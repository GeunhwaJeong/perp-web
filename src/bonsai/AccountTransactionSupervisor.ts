import { BonsaiCore } from '@/bonsai/ontology';
import { OrderStatus, SubaccountOrder } from '@/bonsai/types/summaryTypes';
import { dAppKit } from '@/haneul/dAppKit';
import {
  eventsOf,
  findPerpAccount,
  hasMarketPosition,
  HaneulTransactionError,
  loadPerpDeployment,
  ORDER_TYPE,
  PerpTransactionBuilder,
  SIDE,
  collateralToUnits,
  priceToUnits,
  sizeToUnits,
  type OrderSpec,
  type PerpAccount,
  type PerpDeployment,
} from '@/haneul/perp';
import { signAndExecute } from '@/haneul/perp/executor';
import { OrderExecution, OrderSide, OrderTimeInForce, OrderType } from '@dydxprotocol/v4-client-js';

import { AnalyticsEvents, TradeMetadataSource } from '@/constants/analytics';
import { STRING_KEYS } from '@/constants/localization';
import { isDev } from '@/constants/networks';
import { MARKET_ORDER_MAX_SLIPPAGE, PlaceOrderStatuses } from '@/constants/trade';

import type { RootStore } from '@/state/_store';
import { store as reduxStore } from '@/state/_store';
import { getUserWalletAddress } from '@/state/accountInfoSelectors';
import {
  cancelAllSubmitted,
  cancelOrderConfirmed,
  cancelOrderFailed,
  cancelOrderSubmitted,
  closeAllPositionsSubmitted,
  placeOrderConfirmed,
  placeOrderFailed,
  placeOrderSubmitted,
} from '@/state/localOrders';

import { track } from '@/lib/analytics/analytics';
import { operationFailureToErrorParams, wrapSimpleError } from '@/lib/errorHelpers';

import { TradeFormPayload } from './forms/trade/types';
import { PlaceOrderPayload } from './forms/triggers/types';
import {
  isOperationFailure,
  isOperationSuccess,
  OperationResult,
  wrapOperationFailure,
  wrapOperationSuccess,
} from './lib/operationResult';
import { logBonsaiError, logBonsaiInfo } from './logs';

const FN = 'AccountTransactionSupervisor';

type Context = {
  deployment: PerpDeployment;
  builder: PerpTransactionBuilder;
  address: string;
  account: PerpAccount;
};

type PlacedOrder = { clientId: string; orderId?: string; filled: boolean };

const isMarketOrder = (payload: PlaceOrderPayload) => payload.type === OrderType.MARKET;

const isTriggerOrder = (payload: PlaceOrderPayload) =>
  payload.type === OrderType.STOP_LIMIT ||
  payload.type === OrderType.STOP_MARKET ||
  payload.type === OrderType.TAKE_PROFIT_LIMIT ||
  payload.type === OrderType.TAKE_PROFIT_MARKET;

/** Maps the form's time-in-force and execution options onto the engine's order type code. */
const orderTypeCode = (payload: PlaceOrderPayload) => {
  if ((payload.postOnly ?? false) || payload.execution === OrderExecution.POST_ONLY) {
    return ORDER_TYPE.POST_ONLY;
  }
  if (payload.execution === OrderExecution.FOK || payload.timeInForce === OrderTimeInForce.FOK) {
    return ORDER_TYPE.FOK;
  }
  if (payload.execution === OrderExecution.IOC || payload.timeInForce === OrderTimeInForce.IOC) {
    return ORDER_TYPE.IOC;
  }
  return ORDER_TYPE.GTC;
};

const toOrderSpec = (
  payload: PlaceOrderPayload,
  market: PerpDeployment['markets'][string]
): OrderSpec => {
  const isAsk = payload.side === OrderSide.SELL ? SIDE.ASK : SIDE.BID;
  const size = sizeToUnits(payload.size, market.lotSize);
  if (isMarketOrder(payload)) {
    return { kind: 'market', isAsk, size, reduceOnly: payload.reduceOnly ?? false };
  }
  return {
    kind: 'limit',
    isAsk,
    size,
    price: priceToUnits(payload.price, market.tickSize),
    orderType: orderTypeCode(payload),
    clientOrderId: BigInt(payload.clientId),
    reduceOnly: payload.reduceOnly ?? false,
    expirationTimestampMs:
      payload.goodTilTimeInSeconds != null && payload.goodTilTimeInSeconds > 0
        ? BigInt(Date.now() + payload.goodTilTimeInSeconds * 1000)
        : undefined,
  };
};

const failure = (message: string, stringKey?: string) =>
  wrapSimpleError(FN, message, stringKey ?? STRING_KEYS.SOMETHING_WENT_WRONG);

/**
 * Write path for the perpetuals engine. Orders, cancels and closes become programmable
 * transactions signed by the connected wallet; on-chain finality is the confirmation, so
 * local order state is updated from the transaction's events rather than from an indexer.
 */
export class AccountTransactionSupervisor {
  private store: RootStore;

  private accounts = new Map<string, PerpAccount>();

  private positions = new Set<string>();

  /** Engine order id -> market, for orders placed in this session. */
  private orderMarkets = new Map<string, string>();

  constructor(store: RootStore) {
    this.store = store;
  }

  /** Orders placed through this supervisor, so cancels can find their market before an indexer exists. */
  knownOrderMarket(orderId: string) {
    return this.orderMarkets.get(orderId);
  }

  forgetAccount() {
    this.accounts.clear();
    this.positions.clear();
  }

  private async context(): Promise<OperationResult<Context>> {
    const network = dAppKit.stores.$currentNetwork.get();
    const deployment = await loadPerpDeployment(network);
    if (!deployment) {
      return failure(`No perpetuals deployment configured for ${network}`);
    }
    const address = getUserWalletAddress(this.store.getState());
    if (!address) {
      return failure('No wallet connected', STRING_KEYS.NO_LOCAL_WALLET);
    }
    let account = this.accounts.get(`${network}:${address}`);
    if (!account) {
      account = await findPerpAccount(dAppKit.getClient(), deployment, address);
      if (!account) {
        return failure('Deposit collateral to open a trading account first');
      }
      this.accounts.set(`${network}:${address}`, account);
    }
    return wrapOperationSuccess({
      deployment,
      builder: new PerpTransactionBuilder(deployment),
      address,
      account,
    });
  }

  private async ensurePosition(ctx: Context, marketId: string) {
    const key = `${ctx.deployment.network}:${ctx.account.account}:${marketId}`;
    if (this.positions.has(key)) return false;
    const exists = await hasMarketPosition(
      dAppKit.getClient(),
      ctx.deployment,
      marketId,
      ctx.account.accountId,
      ctx.address
    );
    if (exists) {
      this.positions.add(key);
      return false;
    }
    return true;
  }

  private markPosition(ctx: Context, marketId: string) {
    this.positions.add(`${ctx.deployment.network}:${ctx.account.account}:${marketId}`);
  }

  private toFailure(error: unknown): OperationResult<never> {
    if (error instanceof HaneulTransactionError) {
      logBonsaiError(FN, error.message, { abort: error.abort, digest: error.digest });
      return wrapOperationFailure(error.message, undefined);
    }
    const message = error instanceof Error ? error.message : String(error);
    logBonsaiError(FN, message, { error });
    return wrapOperationFailure(message, undefined);
  }

  /**
   * Places every payload of one market in a single session. Isolated-margin transfers
   * become collateral allocations, and the first order on a market creates the position
   * at the market's initial margin ratio.
   */
  private async executeSession(
    ctx: Context,
    marketId: string,
    payloads: PlaceOrderPayload[],
    source: TradeMetadataSource
  ): Promise<OperationResult<PlacedOrder[]>> {
    const market = ctx.deployment.markets[marketId];
    if (!market) return failure(`Market ${marketId} is not available on ${ctx.deployment.network}`);
    const createPosition = await this.ensurePosition(ctx, marketId);
    const allocate = payloads.reduce((sum, p) => sum + (p.transferToSubaccountAmount ?? 0), 0);
    const tx = ctx.builder.session({
      ref: { account: ctx.account.account, cap: ctx.account.cap },
      marketId,
      orders: payloads.map((p) => toOrderSpec(p, market)),
      options: {
        createPosition,
        initialMarginRatio: createPosition ? BigInt(market.initialMarginRatio) : undefined,
        allocate:
          allocate > 0
            ? collateralToUnits(allocate, ctx.deployment.collateral.decimals)
            : undefined,
        allocateMissingMargin: true,
        deallocateFreeCollateral: false,
      },
    });
    try {
      const result = await signAndExecute(tx);
      this.markPosition(ctx, marketId);
      const posted = eventsOf(result.events, '::events::PostedOrder');
      const placed: PlacedOrder[] = payloads.map((p) => {
        const match = posted.find((e) => String(e.client_order_id ?? '') === String(p.clientId));
        const orderId = match ? String(match.order_id) : undefined;
        if (orderId) this.orderMarkets.set(orderId, marketId);
        return { clientId: `${p.clientId}`, orderId, filled: isMarketOrder(p) || !orderId };
      });
      logBonsaiInfo(FN, 'session executed', { digest: result.digest, marketId, placed, source });
      return wrapOperationSuccess(placed);
    } catch (error) {
      return this.toFailure(error);
    }
  }

  public async placeOrder(
    payload: PlaceOrderPayload,
    source: TradeMetadataSource
  ): Promise<OperationResult<any>> {
    if (isTriggerOrder(payload)) {
      return failure('Conditional orders are not available yet');
    }
    this.store.dispatch(
      placeOrderSubmitted({
        marketId: payload.marketId,
        clientId: `${payload.clientId}`,
        orderType: payload.type,
        subaccountNumber: payload.subaccountNumber,
      })
    );
    track(
      AnalyticsEvents.TradePlaceOrder({ ...payload, source, volume: payload.size * payload.price })
    );

    const ctx = await this.context();
    const result = isOperationFailure(ctx)
      ? ctx
      : await this.executeSession(ctx.payload, payload.marketId, [payload], source);
    this.settlePlacements(result, [payload]);
    return result;
  }

  public async placeCompoundOrder(order: TradeFormPayload, source: TradeMetadataSource) {
    const main = order.orderPayload;
    const scale = order.scaleOrderPayloads ?? [];
    const triggers = (order.triggersPayloads ?? []).filter((t) => t.placePayload != null);
    if (triggers.length > 0) {
      return failure('Conditional orders are not available yet');
    }
    const payloads = [main, ...scale].filter((p): p is PlaceOrderPayload => p != null);
    if (payloads.length === 0) return wrapOperationSuccess(true);
    if (payloads.length === 1) return this.placeOrder(payloads[0]!, source);

    const marketId = payloads[0]!.marketId;
    if (payloads.some((p) => p.marketId !== marketId)) {
      return failure('All orders of one submission must target the same market');
    }
    payloads.forEach((p) =>
      this.store.dispatch(
        placeOrderSubmitted({
          marketId: p.marketId,
          clientId: `${p.clientId}`,
          orderType: p.type,
          subaccountNumber: p.subaccountNumber,
        })
      )
    );
    const ctx = await this.context();
    const result = isOperationFailure(ctx)
      ? ctx
      : await this.executeSession(ctx.payload, marketId, payloads, source);
    this.settlePlacements(result, payloads);
    return result;
  }

  private settlePlacements(result: OperationResult<PlacedOrder[]>, payloads: PlaceOrderPayload[]) {
    if (isOperationFailure(result)) {
      payloads.forEach((p) =>
        this.store.dispatch(
          placeOrderFailed({
            clientId: `${p.clientId}`,
            errorParams: operationFailureToErrorParams(result),
          })
        )
      );
      return;
    }
    result.payload.forEach((placed) =>
      this.store.dispatch(
        placeOrderConfirmed({
          clientId: placed.clientId,
          orderId: placed.orderId,
          status: placed.filled ? PlaceOrderStatuses.Filled : PlaceOrderStatuses.Placed,
        })
      )
    );
  }

  private resolveOrderMarket(
    orderId: string
  ): { marketId: string; order?: SubaccountOrder } | undefined {
    const known = this.orderMarkets.get(orderId);
    const order = BonsaiCore.account.allOrders
      .data(this.store.getState())
      .find((o) => o.id === orderId);
    const marketId = known ?? order?.marketId;
    return marketId ? { marketId, order } : undefined;
  }

  public async cancelOrder({
    orderId,
    withNotification = true,
  }: {
    orderId: string;
    withNotification?: boolean;
  }): Promise<OperationResult<any>> {
    const uuid = crypto.randomUUID();
    const resolved = this.resolveOrderMarket(orderId);
    if (!resolved) {
      return failure('Order not found', STRING_KEYS.NO_ORDERS_TO_CANCEL);
    }
    if (withNotification && resolved.order) {
      this.store.dispatch(cancelOrderSubmitted({ order: resolved.order, orderId, uuid }));
    }
    track(AnalyticsEvents.TradeCancelOrder({ orderId }));
    const result = await this.cancelIds({ [resolved.marketId]: [orderId] });
    if (isOperationFailure(result)) {
      if (withNotification) {
        this.store.dispatch(
          cancelOrderFailed({ uuid, errorParams: operationFailureToErrorParams(result) })
        );
      }
    } else if (withNotification) {
      this.store.dispatch(cancelOrderConfirmed({ uuid }));
    }
    return result;
  }

  private async cancelIds(
    byMarket: Record<string, string[]>
  ): Promise<OperationResult<{ canceled: string[] }>> {
    const ctx = await this.context();
    if (isOperationFailure(ctx)) return ctx;
    const ids: Record<string, bigint[]> = {};
    try {
      Object.entries(byMarket).forEach(([marketId, list]) => {
        ids[marketId] = list.map((id) => BigInt(id));
      });
    } catch {
      return failure('Order id is not a native order id', STRING_KEYS.NO_ORDERS_TO_CANCEL);
    }
    try {
      const tx = ctx.payload.builder.cancelOrdersAcrossMarkets({
        ref: { account: ctx.payload.account.account, cap: ctx.payload.account.cap },
        byMarket: ids,
      });
      const result = await signAndExecute(tx);
      const canceled = eventsOf(result.events, '::events::CanceledOrder').map((e) =>
        String(e.order_id)
      );
      canceled.forEach((id) => this.orderMarkets.delete(id));
      logBonsaiInfo(FN, 'orders canceled', { digest: result.digest, canceled });
      return wrapOperationSuccess({ canceled });
    } catch (error) {
      return this.toFailure(error);
    }
  }

  public async cancelAllOrders({ marketId }: { marketId?: string }): Promise<OperationResult<any>> {
    track(AnalyticsEvents.TradeCancelAllOrdersClick({ marketId }));
    const state = this.store.getState();
    const openOrders = BonsaiCore.account.allOrders
      .data(state)
      .filter(
        (o) => o.status === OrderStatus.Open && (marketId == null || o.marketId === marketId)
      );
    const byMarket: Record<string, string[]> = {};
    openOrders.forEach((o) => {
      (byMarket[o.marketId] ??= []).push(o.id);
    });
    this.orderMarkets.forEach((m, id) => {
      if (marketId != null && m !== marketId) return;
      if (!(byMarket[m] ?? []).includes(id)) (byMarket[m] ??= []).push(id);
    });
    if (Object.values(byMarket).every((l) => l.length === 0)) {
      return failure('No orders to cancel', STRING_KEYS.NO_ORDERS_TO_CANCEL);
    }
    const cancels = openOrders.map((order) => ({
      uuid: crypto.randomUUID(),
      orderId: order.id,
      order,
    }));
    if (cancels.length > 0) {
      this.store.dispatch(cancelAllSubmitted({ marketId, cancels }));
    }
    const result = await this.cancelIds(byMarket);
    if (isOperationSuccess(result)) {
      cancels.forEach((c) => this.store.dispatch(cancelOrderConfirmed({ uuid: c.uuid })));
    } else {
      cancels.forEach((c) =>
        this.store.dispatch(
          cancelOrderFailed({ uuid: c.uuid, errorParams: operationFailureToErrorParams(result) })
        )
      );
    }
    return result;
  }

  /** Closes every open position with reduce-only market orders, one session per market. */
  public async closeAllPositions(): Promise<OperationResult<any>> {
    track(AnalyticsEvents.TradeCloseAllPositionsClick({}));
    const positions =
      BonsaiCore.account.parentSubaccountPositions.data(this.store.getState()) ?? [];
    const open = positions.filter((p) => p.status === 'OPEN' && !p.unsignedSize.isZero());
    if (open.length === 0) {
      return failure('No positions to close', STRING_KEYS.NO_POSITIONS_TO_CLOSE);
    }
    const markets = BonsaiCore.markets.markets.data(this.store.getState());
    const unpriced = open.find((p) => !(Number(markets?.[p.market]?.oraclePrice) > 0));
    if (unpriced) {
      return failure(`No market price for ${unpriced.market} to bound the close`);
    }
    const payloads: PlaceOrderPayload[] = open.map((p) => ({
      subaccountNumber: p.subaccountNumber,
      transferToSubaccountAmount: undefined,
      marketId: p.market,
      clobPairId: 0,
      type: OrderType.MARKET,
      side: p.side === 'LONG' ? OrderSide.SELL : OrderSide.BUY,
      // Closing a long sells, so its worst price sits below the market price; a short buys above.
      price:
        Number(markets![p.market]!.oraclePrice) *
        (p.side === 'LONG' ? 1 - MARKET_ORDER_MAX_SLIPPAGE : 1 + MARKET_ORDER_MAX_SLIPPAGE),
      size: p.unsignedSize.toNumber(),
      clientId: Math.floor(Math.random() * 2 ** 31),
      timeInForce: undefined,
      goodTilTimeInSeconds: undefined,
      execution: OrderExecution.IOC,
      postOnly: false,
      reduceOnly: true,
      triggerPrice: undefined,
      marketInfo: undefined,
      currentHeight: undefined,
      goodTilBlock: undefined,
      memo: undefined,
      twapParameters: undefined,
    }));
    this.store.dispatch(
      closeAllPositionsSubmitted(
        payloads.map((p) => ({
          marketId: p.marketId,
          clientId: `${p.clientId}`,
          orderType: p.type,
          subaccountNumber: p.subaccountNumber,
        }))
      )
    );
    const ctx = await this.context();
    if (isOperationFailure(ctx)) {
      this.settlePlacements(ctx, payloads);
      return ctx;
    }
    // Sessions are one transaction each; run them in order so a failure stops the rest.
    const results = await payloads.reduce<Promise<OperationResult<PlacedOrder[]>[]>>(
      async (previous, payload) => {
        const done = await previous;
        if (done.some(isOperationFailure)) return done;
        const r = await this.executeSession(
          ctx.payload,
          payload.marketId,
          [payload],
          'CloseAllPositionsButton'
        );
        this.settlePlacements(r, [payload]);
        return [...done, r];
      },
      Promise.resolve([])
    );
    const failed = results.find(isOperationFailure);
    return failed ?? wrapOperationSuccess({ results });
  }

  public tearDown(): void {
    this.forgetAccount();
    this.orderMarkets.clear();
  }
}

export const accountTransactionManager = new AccountTransactionSupervisor(reduxStore);

if (isDev && typeof window !== 'undefined') {
  // Lets the localnet browser suite connect the dev wallet and drive the write path directly.
  (window as unknown as { haneulPerp: unknown }).haneulPerp = {
    supervisor: accountTransactionManager,
    dAppKit,
  };
}

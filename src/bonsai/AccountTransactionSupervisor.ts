import { BonsaiCore } from '@/bonsai/ontology';
import { OrderStatus, SubaccountOrder } from '@/bonsai/types/summaryTypes';
import { dAppKit } from '@/haneul/dAppKit';
import {
  eventsOf,
  fetchPriceUpdates,
  findPerpAccount,
  hasMarketPosition,
  HaneulTransactionError,
  imrToLeverage,
  leverageToImr,
  listCollateralCoins,
  loadPerpDeployment,
  ORDER_TYPE,
  PerpTransactionBuilder,
  SIDE,
  collateralToUnits,
  limitPriceToUnits,
  priceToUnits,
  readAccount,
  readPosition,
  selectPriceUpdates,
  sizeToUnits,
  unitsToCollateral,
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

const NO_FILL_WITHIN_LIMIT = 'No orders on the book within the price limit';

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
    // The engine's market order fills at any price and aborts unless fully filled. Sending an
    // immediate-or-cancel limit at the form's worst price instead keeps the fill within the
    // slippage the trade summary showed, and drops the unfilled rest without reverting the
    // matching work (expired makers it cleared stay cleared).
    return {
      kind: 'limit',
      isAsk,
      size,
      price: limitPriceToUnits(payload.price, isAsk, market.tickSize),
      orderType: ORDER_TYPE.IOC,
      clientOrderId: BigInt(payload.clientId),
      reduceOnly: payload.reduceOnly ?? false,
    };
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

  /** Deployment and connected wallet, without requiring a trading account yet. */
  private async walletContext(): Promise<OperationResult<Omit<Context, 'account'>>> {
    const network = dAppKit.stores.$currentNetwork.get();
    const deployment = await loadPerpDeployment(network);
    if (!deployment) {
      return failure(`No perpetuals deployment configured for ${network}`);
    }
    const address = getUserWalletAddress(this.store.getState());
    if (!address) {
      return failure('No wallet connected', STRING_KEYS.NO_LOCAL_WALLET);
    }
    return wrapOperationSuccess({
      deployment,
      builder: new PerpTransactionBuilder(deployment),
      address,
    });
  }

  private async context(): Promise<OperationResult<Context>> {
    const wallet = await this.walletContext();
    if (isOperationFailure(wallet)) return wallet;
    const { deployment, address } = wallet.payload;
    const key = `${deployment.network}:${address}`;
    let account = this.accounts.get(key);
    if (!account) {
      account = await findPerpAccount(dAppKit.getClient(), deployment, address);
      if (!account) {
        return failure('Deposit collateral to open a trading account first');
      }
      this.accounts.set(key, account);
    }
    return wrapOperationSuccess({ ...wallet.payload, account });
  }

  /** Drops the cached account so the next operation reads its balance and caps again. */
  private forgetWalletAccount(deployment: PerpDeployment, address: string) {
    this.accounts.delete(`${deployment.network}:${address}`);
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

  /**
   * Signed prices for a trade on `marketId`, fetched from the price service right before
   * signing so the trade does not depend on the relayer having landed its last round. Empty
   * when the service is unreachable; the trade then reads whatever the chain holds.
   */
  private async priceUpdatesFor(ctx: Context, marketId: string) {
    const market = ctx.deployment.markets[marketId];
    if (!market || !ctx.deployment.oracle) return [];
    const served = await fetchPriceUpdates(ctx.deployment);
    const selected = await selectPriceUpdates({
      client: dAppKit.getClient(),
      deployment: ctx.deployment,
      market,
      updates: served,
    });
    if (served.length === 0) {
      logBonsaiInfo(FN, 'no signed prices from the price service', { marketId });
    }
    return selected;
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
    if (payloads.some((p) => isMarketOrder(p) && !(p.price > 0))) {
      return failure('Market order has no worst-price limit');
    }
    const [createPosition, priceUpdates] = await Promise.all([
      this.ensurePosition(ctx, marketId),
      this.priceUpdatesFor(ctx, marketId),
    ]);
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
      priceUpdates,
    });
    try {
      const result = await signAndExecute(tx);
      this.markPosition(ctx, marketId);
      // The engine emits a taker fill event only when the session filled something. A market
      // order that matched nothing inside its limit can still succeed (it may have cleared
      // expired makers on the way), so report it as not filled rather than filled.
      const takerFilled = eventsOf(result.events, '::events::FilledTakerOrder').length > 0;
      if (payloads.some(isMarketOrder) && !takerFilled) {
        logBonsaiInfo(FN, 'market order not filled within its limit', {
          digest: result.digest,
          marketId,
          source,
        });
        return failure(NO_FILL_WITHIN_LIMIT);
      }
      const posted = eventsOf(result.events, '::events::PostedOrder');
      const placed: PlacedOrder[] = payloads.map((p) => {
        const match = posted.find((e) => String(e.client_order_id ?? '') === String(p.clientId));
        const orderId = match ? String(match.order_id) : undefined;
        if (orderId) this.orderMarkets.set(orderId, marketId);
        return { clientId: `${p.clientId}`, orderId, filled: isMarketOrder(p) || !orderId };
      });
      logBonsaiInfo(FN, 'session executed', {
        digest: result.digest,
        marketId,
        placed,
        source,
        relayedPrices: priceUpdates.map((u) => u.symbol),
      });
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

  // ---------------------------------------------------------------- funds and leverage

  /** Engine market of a dYdX clob pair id; the indexer numbers markets by clob pair. */
  public marketIdForClobPair(clobPairId: number | string): string | undefined {
    const markets = BonsaiCore.markets.markets.data(this.store.getState()) ?? {};
    return Object.values(markets).find((m) => String(m.clobPairId) === String(clobPairId))?.ticker;
  }

  /**
   * Engine market of a child subaccount. The indexer presents the account balance as parent
   * subaccount 0 and the account's collateral in market number `i` as child `128 * (i + 1)`,
   * the numbering dYdX gives isolated positions.
   */
  public marketIdForSubaccount(subaccountNumber: number): string | undefined {
    if (subaccountNumber < 128) return undefined;
    return this.marketIdForClobPair(Math.floor(subaccountNumber / 128) - 1);
  }

  /**
   * The collateral the connected wallet holds and the trading account's unallocated balance
   * (what can be withdrawn), both read from chain, in collateral units (e.g. 12.5 TUSD).
   */
  public async collateralBalances(): Promise<
    OperationResult<{ wallet: number; account: number | undefined; symbol: string }>
  > {
    const wallet = await this.walletContext();
    if (isOperationFailure(wallet)) return wallet;
    const { deployment, address } = wallet.payload;
    const { decimals, coinType } = deployment.collateral;
    try {
      const client = dAppKit.getClient();
      const [coins, account] = await Promise.all([
        listCollateralCoins(client, deployment, address),
        findPerpAccount(client, deployment, address),
      ]);
      const held = coins.reduce((sum, c) => sum + c.balance, 0n);
      return wrapOperationSuccess({
        wallet: unitsToCollateral(held, decimals).toNumber(),
        account: account ? unitsToCollateral(account.collateral, decimals).toNumber() : undefined,
        symbol: coinType.split('::').pop() ?? 'USD',
      });
    } catch (error) {
      return this.toFailure(error);
    }
  }

  /**
   * Deposits collateral from the wallet into the trading account, opening the account in the
   * same transaction if the wallet has none yet.
   */
  public async depositCollateral(
    amount: number
  ): Promise<OperationResult<{ digest: string; createdAccount: boolean }>> {
    const wallet = await this.walletContext();
    if (isOperationFailure(wallet)) return wallet;
    const { deployment, builder, address } = wallet.payload;
    const units = collateralToUnits(amount, deployment.collateral.decimals);
    if (units <= 0n) return failure('Enter an amount to deposit', STRING_KEYS.ENTER_AMOUNT);
    try {
      const client = dAppKit.getClient();
      const coins = await listCollateralCoins(client, deployment, address);
      const balance = coins.reduce((sum, c) => sum + c.balance, 0n);
      if (balance < units) {
        return failure('Not enough collateral in the wallet', STRING_KEYS.INSUFFICIENT_BALANCE);
      }
      const account = await findPerpAccount(client, deployment, address);
      const ids = coins.map((c) => c.objectId);
      const tx = account
        ? builder.deposit({
            ref: { account: account.account, cap: account.cap },
            coins: ids,
            amount: units,
          })
        : builder.createAccount({ sender: address, coins: ids, amount: units });
      const result = await signAndExecute(tx);
      this.forgetWalletAccount(deployment, address);
      logBonsaiInfo(FN, 'collateral deposited', {
        digest: result.digest,
        amount,
        createdAccount: !account,
      });
      return wrapOperationSuccess({ digest: result.digest, createdAccount: !account });
    } catch (error) {
      return this.toFailure(error);
    }
  }

  /**
   * Withdraws collateral from the account balance (parent subaccount) to the wallet.
   * Collateral allocated to a market has to be moved back to the balance first.
   */
  public async withdrawCollateral(amount: number): Promise<OperationResult<{ digest: string }>> {
    const ctx = await this.context();
    if (isOperationFailure(ctx)) return ctx;
    const { deployment, builder, address, account } = ctx.payload;
    const units = collateralToUnits(amount, deployment.collateral.decimals);
    if (units <= 0n) return failure('Enter an amount to withdraw', STRING_KEYS.ENTER_AMOUNT);
    try {
      const { collateral } = await readAccount(dAppKit.getClient(), account.account);
      if (collateral < units) {
        return failure(
          'Not enough free collateral on the account balance',
          STRING_KEYS.INSUFFICIENT_BALANCE
        );
      }
      const tx = builder.withdraw({
        ref: { account: account.account, cap: account.cap },
        amount: units,
        recipient: address,
      });
      const result = await signAndExecute(tx);
      this.forgetWalletAccount(deployment, address);
      logBonsaiInfo(FN, 'collateral withdrawn', { digest: result.digest, amount });
      return wrapOperationSuccess({ digest: result.digest });
    } catch (error) {
      return this.toFailure(error);
    }
  }

  /**
   * Moves collateral between the account balance and a market: into the market is
   * `allocate_collateral` (creating the position object on a first visit), out of it is
   * `deallocate_collateral`, whose margin check reads the feeds and so carries signed prices.
   */
  public async transferMargin({
    marketId,
    amount,
    toMarket,
  }: {
    marketId: string;
    amount: number;
    toMarket: boolean;
  }): Promise<OperationResult<{ digest: string }>> {
    const ctx = await this.context();
    if (isOperationFailure(ctx)) return ctx;
    const { deployment, builder, account } = ctx.payload;
    const market = deployment.markets[marketId];
    if (!market) return failure(`Market ${marketId} is not available on ${deployment.network}`);
    const units = collateralToUnits(amount, deployment.collateral.decimals);
    if (units <= 0n) return failure('Enter an amount', STRING_KEYS.ENTER_AMOUNT);
    const ref = { account: account.account, cap: account.cap };
    try {
      let tx;
      if (toMarket) {
        const createPosition = await this.ensurePosition(ctx.payload, marketId);
        tx = builder.allocateCollateral({ ref, marketId, amount: units, createPosition });
      } else {
        const priceUpdates = await this.priceUpdatesFor(ctx.payload, marketId);
        tx = builder.deallocateCollateral({ ref, marketId, amount: units, priceUpdates });
      }
      const result = await signAndExecute(tx);
      this.markPosition(ctx.payload, marketId);
      this.forgetWalletAccount(deployment, ctx.payload.address);
      logBonsaiInfo(FN, 'margin transferred', {
        digest: result.digest,
        marketId,
        amount,
        toMarket,
      });
      return wrapOperationSuccess({ digest: result.digest });
    } catch (error) {
      return this.toFailure(error);
    }
  }

  /**
   * Sets the leverage of the account's position on a market, as the position's initial margin
   * ratio. A market the account has not traded yet gets its position object in the same
   * transaction, so the leverage holds from the first order on.
   */
  public async setMarketLeverage({
    marketId,
    leverage,
  }: {
    marketId: string;
    leverage: number;
  }): Promise<OperationResult<{ digest: string; leverage: number }>> {
    const ctx = await this.context();
    if (isOperationFailure(ctx)) return ctx;
    const { deployment, builder, account } = ctx.payload;
    const market = deployment.markets[marketId];
    if (!market) return failure(`Market ${marketId} is not available on ${deployment.network}`);
    if (!(leverage >= 1)) return failure('Leverage must be at least 1x');
    const maxLeverage = imrToLeverage(market.initialMarginRatio);
    if (leverage > maxLeverage) {
      return failure(`Leverage above the market maximum of ${maxLeverage}x`);
    }
    try {
      const createPosition = await this.ensurePosition(ctx.payload, marketId);
      const tx = builder.setPositionInitialMarginRatio({
        ref: { account: account.account, cap: account.cap },
        marketId,
        initialMarginRatio: leverageToImr(leverage),
        createPosition,
      });
      const result = await signAndExecute(tx);
      this.markPosition(ctx.payload, marketId);
      logBonsaiInfo(FN, 'leverage set', { digest: result.digest, marketId, leverage });
      return wrapOperationSuccess({ digest: result.digest, leverage });
    } catch (error) {
      return this.toFailure(error);
    }
  }

  /**
   * The leverage each of the account's positions trades at, read from the position objects
   * (1 / their initial margin ratio). Markets without a position are left out; a new position
   * opens at its market's ratio.
   */
  public async readMarketLeverages(): Promise<Record<string, number>> {
    const ctx = await this.context();
    if (isOperationFailure(ctx)) return {};
    const { deployment, account } = ctx.payload;
    const client = dAppKit.getClient();
    const entries = await Promise.all(
      Object.keys(deployment.markets).map(async (marketId) => {
        const position = await readPosition(client, deployment, marketId, account.accountId);
        return position && position.initialMarginRatio > 0n
          ? ([marketId, imrToLeverage(position.initialMarginRatio)] as const)
          : undefined;
      })
    );
    return Object.fromEntries(entries.filter((e): e is readonly [string, number] => e != null));
  }

  public tearDown(): void {
    this.forgetAccount();
    this.orderMarkets.clear();
  }
}

export const accountTransactionManager = new AccountTransactionSupervisor(reduxStore);

if (isDev && typeof window !== 'undefined') {
  // Lets the localnet browser suites connect the dev wallet, drive the write path directly and
  // read what the app derives from the indexer.
  (window as unknown as { haneulPerp: unknown }).haneulPerp = {
    supervisor: accountTransactionManager,
    dAppKit,
    BonsaiCore,
  };
}

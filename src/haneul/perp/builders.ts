import { Transaction, type TransactionObjectArgument } from '@haneullabs/haneul/transactions';

import { CLOCK_OBJECT_ID, type PerpDeployment, type PerpMarketConfig, perpTypes } from './config';
import {
  randomSalt,
  standaloneStopCommitment,
  stopLossTakeProfitCommitment,
  twapCommitment,
  type StandaloneStopDetails,
  type StopLossTakeProfitDetails,
  type TwapDetails,
} from './tickets';

/**
 * Programmable transaction builders for the perpetuals engine. Every builder returns an
 * unsigned `Transaction`; signing and execution live in the executor so the same
 * transactions can be simulated, signed by a wallet, or driven by a script.
 *
 * Sequences follow the localnet suite (`perp-dex/e2e/localnet_e2e.py`), which is the
 * reference for argument order.
 */

export type PerpAccountRef = {
  /** Shared `Account<T>` object. */
  account: string;
  /** Owned `AuthorityCap<ACCOUNT, ADMIN>` of the signer. */
  cap: string;
};

export type LimitOrderSpec = {
  kind: 'limit';
  isAsk: boolean;
  size: bigint;
  price: bigint;
  orderType: bigint;
  clientOrderId?: bigint;
  reduceOnly: boolean;
  expirationTimestampMs?: bigint;
};

export type MarketOrderSpec = {
  kind: 'market';
  isAsk: boolean;
  size: bigint;
  reduceOnly: boolean;
};

export type OrderSpec = LimitOrderSpec | MarketOrderSpec;

export type SessionOptions = {
  /** Pull missing initial margin from the account balance inside the session. */
  allocateMissingMargin?: boolean;
  /** Return free collateral to the account balance when the session ends. */
  deallocateFreeCollateral?: boolean;
  /** Create the market position first (the first session on a market needs it). */
  createPosition?: boolean;
  /** Set the position initial margin ratio (ifixed) before trading, e.g. after a leverage change. */
  initialMarginRatio?: bigint;
  /** Allocate this much collateral (coin units) to the market before trading. */
  allocate?: bigint;
};

const target = (pkg: string, module: string, fn: string) => `${pkg}::${module}::${fn}`;

export class PerpTransactionBuilder {
  readonly deployment: PerpDeployment;

  private readonly types: ReturnType<typeof perpTypes>;

  constructor(deployment: PerpDeployment) {
    this.deployment = deployment;
    this.types = perpTypes(deployment);
  }

  get perp() {
    return this.deployment.packages.perpetuals;
  }

  get coinType() {
    return this.deployment.collateral.coinType;
  }

  market(marketId: string): PerpMarketConfig {
    const market = this.deployment.markets[marketId];
    if (!market)
      throw new Error(`Market ${marketId} is not deployed on ${this.deployment.network}`);
    return market;
  }

  /**
   * Create a trading account owned by `sender`, fund it from `coins` and share it. The
   * authority cap is transferred to the sender; the shared account id is in the
   * `CreatedAccount` event.
   */
  createAccount({ sender, coins, amount }: { sender: string; coins: string[]; amount: bigint }) {
    const tx = new Transaction();
    const created = tx.moveCall({
      target: target(this.perp, 'account', 'create_account'),
      typeArguments: [this.coinType],
      arguments: [tx.object(this.deployment.registry)],
    });
    const [account, policy, cap] = [created[0]!, created[1]!, created[2]!];
    if (amount > 0n) {
      const coin = this.mergedCoin(tx, coins, amount);
      tx.moveCall({
        target: target(this.perp, 'account', 'deposit_collateral'),
        typeArguments: [this.coinType, this.types.admin],
        arguments: [account, cap, tx.object(this.deployment.registry), coin],
      });
    }
    tx.moveCall({
      target: target(this.perp, 'account', 'consume_policy_and_share_account'),
      typeArguments: [this.coinType],
      arguments: [account, policy],
    });
    tx.transferObjects([cap], sender);
    return tx;
  }

  deposit({ ref, coins, amount }: { ref: PerpAccountRef; coins: string[]; amount: bigint }) {
    const tx = new Transaction();
    const coin = this.mergedCoin(tx, coins, amount);
    tx.moveCall({
      target: target(this.perp, 'account', 'deposit_collateral'),
      typeArguments: [this.coinType, this.types.admin],
      arguments: [
        tx.object(ref.account),
        tx.object(ref.cap),
        tx.object(this.deployment.registry),
        coin,
      ],
    });
    return tx;
  }

  withdraw({ ref, amount, recipient }: { ref: PerpAccountRef; amount: bigint; recipient: string }) {
    const tx = new Transaction();
    const coin = tx.moveCall({
      target: target(this.perp, 'account', 'withdraw_collateral'),
      typeArguments: [this.coinType],
      arguments: [
        tx.object(ref.account),
        tx.object(ref.cap),
        tx.object(this.deployment.registry),
        tx.pure.u64(amount),
      ],
    });
    tx.transferObjects([coin[0]!], recipient);
    return tx;
  }

  allocateCollateral({
    ref,
    marketId,
    amount,
  }: {
    ref: PerpAccountRef;
    marketId: string;
    amount: bigint;
  }) {
    const tx = new Transaction();
    this.addAllocate(tx, ref, this.market(marketId), amount);
    return tx;
  }

  deallocateCollateral({
    ref,
    marketId,
    amount,
  }: {
    ref: PerpAccountRef;
    marketId: string;
    amount: bigint;
  }) {
    const tx = new Transaction();
    const market = this.market(marketId);
    tx.moveCall({
      target: target(this.perp, 'clearing_house', 'deallocate_collateral'),
      typeArguments: [this.coinType, this.types.admin],
      arguments: [
        tx.object(market.clearingHouse),
        tx.object(ref.cap),
        tx.object(ref.account),
        tx.object(market.basePriceFeedStorage),
        tx.object(this.deployment.collateral.priceFeedStorage),
        tx.pure.u64(amount),
        tx.object(CLOCK_OBJECT_ID),
      ],
    });
    return tx;
  }

  setPositionInitialMarginRatio({
    ref,
    marketId,
    initialMarginRatio,
  }: {
    ref: PerpAccountRef;
    marketId: string;
    initialMarginRatio: bigint;
  }) {
    const tx = new Transaction();
    this.addSetImr(tx, ref, this.market(marketId), initialMarginRatio);
    return tx;
  }

  createMarketPosition({ ref, marketId }: { ref: PerpAccountRef; marketId: string }) {
    const tx = new Transaction();
    this.addCreatePosition(tx, ref, this.market(marketId));
    return tx;
  }

  /**
   * One trading session: optional position setup, then every order inside a single
   * hot-potato session so the margin check happens once, then the clearing house is
   * shared again.
   */
  session({
    ref,
    marketId,
    orders,
    options = {},
  }: {
    ref: PerpAccountRef;
    marketId: string;
    orders: OrderSpec[];
    options?: SessionOptions;
  }) {
    if (orders.length === 0) throw new Error('A session needs at least one order');
    const tx = new Transaction();
    const market = this.market(marketId);
    if (options.createPosition) this.addCreatePosition(tx, ref, market);
    if (options.initialMarginRatio != null)
      this.addSetImr(tx, ref, market, options.initialMarginRatio);
    if (options.allocate != null && options.allocate > 0n)
      this.addAllocate(tx, ref, market, options.allocate);

    const noIntegrator = tx.moveCall({
      target: '0x1::option::none',
      typeArguments: [this.types.integratorInfo],
    });
    const session = tx.moveCall({
      target: target(this.perp, 'clearing_house', 'start_session'),
      typeArguments: [this.coinType, this.types.admin],
      arguments: [
        tx.object(market.clearingHouse),
        tx.object(ref.cap),
        tx.object(ref.account),
        tx.object(market.basePriceFeedStorage),
        tx.object(this.deployment.collateral.priceFeedStorage),
        noIntegrator[0]!,
        tx.object(CLOCK_OBJECT_ID),
      ],
    });

    orders.forEach((order) => {
      if (order.kind === 'limit') {
        tx.moveCall({
          target: target(this.perp, 'clearing_house', 'place_limit_order'),
          typeArguments: [this.coinType],
          arguments: [
            session[0]!,
            tx.pure.bool(order.isAsk),
            tx.pure.u64(order.size),
            tx.pure.u64(order.price),
            tx.pure.u64(order.orderType),
            tx.pure.option('u64', order.clientOrderId ?? null),
            tx.pure.bool(order.reduceOnly),
            tx.pure.option('u64', order.expirationTimestampMs ?? null),
          ],
        });
      } else {
        tx.moveCall({
          target: target(this.perp, 'clearing_house', 'place_market_order'),
          typeArguments: [this.coinType],
          arguments: [
            session[0]!,
            tx.pure.bool(order.isAsk),
            tx.pure.u64(order.size),
            tx.pure.bool(order.reduceOnly),
          ],
        });
      }
    });

    const clearingHouse = tx.moveCall({
      target: target(this.perp, 'clearing_house', 'end_session'),
      typeArguments: [this.coinType, this.types.admin],
      arguments: [
        session[0]!,
        tx.object(ref.cap),
        tx.object(ref.account),
        tx.pure.bool(options.allocateMissingMargin ?? true),
        tx.pure.bool(options.deallocateFreeCollateral ?? false),
      ],
    });
    tx.moveCall({
      target: target(this.perp, 'clearing_house', 'share'),
      typeArguments: [this.coinType],
      arguments: [clearingHouse[0]!],
    });
    return tx;
  }

  cancelOrders({
    ref,
    marketId,
    orderIds,
  }: {
    ref: PerpAccountRef;
    marketId: string;
    orderIds: bigint[];
  }) {
    if (orderIds.length === 0) throw new Error('No orders to cancel');
    const tx = new Transaction();
    this.addCancel(tx, ref, this.market(marketId), orderIds);
    return tx;
  }

  /** Cancels on several markets in one transaction. */
  cancelOrdersAcrossMarkets({
    ref,
    byMarket,
  }: {
    ref: PerpAccountRef;
    byMarket: Record<string, bigint[]>;
  }) {
    const tx = new Transaction();
    let count = 0;
    Object.entries(byMarket).forEach(([marketId, ids]) => {
      if (ids.length === 0) return;
      count += ids.length;
      this.addCancel(tx, ref, this.market(marketId), ids);
    });
    if (count === 0) throw new Error('No orders to cancel');
    return tx;
  }

  /**
   * Stop-loss / take-profit attached to the current position (ticket type 0). Returns the
   * transaction and the details the executor needs; the chain only stores the commitment.
   */
  stopLossTakeProfitTicket({
    ref,
    details,
    executors,
  }: {
    ref: PerpAccountRef;
    details: Omit<StopLossTakeProfitDetails, 'salt'> & { salt?: Uint8Array };
    /** Keeper addresses allowed to execute; defaults to the deployment's executors. */
    executors?: string[];
  }) {
    const full: StopLossTakeProfitDetails = { ...details, salt: details.salt ?? randomSalt() };
    const commitment = stopLossTakeProfitCommitment(full);
    return { tx: this.ticketTx(ref, 0n, commitment, executors), details: full };
  }

  /** Standalone stop order (ticket type 1): trigger on the index price, then place an order. */
  standaloneStopTicket({
    ref,
    details,
    executors,
  }: {
    ref: PerpAccountRef;
    details: Omit<StandaloneStopDetails, 'salt'> & { salt?: Uint8Array };
    executors?: string[];
  }) {
    const full: StandaloneStopDetails = { ...details, salt: details.salt ?? randomSalt() };
    const commitment = standaloneStopCommitment(full);
    return { tx: this.ticketTx(ref, 1n, commitment, executors), details: full };
  }

  cancelStopTicket({
    ref,
    ticketId,
    recipient,
  }: {
    ref: PerpAccountRef;
    ticketId: string;
    recipient: string;
  }) {
    const tx = new Transaction();
    const gas = tx.moveCall({
      target: target(this.deployment.packages.perpetualsOrders, 'stop_orders', 'cancel'),
      typeArguments: [this.coinType, this.types.admin],
      arguments: [
        tx.object(ref.account),
        tx.object(ref.cap),
        tx.object(this.deployment.registry),
        tx.pure.id(ticketId),
      ],
    });
    tx.transferObjects([gas[0]!], recipient);
    return tx;
  }

  twapTicket({
    ref,
    marketId,
    details,
    executors,
  }: {
    ref: PerpAccountRef;
    marketId: string;
    details: Omit<TwapDetails, 'salt'> & { salt?: Uint8Array };
    executors?: string[];
  }) {
    const full: TwapDetails = { ...details, salt: details.salt ?? randomSalt() };
    const commitment = twapCommitment(full);
    const market = this.market(marketId);
    const tx = new Transaction();
    const gas = tx.splitCoins(tx.gas, [tx.pure.u64(BigInt(this.deployment.ticketGas))]);
    tx.moveCall({
      target: target(
        this.deployment.packages.perpetualsOrders,
        'twap_orders',
        'create_twap_order_ticket'
      ),
      typeArguments: [this.coinType, this.types.admin],
      arguments: [
        tx.object(ref.account),
        tx.object(ref.cap),
        tx.object(market.clearingHouse),
        tx.object(this.deployment.registry),
        tx.pure.vector('address', executors ?? this.deployment.ticketExecutors),
        tx.pure.option('address', null),
        gas[0]!,
        tx.pure.vector('u8', Array.from(commitment)),
      ],
    });
    return { tx, details: full };
  }

  cancelTwapTicket({
    ref,
    marketId,
    ticketId,
    recipient,
  }: {
    ref: PerpAccountRef;
    marketId: string;
    ticketId: string;
    recipient: string;
  }) {
    const market = this.market(marketId);
    const tx = new Transaction();
    const gas = tx.moveCall({
      target: target(
        this.deployment.packages.perpetualsOrders,
        'twap_orders',
        'user_cancel_twap_order'
      ),
      typeArguments: [this.coinType, this.types.admin],
      arguments: [
        tx.object(ref.account),
        tx.object(ref.cap),
        tx.object(market.clearingHouse),
        tx.object(market.basePriceFeedStorage),
        tx.object(this.deployment.collateral.priceFeedStorage),
        tx.pure.id(ticketId),
        tx.object(CLOCK_OBJECT_ID),
        tx.object(this.deployment.registry),
      ],
    });
    tx.transferObjects([gas[0]!], recipient);
    return tx;
  }

  /**
   * Executor side of a standalone stop ticket: reveals the details, lets the engine verify
   * the commitment and places the order. Used by keepers and by the localnet suite to prove
   * the commitment encoding matches the Move side byte for byte.
   */
  executeStandaloneStop({
    ref,
    marketId,
    ticketId,
    details,
    recipient,
  }: {
    ref: PerpAccountRef;
    marketId: string;
    ticketId: string;
    details: StandaloneStopDetails;
    recipient: string;
  }) {
    const market = this.market(marketId);
    const tx = new Transaction();
    const executor = tx.moveCall({
      target: target(this.perp, 'clearing_house', 'no_domain_executor'),
    });
    const noIntegrator = tx.moveCall({
      target: '0x1::option::none',
      typeArguments: [this.types.integratorInfo],
    });
    const result = tx.moveCall({
      target: target(
        this.deployment.packages.perpetualsOrders,
        'stop_orders',
        'place_stop_order_standalone'
      ),
      typeArguments: [this.coinType],
      arguments: [
        tx.object(market.clearingHouse),
        tx.object(market.basePriceFeedStorage),
        tx.object(this.deployment.collateral.priceFeedStorage),
        tx.object(CLOCK_OBJECT_ID),
        tx.object(this.deployment.registry),
        tx.pure.id(ticketId),
        tx.object(ref.account),
        tx.pure.option('u64', details.expireTimestampMs ?? null),
        tx.pure.bool(details.isLimitOrder),
        tx.pure.u8(details.triggerPriceType),
        tx.pure.u256(details.stopIndexPrice),
        tx.pure.bool(details.triggerAtOrAbove),
        tx.pure.bool(details.side),
        tx.pure.u64(details.size),
        tx.pure.u64(details.price),
        tx.pure.u64(details.orderType),
        tx.pure.bool(details.reduceOnly),
        tx.pure.vector('u8', Array.from(details.salt)),
        noIntegrator[0]!,
        executor[0]!,
      ],
    });
    tx.transferObjects([result[1]!], recipient);
    tx.moveCall({
      target: target(this.perp, 'clearing_house', 'share'),
      typeArguments: [this.coinType],
      arguments: [result[2]!],
    });
    return tx;
  }

  /** Read-only: `clearing_house::exists_position` for an account on a market. */
  positionExists({ marketId, accountId }: { marketId: string; accountId: bigint }) {
    const market = this.market(marketId);
    const tx = new Transaction();
    tx.moveCall({
      target: target(this.perp, 'clearing_house', 'exists_position'),
      typeArguments: [this.coinType],
      arguments: [tx.object(market.clearingHouse), tx.pure.u64(accountId)],
    });
    return tx;
  }

  // ---------------------------------------------------------------- pieces

  private ticketTx(
    ref: PerpAccountRef,
    stopOrderType: bigint,
    commitment: Uint8Array,
    executors?: string[]
  ) {
    const tx = new Transaction();
    const gas = tx.splitCoins(tx.gas, [tx.pure.u64(BigInt(this.deployment.ticketGas))]);
    tx.moveCall({
      target: target(
        this.deployment.packages.perpetualsOrders,
        'stop_orders',
        'create_stop_order_ticket'
      ),
      typeArguments: [this.coinType, this.types.admin],
      arguments: [
        tx.object(ref.account),
        tx.object(ref.cap),
        tx.object(this.deployment.registry),
        tx.pure.vector('address', executors ?? this.deployment.ticketExecutors),
        tx.pure.option('address', null),
        gas[0]!,
        tx.pure.u64(stopOrderType),
        tx.pure.vector('u8', Array.from(commitment)),
      ],
    });
    return tx;
  }

  private addCreatePosition(tx: Transaction, ref: PerpAccountRef, market: PerpMarketConfig) {
    tx.moveCall({
      target: target(this.perp, 'clearing_house', 'create_market_position'),
      typeArguments: [this.coinType, this.types.admin],
      arguments: [tx.object(market.clearingHouse), tx.object(ref.cap), tx.object(ref.account)],
    });
  }

  private addSetImr(tx: Transaction, ref: PerpAccountRef, market: PerpMarketConfig, imr: bigint) {
    tx.moveCall({
      target: target(this.perp, 'clearing_house', 'set_position_initial_margin_ratio'),
      typeArguments: [this.coinType, this.types.admin],
      arguments: [
        tx.object(market.clearingHouse),
        tx.object(ref.cap),
        tx.object(ref.account),
        tx.pure.u256(imr),
      ],
    });
  }

  private addAllocate(
    tx: Transaction,
    ref: PerpAccountRef,
    market: PerpMarketConfig,
    amount: bigint
  ) {
    tx.moveCall({
      target: target(this.perp, 'clearing_house', 'allocate_collateral'),
      typeArguments: [this.coinType, this.types.admin],
      arguments: [
        tx.object(market.clearingHouse),
        tx.object(ref.cap),
        tx.object(ref.account),
        tx.pure.u64(amount),
      ],
    });
  }

  private addCancel(
    tx: Transaction,
    ref: PerpAccountRef,
    market: PerpMarketConfig,
    orderIds: bigint[]
  ) {
    const ids = tx.makeMoveVec({ type: 'u128', elements: orderIds.map((id) => tx.pure.u128(id)) });
    tx.moveCall({
      target: target(this.perp, 'clearing_house', 'cancel_orders'),
      typeArguments: [this.coinType, this.types.admin],
      arguments: [tx.object(market.clearingHouse), tx.object(ref.cap), tx.object(ref.account), ids],
    });
  }

  /** Merges the given coin objects and splits exactly `amount` off for the call. */
  private mergedCoin(tx: Transaction, coins: string[], amount: bigint): TransactionObjectArgument {
    if (coins.length === 0) throw new Error('No collateral coins to draw from');
    const [first, ...rest] = coins;
    const primary = tx.object(first!);
    if (rest.length > 0) {
      tx.mergeCoins(
        primary,
        rest.map((c) => tx.object(c))
      );
    }
    const coin = tx.splitCoins(primary, [tx.pure.u64(amount)]);
    return coin!;
  }
}

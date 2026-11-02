import type { PlaceOrderPayload, TriggerOrderActions } from '@/bonsai/forms/triggers/types';
import {
  OrderExecution,
  OrderSide,
  OrderStatus,
  OrderType,
  type PositionUniqueId,
  type SubaccountOrder,
  type SubaccountPosition,
} from '@/bonsai/types/summaryTypes';
import {
  ORDER_TYPE,
  limitPriceToUnits,
  priceToIfixed,
  priceToUnits,
  sizeToUnits,
  type PerpMarketConfig,
  type StandaloneStopDetails,
  type TwapDetails,
} from '@/haneul/perp';
import BigNumber from 'bignumber.js';

import {
  IndexerOrderSide,
  IndexerOrderType,
  IndexerPerpetualPositionStatus,
  IndexerPositionSide,
} from '@/types/indexer/indexerApiGen';
import type { IndexerOrderTicket } from '@/types/indexer/indexerManual';

import { normalizeCommitment, type StoredTicketDetails } from '@/state/ticketDetails';

/**
 * Stop loss / take profit tickets seen as the conditional orders the dYdX screens know. A
 * ticket holds both levels; each becomes an order whose id names the ticket and the level, so
 * the positions table and the triggers form show and edit them as they would two orders, and
 * the account transaction supervisor turns the form's edits back into tickets.
 */

const PREFIX = 'ticket:';

export type TicketLeg = 'sl' | 'tp';

export const ticketOrderId = (ticketId: string, leg: TicketLeg) => `${PREFIX}${ticketId}:${leg}`;

export const parseTicketOrderId = (
  id: string | undefined
): { ticketId: string; leg: TicketLeg } | undefined => {
  if (id == null || !id.startsWith(PREFIX)) return undefined;
  const [ticketId, leg] = id.slice(PREFIX.length).split(':');
  return ticketId && (leg === 'sl' || leg === 'tp') ? { ticketId, leg } : undefined;
};

const IFIXED_ONE = new BigNumber('1e18');
const B9 = new BigNumber('1e9');

/** An open stop loss / take profit ticket this browser has the details of. */
export type OpenStopLossTakeProfit = {
  ticketId: string;
  marketId: string;
  stopLoss?: BigNumber;
  takeProfit?: BigNumber;
  size: BigNumber;
  positionIsAsk: boolean;
  createdAtMs: number;
  updatedAtMs: number;
};

const stored = (
  ticket: IndexerOrderTicket,
  byCommitment: Record<string, StoredTicketDetails>,
  account: string | undefined
) => {
  const entry = byCommitment[normalizeCommitment(ticket.encryptedDetails)];
  return entry != null && (account == null || entry.account === account) ? entry : undefined;
};

const isOpenStop = (ticket: IndexerOrderTicket) =>
  ticket.type === 'STOP' && ticket.status === 'OPEN';

export function openStopLossTakeProfits(
  tickets: IndexerOrderTicket[],
  byCommitment: Record<string, StoredTicketDetails>,
  account?: string
): OpenStopLossTakeProfit[] {
  return tickets.flatMap((ticket) => {
    if (!isOpenStop(ticket) || ticket.stopOrderType !== '0') return [];
    const entry = stored(ticket, byCommitment, account);
    if (entry?.kind !== 'stopLossTakeProfit') return [];
    const d = entry.details;
    const level = (value: unknown) =>
      value == null ? undefined : new BigNumber(String(value)).div(IFIXED_ONE);
    return [
      {
        ticketId: ticket.id,
        marketId: entry.marketId,
        stopLoss: level(d.stopLossPrice),
        takeProfit: level(d.takeProfitPrice),
        size: new BigNumber(String(d.size)).div(B9),
        positionIsAsk: d.positionIsAsk === true,
        createdAtMs: Date.parse(ticket.createdAt),
        updatedAtMs: Date.parse(ticket.updatedAt),
      },
    ];
  });
}

/**
 * The open stop tickets that only reduce a position on a market: stop loss / take profit
 * tickets and reduce-only standalone stops this browser has the details of. Closing the
 * position cancels them, or they would act on the next position the account opens there.
 */
export function openReducingStopTickets(
  tickets: IndexerOrderTicket[],
  byCommitment: Record<string, StoredTicketDetails>,
  account?: string
): Array<{ ticketId: string; marketId: string }> {
  return tickets.flatMap((ticket) => {
    if (!isOpenStop(ticket)) return [];
    const entry = stored(ticket, byCommitment, account);
    if (entry == null) return [];
    const reducing =
      entry.kind === 'stopLossTakeProfit' ||
      (entry.kind === 'standaloneStop' && entry.details.reduceOnly === true);
    return reducing ? [{ ticketId: ticket.id, marketId: entry.marketId }] : [];
  });
}

/** The tickets as the reduce-only conditional orders of the positions they close. */
export function stopLossTakeProfitOrders(
  open: OpenStopLossTakeProfit[],
  positions: SubaccountPosition[],
  clobPairIds: Record<string, number | undefined>
): SubaccountOrder[] {
  return open.flatMap((ticket) => {
    const position = positions.find(
      (p) => p.market === ticket.marketId && p.status === IndexerPerpetualPositionStatus.OPEN
    );
    if (position == null) return [];
    // The order closes the position: a long's sells, a short's buys.
    const side =
      position.side === IndexerPositionSide.LONG ? IndexerOrderSide.SELL : IndexerOrderSide.BUY;
    const order = (leg: TicketLeg, level: BigNumber): SubaccountOrder => ({
      subaccountNumber: position.subaccountNumber,
      id: ticketOrderId(ticket.ticketId, leg),
      // The triggers form needs these to build a cancel; the supervisor reads only the id.
      clientId: '0',
      clobPairId: clobPairIds[ticket.marketId] ?? 0,
      orderFlags: '32',
      positionUniqueId: position.uniqueId as PositionUniqueId,
      type: leg === 'sl' ? IndexerOrderType.STOPMARKET : IndexerOrderType.TAKEPROFITMARKET,
      side,
      status: OrderStatus.Untriggered,
      timeInForce: undefined,
      marketId: ticket.marketId,
      displayId: ticket.ticketId,
      price: level,
      triggerPrice: level,
      size: ticket.size,
      remainingSize: ticket.size,
      totalFilled: new BigNumber(0),
      goodTilBlock: undefined,
      goodTilBlockTimeMilliseconds: undefined,
      goodTilBlockTimeSeconds: undefined,
      createdAtHeight: undefined,
      expiresAtMilliseconds: undefined,
      createdAtMilliseconds: ticket.createdAtMs,
      updatedAtMilliseconds: ticket.updatedAtMs,
      updatedAtHeight: undefined,
      postOnly: false,
      reduceOnly: true,
      removalReason: undefined,
      marginMode: position.marginMode,
    });
    return [
      ...(ticket.stopLoss != null ? [order('sl', ticket.stopLoss)] : []),
      ...(ticket.takeProfit != null ? [order('tp', ticket.takeProfit)] : []),
    ];
  });
}

export type StopLossTakeProfitPlan = {
  /** The tickets the edit replaces or removes. */
  cancelTicketIds: string[];
  /** The ticket to create, holding both levels; none when every level was removed. */
  create?: { stopLoss?: number; takeProfit?: number; size: number };
};

const legOf = (type: OrderType): TicketLeg =>
  type === OrderType.STOP_MARKET || type === OrderType.STOP_LIMIT ? 'sl' : 'tp';

/**
 * What the triggers form's actions come to with tickets. A ticket holds both levels, so a level
 * the form leaves alone is carried over from the ticket it replaces: every edit cancels the
 * market's open ticket and, unless no level is left, creates one ticket with the levels after
 * the edit.
 */
export function planStopLossTakeProfit(
  actions: TriggerOrderActions[],
  existing: OpenStopLossTakeProfit[]
): StopLossTakeProfitPlan {
  const current = existing[0];
  const levels: Record<TicketLeg, number | undefined> = {
    sl: current?.stopLoss?.toNumber(),
    tp: current?.takeProfit?.toNumber(),
  };
  let size = current?.size.toNumber();
  actions.forEach(({ placePayload, cancelPayload }) => {
    if (placePayload != null) {
      levels[legOf(placePayload.type)] = placePayload.triggerPrice;
      size = placePayload.size;
    } else if (cancelPayload != null) {
      const leg = parseTicketOrderId(cancelPayload.orderId)?.leg;
      if (leg != null) levels[leg] = undefined;
    }
  });
  const cancelTicketIds = existing.map((e) => e.ticketId);
  if ((levels.sl == null && levels.tp == null) || size == null || !(size > 0)) {
    return { cancelTicketIds };
  }
  return {
    cancelTicketIds,
    create: { stopLoss: levels.sl, takeProfit: levels.tp, size },
  };
}

// ---------------------------------------------------------------- standalone stops and TWAPs

/** Order types placed as standalone stop tickets. */
export const isStopOrderType = (type: OrderType) =>
  type === OrderType.STOP_LIMIT ||
  type === OrderType.STOP_MARKET ||
  type === OrderType.TAKE_PROFIT_LIMIT ||
  type === OrderType.TAKE_PROFIT_MARKET;

/**
 * Whether a stop triggers once the index rises to its price, rather than falls to it. The trade
 * form names an order a stop or a take profit by where its trigger sits against the oracle price
 * when it is placed (`tradeFormTypeToOrderType`): a stop buys on the way up and sells on the way
 * down, a take profit the other way round.
 */
export const triggersAtOrAbove = (type: OrderType, side: OrderSide) =>
  (type === OrderType.STOP_LIMIT || type === OrderType.STOP_MARKET) === (side === OrderSide.BUY);

type Market = Pick<PerpMarketConfig, 'clearingHouse' | 'lotSize' | 'tickSize'>;

type Planned<T> = { details: Omit<T, 'salt'> } | { error: string };

// Stops and take profits trigger on the index price, the oracle price the forms show.
const TRIGGER_ON_INDEX = 0;

/**
 * How a triggered stop limit order trades. The form shows only its execution; the payload's time
 * in force is a hidden default, as in dYdX's client, which also reads only the execution of a
 * conditional order.
 */
const stopLimitOrderType = (execution: OrderExecution | undefined) => {
  switch (execution) {
    case OrderExecution.IOC:
      return ORDER_TYPE.IOC;
    case OrderExecution.FOK:
      return ORDER_TYPE.FOK;
    case OrderExecution.POST_ONLY:
      return ORDER_TYPE.POST_ONLY;
    default:
      return ORDER_TYPE.GTC;
  }
};

/**
 * A stop or take profit order of the trade form as a standalone stop ticket. A limit order rests
 * at its price with the form's execution; a market order becomes an immediate-or-cancel order at
 * the worst price the form allows (the trigger moved by the form's slippage buffer), so the chain
 * bounds its fill.
 */
export function standaloneStopFromPayload(
  payload: PlaceOrderPayload,
  market: Market,
  nowMs: number
): Planned<StandaloneStopDetails> {
  if (!isStopOrderType(payload.type)) return { error: `${payload.type} is not a stop order` };
  const trigger = payload.triggerPrice;
  if (trigger == null || !(trigger > 0)) return { error: 'The stop order has no trigger price' };
  const isAsk = payload.side === OrderSide.SELL;
  const isLimit =
    payload.type === OrderType.STOP_LIMIT || payload.type === OrderType.TAKE_PROFIT_LIMIT;
  const price = isLimit
    ? priceToUnits(payload.price, market.tickSize)
    : limitPriceToUnits(payload.price, isAsk, market.tickSize);
  const size = sizeToUnits(payload.size, market.lotSize);
  if (!(price > 0n)) return { error: 'The stop order has no price' };
  if (!(size > 0n)) return { error: 'The stop order is smaller than one lot' };
  return {
    details: {
      clearingHouse: market.clearingHouse,
      expireTimestampMs:
        payload.goodTilTimeInSeconds != null && payload.goodTilTimeInSeconds > 0
          ? BigInt(nowMs + payload.goodTilTimeInSeconds * 1000)
          : undefined,
      isLimitOrder: true,
      triggerPriceType: TRIGGER_ON_INDEX,
      stopIndexPrice: priceToIfixed(trigger),
      triggerAtOrAbove: triggersAtOrAbove(payload.type, payload.side),
      side: isAsk,
      size,
      price,
      orderType: isLimit ? stopLimitOrderType(payload.execution) : ORDER_TYPE.IOC,
      reduceOnly: payload.reduceOnly ?? false,
    },
  };
}

/** The most chunks a TWAP may run in: the keeper pays each chunk's gas for now. */
export const MAX_TWAP_CHUNKS = 120;

const max = (a: bigint, b: bigint) => (a > b ? a : b);
const min = (a: bigint, b: bigint) => (a < b ? a : b);

/**
 * A TWAP of the trade form as a TWAP ticket: its duration split into chunks one interval apart,
 * each an immediate-or-cancel order within the form's price tolerance of the mark price. A chunk
 * may run up to its interval's tenth (at most 5 s) early; nothing filled for twice the interval
 * (at least a minute) spoils the order; one execution may take two chunks, so a chunk that found
 * no liquidity is made up by the next; a tail under half a chunk joins the last one. The first
 * chunk must run within two minutes, and the order lapses five minutes after its last chunk was
 * due.
 */
export function twapFromPayload(
  payload: PlaceOrderPayload,
  market: Market,
  nowMs: number
): Planned<TwapDetails> {
  const params = payload.twapParameters;
  if (payload.type !== OrderType.TWAP || params == null) return { error: 'Not a TWAP order' };
  const chunks = Math.round(params.duration / params.interval);
  if (!(chunks >= 2)) return { error: 'A TWAP runs in at least two chunks' };
  if (chunks > MAX_TWAP_CHUNKS) {
    return {
      error: `A TWAP runs in at most ${MAX_TWAP_CHUNKS} chunks; this one would take ${chunks}. Lengthen the frequency.`,
    };
  }
  const lot = BigInt(market.lotSize);
  const size = sizeToUnits(payload.size, market.lotSize);
  if (size / lot < BigInt(chunks)) {
    return { error: `A TWAP in ${chunks} chunks needs at least ${chunks} lots` };
  }
  const gap = BigInt(Math.round(params.interval * 1000));
  const now = BigInt(nowMs);
  return {
    details: {
      firstRunExpireTimestampMs: now + 120_000n,
      expireTimestampMs: now + BigInt(Math.round(params.duration * 1000)) + 2n * gap + 300_000n,
      executionGapMs: gap,
      executionTimeUncertaintyMs: min(gap / 10n, 5_000n),
      chunksAmount: BigInt(chunks),
      smallTailMergeThresholdBps: 5_000n,
      timeForRetryMs: max(2n * gap, 60_000n),
      amountUncertaintyBps: 0n,
      maxOneExecutionAmountBps: min(10_000n, (20_000n + BigInt(chunks) - 1n) / BigInt(chunks)),
      side: payload.side === OrderSide.SELL,
      size,
      // The form's tolerance is in parts per million.
      maxSlippageBps: max(1n, BigInt(Math.round(params.priceTolerance / 100))),
      reduceOnly: payload.reduceOnly ?? false,
    },
  };
}

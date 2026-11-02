import type { TriggerOrderActions } from '@/bonsai/forms/triggers/types';
import {
  OrderStatus,
  OrderType,
  type PositionUniqueId,
  type SubaccountOrder,
  type SubaccountPosition,
} from '@/bonsai/types/summaryTypes';
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

import { OrderSide, OrderType, type SubaccountPosition } from '@/bonsai/types/summaryTypes';
import { describe, expect, it } from 'vitest';

import {
  IndexerOrderSide,
  IndexerOrderType,
  IndexerPerpetualPositionStatus,
  IndexerPositionSide,
} from '@/types/indexer/indexerApiGen';
import type { IndexerOrderTicket } from '@/types/indexer/indexerManual';

import type { StoredTicketDetails } from '@/state/ticketDetails';

import type { TriggerOrderActions } from '../../forms/triggers/types';
import {
  openReducingStopTickets,
  openStopLossTakeProfits,
  parseTicketOrderId,
  planStopLossTakeProfit,
  stopLossTakeProfitOrders,
  ticketOrderId,
} from '../ticketOrders';

const ACCOUNT = '0xacc';

const ticket = (id: string, commitment: string, extra: Partial<IndexerOrderTicket> = {}) =>
  ({
    id,
    type: 'STOP',
    status: 'OPEN',
    ticker: null,
    stopOrderType: '0',
    executors: ['0xk'],
    gas: '0.001',
    encryptedDetails: commitment,
    createdAt: '2026-11-02T00:00:00.000Z',
    createdAtHeight: '1',
    updatedAt: '2026-11-02T00:00:01.000Z',
    updatedAtHeight: '1',
    subaccountNumber: 0,
    ...extra,
  }) as IndexerOrderTicket;

const stored = (
  kind: StoredTicketDetails['kind'],
  details: StoredTicketDetails['details']
): StoredTicketDetails => ({
  network: 'localnet',
  account: ACCOUNT,
  marketId: 'BTC-USD',
  kind,
  details,
  savedAtMs: 1,
});

const sltp = stored('stopLossTakeProfit', {
  stopLossPrice: '99000000000000000000000',
  takeProfitPrice: '105000000000000000000000',
  positionIsAsk: false,
  size: '100000000',
});

describe('ticket order ids', () => {
  it('name the ticket and the level, and nothing else parses', () => {
    expect(parseTicketOrderId(ticketOrderId('0x71c', 'sl'))).toEqual({
      ticketId: '0x71c',
      leg: 'sl',
    });
    expect(parseTicketOrderId('ticket:0x71c:tp')).toEqual({ ticketId: '0x71c', leg: 'tp' });
    expect(parseTicketOrderId('340282366920938463463374607431768211455')).toBeUndefined();
    expect(parseTicketOrderId('ticket:0x71c:limit')).toBeUndefined();
    expect(parseTicketOrderId(undefined)).toBeUndefined();
  });
});

describe('openStopLossTakeProfits', () => {
  it('reads the levels of the open tickets this browser has the details of', () => {
    const tickets = [
      ticket('0x1', '0xAA'),
      ticket('0x2', 'bb', { status: 'EXECUTED' }),
      ticket('0x3', 'cc'),
      ticket('0x4', 'dd', { stopOrderType: '1' }),
    ];
    const open = openStopLossTakeProfits(tickets, { aa: sltp, bb: sltp, dd: sltp }, ACCOUNT);
    expect(open).toHaveLength(1);
    expect(open[0]!.ticketId).toBe('0x1');
    expect(open[0]!.stopLoss?.toNumber()).toBe(99_000);
    expect(open[0]!.takeProfit?.toNumber()).toBe(105_000);
    expect(open[0]!.size.toNumber()).toBe(0.1);
    expect(openStopLossTakeProfits(tickets, { aa: sltp }, '0xother')).toEqual([]);
  });

  it('counts reduce-only standalone stops among the tickets a close cancels', () => {
    const tickets = [
      ticket('0x1', 'aa'),
      ticket('0x2', 'bb', { stopOrderType: '1' }),
      ticket('0x3', 'cc', { stopOrderType: '1' }),
    ];
    const reducing = openReducingStopTickets(
      tickets,
      {
        aa: sltp,
        bb: stored('standaloneStop', { reduceOnly: true }),
        cc: stored('standaloneStop', { reduceOnly: false }),
      },
      ACCOUNT
    );
    expect(reducing.map((t) => t.ticketId)).toEqual(['0x1', '0x2']);
  });
});

describe('stopLossTakeProfitOrders', () => {
  it('shows a ticket as the reduce-only orders that close the position', () => {
    const position = {
      market: 'BTC-USD',
      status: IndexerPerpetualPositionStatus.OPEN,
      side: IndexerPositionSide.LONG,
      subaccountNumber: 128,
      uniqueId: 'BTC-USD-128',
      marginMode: 'ISOLATED',
    } as unknown as SubaccountPosition;
    const open = openStopLossTakeProfits([ticket('0x1', 'aa')], { aa: sltp });
    const orders = stopLossTakeProfitOrders(open, [position], { 'BTC-USD': 0 });
    expect(orders.map((o) => [o.id, o.type, o.side, o.triggerPrice?.toNumber()])).toEqual([
      ['ticket:0x1:sl', IndexerOrderType.STOPMARKET, IndexerOrderSide.SELL, 99_000],
      ['ticket:0x1:tp', IndexerOrderType.TAKEPROFITMARKET, IndexerOrderSide.SELL, 105_000],
    ]);
    expect(orders.every((o) => o.reduceOnly && o.positionUniqueId === 'BTC-USD-128')).toBe(true);
    expect(stopLossTakeProfitOrders(open, [], {})).toEqual([]);
  });
});

const place = (type: OrderType, triggerPrice: number, size = 0.1): TriggerOrderActions => ({
  placePayload: {
    type,
    triggerPrice,
    size,
    marketId: 'BTC-USD',
    side: OrderSide.SELL,
  } as TriggerOrderActions['placePayload'],
});
const cancel = (orderId: string): TriggerOrderActions => ({
  cancelPayload: { orderId } as TriggerOrderActions['cancelPayload'],
});

describe('planStopLossTakeProfit', () => {
  const existing = openStopLossTakeProfits([ticket('0x1', 'aa')], { aa: sltp });

  it('makes one ticket of a new stop loss and take profit', () => {
    expect(
      planStopLossTakeProfit(
        [place(OrderType.STOP_MARKET, 99_000), place(OrderType.TAKE_PROFIT_MARKET, 105_000)],
        []
      )
    ).toEqual({
      cancelTicketIds: [],
      create: { stopLoss: 99_000, takeProfit: 105_000, size: 0.1 },
    });
  });

  it('carries the level the form leaves alone into the ticket that replaces the old one', () => {
    expect(
      planStopLossTakeProfit(
        [cancel('ticket:0x1:sl'), place(OrderType.STOP_MARKET, 98_000)],
        existing
      )
    ).toEqual({
      cancelTicketIds: ['0x1'],
      create: { stopLoss: 98_000, takeProfit: 105_000, size: 0.1 },
    });
    expect(planStopLossTakeProfit([cancel('ticket:0x1:tp')], existing)).toEqual({
      cancelTicketIds: ['0x1'],
      create: { stopLoss: 99_000, takeProfit: undefined, size: 0.1 },
    });
  });

  it('only cancels once no level is left, and does nothing without a change', () => {
    expect(
      planStopLossTakeProfit([cancel('ticket:0x1:sl'), cancel('ticket:0x1:tp')], existing)
    ).toEqual({ cancelTicketIds: ['0x1'] });
    expect(planStopLossTakeProfit([], [])).toEqual({ cancelTicketIds: [] });
  });
});

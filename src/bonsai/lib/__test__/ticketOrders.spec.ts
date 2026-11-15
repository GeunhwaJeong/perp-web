import {
  OrderExecution,
  OrderSide,
  OrderTimeInForce,
  OrderType,
  type SubaccountPosition,
} from '@/bonsai/types/summaryTypes';
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
  MAX_TWAP_CHUNKS,
  openReducingStopTickets,
  openStopLossTakeProfits,
  parseTicketOrderId,
  planStopLossTakeProfit,
  standaloneStopFromPayload,
  stopLossTakeProfitFromLevel,
  stopLossTakeProfitOrders,
  ticketOrderId,
  triggeredMarketOrderPrice,
  triggersAtOrAbove,
  twapFromPayload,
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

const place = (
  type: OrderType,
  triggerPrice: number,
  price: number,
  size = 0.1
): TriggerOrderActions => ({
  placePayload: {
    type,
    triggerPrice,
    price,
    size,
    marketId: 'BTC-USD',
    side: OrderSide.SELL,
  } as TriggerOrderActions['placePayload'],
});
const cancel = (orderId: string): TriggerOrderActions => ({
  cancelPayload: { orderId } as TriggerOrderActions['cancelPayload'],
});

describe('triggeredMarketOrderPrice', () => {
  it('moves the trigger against the order by 5% on a major market and by 10% elsewhere', () => {
    expect(triggeredMarketOrderPrice(OrderSide.SELL, 100_000, 'BTC-USD')).toBeCloseTo(95_000, 6);
    expect(triggeredMarketOrderPrice(OrderSide.BUY, 100_000, 'BTC-USD')).toBeCloseTo(105_000, 6);
    expect(triggeredMarketOrderPrice(OrderSide.SELL, 200, 'DOGE-USD')).toBeCloseTo(180, 9);
    expect(triggeredMarketOrderPrice(OrderSide.BUY, 200, 'DOGE-USD')).toBeCloseTo(220, 9);
  });
});

describe('planStopLossTakeProfit', () => {
  // A ticket from before the levels had tickets of their own: both levels, at no price.
  const both = openStopLossTakeProfits([ticket('0x1', 'aa')], { aa: sltp });
  // The tickets as they are made now, one per level.
  const split = openStopLossTakeProfits([ticket('0x2', 'bb'), ticket('0x3', 'cc')], {
    bb: stored('stopLossTakeProfit', {
      stopLossPrice: '99000000000000000000000',
      positionIsAsk: false,
      size: '100000000',
    }),
    cc: stored('stopLossTakeProfit', {
      takeProfitPrice: '105000000000000000000000',
      positionIsAsk: false,
      size: '100000000',
    }),
  });

  it('makes a ticket of each new level, at the price the form gives it', () => {
    expect(
      planStopLossTakeProfit(
        [
          place(OrderType.STOP_MARKET, 99_000, 94_050),
          place(OrderType.TAKE_PROFIT_MARKET, 105_000, 99_750),
        ],
        []
      )
    ).toEqual({
      cancelTicketIds: [],
      create: [
        { leg: 'sl', triggerPrice: 99_000, price: 94_050, size: 0.1 },
        { leg: 'tp', triggerPrice: 105_000, price: 99_750, size: 0.1 },
      ],
    });
  });

  it('takes a limit level at its limit price', () => {
    expect(planStopLossTakeProfit([place(OrderType.STOP_LIMIT, 99_000, 98_500)], [])).toEqual({
      cancelTicketIds: [],
      create: [{ leg: 'sl', triggerPrice: 99_000, price: 98_500, size: 0.1 }],
    });
  });

  it('replaces the ticket of the level the form changes and leaves the other alone', () => {
    expect(
      planStopLossTakeProfit(
        [cancel('ticket:0x2:sl'), place(OrderType.STOP_MARKET, 98_000, 93_100)],
        split
      )
    ).toEqual({
      cancelTicketIds: ['0x2'],
      create: [{ leg: 'sl', triggerPrice: 98_000, price: 93_100, size: 0.1 }],
    });
    // The level's ticket goes even when the form sends no cancel with the new level.
    expect(
      planStopLossTakeProfit([place(OrderType.TAKE_PROFIT_MARKET, 106_000, 100_700)], split)
    ).toEqual({
      cancelTicketIds: ['0x3'],
      create: [{ leg: 'tp', triggerPrice: 106_000, price: 100_700, size: 0.1 }],
    });
    expect(planStopLossTakeProfit([cancel('ticket:0x3:tp')], split)).toEqual({
      cancelTicketIds: ['0x3'],
      create: [],
    });
  });

  it('carries the level a ticket of both keeps into a ticket of its own, at the market slippage', () => {
    expect(
      planStopLossTakeProfit(
        [cancel('ticket:0x1:sl'), place(OrderType.STOP_MARKET, 98_000, 93_100)],
        both
      )
    ).toEqual({
      cancelTicketIds: ['0x1'],
      create: [
        { leg: 'sl', triggerPrice: 98_000, price: 93_100, size: 0.1 },
        // The long's take profit sells: 5% under its trigger on BTC-USD.
        { leg: 'tp', triggerPrice: 105_000, price: expect.closeTo(99_750, 6), size: 0.1 },
      ],
    });
    expect(planStopLossTakeProfit([cancel('ticket:0x1:tp')], both)).toEqual({
      cancelTicketIds: ['0x1'],
      create: [{ leg: 'sl', triggerPrice: 99_000, price: expect.closeTo(94_050, 6), size: 0.1 }],
    });
  });

  it('only cancels once no level is left, and does nothing without a change', () => {
    expect(
      planStopLossTakeProfit([cancel('ticket:0x1:sl'), cancel('ticket:0x1:tp')], both)
    ).toEqual({ cancelTicketIds: ['0x1'], create: [] });
    expect(
      planStopLossTakeProfit([cancel('ticket:0x2:sl'), cancel('ticket:0x3:tp')], split)
    ).toEqual({ cancelTicketIds: ['0x2', '0x3'], create: [] });
    expect(planStopLossTakeProfit([], split)).toEqual({ cancelTicketIds: [], create: [] });
  });

  it('leaves out a level without a size or a price', () => {
    expect(
      planStopLossTakeProfit(
        [
          place(OrderType.STOP_MARKET, 99_000, 94_050, 0),
          place(OrderType.TAKE_PROFIT_MARKET, 105_000, 0),
        ],
        []
      )
    ).toEqual({ cancelTicketIds: [], create: [] });
  });
});

const MARKET = {
  clearingHouse: '0xf77dda417d4003c017c96697809d3a25b2767aca586b5b7579e975e47508df77',
  lotSize: '1000000',
  tickSize: '1000000000',
};
const NOW = 1_800_000_000_000;
const E18 = 10n ** 18n;

const order = (fields: Partial<TriggerOrderActions['placePayload'] & object>) =>
  ({
    marketId: 'BTC-USD',
    side: OrderSide.BUY,
    size: 0.1,
    price: 101_000,
    triggerPrice: 100_500,
    reduceOnly: false,
    goodTilTimeInSeconds: 28 * 24 * 3600,
    ...fields,
  }) as NonNullable<TriggerOrderActions['placePayload']>;

describe('stopLossTakeProfitFromLevel', () => {
  it("closes a long at its stop loss with an immediate-or-cancel ask, no lower than the level's price", () => {
    expect(
      stopLossTakeProfitFromLevel(
        { leg: 'sl', triggerPrice: 99_000, price: 94_050.4, size: 0.1 },
        false,
        MARKET
      )
    ).toEqual({
      clearingHouse: MARKET.clearingHouse,
      isLimitOrder: true,
      triggerPriceType: 0,
      stopLossPrice: 99_000n * E18,
      takeProfitPrice: undefined,
      positionIsAsk: false,
      size: 100_000_000n,
      // An ask rounds up to the tick, so the sale is never under the price.
      price: 94_051_000_000_000n,
      orderType: 3n,
    });
  });

  it("closes a short at its take profit with a bid, no higher than the level's price", () => {
    expect(
      stopLossTakeProfitFromLevel(
        { leg: 'tp', triggerPrice: 59_000, price: 61_950.7, size: 0.25 },
        true,
        MARKET
      )
    ).toMatchObject({
      stopLossPrice: undefined,
      takeProfitPrice: 59_000n * E18,
      positionIsAsk: true,
      size: 250_000_000n,
      price: 61_950_000_000_000n,
      orderType: 3n,
    });
  });
});

describe('triggersAtOrAbove', () => {
  it('has a stop buy and a take profit sell wait for the index to rise, the others to fall', () => {
    expect(triggersAtOrAbove(OrderType.STOP_MARKET, OrderSide.BUY)).toBe(true);
    expect(triggersAtOrAbove(OrderType.STOP_LIMIT, OrderSide.SELL)).toBe(false);
    expect(triggersAtOrAbove(OrderType.TAKE_PROFIT_MARKET, OrderSide.BUY)).toBe(false);
    expect(triggersAtOrAbove(OrderType.TAKE_PROFIT_LIMIT, OrderSide.SELL)).toBe(true);
  });
});

describe('standaloneStopFromPayload', () => {
  it('makes a stop market buy an immediate-or-cancel bid at the worst price the form allows', () => {
    const planned = standaloneStopFromPayload(order({ type: OrderType.STOP_MARKET }), MARKET, NOW);
    expect(planned).toEqual({
      details: {
        clearingHouse: MARKET.clearingHouse,
        expireTimestampMs: BigInt(NOW + 28 * 24 * 3600 * 1000),
        isLimitOrder: true,
        triggerPriceType: 0,
        stopIndexPrice: 100_500n * E18,
        triggerAtOrAbove: true,
        side: false,
        size: 100_000_000n,
        price: 101_000_000_000_000n,
        orderType: 3n,
        reduceOnly: false,
      },
    });
  });

  it('rests a take profit limit sell at its price with the form execution', () => {
    const planned = standaloneStopFromPayload(
      order({
        type: OrderType.TAKE_PROFIT_LIMIT,
        side: OrderSide.SELL,
        price: 102_000,
        triggerPrice: 101_500,
        reduceOnly: true,
        execution: OrderExecution.POST_ONLY,
        goodTilTimeInSeconds: undefined,
      }),
      MARKET,
      NOW
    );
    expect('details' in planned && planned.details).toMatchObject({
      expireTimestampMs: undefined,
      triggerAtOrAbove: true,
      side: true,
      price: 102_000_000_000_000n,
      orderType: 2n,
      reduceOnly: true,
    });
  });

  it('reads a stop limit execution, not the hidden time in force the form sends with it', () => {
    const goodTilDate = standaloneStopFromPayload(
      order({
        type: OrderType.STOP_LIMIT,
        execution: OrderExecution.DEFAULT,
        timeInForce: OrderTimeInForce.IOC,
      }),
      MARKET,
      NOW
    );
    expect('details' in goodTilDate && goodTilDate.details.orderType).toBe(0n);
    const immediate = standaloneStopFromPayload(
      order({ type: OrderType.STOP_LIMIT, execution: OrderExecution.IOC }),
      MARKET,
      NOW
    );
    expect('details' in immediate && immediate.details.orderType).toBe(3n);
  });

  it('refuses an order without a trigger or under a lot', () => {
    expect(
      standaloneStopFromPayload(
        order({ type: OrderType.STOP_MARKET, triggerPrice: undefined }),
        MARKET,
        NOW
      )
    ).toEqual({ error: 'The stop order has no trigger price' });
    expect(
      standaloneStopFromPayload(order({ type: OrderType.STOP_MARKET, size: 0.0001 }), MARKET, NOW)
    ).toEqual({ error: 'The stop order is smaller than one lot' });
  });
});

describe('twapFromPayload', () => {
  const twap = (duration: number, interval: number, size = 0.01) =>
    order({
      type: OrderType.TWAP,
      size,
      twapParameters: { duration, interval, priceTolerance: 10_000 },
    });

  it('splits five minutes at thirty seconds into ten chunks within 1% of the mark', () => {
    const planned = twapFromPayload(twap(300, 30), MARKET, NOW);
    expect(planned).toEqual({
      details: {
        firstRunExpireTimestampMs: BigInt(NOW + 120_000),
        expireTimestampMs: BigInt(NOW + 300_000 + 60_000 + 300_000),
        executionGapMs: 30_000n,
        executionTimeUncertaintyMs: 3_000n,
        chunksAmount: 10n,
        smallTailMergeThresholdBps: 5_000n,
        timeForRetryMs: 60_000n,
        amountUncertaintyBps: 0n,
        maxOneExecutionAmountBps: 2_000n,
        side: false,
        size: 10_000_000n,
        maxSlippageBps: 100n,
        reduceOnly: false,
      },
    });
  });

  it('caps the chunks and the gap tolerance, and needs a lot per chunk', () => {
    const hour = twapFromPayload(twap(3600, 30, 0.12), MARKET, NOW);
    expect('details' in hour && hour.details.chunksAmount).toBe(BigInt(MAX_TWAP_CHUNKS));
    expect(twapFromPayload(twap(7200, 30), MARKET, NOW)).toEqual({
      error: `A TWAP runs in at most ${MAX_TWAP_CHUNKS} chunks; this one would take 240. Lengthen the frequency.`,
    });
    const hourly = twapFromPayload(twap(4 * 3600, 3600), MARKET, NOW);
    expect('details' in hourly && hourly.details.executionTimeUncertaintyMs).toBe(5_000n);
    expect(twapFromPayload(twap(300, 30, 0.005), MARKET, NOW)).toEqual({
      error: 'A TWAP in 10 chunks needs at least 10 lots',
    });
  });
});

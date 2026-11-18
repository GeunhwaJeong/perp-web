import { calculateAllMarkets, createMarketSummary } from '@/bonsai/calculators/markets';
import { getHighestPriorityAlert } from '@/bonsai/lib/validationErrors';
import { CanvasOrderbookLine } from '@/bonsai/types/orderbookTypes';
import {
  ChildSubaccountData,
  MarketsData,
  ParentSubaccountDataBase,
} from '@/bonsai/types/rawTypes';
import { describe, expect, it } from 'vitest';

import { STRING_KEYS } from '@/constants/localization';
import {
  IndexerPerpetualPositionResponseObject,
  IndexerPositionSide,
} from '@/types/indexer/indexerApiGen';
import { IndexerWsBaseMarketObject } from '@/types/indexer/indexerManual';

import { calculateTradeFormErrors } from '../errors';
import { calculateTradeSummary } from '../summary';
import {
  MarginMode,
  OrderSide,
  OrderSizeInputs,
  TradeForm,
  TradeFormInputData,
  TradeFormType,
} from '../types';

// The localnet of 2026-11-18: BTC-USD at 100,000, the maker's first level 80 away on each side,
// and an account of 5,000.
const markets: MarketsData = {
  'BTC-USD': {
    clobPairId: '0',
    ticker: 'BTC-USD',
    status: 'ACTIVE',
    oraclePrice: '100000',
    priceChange24H: '0',
    volume24H: '0',
    trades24H: 0,
    nextFundingRate: '0',
    initialMarginFraction: '0.1',
    maintenanceMarginFraction: '0.05',
    openInterest: '0',
    atomicResolution: -9,
    quantumConversionExponent: -9,
    tickSize: '1',
    stepSize: '0.001',
    stepBaseQuantums: 1000000,
    subticksPerTick: 1000000000,
    marketType: 'ISOLATED',
    openInterestLowerCap: '0',
    openInterestUpperCap: '0',
    baseOpenInterest: '0',
    defaultFundingRate1H: '0',
    takerFee: '0.0005',
    makerFee: '0.0002',
  } as unknown as IndexerWsBaseMarketObject,
};
const marketSummary = createMarketSummary(
  calculateAllMarkets(markets),
  undefined,
  undefined,
  undefined,
  []
)!['BTC-USD']!;

const line = (side: 'ask' | 'bid', price: number): CanvasOrderbookLine => ({
  price,
  size: 0.01,
  depth: 0.01,
  sizeCost: price * 0.01,
  depthCost: price * 0.01,
  offset: 0,
  mine: undefined,
  side,
});
const ASKS = [line('ask', 100080), line('ask', 100140)];
const BIDS = [line('bid', 99920), line('bid', 99860)];

const usdc = (subaccountNumber: number, balance: number) =>
  ({
    USDC: {
      symbol: 'USDC',
      side: balance >= 0 ? IndexerPositionSide.LONG : IndexerPositionSide.SHORT,
      size: String(Math.abs(balance)),
      assetId: '0',
      subaccountNumber,
    },
  }) as ChildSubaccountData['assetPositions'];

const account = (market?: ChildSubaccountData): ParentSubaccountDataBase => ({
  address: '0xd4a8',
  parentSubaccount: 0,
  childSubaccounts: {
    0: {
      address: '0xd4a8',
      subaccountNumber: 0,
      openPerpetualPositions: {},
      assetPositions: usdc(0, 5000),
    },
    ...(market != null ? { 128: market } : {}),
  },
});

// The 0.01 BTC long bought at 100,080 with a margin of 200.
const long: ChildSubaccountData = {
  address: '0xd4a8',
  subaccountNumber: 128,
  openPerpetualPositions: {
    'BTC-USD': {
      market: 'BTC-USD',
      status: 'OPEN',
      side: IndexerPositionSide.LONG,
      size: '0.01',
      maxSize: '0.01',
      entryPrice: '100080',
      realizedPnl: '0',
      createdAt: '2026-11-18T07:00:40.000Z',
      createdAtHeight: '1',
      sumOpen: '0.01',
      sumClose: '0',
      netFunding: '0',
      unrealizedPnl: '0',
      subaccountNumber: 128,
    } as unknown as IndexerPerpetualPositionResponseObject,
  },
  assetPositions: usdc(128, 200 - 1000.8),
};

const inputData = (
  asks: CanvasOrderbookLine[],
  bids: CanvasOrderbookLine[],
  parent: ParentSubaccountDataBase = account()
): TradeFormInputData => ({
  rawParentSubaccountData: parent,
  rawRelevantMarkets: markets,
  rawSelectedMarketLeverages: { 'BTC-USD': 10 },
  currentTradeMarketOpenOrders: [],
  allOpenOrders: [],
  feeMultipliers: undefined,
  currentTradeMarket: markets['BTC-USD'],
  currentTradeMarketSummary: marketSummary,
  currentTradeMarketOrderbook: {
    asks,
    bids,
    midPrice: asks[0] != null && bids[0] != null ? (asks[0].price + bids[0].price) / 2 : undefined,
    spread: asks[0] != null && bids[0] != null ? asks[0].price - bids[0].price : undefined,
    spreadPercent: undefined,
    groupingTickSize: 1,
    groupingTickSizeDecimals: 0,
  },
  rewardParams: undefined,
  marketOrderMaxSlippage: 0.01,
});

const order = (type: TradeFormType, side: OrderSide, over: Partial<TradeForm> = {}): TradeForm => ({
  type,
  marketId: 'BTC-USD',
  side,
  size: OrderSizeInputs.SIZE({ value: '0.01' }),
  reduceOnly: false,
  marginMode: MarginMode.ISOLATED,
  limitPrice: undefined,
  postOnly: undefined,
  timeInForce: undefined,
  triggerPrice: undefined,
  execution: undefined,
  goodTil: undefined,
  durationHours: undefined,
  durationMinutes: undefined,
  frequencySeconds: undefined,
  stopLossOrder: undefined,
  takeProfitOrder: undefined,
  scaleStartPrice: undefined,
  scaleEndPrice: undefined,
  scaleTotalOrders: undefined,
  scaleSkew: undefined,
  ...over,
});

// What the form shows: the button takes the title of the first error and the alert its text.
const shown = (state: TradeForm, data: TradeFormInputData) => {
  const errors = calculateTradeFormErrors(state, data, calculateTradeSummary(state, data));
  const first = getHighestPriorityAlert(errors);
  return {
    code: first?.code,
    button: first?.resources.title?.stringKey,
    text: first?.resources.text?.fallback ?? first?.resources.text?.stringKey,
    codes: errors.map((e) => e.code),
  };
};

describe('an order that fills from the book, with no orders on the book to fill from', () => {
  it('a market buy is told that there are no sell orders', () => {
    const result = shown(order(TradeFormType.MARKET, OrderSide.BUY), inputData([], []));

    expect(result.code).toBe('MARKET_ORDER_EMPTY_BOOK');
    expect(result.button).toBe(STRING_KEYS.INSUFFICIENT_LIQUIDITY);
    expect(result.text).toBe(
      'There are no sell orders on the book right now. Use a limit order instead.'
    );
    // The size came out as zero because of the book, so the size is not what gets blamed.
    expect(result.codes).not.toContain('ORDER_SIZE_BELOW_MIN_SIZE');
    expect(result.codes).not.toContain('REQUIRED_SIZE');
  });

  it('a market sell is told that there are no buy orders', () => {
    const result = shown(order(TradeFormType.MARKET, OrderSide.SELL), inputData(ASKS, []));

    expect(result.code).toBe('MARKET_ORDER_EMPTY_BOOK');
    expect(result.text).toBe(
      'There are no buy orders on the book right now. Use a limit order instead.'
    );
  });

  it('the close form, which sells all of a long at market, is told the same', () => {
    const close = order(TradeFormType.MARKET, OrderSide.SELL, {
      reduceOnly: true,
      size: OrderSizeInputs.AVAILABLE_PERCENT({ value: '1' }),
      marginMode: undefined,
    });

    expect(shown(close, inputData(ASKS, BIDS, account(long))).code).toBeUndefined();

    const result = shown(close, inputData([], [], account(long)));
    expect(result.code).toBe('MARKET_ORDER_EMPTY_BOOK');
    expect(result.text).toBe(
      'There are no buy orders on the book right now. Use a limit order instead.'
    );
  });

  it('a TWAP is told the same', () => {
    const state = order(TradeFormType.TWAP, OrderSide.BUY, {
      durationHours: '0',
      durationMinutes: '5',
      frequencySeconds: '30',
    });
    const result = shown(state, inputData([], BIDS));

    expect(result.code).toBe('MARKET_ORDER_EMPTY_BOOK');
    expect(result.text).toBe(
      'There are no sell orders on the book right now. Use a limit order instead.'
    );
  });

  it('a stop market order is pointed to a stop limit order', () => {
    const state = order(TradeFormType.TRIGGER_MARKET, OrderSide.SELL, { triggerPrice: '95000' });
    const result = shown(state, inputData([], []));

    expect(result.code).toBe('MARKET_ORDER_EMPTY_BOOK');
    expect(result.text).toBe(
      'There are no buy orders on the book right now. Use a stop limit order instead.'
    );
  });

  it('nothing typed still asks for an amount', () => {
    const state = order(TradeFormType.MARKET, OrderSide.BUY, { size: undefined });
    const result = shown(state, inputData([], []));

    expect(result.code).toBe('REQUIRED_SIZE');
    expect(result.button).toBe(STRING_KEYS.ENTER_AMOUNT);
  });
});

describe('an order the empty side of the book does not hold back', () => {
  it('a market buy with sell orders on the book', () => {
    const result = shown(order(TradeFormType.MARKET, OrderSide.BUY), inputData(ASKS, BIDS));

    expect(result.codes).not.toContain('MARKET_ORDER_EMPTY_BOOK');
    expect(result.code).toBeUndefined();
  });

  it('a market buy with sell orders only keeps the one-sided message', () => {
    const result = shown(order(TradeFormType.MARKET, OrderSide.BUY), inputData(ASKS, []));

    expect(result.code).toBe('MARKET_ORDER_ONE_SIDED_LIQUIDITY');
  });

  it('a limit order', () => {
    const state = order(TradeFormType.LIMIT, OrderSide.BUY, { limitPrice: '90000' });
    const result = shown(state, inputData([], []));

    expect(result.codes).not.toContain('MARKET_ORDER_EMPTY_BOOK');
    expect(result.codes).not.toContain('ORDER_SIZE_BELOW_MIN_SIZE');
  });

  it('a stop limit order', () => {
    const state = order(TradeFormType.TRIGGER_LIMIT, OrderSide.SELL, {
      triggerPrice: '95000',
      limitPrice: '94900',
    });
    const result = shown(state, inputData([], []));

    expect(result.codes).not.toContain('MARKET_ORDER_EMPTY_BOOK');
    expect(result.codes).not.toContain('ORDER_SIZE_BELOW_MIN_SIZE');
  });
});

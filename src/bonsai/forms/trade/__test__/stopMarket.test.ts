import { calculateAllMarkets, createMarketSummary } from '@/bonsai/calculators/markets';
import { ErrorType } from '@/bonsai/lib/validationErrors';
import { CanvasOrderbookLine } from '@/bonsai/types/orderbookTypes';
import { MarketsData, ParentSubaccountDataBase } from '@/bonsai/types/rawTypes';
import { OrderType } from '@/bonsai/types/summaryTypes';
import { describe, expect, it } from 'vitest';

import { IndexerPositionSide } from '@/types/indexer/indexerApiGen';
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

// The localnet of 2026-11-18: BTC-USD at 100,000 and an account of 5,000.
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

const line = (side: 'ask' | 'bid', price: number, size: number): CanvasOrderbookLine => ({
  price,
  size,
  depth: size,
  sizeCost: price * size,
  depthCost: price * size,
  offset: 0,
  mine: undefined,
  side,
});
const ASKS = [line('ask', 100087, 0.01), line('ask', 100147, 0.015)];
// The bids of the localnet when a stop market sell of 0.2 BTC was entered: 0.16 BTC in all, the
// last of it far below the rest. The form made the order 0.16 BTC, with a worst price of 88,748.
const THIN_BIDS = [
  line('bid', 99926, 0.01),
  line('bid', 99900, 0.01),
  line('bid', 99866, 0.015),
  line('bid', 99806, 0.022),
  line('bid', 99746, 0.033),
  line('bid', 99686, 0.05),
  line('bid', 89000, 0.02),
];

const account: ParentSubaccountDataBase = {
  address: '0xd4a8',
  parentSubaccount: 0,
  childSubaccounts: {
    0: {
      address: '0xd4a8',
      subaccountNumber: 0,
      openPerpetualPositions: {},
      assetPositions: {
        USDC: {
          symbol: 'USDC',
          side: IndexerPositionSide.LONG,
          size: '5000',
          assetId: '0',
          subaccountNumber: 0,
        },
      },
    },
  },
};

type Book = { asks: CanvasOrderbookLine[]; bids: CanvasOrderbookLine[] } | undefined;
const inputData = (book: Book): TradeFormInputData => ({
  rawParentSubaccountData: account,
  rawRelevantMarkets: markets,
  rawSelectedMarketLeverages: { 'BTC-USD': 10 },
  currentTradeMarketOpenOrders: [],
  allOpenOrders: [],
  feeMultipliers: undefined,
  currentTradeMarket: markets['BTC-USD'],
  currentTradeMarketSummary: marketSummary,
  currentTradeMarketOrderbook:
    book == null
      ? undefined
      : {
          ...book,
          midPrice:
            book.asks[0] != null && book.bids[0] != null
              ? (book.asks[0].price + book.bids[0].price) / 2
              : undefined,
          spread: undefined,
          spreadPercent: undefined,
          groupingTickSize: 1,
          groupingTickSizeDecimals: 0,
        },
  rewardParams: undefined,
  marketOrderMaxSlippage: 0.01,
});

const stop = (side: OrderSide, triggerPrice: string, over: Partial<TradeForm> = {}): TradeForm => ({
  type: TradeFormType.TRIGGER_MARKET,
  marketId: 'BTC-USD',
  side,
  size: OrderSizeInputs.SIZE({ value: '0.2' }),
  reduceOnly: false,
  marginMode: MarginMode.ISOLATED,
  limitPrice: undefined,
  postOnly: undefined,
  timeInForce: undefined,
  triggerPrice,
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

const preview = (state: TradeForm, book: Book) => {
  const data = inputData(book);
  const summary = calculateTradeSummary(state, data);
  const payload = summary.tradePayload?.orderPayload;
  return {
    size: summary.tradeInfo.inputSummary.size?.size,
    usdcSize: summary.tradeInfo.inputSummary.size?.usdcSize,
    expectedPrice: summary.tradeInfo.inputSummary.averageFillPrice,
    worstPrice: summary.tradeInfo.payloadPrice,
    fee: summary.tradeInfo.fee,
    payload: payload && {
      type: payload.type,
      size: payload.size,
      price: payload.price,
      triggerPrice: payload.triggerPrice,
    },
    errors: calculateTradeFormErrors(state, data, summary)
      .filter((e) => e.type === ErrorType.error)
      .map((e) => e.code),
  };
};

describe('a stop market order', () => {
  it('is the size entered when the book holds less', () => {
    const result = preview(stop(OrderSide.SELL, '95000'), { asks: ASKS, bids: THIN_BIDS });

    expect(result.size).toBeCloseTo(0.2, 9);
    expect(result.payload).toEqual({
      type: OrderType.STOP_MARKET,
      size: result.size,
      price: result.worstPrice,
      triggerPrice: 95000,
    });
    expect(result.errors).toEqual([]);
  });

  it('is the same order whatever the book holds, and without a book', () => {
    const full = preview(stop(OrderSide.SELL, '95000'), {
      asks: ASKS,
      bids: [line('bid', 99926, 5)],
    });
    const thin = preview(stop(OrderSide.SELL, '95000'), { asks: ASKS, bids: THIN_BIDS });
    const empty = preview(stop(OrderSide.SELL, '95000'), { asks: [], bids: [] });
    const none = preview(stop(OrderSide.SELL, '95000'), undefined);

    expect(thin).toEqual(full);
    expect(empty).toEqual(full);
    expect(none).toEqual(full);
    expect(full.errors).toEqual([]);
  });

  it('may fill down to its trigger moved 5% against it on a major market', () => {
    expect(preview(stop(OrderSide.SELL, '95000'), undefined).worstPrice).toBeCloseTo(90250, 6);
    expect(preview(stop(OrderSide.BUY, '105000'), undefined).worstPrice).toBeCloseTo(110250, 6);
  });

  it('shows the trigger as its price, and the fee of a fill there', () => {
    const result = preview(stop(OrderSide.SELL, '95000'), { asks: ASKS, bids: THIN_BIDS });

    expect(result.expectedPrice).toBe(95000);
    expect(result.usdcSize).toBeCloseTo(19000, 6);
    expect(result.fee).toBeCloseTo(9.5, 6);
  });

  it('counts a size entered in dollars at the trigger', () => {
    const state = stop(OrderSide.SELL, '95000', {
      size: OrderSizeInputs.USDC_SIZE({ value: '1900' }),
    });

    expect(preview(state, { asks: ASKS, bids: THIN_BIDS }).size).toBeCloseTo(0.02, 9);
  });

  it('still asks for a trigger price and for an amount', () => {
    expect(preview(stop(OrderSide.SELL, ''), undefined).errors).toContain('REQUIRED_TRIGGER_PRICE');
    expect(preview(stop(OrderSide.SELL, '95000', { size: undefined }), undefined).errors).toContain(
      'REQUIRED_SIZE'
    );
  });
});

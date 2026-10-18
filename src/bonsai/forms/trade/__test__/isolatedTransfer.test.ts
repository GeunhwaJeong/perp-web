import { calculateAllMarkets, createMarketSummary } from '@/bonsai/calculators/markets';
import { ErrorType } from '@/bonsai/lib/validationErrors';
import { CanvasOrderbookLine } from '@/bonsai/types/orderbookTypes';
import {
  ChildSubaccountData,
  MarketsData,
  ParentSubaccountDataBase,
} from '@/bonsai/types/rawTypes';
import { OrderStatus, SubaccountOrder } from '@/bonsai/types/summaryTypes';
import { describe, expect, it } from 'vitest';

import {
  IndexerOrderSide,
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

// Mainnet, 2026-10-16 19:31 KST: the BTC-USD market as the API lists it, at the mark price of
// the session that reopened 0.001 BTC (F9NdnU5o…), whose taker fill was at 82,047.
const MARK = 81949.780549;
const markets: MarketsData = {
  'BTC-USD': {
    clobPairId: '0',
    ticker: 'BTC-USD',
    status: 'ACTIVE',
    oraclePrice: String(MARK),
    priceChange24H: '0',
    volume24H: '0',
    trades24H: 0,
    nextFundingRate: '0',
    initialMarginFraction: '0.1',
    maintenanceMarginFraction: '0.05',
    openInterest: '0.022',
    atomicResolution: -9,
    quantumConversionExponent: -9,
    tickSize: '1',
    stepSize: '0.001',
    stepBaseQuantums: 1000000,
    subticksPerTick: 1000000000,
    marketType: 'ISOLATED',
    openInterestLowerCap: '0',
    openInterestUpperCap: '0',
    baseOpenInterest: '0.022',
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
  size: 0.005,
  depth: 0.005,
  sizeCost: price * 0.005,
  depthCost: price * 0.005,
  offset: 0,
  mine: undefined,
  side,
});

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

const long = {
  market: 'BTC-USD',
  status: 'OPEN',
  side: IndexerPositionSide.LONG,
  size: '0.001',
  maxSize: '0.001',
  entryPrice: '82047',
  realizedPnl: '0',
  createdAt: '2026-10-16T10:31:22.000Z',
  createdAtHeight: '1',
  sumOpen: '0.001',
  sumClose: '0',
  netFunding: '0',
  unrealizedPnl: '0',
  subaccountNumber: 128,
} as unknown as IndexerPerpetualPositionResponseObject;

const account = (market?: ChildSubaccountData): ParentSubaccountDataBase => ({
  address: '0xadf3',
  parentSubaccount: 0,
  childSubaccounts: {
    0: {
      address: '0xadf3',
      subaccountNumber: 0,
      openPerpetualPositions: {},
      assetPositions: usdc(0, 19.835284),
    },
    ...(market != null ? { 128: market } : {}),
  },
});

const restingBid = {
  id: '1',
  clientId: '1',
  subaccountNumber: 128,
  marketId: 'BTC-USD',
  side: IndexerOrderSide.BUY,
  status: OrderStatus.Open,
  price: { toNumber: () => 81000 },
  size: { toNumber: () => 0.001 },
  remainingSize: { toNumber: () => 0.001 },
  marginMode: 'ISOLATED',
} as unknown as SubaccountOrder;

const inputData = (
  parent: ParentSubaccountDataBase,
  openOrders: SubaccountOrder[] = []
): TradeFormInputData => ({
  rawParentSubaccountData: parent,
  rawRelevantMarkets: markets,
  // The position object keeps the 10x the leverage dialog set.
  rawSelectedMarketLeverages: { 'BTC-USD': 10 },
  currentTradeMarketOpenOrders: openOrders,
  allOpenOrders: openOrders,
  feeMultipliers: undefined,
  currentTradeMarket: markets['BTC-USD'],
  currentTradeMarketSummary: marketSummary,
  currentTradeMarketOrderbook: {
    asks: [line('ask', 82047), line('ask', 82100)],
    bids: [line('bid', 81900), line('bid', 81850)],
    midPrice: 81973.5,
    spread: 147,
    spreadPercent: 0.18,
    groupingTickSize: 1,
    groupingTickSizeDecimals: 0,
  },
  rewardParams: undefined,
  marketOrderMaxSlippage: 0.01,
});

const order = (type: TradeFormType, side: OrderSide, limitPrice?: string): TradeForm => ({
  type,
  marketId: 'BTC-USD',
  side,
  size: OrderSizeInputs.SIZE({ value: '0.001' }),
  reduceOnly: false,
  marginMode: MarginMode.ISOLATED,
  limitPrice,
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
});

const preview = (state: TradeForm, data: TradeFormInputData) => {
  const summary = calculateTradeSummary(state, data);
  const subaccount =
    summary.accountDetailsAfter?.subaccountSummaries?.[summary.tradeInfo.subaccountNumber];
  return {
    transfer: summary.tradeInfo.transferToSubaccountAmount,
    payloadTransfer: summary.tradePayload?.orderPayload?.transferToSubaccountAmount,
    fee: summary.tradeInfo.fee ?? 0,
    marginAfter: subaccount?.equity.toNumber(),
    leverageAfter: summary.accountDetailsAfter?.position?.leverage?.toNumber(),
    errors: calculateTradeFormErrors(state, data, summary)
      .filter((e) => e.type === ErrorType.error)
      .map((e) => e.code),
  };
};

describe('the collateral an isolated order takes', () => {
  it('is what the engine allocated for the mainnet reopen of 2026-10-16', () => {
    const result = preview(order(TradeFormType.MARKET, OrderSide.BUY), inputData(account()));

    // 10% of 0.001 at the mark (8.194978), the taker fee (0.0410235) and the fill at 82,047
    // against the mark (0.097219). The form used to send 9.366130, which opened at 8.88x.
    expect(result.transfer).toBeCloseTo(8.333221, 6);
    expect(result.payloadTransfer).toBeCloseTo(8.333221, 6);
    expect(result.marginAfter).toBeCloseTo(8.194978, 6);
    expect(result.leverageAfter).toBeCloseTo(10, 6);
    expect(result.errors).toEqual([]);
  });

  it('counts a sell filled below the mark against the margin', () => {
    const result = preview(order(TradeFormType.MARKET, OrderSide.SELL), inputData(account()));

    // 8.194978, the taker fee on 81,900 (0.04095) and the fill below the mark (0.049781)
    expect(result.transfer).toBeCloseTo(8.285709, 6);
    expect(result.leverageAfter).toBeCloseTo(10, 6);
    expect(result.errors).toEqual([]);
  });

  it('uses what an open position already holds above its margin', () => {
    // The 0.001 BTC long of 19:31 with the 9.366130 it was given, less its fee.
    const position = {
      address: '0xadf3',
      subaccountNumber: 128,
      openPerpetualPositions: { 'BTC-USD': long },
      assetPositions: usdc(128, 9.3251065 - 82.047),
    };
    const result = preview(
      order(TradeFormType.MARKET, OrderSide.BUY),
      inputData(account(position))
    );

    // 10% of 0.002 at the mark (16.389956) less the position's equity at the mark (9.227887)
    // after this fill's fee and price (0.138243)
    expect(result.transfer).toBeCloseTo(7.300312, 6);
    expect(result.leverageAfter).toBeCloseTo(10, 6);
    expect(result.errors).toEqual([]);
  });

  it("covers a resting limit order and the market's other resting orders", () => {
    // A bid of 0.001 rests at 81,000 with the margin it was given.
    const market = {
      address: '0xadf3',
      subaccountNumber: 128,
      openPerpetualPositions: {},
      assetPositions: usdc(128, 8.194978),
    };
    const result = preview(
      order(TradeFormType.LIMIT, OrderSide.BUY, '81500'),
      inputData(account(market), [restingBid])
    );

    // Both bids filled would hold 0.002 at a margin of 16.389956; a bid below the mark adds no
    // price loss, only its fee.
    expect(result.transfer).toBeCloseTo(16.389956 - 8.194978 + result.fee, 6);
  });
});

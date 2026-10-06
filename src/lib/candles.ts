import BigNumber from 'bignumber.js';

import {
  Candle,
  RESOLUTION_TO_INTERVAL_MS,
  ResolutionString,
  TradingViewChartBar,
} from '@/constants/candles';

import { isPresent } from './typeUtils';

// Show order book candles instead of trade candles if there are no trades in that time period
const MAX_NUM_TRADES_FOR_ORDERBOOK_PRICES = 1;

const getOhlcValues = ({
  trades,
  tradeOpen,
  tradeClose,
  tradeLow,
  tradeHigh,
  orderbookOpen,
  orderbookClose,
}: {
  trades: number;
  tradeOpen: number;
  tradeClose: number;
  tradeLow: number;
  tradeHigh: number;
  orderbookOpen?: number;
  orderbookClose?: number;
}) => {
  const showOrderbookCandles =
    trades <= MAX_NUM_TRADES_FOR_ORDERBOOK_PRICES &&
    orderbookOpen !== undefined &&
    orderbookClose !== undefined;
  const alsoUseTradeForHighLow = trades >= 1;

  return {
    low: showOrderbookCandles
      ? Math.min(
          ...[orderbookOpen, orderbookClose, alsoUseTradeForHighLow ? tradeLow : undefined].filter(
            isPresent
          )
        )
      : tradeLow,
    high: showOrderbookCandles
      ? Math.max(
          ...[orderbookOpen, orderbookClose, alsoUseTradeForHighLow ? tradeHigh : undefined].filter(
            isPresent
          )
        )
      : tradeHigh,
    open: showOrderbookCandles ? orderbookOpen : tradeOpen,
    close: showOrderbookCandles ? orderbookClose : tradeClose,
  };
};

export const mapCandle = ({
  startedAt,
  open,
  close,
  high,
  low,
  baseTokenVolume,
  usdVolume,
  trades,
  orderbookMidPriceOpen,
  orderbookMidPriceClose,
}: Candle): TradingViewChartBar => {
  const tradeOpen = parseFloat(open);
  const tradeClose = parseFloat(close);
  const tradeLow = parseFloat(low);
  const tradeHigh = parseFloat(high);
  const orderbookOpen = orderbookMidPriceOpen ? parseFloat(orderbookMidPriceOpen) : undefined;
  const orderbookClose = orderbookMidPriceClose ? parseFloat(orderbookMidPriceClose) : undefined;
  const tokenVolume = Math.ceil(Number(baseTokenVolume)); // default
  return {
    ...getOhlcValues({
      trades,
      tradeOpen,
      tradeClose,
      tradeLow,
      tradeHigh,
      orderbookOpen,
      orderbookClose,
    }),
    time: new Date(startedAt).getTime(),
    volume: Math.ceil(Number(usdVolume)),
    assetVolume: tokenVolume,
    usdVolume: Math.ceil(Number(usdVolume)),
    tradeOpen,
    tradeClose,
    orderbookOpen,
    orderbookClose,
    tradeLow,
    tradeHigh,
    trades,
  };
};

/**
 * @description Converts times in ms to the appropriate bar time (in seconds)
 * For example, if the starting time = 5000ms, interval = 10,000ms, a value of 26,000ms would
 * be grouped into the bar at 25,000ms = 25s
 */
export function getBarTime(
  chartStartTimeMs: number,
  fillTimeMs: number,
  resolution: ResolutionString
): number | undefined {
  const intervalMs = RESOLUTION_TO_INTERVAL_MS[resolution]!;

  const [startBn, intervalSizeBn, fillTimeBn] = [
    BigNumber(chartStartTimeMs),
    BigNumber(intervalMs),
    BigNumber(fillTimeMs),
  ];
  const numIntervalsBetween = fillTimeBn.minus(startBn).dividedToIntegerBy(intervalSizeBn);
  return startBn
    .plus(numIntervalsBetween.multipliedBy(intervalSizeBn))
    .dividedToIntegerBy(1000)
    .toNumber();
}

/**
 * Merges bars into one ascending list with one bar per time, the later argument winning. Bars
 * come from paged history requests that overlap at their edges and from the stream, which
 * repeats the open bar on every update.
 */
export function mergeBars<T extends { time: number }>(
  existing: readonly T[],
  incoming: readonly T[]
): T[] {
  const byTime = new Map<number, T>();
  existing.forEach((bar) => byTime.set(bar.time, bar));
  incoming.forEach((bar) => byTime.set(bar.time, bar));
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

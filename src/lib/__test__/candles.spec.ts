import { describe, expect, it } from 'vitest';

import { Candle, CandleResolution } from '@/constants/candles';
import { timeUnits } from '@/constants/time';

import { getBarTime, mapCandle, mergeBars } from '../candles';

describe('getBarTime', () => {
  it('should return the correct value when times start at 0', () => {
    const beginningOfChart = getBarTime(0, 0, '1');
    expect(beginningOfChart).toBe(0);

    const middleOfChart = getBarTime(0, timeUnits.minute * 10 + 1, '1');
    expect(middleOfChart).toBe(600);
  });

  it('should return the correct value when times dont start at 0', () => {
    // Intervals here look like 100, 1100, ... 9100, 10100, .etc
    // Should resolve to 9100ms bucket which is 9s
    const nonZeroStart = getBarTime(100, timeUnits.minute * 10 + 1, '1');
    expect(nonZeroStart).toBe(540);
  });

  it('should return correct value with real timestamps', () => {
    const timestampInSeconds = getBarTime(1716091200000, 1723573418524, '1D');
    expect(timestampInSeconds).toBe(1723521600);
  });
});

describe('mergeBars', () => {
  const bar = (time: number, close: number) => ({ time, close });

  it('keeps one bar per time, the incoming one winning, in ascending order', () => {
    const merged = mergeBars([bar(30, 1), bar(10, 1), bar(20, 1)], [bar(20, 2), bar(5, 2)]);
    expect(merged).toEqual([bar(5, 2), bar(10, 1), bar(20, 2), bar(30, 1)]);
  });

  it('returns the incoming bars when nothing was loaded yet', () => {
    expect(mergeBars([], [bar(2, 1), bar(1, 1)])).toEqual([bar(1, 1), bar(2, 1)]);
  });
});

describe('mapCandle', () => {
  const candle: Candle = {
    startedAt: '2026-10-06T00:00:00.000Z',
    ticker: 'BTC-USD',
    resolution: CandleResolution.ONE_HOUR,
    low: '99000',
    high: '101000',
    open: '100000',
    close: '100500',
    baseTokenVolume: '1.5',
    usdVolume: '150000.4',
    trades: 3,
    startingOpenInterest: '0',
    orderbookMidPriceOpen: '100010',
    orderbookMidPriceClose: '100020',
  };

  it('uses the trade prices when the bar has trades', () => {
    const bar = mapCandle(candle);
    expect(bar.time).toBe(Date.parse('2026-10-06T00:00:00.000Z'));
    expect([bar.open, bar.high, bar.low, bar.close]).toEqual([100000, 101000, 99000, 100500]);
    expect(bar.volume).toBe(150001);
  });

  it('uses the order book mid prices when the bar has no trades', () => {
    const bar = mapCandle({ ...candle, trades: 0 });
    expect([bar.open, bar.close]).toEqual([100010, 100020]);
    expect(bar.low).toBe(100010);
    expect(bar.high).toBe(100020);
  });
});

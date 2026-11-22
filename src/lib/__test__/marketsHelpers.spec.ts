import { describe, expect, it } from 'vitest';

import { MarketsSortType } from '@/constants/marketList';

import { getEffectiveMarketsSort, hasMarketCaps } from '../marketsHelpers';

describe('the order a market list sorts by', () => {
  const without = [{ marketCap: null }, { marketCap: 0 }];
  const withOne = [{ marketCap: null }, { marketCap: 1_000_000 }];

  it('is volume when market cap is chosen and no market carries one', () => {
    expect(hasMarketCaps(without)).toBe(false);
    expect(getEffectiveMarketsSort(MarketsSortType.MarketCap, without)).toBe(
      MarketsSortType.Volume
    );
    expect(getEffectiveMarketsSort(MarketsSortType.MarketCap, [])).toBe(MarketsSortType.Volume);
  });

  it('is market cap when it is chosen and a market carries one', () => {
    expect(hasMarketCaps(withOne)).toBe(true);
    expect(getEffectiveMarketsSort(MarketsSortType.MarketCap, withOne)).toBe(
      MarketsSortType.MarketCap
    );
  });

  it('is any other choice as it is', () => {
    expect(getEffectiveMarketsSort(MarketsSortType.Gainers, without)).toBe(MarketsSortType.Gainers);
  });
});

import { describe, expect, it } from 'vitest';

import { MarketsData } from '../../types/rawTypes';
import { getHighestMarketLeverage } from '../markets';

const markets = (fractions: Record<string, string | undefined>) =>
  Object.fromEntries(
    Object.entries(fractions).map(([ticker, initialMarginFraction]) => [
      ticker,
      { ticker, initialMarginFraction },
    ])
  ) as unknown as MarketsData;

describe('the highest leverage any market allows', () => {
  it('is one over the initial margin fraction of the only market', () => {
    expect(getHighestMarketLeverage(markets({ 'BTC-USD': '0.1' }))?.toNumber()).toBe(10);
  });

  it('is that of the market with the lowest initial margin fraction', () => {
    const leverage = getHighestMarketLeverage(markets({ 'BTC-USD': '0.1', 'ETH-USD': '0.05' }));
    expect(leverage?.toNumber()).toBe(20);
  });

  it('is not known without a market that has a fraction above zero', () => {
    expect(getHighestMarketLeverage(undefined)).toBeUndefined();
    expect(getHighestMarketLeverage(markets({}))).toBeUndefined();
    expect(getHighestMarketLeverage(markets({ 'BTC-USD': undefined }))).toBeUndefined();
    expect(getHighestMarketLeverage(markets({ 'BTC-USD': '0' }))).toBeUndefined();
  });
});

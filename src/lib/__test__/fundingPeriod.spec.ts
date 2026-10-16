import { describe, expect, it } from 'vitest';

import { formatFundingPeriod, getFundingPeriodHours } from '../fundingPeriod';

describe('getFundingPeriodHours', () => {
  it("reads the market's period in hours", () => {
    // the BTC market's period on mainnet
    expect(getFundingPeriodHours(28_800_000)).toBe(8);
    expect(getFundingPeriodHours(5_400_000)).toBe(1.5);
  });

  it('falls back to the hourly rate without a period', () => {
    expect(getFundingPeriodHours(undefined)).toBe(1);
    expect(getFundingPeriodHours(null)).toBe(1);
    expect(getFundingPeriodHours(0)).toBe(1);
  });
});

describe('formatFundingPeriod', () => {
  it('names whole and partial hours', () => {
    expect(formatFundingPeriod(8)).toBe('8h');
    expect(formatFundingPeriod(1.5)).toBe('1.5h');
  });
});

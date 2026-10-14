import { describe, expect, it } from 'vitest';

import {
  fractionToIfixed,
  IFIXED_ONE,
  limitPriceToUnits,
  priceToUnits,
  ratioToRestore,
} from '../units';

const HALF_DOLLAR_TICK = '500000000';

describe('limitPriceToUnits', () => {
  it('rounds a bid limit down to the tick', () => {
    expect(limitPriceToUnits(100.37, false, HALF_DOLLAR_TICK)).toBe(100_000_000_000n);
  });

  it('rounds an ask limit up to the tick', () => {
    expect(limitPriceToUnits(100.37, true, HALF_DOLLAR_TICK)).toBe(100_500_000_000n);
  });

  it('keeps a price already on the tick', () => {
    expect(limitPriceToUnits(100.5, false, HALF_DOLLAR_TICK)).toBe(100_500_000_000n);
    expect(limitPriceToUnits(100.5, true, HALF_DOLLAR_TICK)).toBe(100_500_000_000n);
  });

  it('rounds below the nine-decimal unit toward the inside of the limit', () => {
    expect(limitPriceToUnits('1.2345678901', false)).toBe(1_234_567_890n);
    expect(limitPriceToUnits('1.2345678901', true)).toBe(1_234_567_891n);
  });

  it('matches priceToUnits for bids', () => {
    expect(limitPriceToUnits(64_123.987, false, HALF_DOLLAR_TICK)).toBe(
      priceToUnits(64_123.987, HALF_DOLLAR_TICK)
    );
  });
});

describe('fractionToIfixed', () => {
  it('scales an indexer margin fraction to 18 decimals, rounding up', () => {
    expect(fractionToIfixed('0.1')).toBe(100_000_000_000_000_000n);
    expect(fractionToIfixed('0.0000000000000000001')).toBe(1n);
  });
});

describe('ratioToRestore', () => {
  const TEN_X = 100_000_000_000_000_000n;
  const FIVE_X = 200_000_000_000_000_000n;

  it("keeps the position's own ratio when it is the highest", () => {
    expect(ratioToRestore(FIVE_X, [TEN_X, undefined])).toBe(FIVE_X);
  });

  it("takes a market ratio raised above the position's", () => {
    expect(ratioToRestore(TEN_X, [TEN_X, FIVE_X])).toBe(FIVE_X);
  });

  it('never exceeds 1', () => {
    expect(ratioToRestore(TEN_X, [IFIXED_ONE + 1n])).toBe(IFIXED_ONE);
  });
});

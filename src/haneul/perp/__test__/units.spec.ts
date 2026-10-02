import { describe, expect, it } from 'vitest';

import { limitPriceToUnits, priceToUnits } from '../units';

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

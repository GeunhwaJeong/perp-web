import { OrderType } from '@/bonsai/types/summaryTypes';
import { describe, expect, it } from 'vitest';

import { unsupportedOrderTypeReason } from '../engineOrderSupport';

describe('unsupportedOrderTypeReason', () => {
  it('lets limit and market orders through', () => {
    expect(unsupportedOrderTypeReason(OrderType.LIMIT)).toBeUndefined();
    expect(unsupportedOrderTypeReason(OrderType.MARKET)).toBeUndefined();
  });

  it('lets stop, take profit and TWAP orders through, which become order tickets', () => {
    [
      OrderType.STOP_LIMIT,
      OrderType.STOP_MARKET,
      OrderType.TAKE_PROFIT_LIMIT,
      OrderType.TAKE_PROFIT_MARKET,
      OrderType.TWAP,
    ].forEach((type) => {
      expect(unsupportedOrderTypeReason(type)).toBeUndefined();
    });
  });

  it('refuses a TWAP suborder, which only the keeper places', () => {
    expect(unsupportedOrderTypeReason(OrderType.TWAP_SUBORDER)).toBe(
      'TWAP suborders are placed by the keeper'
    );
  });
});

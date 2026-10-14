import { OrderType } from '@dydxprotocol/v4-client-js';
import { describe, expect, it } from 'vitest';

import { unsupportedOrderTypeReason } from '../engineOrderSupport';

describe('unsupportedOrderTypeReason', () => {
  it('lets limit and market orders through', () => {
    expect(unsupportedOrderTypeReason(OrderType.LIMIT)).toBeUndefined();
    expect(unsupportedOrderTypeReason(OrderType.MARKET)).toBeUndefined();
  });

  it('refuses TWAP orders', () => {
    expect(unsupportedOrderTypeReason(OrderType.TWAP)).toBe('TWAP orders are not available yet');
    expect(unsupportedOrderTypeReason(OrderType.TWAP_SUBORDER)).toBe(
      'TWAP orders are not available yet'
    );
  });

  it('refuses every conditional order type', () => {
    [
      OrderType.STOP_LIMIT,
      OrderType.STOP_MARKET,
      OrderType.TAKE_PROFIT_LIMIT,
      OrderType.TAKE_PROFIT_MARKET,
    ].forEach((type) => {
      expect(unsupportedOrderTypeReason(type)).toBe('Conditional orders are not available yet');
    });
  });
});

import { describe, expect, it } from 'vitest';

import { canceledOrders, ORDER_NO_LONGER_OPEN } from '../cancelOutcome';

describe('canceledOrders', () => {
  it('tells the orders the chain canceled from the ones the cancel passed over', () => {
    const wasCanceled = canceledOrders(['170141183460469231731687303715884105729', '42']);
    expect(wasCanceled('170141183460469231731687303715884105729')).toBe(true);
    expect(wasCanceled('42')).toBe(true);
    expect(wasCanceled('43')).toBe(false);
    expect(canceledOrders([])('42')).toBe(false);
  });

  it('compares the ids as numbers, however they are written', () => {
    const wasCanceled = canceledOrders(['0x2a', '007']);
    expect(wasCanceled('42')).toBe(true);
    expect(wasCanceled('7')).toBe(true);
  });

  it('takes an id that is not a number as it is', () => {
    const wasCanceled = canceledOrders(['42']);
    expect(wasCanceled('ticket:0x1:sl')).toBe(false);
    expect(canceledOrders(['ticket:0x1:sl'])('ticket:0x1:sl')).toBe(true);
  });

  it('says of a passed-over order that it was no longer open', () => {
    expect(ORDER_NO_LONGER_OPEN).toEqual({ errorMessage: 'The order was no longer open' });
  });
});

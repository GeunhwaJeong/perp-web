import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  handInTicketDetails,
  KeeperUnavailableError,
  stopLossTakeProfitJson,
  toHex,
  twapJson,
} from '../keeper';

const CLEARING_HOUSE = '0xf77dda417d4003c017c96697809d3a25b2767aca586b5b7579e975e47508df77';
const E18 = 10n ** 18n;
const salt = Uint8Array.from({ length: 32 }, (_, i) => i);

describe('the keeper details JSON', () => {
  it('is the keeper smoke check vector of a stop loss / take profit on a long', () => {
    const json = stopLossTakeProfitJson({
      clearingHouse: CLEARING_HOUSE,
      isLimitOrder: false,
      triggerPriceType: 0,
      stopLossPrice: 95_000n * E18,
      takeProfitPrice: 105_000n * E18,
      positionIsAsk: false,
      size: 250_000_000n,
      price: 0n,
      orderType: 0n,
      salt,
    });
    // What perp-liquidator's keeper_smoke.py hands in, and the keeper hashes to 330487….
    expect(JSON.parse(JSON.stringify(json))).toEqual({
      clearingHouse: CLEARING_HOUSE,
      isLimitOrder: false,
      triggerPriceType: 0,
      stopLossPrice: '95000000000000000000000',
      takeProfitPrice: '105000000000000000000000',
      positionIsAsk: false,
      size: '250000000',
      price: '0',
      orderType: '0',
      salt: toHex(salt),
    });
  });

  it('writes a TWAP with its optional deadlines left out when unset', () => {
    const json = twapJson({
      firstRunExpireTimestampMs: 1_800_000_060_000n,
      executionGapMs: 60_000n,
      executionTimeUncertaintyMs: 10_000n,
      chunksAmount: 4n,
      smallTailMergeThresholdBps: 0n,
      timeForRetryMs: 30_000n,
      amountUncertaintyBps: 0n,
      maxOneExecutionAmountBps: 2_500n,
      side: false,
      size: 1_000_000_000n,
      maxSlippageBps: 100n,
      reduceOnly: false,
      salt,
    });
    const sent = JSON.parse(JSON.stringify(json));
    expect(sent.firstRunExpireTimestampMs).toBe('1800000060000');
    expect('expireTimestampMs' in sent).toBe(false);
    expect(sent.chunksAmount).toBe('4');
  });

  it('writes bytes as lowercase hex', () => {
    expect(toHex(Uint8Array.from([0, 15, 255]))).toBe('000fff');
  });
});

describe('handInTicketDetails', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts the details to the keeper under the site origin and reads its answer', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ commitment: 'ab', known: false, held: true }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const answer = await handInTicketDetails({}, 'twap', { size: '1' });
    expect(answer).toEqual({ commitment: 'ab', known: false, held: true });
    expect(fetchMock).toHaveBeenCalledWith('/keeper/v1/details', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'twap', details: { size: '1' } }),
    });
  });

  it('throws when the keeper refuses the details or cannot be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: 'triggerPriceType 3 is not 0 (index), 1 (book) or 2 (mark)' }),
      })
    );
    await expect(handInTicketDetails({ keeperUrl: '/k' }, 'twap', {})).rejects.toThrow(
      /refused the order's details: triggerPriceType 3/
    );
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(handInTicketDetails({}, 'twap', {})).rejects.toBeInstanceOf(
      KeeperUnavailableError
    );
  });
});

import { describe, expect, it } from 'vitest';

import { standaloneStopCommitment, stopLossTakeProfitCommitment, twapCommitment } from '../tickets';

// The mainnet BTC-USD clearing house. The keepers (perp-liquidator `perp_bot_common::tickets`)
// pin the same hashes, so a change to the encoding on either side breaks one of the two suites.
const CLEARING_HOUSE = '0xf77dda417d4003c017c96697809d3a25b2767aca586b5b7579e975e47508df77';
const E18 = 10n ** 18n;
const salt = Uint8Array.from({ length: 32 }, (_, i) => i);
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

describe('stopLossTakeProfitCommitment', () => {
  it('commits to a stop loss and a take profit on a long', () => {
    const commitment = stopLossTakeProfitCommitment({
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
    expect(hex(commitment)).toBe(
      '330487179a9f27ca0f9adf7fca5bb677b5484ded8aaecabf9cc5ca5fe1e372b8'
    );
  });

  it('commits to a take profit only limit close of a short', () => {
    const commitment = stopLossTakeProfitCommitment({
      clearingHouse: CLEARING_HOUSE,
      expireTimestampMs: 1_800_000_000_000n,
      isLimitOrder: true,
      triggerPriceType: 2,
      takeProfitPrice: 90_000n * E18,
      positionIsAsk: true,
      size: 100_000_000n,
      price: 90_000_000_000n,
      orderType: 1n,
      salt,
    });
    expect(hex(commitment)).toBe(
      'b3391bdd5582bb2db8e7237f6c0b5805a78399feb0c33d7c1e21842bbd19a689'
    );
  });
});

describe('standaloneStopCommitment', () => {
  it('commits to a stop on the book price', () => {
    const commitment = standaloneStopCommitment({
      clearingHouse: CLEARING_HOUSE,
      expireTimestampMs: 1_800_000_000_000n,
      isLimitOrder: true,
      triggerPriceType: 1,
      stopIndexPrice: 101_000n * E18,
      triggerAtOrAbove: true,
      side: false,
      size: 100_000_000n,
      price: 101_500_000_000n,
      orderType: 0n,
      reduceOnly: true,
      salt,
    });
    expect(hex(commitment)).toBe(
      '17c0fe7d24464e1d3df5dcf1cf54c9534e5044e6284a9ee22272a5e6c3f229ec'
    );
  });
});

describe('twapCommitment', () => {
  it('commits to a TWAP in four chunks', () => {
    const commitment = twapCommitment({
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
    expect(hex(commitment)).toBe(
      'c132d3da096c43c38b2c96ad1f4bc9edac7441c1a272dd3f0d7bb927596539ec'
    );
  });
});

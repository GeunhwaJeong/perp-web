import { bcs } from '@haneullabs/haneul/bcs';
import { describe, expect, it } from 'vitest';

import {
  accountFeeRates,
  ifixedToNumber,
  parseFeeSchedule,
  stakingLevel,
  volumeTierIndex,
  type PerpFeeSchedule,
} from '../fees';
import { B9, IFIXED_ONE } from '../units';

const ifixed = (fraction: number) => BigInt(Math.round(fraction * 1e6)) * (IFIXED_ONE / 1_000_000n);

// The mainnet schedule at launch: one volume tier at the base rates, 10% off from 10,000 HANEUL.
const FeeScheduleBcs = bcs.struct('FeeSchedule', {
  id: bcs.Address,
  version: bcs.u64(),
  base_taker_fee: bcs.u256(),
  base_maker_fee: bcs.u256(),
  volume_tiers: bcs.vector(
    bcs.struct('VolumeTier', {
      min_volume: bcs.u256(),
      taker_fee: bcs.u256(),
      maker_fee: bcs.u256(),
    })
  ),
  staking_tiers: bcs.vector(
    bcs.struct('StakingTier', { min_stake: bcs.u64(), discount: bcs.u256() })
  ),
  share_tiers: bcs.vector(
    bcs.struct('ShareTier', {
      min_share: bcs.u256(),
      min_maker_volume: bcs.u256(),
      maker_fee: bcs.u256(),
    })
  ),
  multiplier_ttl_ms: bcs.u64(),
  window_epochs: bcs.u64(),
});

const mainnetBytes = FeeScheduleBcs.serialize({
  id: `0x${'5a'.repeat(32)}`,
  version: 1n,
  base_taker_fee: ifixed(0.0005),
  base_maker_fee: ifixed(0.0002),
  volume_tiers: [{ min_volume: 0n, taker_fee: ifixed(0.0005), maker_fee: ifixed(0.0002) }],
  staking_tiers: [{ min_stake: 10_000n * B9, discount: ifixed(0.1) }],
  share_tiers: [],
  multiplier_ttl_ms: 86_400_000n,
  window_epochs: 14n,
}).toBytes();

const tiered: PerpFeeSchedule = {
  baseTakerFee: 0.0005,
  baseMakerFee: 0.0002,
  volumeTiers: [
    { minVolume: 0, takerFee: 0.0005, makerFee: 0.0002 },
    { minVolume: 1_000_000, takerFee: 0.0004, makerFee: 0.0001 },
    { minVolume: 10_000_000, takerFee: 0.0003, makerFee: 0 },
  ],
  stakingTiers: [
    { minStake: 10_000, discount: 0.1 },
    { minStake: 100_000, discount: 0.25 },
  ],
  shareTiers: [],
  multiplierTtlMs: 86_400_000,
  windowEpochs: 14,
};

describe('parseFeeSchedule', () => {
  it('reads the schedule object as rates, USD and HANEUL', () => {
    expect(parseFeeSchedule(mainnetBytes)).toEqual({
      baseTakerFee: 0.0005,
      baseMakerFee: 0.0002,
      volumeTiers: [{ minVolume: 0, takerFee: 0.0005, makerFee: 0.0002 }],
      stakingTiers: [{ minStake: 10_000, discount: 0.1 }],
      shareTiers: [],
      multiplierTtlMs: 86_400_000,
      windowEpochs: 14,
    });
  });
});

describe('ifixedToNumber', () => {
  it('reads two’s complement values as negative', () => {
    expect(ifixedToNumber(2n ** 256n - ifixed(0.0001))).toBe(-0.0001);
    expect(ifixedToNumber(IFIXED_ONE)).toBe(1);
  });
});

describe('tiers', () => {
  it('takes the highest volume tier reached', () => {
    expect(volumeTierIndex(tiered, 0)).toBe(0);
    expect(volumeTierIndex(tiered, 999_999)).toBe(0);
    expect(volumeTierIndex(tiered, 1_000_000)).toBe(1);
    expect(volumeTierIndex(tiered, 50_000_000)).toBe(2);
  });

  it('counts the staking levels reached', () => {
    expect(stakingLevel(tiered, 9_999.999)).toBe(0);
    expect(stakingLevel(tiered, 10_000)).toBe(1);
    expect(stakingLevel(tiered, 100_000)).toBe(2);
  });
});

describe('accountFeeRates', () => {
  it('is the first tier without volume or stake', () => {
    expect(accountFeeRates(tiered, 0, 0)).toEqual({
      tierIndex: 0,
      level: 0,
      discount: 0,
      tierTaker: 0.0005,
      tierMaker: 0.0002,
      taker: 0.0005,
      maker: 0.0002,
    });
  });

  it('applies the staking discount to both rates of the volume tier', () => {
    const rates = accountFeeRates(tiered, 2_000_000, 100_000);
    expect(rates).toMatchObject({ tierIndex: 1, level: 2, tierTaker: 0.0004, tierMaker: 0.0001 });
    expect(rates.taker).toBeCloseTo(0.0003, 12);
    expect(rates.maker).toBeCloseTo(0.000075, 12);
  });

  it('leaves a schedule without volume tiers at the base rates, stake or not', () => {
    expect(accountFeeRates({ ...tiered, volumeTiers: [] }, 0, 10_000)).toMatchObject({
      discount: 0,
      taker: 0.0005,
      maker: 0.0002,
    });
  });
});

import { bcs } from '@haneullabs/haneul/bcs';
import type { ClientWithCoreApi } from '@haneullabs/haneul/client';
import { Transaction } from '@haneullabs/haneul/transactions';
import BigNumber from 'bignumber.js';

import { CLOCK_OBJECT_ID, type PerpDeployment } from './config';
import { simulateReturnValues } from './execution';
import { B9, IFIXED_ONE } from './units';

/**
 * Fee tiers as the engine prices them (`perpetuals_fees`). The schedule's volume tiers set the
 * taker and maker rates, a staking tier discounts both, and the result is cached on each market
 * as multipliers of that market's own rates, which the account's next sessions pay.
 *
 * Rates are fractions of notional (0.0005 is 0.05%), volumes are USD and stakes are HANEUL.
 */

export type PerpFeeSchedule = {
  baseTakerFee: number;
  baseMakerFee: number;
  /** Ascending by `minVolume`; the first tier starts at zero. */
  volumeTiers: { minVolume: number; takerFee: number; makerFee: number }[];
  /** Ascending by `minStake`, the principal kept in the staking tier registry. */
  stakingTiers: { minStake: number; discount: number }[];
  /** Maker rates for a share of a market's maker volume, priced per market. */
  shareTiers: { minShare: number; minMakerVolume: number; makerFee: number }[];
  multiplierTtlMs: number;
  /** Epochs of volume that count toward a volume tier. */
  windowEpochs: number;
};

export type PerpFeeMultipliers = { taker: number; maker: number };

export type PerpAccountFees = {
  /** Volume over the window: the account's own plus maker volume still staged on its markets. */
  volume: number;
  /** Principal the account's tier address keeps in the staking tier registry. */
  stake: number;
  /** Per market, what the next session pays: the cached tier, or 1 once it has expired. */
  multipliers: Record<string, PerpFeeMultipliers>;
};

const VolumeTierBcs = bcs.struct('VolumeTier', {
  min_volume: bcs.u256(),
  taker_fee: bcs.u256(),
  maker_fee: bcs.u256(),
});

const StakingTierBcs = bcs.struct('StakingTier', {
  min_stake: bcs.u64(),
  discount: bcs.u256(),
});

const ShareTierBcs = bcs.struct('ShareTier', {
  min_share: bcs.u256(),
  min_maker_volume: bcs.u256(),
  maker_fee: bcs.u256(),
});

const FeeScheduleBcs = bcs.struct('FeeSchedule', {
  id: bcs.Address,
  version: bcs.u64(),
  base_taker_fee: bcs.u256(),
  base_maker_fee: bcs.u256(),
  volume_tiers: bcs.vector(VolumeTierBcs),
  staking_tiers: bcs.vector(StakingTierBcs),
  share_tiers: bcs.vector(ShareTierBcs),
  multiplier_ttl_ms: bcs.u64(),
  window_epochs: bcs.u64(),
});

const IFIXED_SIGN_BIT = 2n ** 255n;

/** An ifixed (1e18, two's complement `u256`) as a number. */
export const ifixedToNumber = (value: string | bigint) => {
  const raw = BigInt(value);
  const signed = raw >= IFIXED_SIGN_BIT ? raw - 2n ** 256n : raw;
  return new BigNumber(signed.toString()).div(IFIXED_ONE.toString()).toNumber();
};

const haneulToNumber = (value: string | bigint) =>
  new BigNumber(value.toString()).div(B9.toString()).toNumber();

export const parseFeeSchedule = (bytes: Uint8Array): PerpFeeSchedule => {
  const s = FeeScheduleBcs.parse(bytes);
  return {
    baseTakerFee: ifixedToNumber(s.base_taker_fee),
    baseMakerFee: ifixedToNumber(s.base_maker_fee),
    volumeTiers: s.volume_tiers.map((t) => ({
      minVolume: ifixedToNumber(t.min_volume),
      takerFee: ifixedToNumber(t.taker_fee),
      makerFee: ifixedToNumber(t.maker_fee),
    })),
    stakingTiers: s.staking_tiers.map((t) => ({
      minStake: haneulToNumber(t.min_stake),
      discount: ifixedToNumber(t.discount),
    })),
    shareTiers: s.share_tiers.map((t) => ({
      minShare: ifixedToNumber(t.min_share),
      minMakerVolume: ifixedToNumber(t.min_maker_volume),
      makerFee: ifixedToNumber(t.maker_fee),
    })),
    multiplierTtlMs: Number(s.multiplier_ttl_ms),
    windowEpochs: Number(s.window_epochs),
  };
};

/** The deployment's fee schedule; undefined where the fee-tier extension is not configured. */
export const readFeeSchedule = async (
  client: ClientWithCoreApi,
  deployment: PerpDeployment
): Promise<PerpFeeSchedule | undefined> => {
  if (!deployment.fees) return undefined;
  const { object } = await client.core.getObject<{ content: true }>({
    objectId: deployment.fees.schedule,
    include: { content: true },
  });
  return parseFeeSchedule(object.content);
};

/**
 * Reads an account's fee inputs in one simulated transaction, on the chain's own epoch and
 * clock. Without a trading account only the signer's stake is read: the address an account it
 * opens is priced by until it registers another.
 */
export const readAccountFees = async (
  client: ClientWithCoreApi,
  deployment: PerpDeployment,
  sender: string,
  account: { account: string; accountId: bigint } | undefined
): Promise<PerpAccountFees | undefined> => {
  const { fees } = deployment;
  if (!fees) return undefined;
  const { perpetuals, perpetualsFees, stakingTiers } = deployment.packages;
  const coinType = deployment.collateral.coinType;
  const tx = new Transaction();
  tx.setSender(sender);

  if (!account) {
    tx.moveCall({
      target: `${stakingTiers}::registry::active_stake`,
      arguments: [tx.object(fees.tierRegistry), tx.pure.address(sender)],
    });
    const [[stake]] = (await simulateReturnValues(tx, client)) as [[Uint8Array]];
    return { volume: 0, stake: haneulToNumber(bcs.u64().parse(stake)), multipliers: {} };
  }

  const [epoch] = tx.moveCall({ target: '0x2::tx_context::epoch' });
  const [now] = tx.moveCall({
    target: '0x2::clock::timestamp_ms',
    arguments: [tx.object(CLOCK_OBJECT_ID)],
  });
  const markets = Object.values(deployment.markets);
  markets.forEach((market) => {
    tx.moveCall({
      target: `${perpetuals}::clearing_house::fee_multiplier`,
      typeArguments: [coinType],
      arguments: [tx.object(market.clearingHouse), tx.pure.u64(account.accountId), now!],
    });
    tx.moveCall({
      target: `${perpetualsFees}::fees::unswept_maker_volume`,
      typeArguments: [coinType],
      arguments: [tx.object(market.clearingHouse), tx.pure.u64(account.accountId), epoch!],
    });
  });
  tx.moveCall({
    target: `${perpetualsFees}::fees::volume`,
    typeArguments: [coinType],
    arguments: [tx.object(account.account), epoch!],
  });
  const [tierAddress] = tx.moveCall({
    target: `${perpetualsFees}::fees::tier_address`,
    typeArguments: [coinType],
    arguments: [tx.object(account.account), tx.pure.address(sender)],
  });
  tx.moveCall({
    target: `${stakingTiers}::registry::active_stake`,
    arguments: [tx.object(fees.tierRegistry), tierAddress!],
  });

  const results = await simulateReturnValues(tx, client);
  const u256 = (bytes: Uint8Array | undefined) => ifixedToNumber(bcs.u256().parse(bytes!));
  const perMarket = results.slice(2, 2 + markets.length * 2);
  const [volume, , stake] = results.slice(2 + markets.length * 2);
  let staged = 0;
  const multipliers: Record<string, PerpFeeMultipliers> = {};
  markets.forEach((market, i) => {
    const [taker, maker] = perMarket[i * 2]!;
    multipliers[market.marketId] = { taker: u256(taker), maker: u256(maker) };
    staged += u256(perMarket[i * 2 + 1]![0]);
  });
  return {
    volume: u256(volume![0]) + staged,
    stake: haneulToNumber(bcs.u64().parse(stake![0]!)),
    multipliers,
  };
};

/** Index of the highest volume tier `volume` reaches, as `config::volume_tier_index`. */
export const volumeTierIndex = (schedule: PerpFeeSchedule, volume: number) =>
  schedule.volumeTiers.reduce(
    (index, tier, i) => (i > 0 && volume >= tier.minVolume ? i : index),
    0
  );

/** Number of staking tiers `stake` reaches, 0 below the first, as `config::staking_tier_index`. */
export const stakingLevel = (schedule: PerpFeeSchedule, stake: number) =>
  schedule.stakingTiers.filter((tier) => stake >= tier.minStake).length;

/**
 * What an account's tier charges on a market at the schedule's base rates (other markets scale
 * in proportion): its volume tier's rates, and those rates after its staking discount. Maker
 * share rebates are earned per market and are not part of it. A schedule without volume tiers
 * leaves every account at the market's rates, as `config::multipliers` does.
 */
export const accountFeeRates = (schedule: PerpFeeSchedule, volume: number, stake: number) => {
  const tierIndex = volumeTierIndex(schedule, volume);
  const tier = schedule.volumeTiers[tierIndex];
  const level = stakingLevel(schedule, stake);
  if (tier == null || schedule.baseTakerFee === 0) {
    const { baseTakerFee, baseMakerFee } = schedule;
    return {
      tierIndex,
      level,
      discount: 0,
      tierTaker: baseTakerFee,
      tierMaker: baseMakerFee,
      taker: baseTakerFee,
      maker: baseMakerFee,
    };
  }
  const discount = level > 0 ? schedule.stakingTiers[level - 1]!.discount : 0;
  return {
    tierIndex,
    level,
    discount,
    tierTaker: tier.takerFee,
    tierMaker: tier.makerFee,
    taker: tier.takerFee * (1 - discount),
    maker: tier.makerFee * (1 - discount),
  };
};

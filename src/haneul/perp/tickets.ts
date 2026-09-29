import { bcs } from '@haneullabs/haneul/bcs';
import { blake2b } from '@noble/hashes/blake2.js';

/**
 * Conditional order tickets commit to a blake2b-256 hash of their details. The engine only
 * learns the details when the executor submits them, so the same encoding the Move code
 * uses to verify the commitment has to be reproduced here byte for byte.
 */

const concat = (parts: Uint8Array[]) => {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  parts.forEach((p) => {
    out.set(p, offset);
    offset += p.length;
  });
  return out;
};

const optionU64 = bcs.option(bcs.u64());
const optionU256 = bcs.option(bcs.u256());
// Option<IntegratorInfo> is only ever `none` from the app, which serializes as a single 0.
const NO_INTEGRATOR = new Uint8Array([0]);

export const randomSalt = (length = 32) => {
  const salt = new Uint8Array(length);
  crypto.getRandomValues(salt);
  return salt;
};

export const hash32 = (bytes: Uint8Array) => blake2b(bytes, { dkLen: 32 });

export type StopLossTakeProfitDetails = {
  clearingHouse: string;
  expireTimestampMs?: bigint;
  isLimitOrder: boolean;
  /** 0: index price, 1: mark price (see `stop_orders::assert_stop_order_trigger_price_type`). */
  triggerPriceType: number;
  stopLossPrice?: bigint;
  takeProfitPrice?: bigint;
  positionIsAsk: boolean;
  size: bigint;
  price: bigint;
  orderType: bigint;
  salt: Uint8Array;
};

/** `stop_orders::place_stop_order_sltp` commitment: bcs of each field in order, then the raw salt. */
export const stopLossTakeProfitCommitment = (d: StopLossTakeProfitDetails) =>
  hash32(
    concat([
      bcs.Address.serialize(d.clearingHouse).toBytes(),
      optionU64.serialize(d.expireTimestampMs ?? null).toBytes(),
      bcs.bool().serialize(d.isLimitOrder).toBytes(),
      bcs.u8().serialize(d.triggerPriceType).toBytes(),
      optionU256.serialize(d.stopLossPrice ?? null).toBytes(),
      optionU256.serialize(d.takeProfitPrice ?? null).toBytes(),
      bcs.bool().serialize(d.positionIsAsk).toBytes(),
      bcs.u64().serialize(d.size).toBytes(),
      bcs.u64().serialize(d.price).toBytes(),
      bcs.u64().serialize(d.orderType).toBytes(),
      NO_INTEGRATOR,
      d.salt,
    ])
  );

export type StandaloneStopDetails = {
  clearingHouse: string;
  expireTimestampMs?: bigint;
  isLimitOrder: boolean;
  triggerPriceType: number;
  /** Index price (ifixed) the order triggers at. */
  stopIndexPrice: bigint;
  /** Trigger when the index is at or above the stop price; otherwise at or below. */
  triggerAtOrAbove: boolean;
  side: boolean;
  size: bigint;
  price: bigint;
  orderType: bigint;
  reduceOnly: boolean;
  salt: Uint8Array;
};

/** `stop_orders::place_stop_order_standalone` commitment. */
export const standaloneStopCommitment = (d: StandaloneStopDetails) =>
  hash32(
    concat([
      bcs.Address.serialize(d.clearingHouse).toBytes(),
      optionU64.serialize(d.expireTimestampMs ?? null).toBytes(),
      bcs.bool().serialize(d.isLimitOrder).toBytes(),
      bcs.u8().serialize(d.triggerPriceType).toBytes(),
      bcs.u256().serialize(d.stopIndexPrice).toBytes(),
      bcs.bool().serialize(d.triggerAtOrAbove).toBytes(),
      bcs.bool().serialize(d.side).toBytes(),
      bcs.u64().serialize(d.size).toBytes(),
      bcs.u64().serialize(d.price).toBytes(),
      bcs.u64().serialize(d.orderType).toBytes(),
      bcs.bool().serialize(d.reduceOnly).toBytes(),
      NO_INTEGRATOR,
      d.salt,
    ])
  );

/** Mirrors `twap_orders::TWAPOrderDetails`; the commitment is blake2b-256 of its BCS. */
export const TwapOrderDetails = bcs.struct('TWAPOrderDetails', {
  first_run_expire_timestamp: optionU64,
  expire_timestamp: optionU64,
  execution_gap_ms: bcs.u64(),
  execution_time_uncertainty_ms: bcs.u64(),
  chunks_amount: bcs.u64(),
  small_tail_merge_threshold_bps: bcs.u64(),
  time_for_retry_ms: bcs.u64(),
  amount_uncertainty_bps: bcs.u64(),
  max_one_execution_amount_bps: bcs.u64(),
  side: bcs.bool(),
  size: bcs.u64(),
  max_slippage_bps: bcs.u64(),
  reduce_only: bcs.bool(),
  // Option<IntegratorInfo>: the app never sets an integrator, so this stays `none`.
  integrator_info: bcs.option(bcs.u8()),
  salt: bcs.vector(bcs.u8()),
});

export type TwapDetails = {
  firstRunExpireTimestampMs?: bigint;
  expireTimestampMs?: bigint;
  executionGapMs: bigint;
  executionTimeUncertaintyMs: bigint;
  chunksAmount: bigint;
  smallTailMergeThresholdBps: bigint;
  timeForRetryMs: bigint;
  amountUncertaintyBps: bigint;
  maxOneExecutionAmountBps: bigint;
  side: boolean;
  size: bigint;
  maxSlippageBps: bigint;
  reduceOnly: boolean;
  salt: Uint8Array;
};

export const twapCommitment = (d: TwapDetails) =>
  hash32(
    TwapOrderDetails.serialize({
      first_run_expire_timestamp: d.firstRunExpireTimestampMs ?? null,
      expire_timestamp: d.expireTimestampMs ?? null,
      execution_gap_ms: d.executionGapMs,
      execution_time_uncertainty_ms: d.executionTimeUncertaintyMs,
      chunks_amount: d.chunksAmount,
      small_tail_merge_threshold_bps: d.smallTailMergeThresholdBps,
      time_for_retry_ms: d.timeForRetryMs,
      amount_uncertainty_bps: d.amountUncertaintyBps,
      max_one_execution_amount_bps: d.maxOneExecutionAmountBps,
      side: d.side,
      size: d.size,
      max_slippage_bps: d.maxSlippageBps,
      reduce_only: d.reduceOnly,
      integrator_info: null,
      salt: Array.from(d.salt),
    }).toBytes()
  );

import BigNumber from 'bignumber.js';

/** Order prices and sizes are u64 with nine decimals; ratios use an 18-decimal fixed point. */
export const B9 = 1_000_000_000n;
export const IFIXED_ONE = 1_000_000_000_000_000_000n;

/** Order type codes the clearing house accepts. */
export const ORDER_TYPE = { GTC: 0n, FOK: 1n, POST_ONLY: 2n, IOC: 3n } as const;

/** Side flag: asks (sells) are `true`, bids (buys) are `false`. */
export const SIDE = { ASK: true, BID: false } as const;

const toBigInt = (
  value: BigNumber,
  scale: bigint,
  step?: bigint,
  mode: BigNumber.RoundingMode = BigNumber.ROUND_DOWN
) => {
  const scaled = value.times(scale.toString()).integerValue(mode);
  let out = BigInt(scaled.toFixed(0));
  if (step && step > 0n) {
    out -= out % step;
  }
  return out;
};

/** Human price (USD) to the u64 order price, snapped down to the tick. */
export const priceToUnits = (price: number | string, tickSize?: string) =>
  toBigInt(new BigNumber(price), B9, tickSize ? BigInt(tickSize) : undefined);

/**
 * Worst acceptable price of an immediate order, snapped to the tick on the side that keeps the
 * limit inside the given price: bids round down, asks round up.
 */
export const limitPriceToUnits = (price: number | string, isAsk: boolean, tickSize?: string) => {
  const mode = isAsk ? BigNumber.ROUND_UP : BigNumber.ROUND_DOWN;
  const out = toBigInt(new BigNumber(price), B9, undefined, mode);
  const step = tickSize ? BigInt(tickSize) : 0n;
  const remainder = step > 0n ? out % step : 0n;
  if (remainder === 0n) return out;
  return isAsk ? out - remainder + step : out - remainder;
};

/** Human size (base asset) to the u64 order size, snapped down to the lot. */
export const sizeToUnits = (size: number | string, lotSize?: string) =>
  toBigInt(new BigNumber(size), B9, lotSize ? BigInt(lotSize) : undefined);

/** Human collateral amount to the coin's smallest unit. */
export const collateralToUnits = (amount: number | string, decimals: number) =>
  toBigInt(new BigNumber(amount), 10n ** BigInt(decimals));

export const unitsToCollateral = (units: bigint | string, decimals: number) =>
  new BigNumber(units.toString()).div(new BigNumber(10).pow(decimals));

export const unitsToPrice = (units: bigint | string) =>
  new BigNumber(units.toString()).div(B9.toString());

/** Leverage (e.g. 10) to the position initial margin ratio as an ifixed, rounded up. */
export const leverageToImr = (leverage: number | string) =>
  toBigInt(new BigNumber(1).div(leverage), IFIXED_ONE, undefined, BigNumber.ROUND_UP);

/** Human price to a u256 ifixed (stop triggers are compared against the index in ifixed). */
export const priceToIfixed = (price: number | string) => toBigInt(new BigNumber(price), IFIXED_ONE);

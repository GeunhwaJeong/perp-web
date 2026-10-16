const HOUR_MS = 3_600_000;

/**
 * Hours in a market's funding period. The indexer serves the funding rate per hour, but the
 * engine charges it over the period (eight hours on the BTC market); without a period, an hour.
 */
export const getFundingPeriodHours = (fundingPeriodMs: number | null | undefined) =>
  fundingPeriodMs != null && fundingPeriodMs > 0 ? fundingPeriodMs / HOUR_MS : 1;

/** "8h", or "1.5h" for a period that is not a whole number of hours. */
export const formatFundingPeriod = (hours: number) =>
  Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;

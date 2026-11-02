import type { PerpDeployment } from './config';
import type { StandaloneStopDetails, StopLossTakeProfitDetails, TwapDetails } from './tickets';

/**
 * The order-ticket keeper (perp-liquidator's `perp-keeper`) is the only party that learns a
 * ticket's details: the chain holds just their commitment. The front end hands the details in
 * right before it asks for the ticket's transaction to be signed, and signs only when the
 * keeper answers with the commitment it computed itself; once the ticket is on chain it hands
 * them in again, which the keeper keeps whatever else is waiting.
 */

export type TicketKind = 'stopLossTakeProfit' | 'standaloneStop' | 'twap';

/** The keeper's details, as JSON: integers as decimal strings, the salt as hex. */
export type TicketDetailsJson = Record<string, string | boolean | number | undefined>;

export type KeeperAnswer = { commitment: string; known: boolean; held: boolean };

/** Where the site serves the keeper, under its own origin (the keeper sends no CORS headers). */
export const DEFAULT_KEEPER_URL = '/keeper';

export const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

const decimal = (value: bigint | undefined) => (value == null ? undefined : value.toString());

export const stopLossTakeProfitJson = (d: StopLossTakeProfitDetails): TicketDetailsJson => ({
  clearingHouse: d.clearingHouse,
  expireTimestampMs: decimal(d.expireTimestampMs),
  isLimitOrder: d.isLimitOrder,
  triggerPriceType: d.triggerPriceType,
  stopLossPrice: decimal(d.stopLossPrice),
  takeProfitPrice: decimal(d.takeProfitPrice),
  positionIsAsk: d.positionIsAsk,
  size: d.size.toString(),
  price: d.price.toString(),
  orderType: d.orderType.toString(),
  salt: toHex(d.salt),
});

export const standaloneStopJson = (d: StandaloneStopDetails): TicketDetailsJson => ({
  clearingHouse: d.clearingHouse,
  expireTimestampMs: decimal(d.expireTimestampMs),
  isLimitOrder: d.isLimitOrder,
  triggerPriceType: d.triggerPriceType,
  stopIndexPrice: d.stopIndexPrice.toString(),
  triggerAtOrAbove: d.triggerAtOrAbove,
  side: d.side,
  size: d.size.toString(),
  price: d.price.toString(),
  orderType: d.orderType.toString(),
  reduceOnly: d.reduceOnly,
  salt: toHex(d.salt),
});

export const twapJson = (d: TwapDetails): TicketDetailsJson => ({
  firstRunExpireTimestampMs: decimal(d.firstRunExpireTimestampMs),
  expireTimestampMs: decimal(d.expireTimestampMs),
  executionGapMs: d.executionGapMs.toString(),
  executionTimeUncertaintyMs: d.executionTimeUncertaintyMs.toString(),
  chunksAmount: d.chunksAmount.toString(),
  smallTailMergeThresholdBps: d.smallTailMergeThresholdBps.toString(),
  timeForRetryMs: d.timeForRetryMs.toString(),
  amountUncertaintyBps: d.amountUncertaintyBps.toString(),
  maxOneExecutionAmountBps: d.maxOneExecutionAmountBps.toString(),
  side: d.side,
  size: d.size.toString(),
  maxSlippageBps: d.maxSlippageBps.toString(),
  reduceOnly: d.reduceOnly,
  salt: toHex(d.salt),
});

export class KeeperUnavailableError extends Error {}

/**
 * `POST <keeper>/v1/details`. Throws when the keeper cannot be reached or refuses the details;
 * a ticket whose details the keeper does not hold would never execute, so the caller signs
 * nothing then.
 */
export async function handInTicketDetails(
  deployment: Pick<PerpDeployment, 'keeperUrl'>,
  kind: TicketKind,
  details: TicketDetailsJson
): Promise<KeeperAnswer> {
  const url = `${deployment.keeperUrl ?? DEFAULT_KEEPER_URL}/v1/details`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind, details }),
    });
  } catch (error) {
    throw new KeeperUnavailableError(
      `The order keeper cannot be reached: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const body = (await response.json().catch(() => undefined)) as
    | (Partial<KeeperAnswer> & { error?: string })
    | undefined;
  if (!response.ok || body?.commitment == null) {
    throw new KeeperUnavailableError(
      `The order keeper refused the order's details: ${body?.error ?? `HTTP ${response.status}`}`
    );
  }
  return { commitment: body.commitment, known: body.known === true, held: body.held === true };
}

import { bcs } from '@haneullabs/haneul/bcs';
import type { ClientWithCoreApi } from '@haneullabs/haneul/client';
import type { Transaction } from '@haneullabs/haneul/transactions';

import { CLOCK_OBJECT_ID, type PerpDeployment, type PerpMarketConfig } from './config';

/**
 * Signed prices put in front of a trade. The `oracle_haneul` source accepts an update from
 * anyone as long as one of its signers signed it, so a trade does not have to wait for the
 * relayer: it fetches the price service's latest updates from `/v1/updates` and writes them
 * into the feeds in the same transaction. An update that is not newer than the stored price is
 * skipped on chain without aborting, so racing the relayer costs nothing.
 */
export type SignedPriceUpdate = {
  symbol: string;
  storageId: number;
  priceFeedStorageId: string;
  /** 18-decimal price. */
  price: bigint;
  confidence: bigint;
  timestampMs: bigint;
  publicKey: Uint8Array;
  signature: Uint8Array;
};

type ServedUpdates = {
  packageId: string;
  sourceId: string;
  aggregatorConfigId: string;
  updates: {
    symbol: string;
    storageId: number;
    priceFeedStorageId: string;
    price: string;
    confidence: string;
    timestampMs: string;
    publicKey: string;
    signature: string;
  }[];
};

/**
 * A collateral feed is shared by every market quoted in that collateral. Writing it from every
 * trade would order all of those markets' trades behind one object, so its update goes in only
 * once the chain's copy has aged past half of the engine's default collateral tolerance (30 s).
 * A market's base feed belongs to that market alone, whose clearing house the trade writes
 * anyway, so its update always goes in.
 */
export const COLLATERAL_RELAY_AFTER_MS = 15_000;

const FETCH_TIMEOUT_MS = 1_500;

const PriceFeedBcs = bcs.struct('PriceFeed', {
  source_id: bcs.u16(),
  from: bcs.Address,
  price: bcs.u128(),
  timestamp_ms: bcs.u64(),
  twap_price: bcs.u128(),
  twap_period_ms: bcs.u64(),
});

const PriceFeedStorageBcs = bcs.struct('PriceFeedStorage', {
  id: bcs.Address,
  storage_id: bcs.u32(),
  symbol: bcs.string(),
  feeds: bcs.vector(PriceFeedBcs),
});

const sameId = (a: string, b: string) =>
  a.replace(/^0x/i, '').padStart(64, '0').toLowerCase() ===
  b.replace(/^0x/i, '').padStart(64, '0').toLowerCase();

const hexToBytes = (hex: string) => {
  const clean = hex.replace(/^0x/i, '');
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) {
    throw new Error(`invalid hex: ${hex.slice(0, 16)}`);
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
};

/**
 * The price service's latest signed updates, or none when it cannot be reached in time or
 * serves another deployment's source. Without updates the trade still goes out and relies on
 * the relayer having kept the feeds fresh; a stale feed then fails it with the engine's own
 * stale-price abort, which is the honest outcome.
 */
export const fetchPriceUpdates = async (
  deployment: PerpDeployment,
  timeoutMs = FETCH_TIMEOUT_MS
): Promise<SignedPriceUpdate[]> => {
  const oracle = deployment.oracle;
  if (!oracle?.updatesUrl) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(oracle.updatesUrl, { cache: 'no-store', signal: controller.signal });
    if (!res.ok) return [];
    const body = (await res.json()) as ServedUpdates;
    // An update signed for another source or package would abort the whole trade on chain.
    if (
      !sameId(body.packageId, oracle.package) ||
      !sameId(body.sourceId, oracle.source) ||
      !sameId(body.aggregatorConfigId, oracle.aggregatorConfig)
    ) {
      return [];
    }
    return body.updates.map((u) => ({
      symbol: u.symbol,
      storageId: u.storageId,
      priceFeedStorageId: u.priceFeedStorageId,
      price: BigInt(u.price),
      confidence: BigInt(u.confidence),
      timestampMs: BigInt(u.timestampMs),
      publicKey: hexToBytes(u.publicKey),
      signature: hexToBytes(u.signature),
    }));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
};

/** Timestamp of the price the source has stored in a feed storage, if it has one. */
export const storedPriceTimestamp = async (
  client: ClientWithCoreApi,
  priceFeedStorageId: string,
  sourceId: number
): Promise<number | undefined> => {
  const obj = await client.core.getObject<{ content: true }>({
    objectId: priceFeedStorageId,
    include: { content: true },
  });
  const storage = PriceFeedStorageBcs.parse(obj.object.content);
  const feed = storage.feeds.find((f) => f.source_id === sourceId);
  return feed ? Number(feed.timestamp_ms) : undefined;
};

/**
 * The updates a trade on `market` should carry: the market's base feed whenever the service
 * has it, the collateral feed only when the chain's copy is getting old (see
 * `COLLATERAL_RELAY_AFTER_MS`). If the stored collateral price cannot be read, its update goes
 * in, which is the safe side.
 */
export const selectPriceUpdates = async ({
  client,
  deployment,
  market,
  updates,
  nowMs = Date.now(),
}: {
  client: ClientWithCoreApi;
  deployment: PerpDeployment;
  market: PerpMarketConfig;
  updates: SignedPriceUpdate[];
  nowMs?: number;
}): Promise<SignedPriceUpdate[]> => {
  const oracle = deployment.oracle;
  if (!oracle || updates.length === 0) return [];
  const base = updates.find((u) => sameId(u.priceFeedStorageId, market.basePriceFeedStorage));
  const collateral = updates.find((u) =>
    sameId(u.priceFeedStorageId, deployment.collateral.priceFeedStorage)
  );
  const selected = base ? [base] : [];
  if (collateral) {
    let stored: number | undefined;
    try {
      stored = await storedPriceTimestamp(
        client,
        deployment.collateral.priceFeedStorage,
        oracle.sourceId
      );
    } catch {
      stored = undefined;
    }
    if (stored == null || nowMs - stored > COLLATERAL_RELAY_AFTER_MS) selected.push(collateral);
  }
  return selected;
};

/** `oracle_haneul::price_feed_storage::update_price_feed` calls for the given updates. */
export const addPriceUpdates = (
  tx: Transaction,
  deployment: PerpDeployment,
  updates: SignedPriceUpdate[]
) => {
  const oracle = deployment.oracle;
  if (!oracle || updates.length === 0) return;
  updates.forEach((u) => {
    tx.moveCall({
      target: `${oracle.package}::price_feed_storage::update_price_feed`,
      arguments: [
        tx.object(oracle.source),
        tx.object(oracle.aggregatorConfig),
        tx.object(u.priceFeedStorageId),
        tx.pure.u128(u.price),
        tx.pure.u128(u.confidence),
        tx.pure.u64(u.timestampMs),
        tx.pure.vector('u8', Array.from(u.publicKey)),
        tx.pure.vector('u8', Array.from(u.signature)),
        tx.object(CLOCK_OBJECT_ID),
      ],
    });
  });
};

import { bcs } from '@haneullabs/haneul/bcs';
import type { ClientWithCoreApi } from '@haneullabs/haneul/client';
import { Transaction } from '@haneullabs/haneul/transactions';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PerpDeployment } from '../config';
import {
  addPriceUpdates,
  COLLATERAL_RELAY_AFTER_MS,
  fetchPriceUpdates,
  selectPriceUpdates,
  type SignedPriceUpdate,
} from '../prices';

const id = (byte: string) => `0x${byte.repeat(32)}`;

const deployment = {
  network: 'localnet',
  collateral: { coinType: '0x2::tusd::TUSD', decimals: 6, priceFeedStorage: id('c0') },
  oracle: {
    package: id('0a'),
    source: id('0b'),
    sourceId: 3,
    aggregatorConfig: id('0c'),
    updatesUrl: 'http://127.0.0.1:8787/v1/updates',
  },
  markets: {
    'BTC-USD': {
      marketId: 'BTC-USD',
      symbol: 'BTC',
      clearingHouse: id('11'),
      basePriceFeedStorage: id('b0'),
      lotSize: '1000000',
      tickSize: '1000000000',
      initialMarginRatio: '100000000000000000',
    },
  },
} as unknown as PerpDeployment;
const market = deployment.markets['BTC-USD']!;

const served = (over: Record<string, unknown> = {}) => ({
  packageId: deployment.oracle!.package,
  sourceId: deployment.oracle!.source,
  aggregatorConfigId: deployment.oracle!.aggregatorConfig,
  updates: [
    {
      symbol: 'BTC/USD',
      storageId: 0,
      priceFeedStorageId: market.basePriceFeedStorage,
      price: '100000000000000000000000',
      confidence: '0',
      timestampMs: '1000',
      publicKey: 'ab'.repeat(32),
      signature: 'cd'.repeat(64),
    },
    {
      symbol: 'TUSD/USD',
      storageId: 1,
      priceFeedStorageId: deployment.collateral.priceFeedStorage,
      price: '1000000000000000000',
      confidence: '0',
      timestampMs: '1001',
      publicKey: 'ab'.repeat(32),
      signature: 'ef'.repeat(64),
    },
  ],
  ...over,
});

const mockFetch = (body: unknown, ok = true) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok, json: async () => body }))
  );

/** A client whose price feed storage holds one feed of `sourceId` stored at `timestampMs`. */
const clientWithStoredFeed = (sourceId: number, timestampMs: number) => {
  const PriceFeed = bcs.struct('PriceFeed', {
    source_id: bcs.u16(),
    from: bcs.Address,
    price: bcs.u128(),
    timestamp_ms: bcs.u64(),
    twap_price: bcs.u128(),
    twap_period_ms: bcs.u64(),
  });
  const content = bcs
    .struct('PriceFeedStorage', {
      id: bcs.Address,
      storage_id: bcs.u32(),
      symbol: bcs.string(),
      feeds: bcs.vector(PriceFeed),
    })
    .serialize({
      id: deployment.collateral.priceFeedStorage,
      storage_id: 1,
      symbol: 'TUSD/USD',
      feeds: [
        {
          source_id: sourceId,
          from: id('0b'),
          price: 10n ** 18n,
          timestamp_ms: BigInt(timestampMs),
          twap_price: 10n ** 18n,
          twap_period_ms: 1n,
        },
      ],
    })
    .toBytes();
  return {
    core: { getObject: vi.fn(async () => ({ object: { content } })) },
  } as unknown as ClientWithCoreApi;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchPriceUpdates', () => {
  it('parses the served updates', async () => {
    mockFetch(served());
    const updates = await fetchPriceUpdates(deployment);
    expect(updates.map((u) => u.symbol)).toEqual(['BTC/USD', 'TUSD/USD']);
    expect(updates[0]!.price).toBe(100_000n * 10n ** 18n);
    expect(updates[0]!.publicKey).toHaveLength(32);
    expect(updates[0]!.signature).toHaveLength(64);
  });

  it('matches ids regardless of leading zeros and case', async () => {
    mockFetch(served({ sourceId: deployment.oracle!.source.toUpperCase().replace('0X', '0x') }));
    expect(await fetchPriceUpdates(deployment)).toHaveLength(2);
  });

  it('ignores a service signing for another source', async () => {
    mockFetch(served({ sourceId: id('ff') }));
    expect(await fetchPriceUpdates(deployment)).toEqual([]);
  });

  it('returns nothing when the service fails', async () => {
    mockFetch({}, false);
    expect(await fetchPriceUpdates(deployment)).toEqual([]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('connection refused');
      })
    );
    expect(await fetchPriceUpdates(deployment)).toEqual([]);
  });

  it('returns nothing without an oracle in the deployment', async () => {
    mockFetch(served());
    expect(await fetchPriceUpdates({ ...deployment, oracle: undefined })).toEqual([]);
  });
});

describe('selectPriceUpdates', () => {
  const now = 1_000_000;
  const updates = async () => {
    mockFetch(served());
    return fetchPriceUpdates(deployment);
  };

  it('always takes the base feed and skips a fresh collateral feed', async () => {
    const client = clientWithStoredFeed(3, now - 1_000);
    const selected = await selectPriceUpdates({
      client,
      deployment,
      market,
      updates: await updates(),
      nowMs: now,
    });
    expect(selected.map((u) => u.symbol)).toEqual(['BTC/USD']);
  });

  it('takes the collateral feed once its stored price ages past the threshold', async () => {
    const client = clientWithStoredFeed(3, now - COLLATERAL_RELAY_AFTER_MS - 1);
    const selected = await selectPriceUpdates({
      client,
      deployment,
      market,
      updates: await updates(),
      nowMs: now,
    });
    expect(selected.map((u) => u.symbol)).toEqual(['BTC/USD', 'TUSD/USD']);
  });

  it('takes the collateral feed when the storage has no feed of the source', async () => {
    const client = clientWithStoredFeed(9, now);
    const selected = await selectPriceUpdates({
      client,
      deployment,
      market,
      updates: await updates(),
      nowMs: now,
    });
    expect(selected.map((u) => u.symbol)).toEqual(['BTC/USD', 'TUSD/USD']);
  });

  it('takes the collateral feed when the stored price cannot be read', async () => {
    const client = {
      core: {
        getObject: vi.fn(async () => {
          throw new Error('unavailable');
        }),
      },
    } as unknown as ClientWithCoreApi;
    const selected = await selectPriceUpdates({
      client,
      deployment,
      market,
      updates: await updates(),
      nowMs: now,
    });
    expect(selected.map((u) => u.symbol)).toEqual(['BTC/USD', 'TUSD/USD']);
  });
});

describe('addPriceUpdates', () => {
  it('writes one update_price_feed call per update, in order', () => {
    const tx = new Transaction();
    const update: SignedPriceUpdate = {
      symbol: 'BTC/USD',
      storageId: 0,
      priceFeedStorageId: market.basePriceFeedStorage,
      price: 1n,
      confidence: 0n,
      timestampMs: 2n,
      publicKey: new Uint8Array(32),
      signature: new Uint8Array(64),
    };
    addPriceUpdates(tx, deployment, [update, { ...update, symbol: 'X' }]);
    const calls = tx.getData().commands.filter((c) => c.$kind === 'MoveCall');
    expect(calls).toHaveLength(2);
    expect(calls[0]!.MoveCall!.function).toBe('update_price_feed');
    expect(calls[0]!.MoveCall!.module).toBe('price_feed_storage');
  });

  it('adds nothing without an oracle', () => {
    const tx = new Transaction();
    addPriceUpdates(tx, { ...deployment, oracle: undefined }, []);
    expect(tx.getData().commands).toHaveLength(0);
  });
});

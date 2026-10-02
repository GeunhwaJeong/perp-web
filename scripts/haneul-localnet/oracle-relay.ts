/* eslint-disable no-console */

/**
 * Checks that a trade carries its own signed prices. Run the fixture's price service without
 * its relay, so the chain's prices go stale and only transactions that write the served updates
 * themselves can read the feeds:
 *
 *   node scripts/haneul-localnet/fixture.mjs push --no-relay      (in another shell)
 *   pnpm exec tsx scripts/haneul-localnet/oracle-relay.ts
 *
 * Needs the dev account from smoke.ts (it creates the BTC-USD position).
 */
import { HaneulGrpcClient } from '@haneullabs/haneul/grpc';
import { Ed25519Keypair } from '@haneullabs/haneul/keypairs/ed25519';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  COLLATERAL_RELAY_AFTER_MS,
  collateralToUnits,
  eventsOf,
  fetchPriceUpdates,
  findPerpAccount,
  HaneulTransactionError,
  ORDER_TYPE,
  PerpTransactionBuilder,
  priceToUnits,
  selectPriceUpdates,
  SIDE,
  signAndExecuteWith,
  sizeToUnits,
  storedPriceTimestamp,
  type PerpDeployment,
} from '../../src/haneul/perp';

const ROOT = join(import.meta.dirname, '..', '..');
const deployment: PerpDeployment = JSON.parse(
  readFileSync(join(ROOT, 'public/configs/haneul/perp.localnet.json'), 'utf8')
);
const signer = Ed25519Keypair.fromSecretKey(
  readFileSync(join(ROOT, '.localnet/dev-wallet.key'), 'utf8').trim()
);
const client = new HaneulGrpcClient({ network: 'localnet', baseUrl: 'http://127.0.0.1:9000' });
const me = signer.getPublicKey().toHaneulAddress();
const b = new PerpTransactionBuilder(deployment);
const MARKET = 'BTC-USD';
const market = deployment.markets[MARKET]!;
const oracle = deployment.oracle!;
const STALE_AFTER_MS = 10_000; // the engine's default base price tolerance

let passed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) throw new Error(`FAIL ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}${detail ? ` (${detail})` : ''}`);
};
const run = (tx: ReturnType<typeof b.session>) => signAndExecuteWith(signer, tx, client);
const abortOf = async (tx: ReturnType<typeof b.session>) => {
  try {
    await run(tx);
    return undefined;
  } catch (e) {
    return e instanceof HaneulTransactionError ? e.abort : undefined;
  }
};
const btcAge = async () =>
  Date.now() - (await storedPriceTimestamp(client, market.basePriceFeedStorage, oracle.sourceId))!;
const sleep = (ms: number) =>
  new Promise((r) => {
    setTimeout(r, ms);
  });
/** Waits until the chain's BTC price is older than the market tolerance (nobody relays). */
const waitForStalePrice = async () => {
  for (let i = 0; i < 40; i += 1) {
    // eslint-disable-next-line no-await-in-loop -- polling the chain until the price ages
    if ((await btcAge()) > STALE_AFTER_MS + 1_000) return;
    // eslint-disable-next-line no-await-in-loop -- polling the chain until the price ages
    await sleep(500);
  }
};

check(
  'deployment names a signed-price source',
  deployment.oracle != null && oracle.updatesUrl.length > 0
);
const health = (await (
  await fetch(oracle.updatesUrl.replace('/v1/updates', '/healthz'))
).json()) as {
  relay?: boolean;
};
if (health.relay !== false) {
  console.error('start the price service without its relay: fixture.mjs push --no-relay');
  process.exit(2);
}
check('price service is up and not relaying', true);

const acct = await findPerpAccount(client, deployment, me);
if (!acct) throw new Error('run smoke.ts first to create the dev account');
const ref = { account: acct.account, cap: acct.cap };

// A resting bid far under the market: it only needs the feeds to be readable.
const restingBid = (clientOrderId: bigint) => ({
  kind: 'limit' as const,
  isAsk: SIDE.BID,
  size: sizeToUnits(0.01, market.lotSize),
  price: priceToUnits(50_000, market.tickSize),
  orderType: ORDER_TYPE.POST_ONLY,
  clientOrderId,
  reduceOnly: false,
});

console.log('waiting for the chain price to go stale...');
await waitForStalePrice();
const staleAge = await btcAge();
check(
  'chain BTC price is older than the market tolerance',
  staleAge > STALE_AFTER_MS,
  `${staleAge} ms`
);

const without = await abortOf(
  b.session({
    ref,
    marketId: MARKET,
    orders: [restingBid(9_001n)],
    options: { allocateMissingMargin: true },
  })
);
check(
  'a session without updates aborts on the stale price',
  without?.module === 'market' && without.code === 1000,
  JSON.stringify(without)
);

const served = await fetchPriceUpdates(deployment);
check('service serves both feeds', served.length === 2, served.map((u) => u.symbol).join(','));
const collateralStored = await storedPriceTimestamp(
  client,
  deployment.collateral.priceFeedStorage,
  oracle.sourceId
);
const selected = await selectPriceUpdates({ client, deployment, market, updates: served });
const collateralAge = Date.now() - collateralStored!;
const expectCollateral = collateralAge > COLLATERAL_RELAY_AFTER_MS;
check(
  'the base feed update is selected',
  selected.some((u) => u.symbol === 'BTC/USD')
);
check(
  `the collateral update is selected only past ${COLLATERAL_RELAY_AFTER_MS} ms`,
  selected.some((u) => u.symbol === 'TUSD/USD') === expectCollateral,
  `collateral age ${collateralAge} ms`
);

const r = await run(
  b.session({
    ref,
    marketId: MARKET,
    orders: [restingBid(9_002n)],
    options: { allocateMissingMargin: true },
    priceUpdates: selected,
  })
);
const posted = eventsOf(r.events, '::events::PostedOrder');
check('the same session with the served updates goes through', posted.length === 1);
const btcUpdate = selected.find((u) => u.symbol === 'BTC/USD')!;
const storedAfter = await storedPriceTimestamp(
  client,
  market.basePriceFeedStorage,
  oracle.sourceId
);
check(
  'the chain now holds the relayed BTC price',
  BigInt(storedAfter!) === btcUpdate.timestampMs,
  `${storedAfter}`
);

// The same updates again are older than nothing and newer than nothing: skipped, not refused.
await run(
  b.cancelOrders({ ref, marketId: MARKET, orderIds: [BigInt(String(posted[0]!.order_id))] })
);
const again = await run(
  b.session({
    ref,
    marketId: MARKET,
    orders: [restingBid(9_003n)],
    options: { allocateMissingMargin: true },
    priceUpdates: selected,
  })
);
const againPosted = eventsOf(again.events, '::events::PostedOrder');
check('relaying an update the chain already has does not fail the trade', againPosted.length === 1);
await run(
  b.cancelOrders({ ref, marketId: MARKET, orderIds: [BigInt(String(againPosted[0]!.order_id))] })
);

// Deallocation reads the feeds for its margin check too.
await waitForStalePrice();
const amount = collateralToUnits(1, deployment.collateral.decimals);
const deallocWithout = await abortOf(b.deallocateCollateral({ ref, marketId: MARKET, amount }));
check(
  'a stale deallocation aborts',
  deallocWithout?.module === 'market' && deallocWithout.code === 1000,
  JSON.stringify(deallocWithout)
);
const fresh = await selectPriceUpdates({
  client,
  deployment,
  market,
  updates: await fetchPriceUpdates(deployment),
});
const dealloc = await run(
  b.deallocateCollateral({ ref, marketId: MARKET, amount, priceUpdates: fresh })
);
check(
  'the deallocation with updates goes through',
  eventsOf(dealloc.events, '::events::DeallocatedCollateral').length === 1
);

const foreign = await fetchPriceUpdates({
  ...deployment,
  oracle: { ...oracle, source: `0x${'ab'.repeat(32)}` },
});
check('updates of another source are not used', foreign.length === 0);

console.log(`\nall ${passed} checks passed`);

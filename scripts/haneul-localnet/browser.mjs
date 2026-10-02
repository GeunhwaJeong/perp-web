/* eslint-disable no-console */

/**
 * Drives the in-app transaction supervisor through the dev wallet against a running
 * localnet. Requires the fixture (`fixture.mjs setup` + `push`) and `pnpm dev`, and runs in
 * the fixture's environment because it re-seeds the maker ladder first.
 *
 *   PLAYWRIGHT=/path/to/node_modules/playwright node scripts/haneul-localnet/browser.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
// eslint-disable-next-line import/no-dynamic-require -- resolved from an external checkout
const { chromium } = require(process.env.PLAYWRIGHT ?? 'playwright');

const ROOT = join(import.meta.dirname, '..', '..');
const secret = readFileSync(join(ROOT, '.localnet/dev-wallet.key'), 'utf8').trim();
const url = process.env.APP_URL ?? 'http://localhost:5173/#/trade/BTC-USD';

let passed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) throw new Error(`FAIL ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}${detail ? ` (${detail})` : ''}`);
};

// The partial-fill check takes every ask inside its limit, so each run starts from a fresh ladder.
const seeded = spawnSync(
  process.execPath,
  [join(ROOT, 'scripts', 'haneul-localnet', 'fixture.mjs'), 'seed'],
  { stdio: 'inherit' }
);
if (seeded.status !== 0) throw new Error('fixture.mjs seed failed');

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('  page error:', e.message));
await page.addInitScript((key) => {
  window.localStorage.setItem('haneul:dev-wallet:secret', key);
}, secret);
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.waitForFunction(() => window.haneulPerp != null, null, { timeout: 60_000 });

// connect the dev wallet through dapp-kit, exactly as the onboarding dialog does
const address = await page.evaluate(async () => {
  const { dAppKit } = window.haneulPerp;
  const wallet = dAppKit.stores.$wallets.get().find((w) => w.name === 'Haneul Dev Wallet');
  const result = await dAppKit.connectWallet({ wallet });
  return result.accounts[0]?.address ?? null;
});
check('dev wallet connected through dapp-kit', address?.startsWith('0x') === true, address);
await page.waitForFunction(
  () => window.haneulPerp?.supervisor.store.getState().wallet.sourceAccount?.address != null,
  null,
  { timeout: 15_000 }
);
check('connection mirrored into redux', true);

const payload = (over) => ({
  subaccountNumber: 0,
  transferToSubaccountAmount: undefined,
  marketId: 'BTC-USD',
  clobPairId: 0,
  type: 'LIMIT',
  side: 'BUY',
  price: 99_900,
  size: 0.1,
  clientId: Math.floor(Math.random() * 2 ** 31),
  timeInForce: 'GTT',
  goodTilTimeInSeconds: 3600,
  execution: 'DEFAULT',
  postOnly: false,
  reduceOnly: false,
  triggerPrice: undefined,
  marketInfo: undefined,
  currentHeight: undefined,
  goodTilBlock: undefined,
  memo: undefined,
  twapParameters: undefined,
  ...over,
});
const place = (over) =>
  page.evaluate(async (p) => {
    const r = await window.haneulPerp.supervisor.placeOrder(p, 'TradeForm');
    const local =
      window.haneulPerp.supervisor.store.getState().localOrders.localPlaceOrders[`${p.clientId}`];
    return { r, local };
  }, payload(over));

// 1. resting limit bid
const limit = await place({});
check('limit order placed', limit.r.type === 'success', JSON.stringify(limit.r).slice(0, 100));
const orderId = limit.r.payload[0]?.orderId;
check(
  'order id returned from PostedOrder',
  typeof orderId === 'string' && orderId.length > 0,
  orderId
);
check(
  'local order marked Placed',
  limit.local.submissionStatus === 1,
  `status=${limit.local.submissionStatus}`
);

// 2. cancel it through the supervisor
const cancel = await page.evaluate(async (id) => {
  return window.haneulPerp.supervisor.cancelOrder({ orderId: id, withNotification: false });
}, orderId);
check('cancel succeeded', cancel.type === 'success', JSON.stringify(cancel).slice(0, 100));
check('CanceledOrder event carried the id', cancel.payload.canceled.includes(orderId));

// Market orders carry the form's worst acceptable price (the summary's average fill price
// ±5%); the ladder sits at $10 steps around $100,000 with 0.5 BTC per level.
const market = (over) =>
  place({ type: 'MARKET', timeInForce: undefined, execution: 'IOC', ...over });

// 3. market buy fills against the maker ladder
const buy = await market({ price: 105_000 });
check(
  'market buy filled',
  buy.r.type === 'success' && buy.local.submissionStatus === 2,
  JSON.stringify(buy.r).slice(0, 100)
);

// 4. reduce-only market sell closes it
const sell = await market({ side: 'SELL', price: 95_000, reduceOnly: true });
check(
  'reduce-only market sell filled',
  sell.r.type === 'success',
  JSON.stringify(sell.r).slice(0, 100)
);

// 4a. the worst price reaches the engine: a buy limited below the best ask fills nothing
const bounded = await market({ price: 100_005 });
check(
  'market buy limited below the best ask is not filled',
  bounded.r.type === 'failure' && /price limit/.test(bounded.r.errorString ?? ''),
  JSON.stringify(bounded.r).slice(0, 140)
);
check(
  'unfilled market order marked FailedSubmission',
  bounded.local.submissionStatus === 4,
  `status=${bounded.local.submissionStatus}`
);

// 4b. a market order without a worst price is refused before signing
const unbounded = await market({ price: 0 });
check(
  'market order without a worst price refused',
  unbounded.r.type === 'failure' && /worst-price/.test(unbounded.r.errorString ?? ''),
  JSON.stringify(unbounded.r).slice(0, 140)
);

// 4c. more size than the book holds inside the limit fills what it can and drops the rest
// (the engine's market order would have aborted: the whole ladder is under 3 BTC)
const partial = await market({ size: 3, price: 100_020 });
check(
  'oversized market buy fills inside its limit',
  partial.r.type === 'success' && partial.local.submissionStatus === 2,
  JSON.stringify(partial.r).slice(0, 140)
);
const flatten = await market({ side: 'SELL', size: 3, price: 95_000, reduceOnly: true });
check(
  'reduce-only market sell flattens the partial fill',
  flatten.r.type === 'success',
  JSON.stringify(flatten.r).slice(0, 140)
);

// 5. off-tick prices are snapped to the tick before submission (the form already rounds)
const snapped = await place({ price: 99_900.5 });
check(
  'off-tick price snapped and posted',
  snapped.r.type === 'success',
  JSON.stringify(snapped.r).slice(0, 100)
);
const snappedCancel = await page.evaluate(
  async (id) => window.haneulPerp.supervisor.cancelOrder({ orderId: id, withNotification: false }),
  snapped.r.payload[0].orderId
);
check('snapped order canceled', snappedCancel.type === 'success');

// 6. engine rejection surfaces as a mapped failure: reduce-only with no position
const bad = await market({ side: 'SELL', price: 95_000, reduceOnly: true });
check(
  'reduce-only without a position rejected',
  bad.r.type === 'failure' && typeof bad.r.errorString === 'string' && bad.r.errorString.length > 0,
  JSON.stringify(bad.r).slice(0, 140)
);
check(
  'local order marked FailedSubmission',
  bad.local.submissionStatus === 4,
  `status=${bad.local.submissionStatus}`
);

// 7. post-only crossing the book is rejected by the engine, not filled
const po = await place({ price: 100_100, postOnly: true });
check(
  'post-only that crosses is rejected',
  po.r.type === 'failure',
  JSON.stringify(po.r).slice(0, 140)
);

// 8. with the price service's relay off (`fixture.mjs push --no-relay`) nothing but the trades
// themselves writes prices: after the market's 10 s tolerance the chain's prices are stale, and
// an order still goes through because the supervisor puts the served updates in front of it.
const deployment = JSON.parse(
  readFileSync(join(ROOT, 'public/configs/haneul/perp.localnet.json'), 'utf8')
);
const health = deployment.oracle
  ? await fetch(deployment.oracle.updatesUrl.replace('/v1/updates', '/healthz'))
      .then((res) => res.json())
      .catch(() => ({}))
  : {};
if (health.relay === false) {
  console.log('  waiting 12 s without relays so the chain price goes stale...');
  await new Promise((r) => {
    setTimeout(r, 12_000);
  });
  const late = await place({ price: 99_800 });
  check(
    'with the chain price stale, an order carries its own signed prices',
    late.r.type === 'success' && late.r.payload[0]?.orderId != null,
    JSON.stringify(late.r).slice(0, 140)
  );
  const lateCancel = await page.evaluate(
    async (id) =>
      window.haneulPerp.supervisor.cancelOrder({ orderId: id, withNotification: false }),
    late.r.payload[0].orderId
  );
  check('and is canceled', lateCancel.type === 'success');
} else {
  console.log(
    '  (relay on: run `fixture.mjs push --no-relay` to check orders carry their own prices)'
  );
}

await browser.close();
console.log(`\n${passed} browser checks passed`);

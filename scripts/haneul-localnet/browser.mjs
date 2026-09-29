/* eslint-disable no-console */

/**
 * Drives the in-app transaction supervisor through the dev wallet against a running
 * localnet. Requires the fixture (`fixture.mjs setup` + `push`) and `pnpm dev`.
 *
 *   PLAYWRIGHT=/path/to/node_modules/playwright node scripts/haneul-localnet/browser.mjs
 */
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

// 3. market buy fills against the maker ladder
const buy = await place({ type: 'MARKET', price: 0, timeInForce: undefined, execution: 'IOC' });
check(
  'market buy filled',
  buy.r.type === 'success' && buy.local.submissionStatus === 2,
  JSON.stringify(buy.r).slice(0, 100)
);

// 4. reduce-only market sell closes it
const sell = await place({
  type: 'MARKET',
  side: 'SELL',
  price: 0,
  timeInForce: undefined,
  execution: 'IOC',
  reduceOnly: true,
});
check(
  'reduce-only market sell filled',
  sell.r.type === 'success',
  JSON.stringify(sell.r).slice(0, 100)
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
const bad = await place({
  type: 'MARKET',
  side: 'SELL',
  price: 0,
  timeInForce: undefined,
  execution: 'IOC',
  reduceOnly: true,
});
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

await browser.close();
console.log(`\n${passed} browser checks passed`);

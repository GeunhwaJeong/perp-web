/* eslint-disable no-console */

/**
 * Checks the liquidation price the app shows for a position against the engine's own formula,
 * evaluated on the position the indexer recorded (collateral, size, quote notional, resting
 * bid and ask quantities, funding): first for a bare long, then with a bid resting that would
 * grow it, which the engine counts in the maintenance requirement. Requires the fixture
 * (`setup`, `push`), the indexer and the API on the same network, and `pnpm dev`.
 *
 *   PLAYWRIGHT=/path/to/node_modules/playwright node scripts/haneul-localnet/liquidation-price.mjs \
 *     [postgres://localhost:5432/perp_indexer_web]
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
// eslint-disable-next-line import/no-dynamic-require -- resolved from an external checkout
const { chromium } = require(process.env.PLAYWRIGHT ?? 'playwright');

const ROOT = join(import.meta.dirname, '..', '..');
const DATABASE_URL = process.argv[2] ?? 'postgres://localhost:5432/perp_indexer_web';
const secret = readFileSync(join(ROOT, '.localnet/dev-wallet.key'), 'utf8').trim();
const deployment = JSON.parse(
  readFileSync(join(ROOT, 'public/configs/haneul/perp.localnet.json'), 'utf8')
);
const url = process.env.APP_URL ?? 'http://localhost:5173/#/trade/BTC-USD';
const MARKET = 'BTC-USD';
const ch = deployment.markets[MARKET].clearingHouse;

let passed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) throw new Error(`FAIL ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}${detail ? ` (${detail})` : ''}`);
};
const sql = (query) =>
  execFileSync('psql', [DATABASE_URL, '-At', '-F', '|', '-c', query], { encoding: 'utf8' }).trim();
const sleep = (ms) =>
  new Promise((r) => {
    setTimeout(r, ms);
  });
const eventually = async (label, fn, timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop -- polling until the indexer catches up
    const value = await fn();
    if (value != null) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    // eslint-disable-next-line no-await-in-loop -- polling until the indexer catches up
    await sleep(500);
  }
};

const seeded = spawnSync(
  process.execPath,
  [join(ROOT, 'scripts', 'haneul-localnet', 'fixture.mjs'), 'seed'],
  { stdio: 'inherit' }
);
if (seeded.status !== 0) throw new Error('fixture.mjs seed failed');

const browser = await chromium.launch();
const page = await browser.newPage();
await page.addInitScript((key) => {
  window.localStorage.setItem('haneul:dev-wallet:secret', key);
}, secret);
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.waitForFunction(() => window.haneulPerp != null, null, { timeout: 60_000 });
await page.evaluate(async () => {
  const { dAppKit } = window.haneulPerp;
  const wallet = dAppKit.stores.$wallets.get().find((w) => w.name === 'Haneul Dev Wallet');
  await dAppKit.connectWallet({ wallet });
});
await page.waitForFunction(
  () => window.haneulPerp?.supervisor.store.getState().wallet.sourceAccount?.address != null,
  null,
  { timeout: 15_000 }
);
const accountId = await page.evaluate(async () => {
  const r = await window.haneulPerp.supervisor.context();
  return r.type === 'success' ? String(r.payload.account.accountId) : null;
});
check('dev account found', accountId != null, `account #${accountId}`);

// Start flat: no resting orders, no position.
await page.evaluate(async () => {
  await window.haneulPerp.supervisor.cancelAllOrders({});
  await window.haneulPerp.supervisor.closeAllPositions();
});

const payload = (over) => ({
  subaccountNumber: 0,
  transferToSubaccountAmount: undefined,
  marketId: MARKET,
  clobPairId: 0,
  type: 'LIMIT',
  side: 'BUY',
  price: 99_000,
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
  page.evaluate(
    async (p) =>
      JSON.parse(JSON.stringify(await window.haneulPerp.supervisor.placeOrder(p, 'TradeForm'))),
    payload(over)
  );

/** The app's position on the market, as the positions table reads it. */
const appPosition = () =>
  page.evaluate((market) => {
    const { BonsaiCore, supervisor } = window.haneulPerp;
    const positions = BonsaiCore.account.parentSubaccountPositions.data(
      supervisor.store.getState()
    );
    const p = positions?.find((x) => x.market === market && x.status === 'OPEN');
    return p
      ? { size: p.signedSize.toNumber(), liquidationPrice: p.liquidationPrice?.toNumber() ?? null }
      : null;
  }, MARKET);

/** The engine's formula (af-iperps `Position::liquidation_price`) on the indexed position. */
const engineLiquidationPrice = () => {
  const [coll, base, quote, asks, bids, posLong, posShort] = sql(
    `SELECT collateral, base, quote_notional, asks_quantity, bids_quantity, cum_funding_rate_long, cum_funding_rate_short FROM positions WHERE market = '${ch}' AND account_id = ${accountId}`
  )
    .split('|')
    .map(Number);
  const [mmr, mktLong, mktShort] = sql(
    `SELECT margin_ratio_maintenance, cum_funding_rate_long, cum_funding_rate_short FROM markets WHERE market = '${ch}'`
  )
    .split('|')
    .map(Number);
  // A rising cumulative rate is a cost for longs and income for shorts.
  const funding = base < 0 ? -(mktShort - posShort) * base : -(mktLong - posLong) * base;
  const net = Math.max(Math.abs(base + bids), Math.abs(base - asks));
  return {
    price: (coll + funding - quote) / (net * mmr - base),
    // The same position valued as if nothing rested: the formula the app used before.
    withoutOrders: (coll + funding - quote) / (Math.abs(base) * mmr - base),
    base,
    bids,
  };
};

// Collateral left in the market by earlier runs would put the liquidation price below zero
// (nothing to show); move it back so the position runs on the margin its session allocates.
const flat = await eventually('the flat position', async () => {
  const row = sql(
    `SELECT base, collateral FROM positions WHERE market = '${ch}' AND account_id = ${accountId}`
  );
  const [base, collateral] = row.split('|').map(Number);
  return row && base === 0 ? collateral : null;
});
if (flat > 0) {
  const back = await page.evaluate(
    async (amount) =>
      JSON.parse(
        JSON.stringify(
          await window.haneulPerp.supervisor.transferMargin({
            marketId: 'BTC-USD',
            amount,
            toMarket: false,
          })
        )
      ),
    // The indexer keeps 18 decimals; read as a JS number the collateral can round up past what
    // the chain holds (17854.0139999... becomes 17854.014), so a dollar stays behind.
    Math.floor(flat) - 1
  );
  check(
    'market collateral moved back to the account',
    back.type === 'success',
    `${flat} TUSD ${back.errorString ?? ''}`
  );
}

// 1. a bare long at the market's 10x
const bought = await place({
  type: 'MARKET',
  price: 100_100,
  size: 0.5,
  execution: 'IOC',
  timeInForce: undefined,
  goodTilTimeInSeconds: undefined,
});
check('market buy 0.5', bought.type === 'success', JSON.stringify(bought).slice(0, 100));
const bare = await eventually('the indexed long', async () => {
  const app = await appPosition();
  const engine = engineLiquidationPrice();
  return app &&
    app.size === 0.5 &&
    engine.base === 0.5 &&
    engine.bids === 0 &&
    app.liquidationPrice != null
    ? { app, engine }
    : null;
});
check(
  'without resting orders the app shows the engine liquidation price',
  Math.abs(bare.app.liquidationPrice - bare.engine.price) < 0.5,
  `app ${bare.app.liquidationPrice.toFixed(2)}, engine ${bare.engine.price.toFixed(2)}`
);

// 2. a bid that would grow the long rests on the book
const bid = await place({ price: 99_000, size: 0.2 });
check('resting bid 0.2 at $99,000', bid.type === 'success', JSON.stringify(bid).slice(0, 100));
const withBid = await eventually('the indexed bid', async () => {
  const app = await appPosition();
  const engine = engineLiquidationPrice();
  return app && engine.bids > 0 && app.liquidationPrice !== bare.app.liquidationPrice
    ? { app, engine }
    : null;
});
check(
  'with the bid resting the app shows the engine liquidation price',
  Math.abs(withBid.app.liquidationPrice - withBid.engine.price) < 0.5,
  `app ${withBid.app.liquidationPrice.toFixed(2)}, engine ${withBid.engine.price.toFixed(2)}`
);
// Resting the bid also allocated its initial margin, so the collateral changed; at that same
// collateral the price without the bid counted would be further from the mark.
check(
  'the resting bid is counted, putting the price nearer the mark than without it',
  withBid.app.liquidationPrice > withBid.engine.withoutOrders + 1,
  `${withBid.engine.withoutOrders.toFixed(2)} without the bid, ${withBid.app.liquidationPrice.toFixed(2)} with it`
);

// Leave the account flat for the other suites.
await page.evaluate(async () => {
  await window.haneulPerp.supervisor.cancelAllOrders({});
  await window.haneulPerp.supervisor.closeAllPositions();
});
await browser.close();
console.log(`\n${passed} liquidation price checks passed`);

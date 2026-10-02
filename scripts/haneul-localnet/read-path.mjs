/* eslint-disable no-console */

/**
 * Checks the read path end to end: the app against the perp indexer's API (perp-api), on a
 * localnet. Where browser.mjs drives transactions, this looks at what the app shows for them.
 *
 * Needs, all running:
 *   - the localnet with the fixture (`fixture.mjs setup` + `push`) and a funded dev account
 *     (`smoke.ts` creates and funds it);
 *   - perp-indexer and perp-api over that network, perp-api started with
 *     `--deployment public/configs/haneul/perp.localnet.json` on 127.0.0.1:3002, which is where
 *     the `haneul-localnet` environment in public/configs/v1/env.json points;
 *   - `pnpm dev`.
 *
 *   PLAYWRIGHT=/path/to/node_modules/playwright node scripts/haneul-localnet/read-path.mjs
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
// eslint-disable-next-line import/no-dynamic-require -- resolved from an external checkout
const { chromium } = require(process.env.PLAYWRIGHT ?? 'playwright');

const ROOT = join(import.meta.dirname, '..', '..');
const secret = readFileSync(join(ROOT, '.localnet/dev-wallet.key'), 'utf8').trim();
const APP = process.env.APP_URL ?? 'http://localhost:5173';
const INDEXER_PORT = process.env.INDEXER_PORT ?? '3002';

const failures = [];
let passed = 0;
const check = (name, ok, detail = '') => {
  if (ok) passed += 1;
  else failures.push(name);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

const appErrors = [];
const indexer = new Map();
const elsewhere = new Set();
const subscribed = new Set();
const pushed = new Map();
page.on('console', (m) => {
  // The app reports a response it could not use, or a query that failed, through this logger.
  if (m.type() === 'error' && m.text().includes('bonsai')) appErrors.push(m.text().slice(0, 200));
});
page.on('response', (r) => {
  const url = new URL(r.url());
  if (url.port === INDEXER_PORT) {
    const key = `${r.status()} ${url.pathname.replace(/0x[0-9a-f]{64}/, '<address>')}`;
    indexer.set(key, (indexer.get(key) ?? 0) + 1);
  }
});
page.on('request', (r) => {
  const { hostname } = new URL(r.url());
  if (hostname.endsWith('dydx.exchange') || hostname.endsWith('dydx.trade'))
    elsewhere.add(hostname);
});
page.on('websocket', (ws) => {
  if (!ws.url().includes(`:${INDEXER_PORT}/`)) return;
  ws.on('framereceived', ({ payload }) => {
    const message = JSON.parse(payload);
    if (message.type === 'subscribed') subscribed.add(message.channel);
    if (message.type === 'channel_batch_data' || message.type === 'channel_data') {
      pushed.set(message.channel, (pushed.get(message.channel) ?? 0) + 1);
    }
  });
});

await page.addInitScript((key) => {
  window.localStorage.setItem('haneul:dev-wallet:secret', key);
}, secret);
await page.goto(`${APP}/#/trade/BTC-USD`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.waitForFunction(() => window.haneulPerp != null, null, { timeout: 60_000 });

const text = (selector = 'body') => page.locator(selector).innerText();
const state = (expression) =>
  page.evaluate((e) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- used by the expression
    const s = window.haneulPerp.supervisor.store.getState();
    // eslint-disable-next-line no-eval
    return eval(e);
  }, expression);
const eventually = async (read, ok, timeoutMs = 20_000) => {
  const deadline = Date.now() + timeoutMs;
  // eslint-disable-next-line no-constant-condition
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const value = await read();
    if (ok(value) || Date.now() > deadline) return value;
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(250);
  }
};

// ----------------------------------------------------------------------------- without a wallet

const market = await eventually(
  () => state("s.raw.markets.allMarkets.data?.['BTC-USD']"),
  (m) => m != null
);
check('the market is listed from the indexer', market?.ticker === 'BTC-USD', market?.oraclePrice);
const heights = await eventually(
  () =>
    state(
      '[s.raw.heights.indexerHeight.lastFewResults[0]?.data?.response?.height, s.raw.heights.validatorHeight.lastFewResults[0]?.data?.response?.height]'
    ),
  ([indexerHeight, nodeHeight]) => indexerHeight > 0 && nodeHeight > 0
);
check(
  'the height of the indexer and of the Haneul node are both read',
  heights[0] > 0 && heights[1] > 0,
  `indexer ${heights[0]}, node ${heights[1]}`
);
check('and the indexer is not trailing the node', Math.abs(heights[1] - heights[0]) <= 50);
const footer = await eventually(
  () => text('footer'),
  (t) => /Operational/.test(t)
);
check(
  'the app reports the network as operational',
  /Operational/.test(footer),
  footer.slice(0, 40)
);
check('no connection warning is shown', !(await text()).includes('Connection issue detected'));
const book = await eventually(
  () => state("Object.keys(s.raw.markets.orderbooks['BTC-USD']?.data?.bids ?? {}).length"),
  (n) => n > 0
);
check('the order book has bids', book > 0, `${book} levels`);

// -------------------------------------------------------------------------------- with a wallet

const address = await page.evaluate(async () => {
  const { dAppKit } = window.haneulPerp;
  const wallet = dAppKit.stores.$wallets.get().find((w) => w.name === 'Haneul Dev Wallet');
  return (await dAppKit.connectWallet({ wallet })).accounts[0]?.address;
});
const account = await eventually(
  () => state('s.raw.account.parentSubaccount.data'),
  (a) => a?.childSubaccounts != null
);
check('the account is delivered over the stream', account?.address === address);

const sizeBefore = Number(
  account?.childSubaccounts?.[128]?.openPerpetualPositions?.['BTC-USD']?.size ?? 0
);
const tradesBefore = pushed.get('v4_trades') ?? 0;
await page.getByRole('tab', { name: 'Trades' }).first().click();
await eventually(() => subscribed.has('v4_trades'), Boolean);

const placed = await page.evaluate(
  async (payload) => {
    return window.haneulPerp.supervisor.placeOrder(payload, 'TradeForm');
  },
  {
    subaccountNumber: 0,
    marketId: 'BTC-USD',
    clobPairId: 0,
    type: 'MARKET',
    side: 'BUY',
    price: 100_500,
    size: 0.1,
    clientId: Math.floor(Math.random() * 2 ** 31),
    timeInForce: 'IOC',
    goodTilTimeInSeconds: 3600,
    execution: 'DEFAULT',
    postOnly: false,
    reduceOnly: false,
  }
);
check('a market buy is filled', placed.type === 'success', JSON.stringify(placed).slice(0, 120));

const size = await eventually(
  () =>
    state(
      "s.raw.account.parentSubaccount.data?.childSubaccounts?.[128]?.openPerpetualPositions?.['BTC-USD']?.size"
    ),
  (v) => Math.abs(Number(v) - sizeBefore - 0.1) < 1e-9
);
check(
  'the position grows by the fill, pushed by the indexer',
  Math.abs(Number(size) - sizeBefore - 0.1) < 1e-9,
  `${sizeBefore} -> ${size}`
);
await eventually(
  () => pushed.get('v4_trades') ?? 0,
  (n) => n > tradesBefore
);
check('the trade is pushed to the tape', (pushed.get('v4_trades') ?? 0) > tradesBefore);

const positions = await eventually(
  () => text(),
  (t) => !t.includes('You have no open positions')
);
check('the position is shown', !positions.includes('You have no open positions'));
const summary = await text();
check(
  'the account has a portfolio value',
  /Portfolio Value\s*\$[\d,]+\.\d\d/.test(summary),
  summary.match(/Portfolio Value\s*\S+/)?.[0]
);

await page
  .getByRole('tab', { name: /Order History/ })
  .first()
  .click();
const history = await eventually(
  () => text(),
  (t) => /Market\s+Buy/.test(t)
);
check('the market order is in the order history', /Market\s+Buy/.test(history));
await page.getByRole('tab', { name: /Fills/ }).first().click();
const fills = await eventually(
  () => text(),
  (t) => /Market\s+Buy\s+0\.100/.test(t)
);
check('and its fill is a market fill', /Market\s+Buy\s+0\.100/.test(fills));

await page.goto(`${APP}/#/portfolio`, { waitUntil: 'domcontentloaded' });
await eventually(() => [...indexer.keys()].some((k) => k.includes('/v4/pnl/')), Boolean);
await page.waitForTimeout(2_000);

// ------------------------------------------------------------------------------------- overall

const requests = [...indexer].map(([key, count]) => `${count}x ${key}`);
const failed = [...indexer.keys()].filter((key) => !key.startsWith('200 '));
check('every request to the indexer was answered', failed.length === 0, failed.join(', '));
check(
  'the portfolio page read the PnL history',
  [...indexer.keys()].includes('200 /v4/pnl/parentSubaccountNumber')
);
const candles = [...indexer]
  .filter(([key]) => key.includes('/v4/candles/'))
  .reduce((n, [, c]) => n + c, 0);
// The chart pages backwards until it is answered with nothing; it must not be answered with
// the same candle for ever.
check(
  'the chart asked for candles a handful of times',
  candles > 0 && candles <= 6,
  `${candles} requests`
);
['v4_markets', 'v4_orderbook', 'v4_candles', 'v4_parent_subaccounts', 'v4_trades'].forEach(
  (channel) => check(`subscribed to ${channel}`, subscribed.has(channel))
);
check('the app could use every response', appErrors.length === 0, appErrors[0] ?? '');
check('nothing was asked of a dYdX host', elsewhere.size === 0, [...elsewhere].join(', '));

console.log(`\n  indexer requests: ${requests.sort().join('; ')}`);
await browser.close();
if (failures.length > 0) {
  console.log(`\n${failures.length} FAILED of ${passed + failures.length}`);
  process.exit(1);
}
console.log(`\nall ${passed} read path checks passed`);

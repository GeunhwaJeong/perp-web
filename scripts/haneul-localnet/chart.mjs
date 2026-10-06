/* eslint-disable no-console */
/**
 * Checks the price chart against the indexer on a running localnet: the candles it loads, the
 * stream's updates, the resolution buttons, the order and position lines, the fill marks and
 * the right-click limit order draft. Requires the fixture (`fixture.mjs setup` + `push`), the
 * indexer and API, `smoke.ts` (so that the dev account exists and has traded) and `pnpm dev`.
 *
 *   PLAYWRIGHT=/path/to/node_modules/playwright node scripts/haneul-localnet/chart.mjs
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
const api = process.env.API_URL ?? 'http://127.0.0.1:3002';
const screenshot = process.env.SCREENSHOT;

let passed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) throw new Error(`FAIL ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}${detail ? ` (${detail})` : ''}`);
};

const candles = async (resolution, limit = 300) => {
  const r = await fetch(
    `${api}/v4/candles/perpetualMarkets/BTC-USD?resolution=${resolution}&limit=${limit}`
  );
  return (await r.json()).candles;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
await page.addInitScript((key) => {
  window.localStorage.setItem('haneul:dev-wallet:secret', key);
}, secret);
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.waitForFunction(() => window.haneulPerp != null, null, { timeout: 60_000 });

const address = await page.evaluate(async () => {
  const { dAppKit } = window.haneulPerp;
  const wallet = dAppKit.stores.$wallets.get().find((w) => w.name === 'Haneul Dev Wallet');
  const result = await dAppKit.connectWallet({ wallet });
  return result.accounts[0]?.address ?? null;
});
check('dev wallet connected', address?.startsWith('0x') === true, address);

const chart = () =>
  page.evaluate(() => {
    const c = window.haneulPerp?.priceChart;
    if (!c?.handles) return null;
    return {
      resolution: c.resolution,
      isLoading: c.isLoading,
      bars: c.handles.candles.data(),
      volume: c.handles.volume.data(),
      lines: c.lines.map((l) => ({ key: l.key, price: l.options.price, title: l.options.title })),
      markers: c.markers().map((m) => ({ time: m.time, text: m.text, position: m.position })),
      canvases: document.querySelectorAll('#price-chart canvas').length,
    };
  });
const waitForChart = (predicate, what) =>
  page.waitForFunction(
    (src) => {
      const c = window.haneulPerp?.priceChart;
      if (!c?.handles || c.isLoading) return false;
      // eslint-disable-next-line no-new-func
      return new Function('c', `return (${src})(c)`)(c);
    },
    predicate.toString(),
    { timeout: 60_000 }
  ).catch((e) => {
    throw new Error(`timed out waiting for ${what}: ${e.message}`);
  });

/** The app's open position on the market, as the positions table reads it. */
const appPosition = () =>
  page.evaluate(() => {
    const { BonsaiCore, supervisor } = window.haneulPerp;
    const positions = BonsaiCore.account.parentSubaccountPositions.data(
      supervisor.store.getState()
    );
    const p = positions?.find((x) => x.market === 'BTC-USD' && x.status === 'OPEN');
    return p ? p.signedSize.toNumber() : 0;
  });

// 1. the default resolution loads every daily candle the indexer has
await waitForChart((c) => c.handles.candles.data().length > 0, 'daily candles');
let state = await chart();
check('chart drawn', state.canvases > 0, `${state.canvases} canvases`);
check('default resolution is 1D', state.resolution === '1D');
const daily = await candles('1DAY');
check('daily bars match the indexer', state.bars.length === daily.length, `${state.bars.length}`);
const lastDaily = daily[0];
const lastBar = state.bars.at(-1);
check(
  'latest daily bar carries the indexer OHLC',
  lastBar.time === Date.parse(lastDaily.startedAt) / 1000 &&
    lastBar.open === Number(lastDaily.open) &&
    lastBar.high === Number(lastDaily.high) &&
    lastBar.low === Number(lastDaily.low) &&
    lastBar.close === Number(lastDaily.close),
  `${lastBar.open}/${lastBar.high}/${lastBar.low}/${lastBar.close}`
);
check(
  'volume bars line up with the candles',
  state.volume.length === state.bars.length &&
    state.volume.at(-1).value === Math.ceil(Number(lastDaily.usdVolume)),
  `${state.volume.at(-1).value}`
);

// 2. switching to one-minute bars reloads and is remembered
await page.locator('#price-chart').locator('xpath=../..').locator('button').first().click();
await waitForChart((c) => c.resolution === '1', 'the 1m resolution');
await waitForChart((c) => c.handles.candles.data().length > 0, '1m candles');
state = await chart();
const minute = await candles('1MIN');
check('1m bars match the indexer', state.bars.length === minute.length, `${state.bars.length}`);
const savedResolution = await page.evaluate(
  () => window.haneulPerp.supervisor.store.getState().tradingView.resolution
);
check('resolution saved in the store', savedResolution === '1');

// 3. a resting bid draws an order line, a market buy a position and a mark; the stream updates the bar
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
  page.evaluate(async (p) => window.haneulPerp.supervisor.placeOrder(p, 'TradeForm'), payload(over));

// start flat, whatever an earlier run left open
await page.waitForFunction(
  () =>
    window.haneulPerp.BonsaiCore.account.parentSubaccountPositions.data(
      window.haneulPerp.supervisor.store.getState()
    ) != null,
  null,
  { timeout: 60_000 }
);
const leftover = await appPosition();
if (leftover !== 0) {
  const flat = await place({
    type: 'MARKET',
    side: leftover > 0 ? 'SELL' : 'BUY',
    price: leftover > 0 ? 99_000 : 101_000,
    size: Math.abs(leftover),
    reduceOnly: true,
  });
  check('leftover position closed', flat.type === 'success', `${leftover}`);
  await page.waitForFunction(
    () =>
      !window.haneulPerp.BonsaiCore.account
        .parentSubaccountPositions.data(window.haneulPerp.supervisor.store.getState())
        ?.some((x) => x.market === 'BTC-USD' && x.status === 'OPEN'),
    null,
    { timeout: 60_000 }
  );
}

const bid = await place({});
check('resting bid placed', bid.type === 'success', JSON.stringify(bid).slice(0, 80));
const bidId = bid.payload[0]?.orderId;
await page.evaluate((id) => {
  window.haneulPerp.__bidId = id;
}, bidId);
await waitForChart((c) => c.lines.some((l) => l.key === `order-${window.haneulPerp.__bidId}`), 'the order line');
state = await chart();
const orderLine = state.lines.find((l) => l.key === `order-${bidId}`);
check('order line at the bid price', orderLine?.price === 99_900, orderLine?.title);
check('order line titled with the size', orderLine.title.includes('0.1'), orderLine.title);

const barsBefore = (await chart()).bars.length;
const buy = await place({ type: 'MARKET', price: 100_100, size: 0.2 });
check('market buy filled', buy.type === 'success', JSON.stringify(buy).slice(0, 80));
await waitForChart((c) => c.lines.some((l) => l.key === 'entry'), 'the entry line');
state = await chart();
const entry = state.lines.find((l) => l.key === 'entry');
const liquidation = state.lines.find((l) => l.key === 'liquidation');
check('entry line at the fill price', entry.price > 99_000 && entry.price < 101_000, `${entry.price}`);
// The account's collateral may put the liquidation price at or below zero, in which case
// the app reports none and no line is drawn.
check(
  'liquidation line below the entry when there is one',
  liquidation == null || liquidation.price < entry.price,
  liquidation ? `${liquidation.price}` : 'none'
);
check('position size in the line titles', entry.title.includes('0.2'), entry.title);

await waitForChart((c) => c.markers().some((m) => m.text === 'B'), 'the buy mark');
state = await chart();
const mark = state.markers.find((m) => m.text === 'B');
const barOfMark = state.bars.find((b) => b.time === mark.time);
check('buy mark sits on a loaded bar', barOfMark != null, `${mark.time}`);
check('buy mark below the bar', mark.position === 'belowBar');

await waitForChart(
  (c) => c.handles.candles.data().at(-1).close >= 100_010,
  'the stream to update the open bar with the fill'
);
state = await chart();
check(
  'open bar updated from the stream',
  state.bars.at(-1).close >= 100_010 && state.bars.length >= barsBefore,
  `${state.bars.at(-1).close}`
);

// 4. toggles and cancel
await page.locator('#price-chart').locator('xpath=../..').locator('button[data-state]').first().click();
await waitForChart((c) => c.lines.length === 0, 'the lines to hide');
check('order lines toggle hides the lines', true);
await page.locator('#price-chart').locator('xpath=../..').locator('button[data-state]').first().click();
await waitForChart((c) => c.lines.length >= 2, 'the lines to show again');
check('and shows them again', true);

const cancel = await page.evaluate(
  async (id) => window.haneulPerp.supervisor.cancelOrder({ orderId: id }),
  bidId
);
check('bid canceled', cancel.type === 'success');
await waitForChart((c) => !c.lines.some((l) => l.key === `order-${window.haneulPerp.__bidId}`), 'the order line to go');
check('order line removed with the order', true);

// 5. right click drafts a limit order at the price under the cursor
const box = await page.locator('#price-chart').boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.3, { button: 'right' });
const menuButton = page.locator('#price-chart').locator('xpath=..').locator('button');
await menuButton.waitFor({ timeout: 10_000 });
const label = await menuButton.textContent();
check('context menu offers a limit order', /\d/.test(label), label);
await menuButton.click();
const form = await page.evaluate(() => {
  const s = window.haneulPerp.supervisor.store.getState().tradeForm;
  return { type: s.type, side: s.side, limitPrice: s.limitPrice };
});
check('trade form drafted as a limit order', form.type === 'LIMIT' && form.limitPrice != null, JSON.stringify(form));
check(
  'drafted price is the one in the menu',
  label.replace(/,/g, '').includes(form.limitPrice.replace(/,/g, '')),
  form.limitPrice
);

// close the position so the next run starts flat
const close = await place({ type: 'MARKET', side: 'SELL', price: 99_900, size: 0.2, reduceOnly: true });
check('position closed', close.type === 'success', JSON.stringify(close).slice(0, 80));

if (screenshot) {
  await page.waitForTimeout(1000);
  await page.screenshot({ path: screenshot });
  console.log(`  screenshot ${screenshot}`);
}

check('no page errors', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 200));
console.log(`\nall ${passed} checks passed`);
await browser.close();

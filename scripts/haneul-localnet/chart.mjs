/* eslint-disable no-console */

/**
 * Checks the TradingView chart against the indexer on a running localnet: the candles it
 * loads, the resolution switch, the order and position lines (horizontal_line drawings, see
 * src/lib/tradingView/chartLineShape.ts), the Order Lines toggle and the right-click limit
 * order draft. Requires the fixture (`fixture.mjs setup` + `push`), the indexer and API,
 * `smoke.ts` (so that the dev account exists and has traded) and `pnpm dev`.
 *
 *   PLAYWRIGHT=/path/to/node_modules/playwright SCREENSHOT=/tmp/chart.png \
 *     node scripts/haneul-localnet/chart.mjs
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

// The widget's bars and drawings, read through the charting library API.
const chart = () =>
  page.evaluate(async () => {
    const w = window.haneulPerp?.tvWidget;
    if (!w) return null;
    let c;
    try {
      c = w.activeChart();
    } catch {
      return null;
    }
    const lines = c
      .getAllShapes()
      .filter((s) => s.name === 'horizontal_line')
      .map((s) => {
        const a = c.getShapeById(s.id);
        return { id: s.id, price: a.getPoints()[0]?.price, text: a.getProperties().text };
      });
    const exported = await c.exportData({ includeTime: true, includeSeries: true });
    const bars = exported.data.map(([time, open, high, low, close]) => ({
      time,
      open,
      high,
      low,
      close,
    }));
    return {
      resolution: c.resolution(),
      symbol: c.symbol(),
      bars,
      lines,
      iframes: document.querySelectorAll('#tv-price-chart iframe').length,
    };
  });
const waitForChart = (predicate, what) =>
  page
    .waitForFunction(
      async (src) => {
        const w = window.haneulPerp?.tvWidget;
        if (!w) return false;
        let c;
        try {
          c = w.activeChart();
        } catch {
          return false;
        }
        const lines = c
          .getAllShapes()
          .filter((s) => s.name === 'horizontal_line')
          .map((s) => {
            const a = c.getShapeById(s.id);
            return { id: s.id, price: a.getPoints()[0]?.price, text: a.getProperties().text };
          });
        const exported = await c.exportData({ includeTime: true, includeSeries: true });
        const state = { resolution: c.resolution(), bars: exported.data, lines };
        // eslint-disable-next-line no-new-func, @typescript-eslint/no-implied-eval
        return new Function('c', `return (${src})(c)`)(state);
      },
      predicate.toString(),
      { timeout: 60_000 }
    )
    .catch((e) => {
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
await page.waitForFunction(() => window.haneulPerp?.tvWidget != null, null, { timeout: 60_000 });
await page.evaluate(
  () =>
    new Promise((r) => {
      window.haneulPerp.tvWidget.onChartReady(r);
    })
);
await waitForChart((c) => c.bars.length > 0, 'daily candles');
let state = await chart();
check('chart drawn in the library iframe', state.iframes === 1, `${state.iframes} iframe`);
check('symbol is the market', state.symbol === 'BTC-USD', state.symbol);
check('default resolution is 1D', state.resolution === '1D', state.resolution);
const daily = await candles('1DAY');
check('daily bars match the indexer', state.bars.length === daily.length, `${state.bars.length}`);
const lastDaily = daily[0];
const lastBar = state.bars.at(-1);
// The library places a daily bar at the start of that day in the chart's timezone (the
// browser's), so the exported time is the UTC day start shifted by the local offset.
const dailyStart = Date.parse(lastDaily.startedAt) / 1000;
const localDailyStart = dailyStart + new Date(dailyStart * 1000).getTimezoneOffset() * 60;
check(
  'latest daily bar carries the indexer OHLC',
  (lastBar.time === dailyStart || lastBar.time === localDailyStart) &&
    lastBar.open === Number(lastDaily.open) &&
    lastBar.high === Number(lastDaily.high) &&
    lastBar.low === Number(lastDaily.low) &&
    lastBar.close === Number(lastDaily.close),
  `${lastBar.open}/${lastBar.high}/${lastBar.low}/${lastBar.close}`
);

// 2. switching to one-minute bars reloads them and the layout autosave remembers it
await page.evaluate(() => window.haneulPerp.tvWidget.activeChart().setResolution('1'));
await waitForChart((c) => c.resolution === '1' && c.bars.length > 0, '1m candles');
state = await chart();
const minute = await candles('1MIN');
check('1m bars match the indexer', state.bars.length === minute.length, `${state.bars.length}`);
await page.waitForFunction(
  () =>
    JSON.stringify(window.haneulPerp.supervisor.store.getState().tradingView).includes(
      '"interval":"1"'
    ),
  null,
  { timeout: 15_000 }
);
check('resolution saved in the chart layout', true);

// 3. a resting bid draws an order line, a market buy the entry and liquidation lines
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
  page.evaluate(
    async (p) => window.haneulPerp.supervisor.placeOrder(p, 'TradeForm'),
    payload(over)
  );

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
      !window.haneulPerp.BonsaiCore.account.parentSubaccountPositions
        .data(window.haneulPerp.supervisor.store.getState())
        ?.some((x) => x.market === 'BTC-USD' && x.status === 'OPEN'),
    null,
    { timeout: 60_000 }
  );
}
// and without resting orders from an interrupted run
await page.evaluate(() =>
  window.haneulPerp.supervisor.cancelAllOrders({ marketId: 'BTC-USD' }).catch(() => null)
);
await page.waitForFunction(
  () =>
    window.haneulPerp.BonsaiCore.account.openOrders.data(
      window.haneulPerp.supervisor.store.getState()
    )?.length === 0,
  null,
  { timeout: 60_000 }
);
await waitForChart((c) => c.lines.length === 0, 'a chart without lines');

const bid = await place({});
check('resting bid placed', bid.type === 'success', JSON.stringify(bid).slice(0, 80));
const bidId = bid.payload[0]?.orderId;
await waitForChart((c) => c.lines.some((l) => l.price === 99_900), 'the order line');
// the drawing stays once it is there; read it again a moment later to make sure
await page.waitForTimeout(1000);
state = await chart();
const orderLine = state.lines.find((l) => l.price === 99_900);
check('order line at the bid price', orderLine != null, state.lines.map((l) => l.price).join(','));
check('order line labelled with the size', orderLine.text.includes('0.1'), orderLine.text);

const buy = await place({ type: 'MARKET', price: 100_100, size: 0.2 });
check('market buy filled', buy.type === 'success', JSON.stringify(buy).slice(0, 80));
await waitForChart((c) => c.lines.some((l) => l.price !== 99_900), 'the position lines');
state = await chart();
const positionLines = state.lines.filter((l) => l.price !== 99_900);
const entry = positionLines.find((l) => l.price > 99_000 && l.price < 101_000);
check('entry line at the fill price', entry != null, positionLines.map((l) => l.price).join(','));
check('position size in the line label', entry.text.includes('0.2'), entry.text);
// The account's collateral may put the liquidation price at or below zero, in which case
// the app reports none and no line is drawn.
const liquidation = positionLines.find((l) => l !== entry);
check(
  'liquidation line below the entry when there is one',
  liquidation == null || liquidation.price < entry.price,
  liquidation ? `${liquidation.price} ${liquidation.text}` : 'none'
);

if (screenshot) {
  await page.waitForTimeout(1500);
  await page.screenshot({ path: screenshot });
  console.log(`  screenshot ${screenshot}`);
}

// 4. the Order Lines toggle in the chart header hides and shows the drawings
const frame = page.frameLocator('#tv-price-chart iframe');
const linesToggle = frame.getByText('Order Lines', { exact: true });
await linesToggle.click();
await waitForChart((c) => c.lines.length === 0, 'the lines to hide');
check('order lines toggle hides the lines', true);
await linesToggle.click();
await waitForChart((c) => c.lines.some((l) => l.price !== 99_900), 'the lines to show again');
check('and shows them again', true);

// 5. cancelling the bid removes its line
const cancel = await page.evaluate(
  async (id) => window.haneulPerp.supervisor.cancelOrder({ orderId: id }),
  bidId
);
check('bid canceled', cancel.type === 'success');
await waitForChart((c) => !c.lines.some((l) => l.price === 99_900), 'the order line to go');
check('order line removed with the order', true);

// 6. right click drafts a limit order at the price under the cursor
const box = await page.locator('#tv-price-chart').boundingBox();
await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.3, { button: 'right' });
const menuItem = frame.getByText(/Limit (Buy|Sell)/);
await menuItem.first().waitFor({ timeout: 10_000 });
const label = await menuItem.first().textContent();
check('context menu offers a limit order', /\d/.test(label), label);
await menuItem.first().click();
const form = await page.evaluate(() => {
  const s = window.haneulPerp.supervisor.store.getState().tradeForm;
  return { type: s.type, side: s.side, limitPrice: s.limitPrice };
});
check(
  'trade form drafted as a limit order',
  form.type === 'LIMIT' && form.limitPrice != null,
  JSON.stringify(form)
);
check(
  'drafted price is the one in the menu',
  label.replace(/,/g, '').includes(form.limitPrice.replace(/,/g, '')),
  form.limitPrice
);

// close the position so the next run starts flat
const close = await place({
  type: 'MARKET',
  side: 'SELL',
  price: 99_900,
  size: 0.2,
  reduceOnly: true,
});
check('position closed', close.type === 'success', JSON.stringify(close).slice(0, 80));
await waitForChart((c) => c.lines.length === 0, 'the position lines to go');
check('position lines removed with the position', true);

check('no page errors', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 200));
console.log(`\nall ${passed} checks passed`);
await browser.close();

/* eslint-disable no-console */

/**
 * The chart's bars and its buy and sell marks, against a running localnet, in a browser set to a
 * time zone (TZ_ID, Asia/Seoul by default). The indexer's candles start at UTC multiples of their
 * resolution, and TradingView lays bars out from the time zone the datafeed gives the symbol, so
 * that zone decides where the bars it draws start. At 1h, 4h and 1D the bar holding each fill
 * starts where the indexer's candle does, both fills of a buy and a close are marked, and every
 * mark's time is the time of a bar TradingView draws (a mark at any other time is moved).
 * Requires the fixture (`fixture.mjs setup` + `push`), the indexer and API, and `pnpm dev`.
 *
 *   PLAYWRIGHT=/path/to/node_modules/playwright TZ_ID=Asia/Kolkata \
 *     pnpm exec tsx scripts/haneul-localnet/chart-marks.ts
 */
import { Ed25519Keypair } from '@haneullabs/haneul/keypairs/ed25519';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
// eslint-disable-next-line import/no-dynamic-require -- resolved from an external checkout
const { chromium } = require(process.env.PLAYWRIGHT ?? 'playwright');

const ROOT = join(import.meta.dirname, '..', '..');
const url = process.env.APP_URL ?? 'http://localhost:5173/#/trade/BTC-USD';
const screenshots = process.env.SCREENSHOTS ?? join(ROOT, '.localnet', 'chart-marks');
const timezoneId = process.env.TZ_ID ?? 'Asia/Seoul';
const MARKET = 'BTC-USD';
const INTERVAL_SECONDS: Record<string, number> = { '60': 3_600, '240': 14_400, '1D': 86_400 };
const RESOLUTIONS = Object.keys(INTERVAL_SECONDS);

let passed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) throw new Error(`FAIL ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}${detail ? ` (${detail})` : ''}`);
};
const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

// A trader with gas and 1,000 TUSD in the wallet.
const fresh = Ed25519Keypair.generate();
const me = fresh.getPublicKey().toHaneulAddress();
const funded = spawnSync(
  process.execPath,
  [join(ROOT, 'scripts', 'haneul-localnet', 'fixture.mjs'), 'fund', me, '1000'],
  { stdio: 'inherit' }
);
if (funded.status !== 0) throw new Error('fixture.mjs fund failed');

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
  timezoneId,
});
console.log(`  browser time zone ${timezoneId}`);
const page = await context.newPage();
page.on('pageerror', (e: Error) => {
  if (!e.message.includes('qs_')) console.log('  page error:', e.message);
});
await page.addInitScript((key: string) => {
  window.localStorage.setItem('haneul:dev-wallet:secret', key);
}, fresh.getSecretKey());
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.waitForFunction(() => (window as any).haneulPerp != null, null, { timeout: 60_000 });
await page.evaluate(async () => {
  const { dAppKit } = (window as any).haneulPerp;
  const wallet = dAppKit.stores.$wallets.get().find((w: any) => w.name === 'Haneul Dev Wallet');
  await dAppKit.connectWallet({ wallet });
});
await page.waitForFunction(
  () =>
    (window as any).haneulPerp?.supervisor.store.getState().wallet.sourceAccount?.address != null,
  null,
  { timeout: 15_000 }
);
const supervisor = (method: string, ...args: unknown[]) =>
  page.evaluate(
    async ({ m, a }: { m: string; a: unknown[] }) => {
      const r = await (window as any).haneulPerp.supervisor[m](...a);
      return JSON.parse(JSON.stringify(r));
    },
    { m: method, a: args }
  );
const showsPosition = (want: boolean) =>
  page.waitForFunction(
    ({ m, w }: { m: string; w: boolean }) =>
      (
        (window as any).haneulPerp.BonsaiCore.account.parentSubaccountPositions.data(
          (window as any).haneulPerp.supervisor.store.getState()
        ) ?? []
      ).some((p: any) => p.market === m && p.status === 'OPEN') === w,
    { m: MARKET, w: want },
    { timeout: 60_000 }
  );

await page.locator('form footer').first().waitFor({ timeout: 60_000 });

// A buy and its close: two fills, two orders, two marks.
const deposited = await supervisor('depositCollateral', 20);
check('20 TUSD deposited', deposited.type === 'success', JSON.stringify(deposited).slice(0, 160));
const bought = await supervisor(
  'placeOrder',
  {
    subaccountNumber: 0,
    transferToSubaccountAmount: undefined,
    marketId: MARKET,
    clobPairId: 0,
    type: 'MARKET',
    side: 'BUY',
    price: 105_000,
    size: 0.001,
    clientId: Math.floor(Math.random() * 2 ** 31),
    timeInForce: undefined,
    goodTilTimeInSeconds: undefined,
    execution: 'IOC',
    postOnly: false,
    reduceOnly: false,
    triggerPrice: undefined,
    marketInfo: undefined,
    currentHeight: undefined,
    goodTilBlock: undefined,
    memo: undefined,
    twapParameters: undefined,
  },
  'TradeForm'
);
check('0.001 BTC bought', bought.type === 'success', JSON.stringify(bought).slice(0, 160));
await showsPosition(true);
const closed = await supervisor('closeAllPositions');
check('and closed', closed.type === 'success', JSON.stringify(closed).slice(0, 160));
await showsPosition(false);
const fillTimes: number[] = await page
  .waitForFunction(
    () => {
      const { haneulPerp } = window as any;
      const fills =
        haneulPerp.BonsaiCore.account.fills?.data?.(haneulPerp.supervisor.store.getState()) ?? [];
      return fills.length >= 2
        ? fills.map((f: any) => Math.floor(Date.parse(f.createdAt) / 1000))
        : null;
    },
    null,
    { timeout: 60_000 }
  )
  .then((h: any) => h.jsonValue());
console.log(`  fills at ${fillTimes.map(iso).join(', ')}`);

// What TradingView asks for and what the app answers, from the datafeed object the library calls.
await page.waitForFunction(
  () => {
    const frame = [...document.querySelectorAll('iframe')].find((f) =>
      /tradingview/i.test(f.id)
    ) as HTMLIFrameElement | undefined;
    return (
      (frame?.contentWindow as any)?.ChartApiInstance?._transport?._backend?._engine
        ?._externalDatafeed?.getMarks != null
    );
  },
  null,
  { timeout: 60_000 }
);
await page.evaluate(() => {
  const w = window as any;
  const frame = [...document.querySelectorAll('iframe')].find((f) =>
    /tradingview/i.test(f.id)
  ) as HTMLIFrameElement;
  const datafeed = (frame.contentWindow as any).ChartApiInstance._transport._backend._engine
    ._externalDatafeed;
  w.marksCalls = [];
  w.getMarksUnrecorded = datafeed.getMarks.bind(datafeed);
  datafeed.getMarks = (symbol: unknown, from: number, to: number, done: any, res: string) =>
    w.getMarksUnrecorded(
      symbol,
      from,
      to,
      (marks: Array<{ label: string; time: number }>) => {
        w.marksCalls.push({ res, from, to, marks: marks.map((m) => [m.label, m.time]) });
        done(marks);
      },
      res
    );
});

type Call = { res: string; from: number; to: number; marks: Array<[string, number]> };
const results: Record<string, Call | undefined> = {};
const drawnBars: Record<string, number[]> = {};
// Each resolution's data is reloaded, which makes TradingView ask for its marks again; the bars it
// then draws are read back with their times.
for (let i = 0; i < RESOLUTIONS.length; i += 1) {
  const res = RESOLUTIONS[i]!;
  // eslint-disable-next-line no-await-in-loop
  await page.evaluate((r: string) => {
    const w = window as any;
    w.marksCalls = [];
    const chart = w.haneulPerp.tvWidget.activeChart();
    if (chart.resolution() === r) chart.resetData();
    else chart.setResolution(r);
  }, res);
  // eslint-disable-next-line no-await-in-loop
  results[res] = await page
    .waitForFunction(
      (r: string) =>
        ((window as any).marksCalls as Call[]).find((c) => c.res === r && c.marks.length > 0),
      res,
      { timeout: 20_000 }
    )
    .then((h: any) => h.jsonValue())
    .catch(() => undefined);
  // eslint-disable-next-line no-await-in-loop
  await page.waitForTimeout(1_500);
  // eslint-disable-next-line no-await-in-loop
  drawnBars[res] = await page.evaluate(async () => {
    const exported = await (window as any).haneulPerp.tvWidget
      .activeChart()
      .exportData({ includeTime: true, includedStudies: [] });
    const column = exported.schema.findIndex((f: { type: string }) => f.type === 'time');
    return exported.data.map((row: Float64Array) => row[column]);
  });
  // eslint-disable-next-line no-await-in-loop
  await page.screenshot({ path: `${screenshots}-${res}.png` });
}
console.log(`  screenshots ${screenshots}-{${RESOLUTIONS.join(',')}}.png`);

// The indexer's candle for a fill starts at the fill's time less its remainder in the resolution.
const candleStarts = (res: string) => {
  const interval = INTERVAL_SECONDS[res]!;
  return [...new Set(fillTimes.map((t) => t - (t % interval)))];
};
RESOLUTIONS.forEach((res) => {
  const call = results[res];
  console.log(
    `  ${res}: asked from ${call ? iso(call.from) : '-'}, marks ${
      call?.marks.map(([label, time]) => `${label} ${iso(time)}`).join(', ') ?? 'none'
    }; candles of the fills ${candleStarts(res).map(iso).join(', ')}; last bars drawn ${(
      drawnBars[res] ?? []
    )
      .slice(-3)
      .map(iso)
      .join(', ')}`
  );
});
RESOLUTIONS.forEach((res) => {
  const call = results[res];
  const drawn = new Set(drawnBars[res] ?? []);
  check(
    `${res}: the bar holding the fills starts where the indexer's candle does`,
    candleStarts(res).every((start) => drawn.has(start)),
    `candles ${candleStarts(res).map(iso).join(', ')}`
  );
  check(
    `${res}: both fills are marked`,
    call != null && call.marks.length === 2,
    call == null ? 'no marks' : `${call.marks.length} marks`
  );
  check(
    `${res}: each mark is at the time of a bar the chart draws`,
    call != null && call.marks.every(([, time]) => drawn.has(time)),
    call?.marks.map(([label, time]) => `${label} ${iso(time)}`).join(', ') ?? 'no marks'
  );
});

await browser.close();
console.log(`\n${passed} checks passed`);

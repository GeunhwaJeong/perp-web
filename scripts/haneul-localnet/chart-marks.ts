/* eslint-disable no-console */

/**
 * The chart's buy and sell marks, against a running localnet, in a browser set to Asia/Seoul.
 * TradingView asks for marks over a range that starts at a boundary of the chart's time zone (a
 * Seoul day starts at 15:00 UTC), while the indexer's candles start at UTC multiples of their
 * resolution. Each mark must sit on the bar its fill belongs to: at 1h, 4h and 1D every mark's
 * time is the UTC start of its fill's bar, and both fills of a buy and a close are marked.
 * Requires the fixture (`fixture.mjs setup` + `push`), the indexer and API, and `pnpm dev`.
 *
 *   PLAYWRIGHT=/path/to/node_modules/playwright pnpm exec tsx scripts/haneul-localnet/chart-marks.ts
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
  timezoneId: 'Asia/Seoul',
});
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
// Each resolution's data is reloaded, which makes TradingView ask for its marks again.
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
  await page.screenshot({ path: `${screenshots}-${res}.png` });
}
console.log(`  screenshots ${screenshots}-{${RESOLUTIONS.join(',')}}.png`);

RESOLUTIONS.forEach((res) => {
  const call = results[res];
  const interval = INTERVAL_SECONDS[res]!;
  const expected = [...new Set(fillTimes.map((t) => t - (t % interval)))];
  console.log(
    `  ${res}: asked from ${call ? iso(call.from) : '-'}, marks ${
      call?.marks.map(([label, time]) => `${label} ${iso(time)}`).join(', ') ?? 'none'
    }; bars of the fills ${expected.map(iso).join(', ')}`
  );
});
RESOLUTIONS.forEach((res) => {
  const call = results[res];
  const interval = INTERVAL_SECONDS[res]!;
  const bars = new Set(fillTimes.map((t) => t - (t % interval)));
  check(
    `${res}: both fills are marked`,
    call != null && call.marks.length === 2,
    call == null ? 'no marks' : `${call.marks.length} marks`
  );
  check(
    `${res}: each mark sits at the UTC start of its fill's bar`,
    call != null && call.marks.every(([, time]) => bars.has(time)),
    call?.marks.map(([label, time]) => `${label} ${iso(time)}`).join(', ') ?? 'no marks'
  );
});

await browser.close();
console.log(`\n${passed} checks passed`);

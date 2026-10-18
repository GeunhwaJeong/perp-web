/* eslint-disable no-console */

/**
 * The app's REST reads of perp-api, on a running localnet. Each read is to answer and reach what
 * it feeds: the market list, the height, the sparklines, the wallet's address screen, the
 * account's orders, fills, transfers and trade history, the chart's candles, the funding chart,
 * the portfolio's PnL, the funding payments and the CSV export. Every read is to go out with
 * fetch rather than XMLHttpRequest, which the dYdX client's axios used, and the app is not to ask
 * perp-api for its time at startup, which only fed the dYdX validator client. The behaviour checks
 * pass before and after the change; the last two fail before it. Requires the fixture
 * (`fixture.mjs setup` + `push` + `seed`), the indexer and API, and `pnpm dev`.
 *
 *   PLAYWRIGHT=/path/to/node_modules/playwright pnpm exec tsx scripts/haneul-localnet/indexer-client.ts
 */
import { Ed25519Keypair } from '@haneullabs/haneul/keypairs/ed25519';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
// eslint-disable-next-line import/no-dynamic-require -- resolved from an external checkout
const { chromium } = require(process.env.PLAYWRIGHT ?? 'playwright');

const ROOT = join(import.meta.dirname, '..', '..');
const APP = (process.env.APP_URL ?? 'http://localhost:5173/#/trade/BTC-USD').replace(/#.*$/, '');
const API = process.env.API_URL ?? 'http://127.0.0.1:3002';
const API_ORIGIN = new URL(API).origin;
const screenshots = process.env.SCREENSHOTS ?? join(ROOT, '.localnet', 'indexer-client');
const MARKET = 'BTC-USD';

let passed = 0;
const failed: string[] = [];
// Every check runs, so a run without the change shows each step it gets wrong.
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
  if (ok) passed += 1;
  else failed.push(name);
};

const keypair = Ed25519Keypair.generate();
const me = keypair.getPublicKey().toHaneulAddress();
// The fixture's admin coin also pays the price relay, and a clash between the two locks it until
// the next epoch (a minute on localnet).
for (let attempt = 1; ; attempt += 1) {
  const funded = spawnSync(
    process.execPath,
    [join(ROOT, 'scripts', 'haneul-localnet', 'fixture.mjs'), 'fund', me, '1000'],
    { stdio: 'inherit' }
  );
  if (funded.status === 0) break;
  if (attempt === 4) throw new Error('fixture.mjs fund failed');
  console.log(`  funding attempt ${attempt} failed; trying again after the epoch`);
  // eslint-disable-next-line no-await-in-loop
  await new Promise((resolve) => {
    setTimeout(resolve, 65_000);
  });
}

type Read = { path: string; type: string; status: number | undefined };
type Answer = { status: number; type: string; body: any } | undefined;

const browser = await chromium.launch();

/** A fresh page with the dev wallet's key, recording every REST read it makes of perp-api. */
const visit = async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.on('pageerror', (e: Error) => {
    if (!/qs_|Bars are not available/.test(e.message)) console.log('  page error:', e.message);
  });
  const reads = new Map<unknown, Read>();
  page.on('request', (request: any) => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith('/v4/')) return;
    // The time request went to the default environment's indexer, which need not be this one.
    if (url.origin !== API_ORIGIN && url.pathname !== '/v4/time') return;
    reads.set(request, { path: url.pathname, type: request.resourceType(), status: undefined });
  });
  page.on('response', (response: any) => {
    const read = reads.get(response.request());
    if (read) read.status = response.status();
  });
  // tsx names the functions it compiles with an `__name` helper, which code sent to the page
  // would call; a string is sent as it is.
  await page.addInitScript({ content: 'window.__name = (f) => f;' });
  await page.addInitScript((key: string) => {
    window.localStorage.setItem('haneul:dev-wallet:secret', key);
  }, keypair.getSecretKey());
  return { page, reads: () => [...reads.values()] };
};

/** The next answer from perp-api whose URL matches; wait for it before the step that asks. */
const answer = (page: any, match: string | ((url: URL) => boolean), timeout = 60_000) =>
  page
    .waitForResponse(
      (response: any) => {
        const url = new URL(response.url());
        if (url.origin !== API_ORIGIN) return false;
        return typeof match === 'string' ? url.pathname === match : match(url);
      },
      { timeout }
    )
    .then(
      async (response: any): Promise<Answer> => ({
        status: response.status(),
        type: response.request().resourceType(),
        body: await response.json().catch(() => undefined),
      })
    )
    .catch((): Answer => undefined);

const checkAnswer = (name: string, read: Answer, holds: (body: any) => boolean = () => true) =>
  check(
    name,
    read?.status === 200 && holds(read.body),
    read ? `${read.status}, ${JSON.stringify(read.body ?? null).slice(0, 100)}` : 'no request'
  );

const connect = async (page: any) => {
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
};

// 1. Startup, before the wallet has a trading account.
console.log('\n1 the app starting up');
const first = await visit();
const markets = answer(first.page, '/v4/perpetualMarkets');
const height = answer(first.page, '/v4/height');
const sparklines = answer(first.page, '/v4/sparklines');
const screen = answer(first.page, (url) => url.pathname.startsWith('/v4/compliance/screen/'));
await first.page.goto(`${APP}#/trade/${MARKET}`, {
  waitUntil: 'domcontentloaded',
  timeout: 120_000,
});
await connect(first.page);
checkAnswer('the market list', await markets, (b) => b?.markets?.[MARKET] != null);
checkAnswer('the indexer height', await height, (b) => Number(b?.height) > 0);
checkAnswer('the sparklines', await sparklines);
checkAnswer('the address screen of the connected wallet', await screen);

// 2. A deposit and a market buy, for the account reads to return.
console.log('\n2 a deposit and a market buy');
const supervisor = (method: string, ...args: unknown[]) =>
  first.page.evaluate(
    async ({ m, a }: { m: string; a: unknown[] }) => {
      const r = await (window as any).haneulPerp.supervisor[m](...a);
      return JSON.parse(JSON.stringify(r));
    },
    { m: method, a: args }
  );
const deposit = await supervisor('depositCollateral', 100);
check('100 TUSD deposited', deposit.type === 'success', deposit.type);
const buy = await supervisor(
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
check('market buy 0.001 BTC', buy.type === 'success', buy.type);
// The second visit reads the buy back, so wait for the indexer to have it.
let indexed = false;
for (let attempt = 0; attempt < 30 && !indexed; attempt += 1) {
  // eslint-disable-next-line no-await-in-loop
  const res = await fetch(
    `${API}/v4/fills/parentSubaccountNumber?address=${me}&parentSubaccountNumber=0`
  );
  // eslint-disable-next-line no-await-in-loop
  indexed = res.ok && ((await res.json()).fills?.length ?? 0) > 0;
  if (!indexed) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      setTimeout(resolve, 2_000);
    });
  }
}
check('perp-api has the fill', indexed);
const firstReads = first.reads();
const timeReads = firstReads.filter((r) => r.path === '/v4/time');
check('the app does not ask perp-api for its time', timeReads.length === 0, `${timeReads.length}`);
await first.page.close();

// 3. A second visit: the account's reads, the chart and the funding chart.
console.log('\n3 a second visit: the account, the chart and the funding chart');
const second = await visit();
const { page } = second;
const orders = answer(page, '/v4/orders/parentSubaccountNumber');
const fills = answer(page, '/v4/fills/parentSubaccountNumber');
const transfers = answer(page, '/v4/transfers/parentSubaccountNumber');
const tradeHistory = answer(page, '/v4/tradeHistory/parentSubaccountNumber');
const rewards = answer(page, (url) =>
  url.pathname.startsWith('/v4/historicalBlockTradingRewards/')
);
const candles = answer(page, `/v4/candles/perpetualMarkets/${MARKET}`, 90_000);
await page.goto(`${APP}#/trade/${MARKET}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await connect(page);
checkAnswer('the account’s orders', await orders, Array.isArray);
checkAnswer('the account’s fills, with the buy', await fills, (b) =>
  b?.fills?.some((f: any) => f.market === MARKET)
);
checkAnswer(
  'the account’s transfers, with the deposit',
  await transfers,
  (b) => (b?.transfers?.length ?? 0) > 0
);
checkAnswer(
  'the account’s trade history',
  await tradeHistory,
  (b) => (b?.tradeHistory?.length ?? 0) > 0
);
checkAnswer('the account’s block trading rewards', await rewards);
checkAnswer('the chart’s candles', await candles, (b) => Array.isArray(b?.candles));
const chartUp = await page
  .waitForFunction(
    () => {
      const frame = [...document.querySelectorAll('iframe')].find((f) =>
        /tradingview/i.test(f.id)
      ) as HTMLIFrameElement | undefined;
      return (frame?.contentWindow as any)?.ChartApiInstance != null;
    },
    null,
    { timeout: 60_000 }
  )
  .then(() => true)
  .catch(() => false);
check('the chart is up', chartUp);
await page.screenshot({ path: `${screenshots}-3.png` });
// The funding chart asks for its history when its tab opens.
const funding = answer(page, `/v4/historicalFunding/${MARKET}`);
await page
  .getByRole('tab', { name: 'Funding', exact: true })
  .first()
  .click({ timeout: 20_000 })
  .catch(() => undefined);
checkAnswer('the funding chart’s history', await funding, (b) =>
  Array.isArray(b?.historicalFunding)
);
await page.screenshot({ path: `${screenshots}-3-funding.png` });

// 4. The portfolio's PnL chart.
console.log('\n4 the portfolio overview');
const pnl = answer(page, '/v4/pnl/parentSubaccountNumber');
await page.goto(`${APP}#/portfolio/overview`, { waitUntil: 'domcontentloaded' });
checkAnswer('the PnL history', await pnl, (b) => Array.isArray(b?.pnl));
await page.screenshot({ path: `${screenshots}-4.png` });

// 5. The history page and its CSV export, which pages through fills and transfers itself.
console.log('\n5 the history page and the CSV export');
const payments = answer(page, '/v4/fundingPayments/parentSubaccount');
await page.goto(`${APP}#/portfolio/history/trades`, { waitUntil: 'domcontentloaded' });
checkAnswer('the funding payments', await payments, (b) => Array.isArray(b?.fundingPayments));
const exportedFills = answer(
  page,
  (url) =>
    url.pathname === '/v4/fills/parentSubaccountNumber' && url.searchParams.get('limit') === '1000'
);
const exportedTransfers = answer(
  page,
  (url) =>
    url.pathname === '/v4/transfers/parentSubaccountNumber' && url.searchParams.get('page') === '1'
);
const downloads: any[] = [];
page.on('download', (download: any) => downloads.push(download));
await page
  .getByRole('button', { name: /Export/ })
  .first()
  .click({ timeout: 20_000 });
await page.getByText('Download', { exact: true }).first().click({ timeout: 20_000 });
checkAnswer('the export’s fills', await exportedFills, (b) => (b?.fills?.length ?? 0) > 0);
checkAnswer(
  'the export’s transfers',
  await exportedTransfers,
  (b) => (b?.transfers?.length ?? 0) > 0
);
for (let waited = 0; downloads.length < 2 && waited < 30; waited += 1) {
  // eslint-disable-next-line no-await-in-loop
  await page.waitForTimeout(1_000);
}
const csv = async (name: string) => {
  const download = downloads.find((d) => d.suggestedFilename() === name);
  return download ? readFileSync(await download.path(), 'utf8') : '';
};
const trades = await csv('trades.csv');
const transferRows = await csv('transfers.csv');
check(
  'trades.csv has the buy',
  trades.split('\n').length > 1 && trades.includes(MARKET),
  trades.split('\n')[1]?.slice(0, 100) ?? 'no file'
);
check(
  'transfers.csv has the deposit',
  transferRows.trim().split('\n').length > 1,
  transferRows.split('\n')[1]?.slice(0, 100) ?? 'no file'
);
await page.screenshot({ path: `${screenshots}-5.png` });

// 6. How the reads went out, over both visits.
console.log('\n6 how the reads went out');
const secondReads = second.reads();
const all = [...firstReads, ...secondReads];
const notFetch = all.filter((r) => r.type !== 'fetch');
check(
  'every read goes out with fetch, none with XMLHttpRequest',
  notFetch.length === 0,
  `${notFetch.length} of ${all.length}: ${[...new Set(notFetch.map((r) => r.path))].join(' ')}`
);
// Before the deposit the account reads answer 404 (no subaccount), so only the second visit's
// reads are held to 200; a read still in flight has no status yet.
const notOk = secondReads.filter((r) => r.status != null && r.status !== 200);
check(
  'every read of the second visit answered 200',
  notOk.length === 0,
  notOk.map((r) => `${r.path} ${r.status}`).join(' ')
);

await browser.close();
console.log(`  screenshots ${screenshots}-{3,3-funding,4,5}.png`);
console.log(`\n${passed} checks passed, ${failed.length} failed`);
if (failed.length > 0) process.exit(1);

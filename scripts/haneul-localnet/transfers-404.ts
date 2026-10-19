/* eslint-disable no-console */

/**
 * The transfer history of a wallet without a trading account, on a running localnet. perp-api
 * answers 404 for an address it holds no account for, and the app is to take that as an empty
 * history: no retries, no error logged, and the transfers marked loaded. Before the change the app
 * matched the 404 by the response text, which its fetch client does not carry, so every wallet
 * without an account retried the read three times each minute and logged an error each time.
 * Then the wallet's first deposit is to show in the history within seconds: the account channel
 * carries no transfers, so the history is read again when a deposit goes through rather than at
 * the next minute's refetch. Requires the fixture (`fixture.mjs setup` + `push`), the indexer and
 * API, and `pnpm dev`.
 *
 *   PLAYWRIGHT=/path/to/node_modules/playwright pnpm exec tsx scripts/haneul-localnet/transfers-404.ts
 */
import { Ed25519Keypair } from '@haneullabs/haneul/keypairs/ed25519';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
// eslint-disable-next-line import/no-dynamic-require -- resolved from an external checkout
const { chromium } = require(process.env.PLAYWRIGHT ?? 'playwright');

const ROOT = join(import.meta.dirname, '..', '..');
const APP = (process.env.APP_URL ?? 'http://localhost:5173/#/trade/BTC-USD').replace(/#.*$/, '');
const API = process.env.API_URL ?? 'http://127.0.0.1:3002';
const screenshots = process.env.SCREENSHOTS ?? join(ROOT, '.localnet', 'transfers-404');
const TRANSFERS = '/v4/transfers/parentSubaccountNumber';
// Covers react-query's three retries (1, 2 and 4 seconds apart) and the query's one-minute refetch.
const WATCH_MS = 70_000;

let passed = 0;
const failed: string[] = [];
// Every check runs, so a run without the change shows each step it gets wrong.
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
  if (ok) passed += 1;
  else failed.push(name);
};

/** A wallet with gas and 1,000 TUSD, and no trading account. */
const fundedWallet = async () => {
  const keypair = Ed25519Keypair.generate();
  const address = keypair.getPublicKey().toHaneulAddress();
  // The fixture's admin coin also pays the price relay, and a clash between the two locks it
  // until the next epoch (a minute on localnet).
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const funded = spawnSync(
      process.execPath,
      [join(ROOT, 'scripts', 'haneul-localnet', 'fixture.mjs'), 'fund', address, '1000'],
      { stdio: 'inherit' }
    );
    if (funded.status === 0) return keypair;
    console.log(`  funding attempt ${attempt} failed; trying again after the epoch`);
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      setTimeout(resolve, 65_000);
    });
  }
  throw new Error('fixture.mjs fund failed');
};

const keypair = await fundedWallet();
const address = keypair.getPublicKey().toHaneulAddress();

// 1. perp-api on its own, for the same address.
console.log('\n1 perp-api for an address without a trading account');
const direct = await fetch(`${API}${TRANSFERS}?address=${address}&parentSubaccountNumber=0`);
check('perp-api answers 404 for the address', direct.status === 404, String(direct.status));

// 2. The app with that wallet connected, watched for a minute and more.
console.log('\n2 the app with the wallet connected');
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const pageErrors: string[] = [];
const transferErrors: string[] = [];
const transferReads: number[] = [];
page.on('pageerror', (e: Error) => {
  if (!/qs_|Bars are not available/.test(e.message)) pageErrors.push(e.message);
});
page.on('console', (message: any) => {
  if (message.type() === 'error' && /bonsai: transfers: /.test(message.text())) {
    transferErrors.push(message.text().replace(/\s+/g, ' ').slice(0, 160));
  }
});
page.on('response', (response: any) => {
  const url = new URL(response.url());
  if (url.pathname === TRANSFERS && url.searchParams.get('address') === address) {
    transferReads.push(response.status());
  }
});
// tsx names the functions it compiles with an `__name` helper, which code sent to the page would
// call; a string is sent as it is.
await page.addInitScript({ content: 'window.__name = (f) => f;' });
await page.addInitScript((key: string) => {
  window.localStorage.setItem('haneul:dev-wallet:secret', key);
}, keypair.getSecretKey());
await page.goto(`${APP}#/portfolio/history/transfers`, {
  waitUntil: 'domcontentloaded',
  timeout: 120_000,
});
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
await page.waitForTimeout(WATCH_MS);
const transfers = await page.evaluate(() => {
  const loadable = (window as any).haneulPerp.supervisor.store.getState().raw.account.transfers;
  return { status: loadable.status, count: loadable.data?.transfers?.length ?? null };
});
await page.screenshot({ path: `${screenshots}-1.png` });
console.log(`  transfer reads ${JSON.stringify(transferReads)}`);
check(
  'the app asks for the transfers without retrying (at most twice in the minute)',
  transferReads.length >= 1 && transferReads.length <= 2,
  `${transferReads.length} reads`
);
check(
  'no transfers error is logged',
  transferErrors.length === 0,
  `${transferErrors.length}${transferErrors[0] ? `: ${transferErrors[0]}` : ''}`
);
check(
  'the transfers are loaded as an empty history',
  transfers.status === 'success' && transfers.count === 0,
  JSON.stringify(transfers)
);

// 3. The first deposit, long after the history's first read and before its next refetch.
console.log('\n3 the first deposit in the history');
const deposited = await page.evaluate(
  async () => (await (window as any).haneulPerp.supervisor.depositCollateral(20)).type
);
check('20 TUSD deposited', deposited === 'success', deposited);
const depositedAt = Date.now();
let shownAfterMs: number | null = null;
for (let i = 0; i < 40 && shownAfterMs == null; i += 1) {
  // eslint-disable-next-line no-await-in-loop
  const count = await page.evaluate(
    () =>
      (window as any).haneulPerp.supervisor.store.getState().raw.account.transfers.data?.transfers
        ?.length ?? 0
  );
  if (count > 0) shownAfterMs = Date.now() - depositedAt;
  // eslint-disable-next-line no-await-in-loop
  else await page.waitForTimeout(500);
}
await page.screenshot({ path: `${screenshots}-2.png` });
check(
  'the deposit shows in the transfer history within 10 seconds',
  shownAfterMs != null && shownAfterMs <= 10_000,
  shownAfterMs == null ? 'not within 20 s' : `${(shownAfterMs / 1000).toFixed(1)} s`
);
check('no page error on the way', pageErrors.length === 0, pageErrors[0] ?? '');

await browser.close();
console.log(`  screenshots ${screenshots}-{1,2}.png`);
console.log(`\n${passed} checks passed, ${failed.length} failed`);
if (failed.length > 0) process.exit(1);

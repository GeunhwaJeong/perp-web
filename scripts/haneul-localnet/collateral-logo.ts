/* eslint-disable no-console */

/**
 * How the app draws the collateral, against a running localnet. The collateral (TUSD) has no logo:
 * the one dYdX's icon list kept under that ticker is TrueUSD's, a different coin. Checks that the
 * app serves no TUSD logo, that the welcome screen's token carousel leaves it out, and that the
 * transfer dialog draws TUSD as a lettered disc. Requires the fixture (`fixture.mjs setup` +
 * `push`), the indexer and API, and `pnpm dev`.
 *
 *   PLAYWRIGHT=/path/to/node_modules/playwright pnpm exec tsx scripts/haneul-localnet/collateral-logo.ts
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
const screenshots = process.env.SCREENSHOTS ?? join(ROOT, '.localnet', 'collateral-logo');

let passed = 0;
const failed: string[] = [];
// Every check runs, so a run without the change shows each place it gets wrong.
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
  if (ok) passed += 1;
  else failed.push(name);
};

// The file the icon list and env.json pointed at, asked for the way an <img> asks.
const logo = await fetch(new URL('/currencies/tusd.png', url), {
  headers: { accept: 'image/avif,image/webp,image/*,*/*;q=0.8' },
});
const logoType = logo.headers.get('content-type') ?? '';
check('the app serves no TUSD logo', !logoType.startsWith('image/'), `${logo.status} ${logoType}`);

const browser = await chromium.launch();
const newPage = async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', (e: Error) => {
    if (!e.message.includes('qs_')) console.log('  page error:', e.message);
  });
  // tsx names the functions it compiles with an `__name` helper, which code sent to the page
  // would call; a string is sent as it is.
  await page.addInitScript({ content: 'window.__name = (f) => f;' });
  return page;
};
// The logos under /currencies/ on the page, with whether each one loaded.
const currencyImages = (page: any) =>
  page.evaluate(() =>
    [...document.querySelectorAll('img')]
      .filter((i) => i.src.includes('/currencies/'))
      .map((i) => ({ path: new URL(i.src).pathname, loaded: i.complete && i.naturalWidth > 0 }))
  );

// 1. The welcome screen a new trader sees first, with no wallet.
console.log('\nwelcome screen');
const visitor = await newPage();
await visitor.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await visitor.getByText('Mark Price').first().waitFor({ timeout: 60_000 });
await visitor
  .getByRole('button', { name: /^(Log in|Get started)$/ })
  .first()
  .click();
await visitor.getByRole('button', { name: 'Create account' }).first().click();
await visitor.getByText('Welcome to Sigma').first().waitFor({ timeout: 15_000 });
await visitor.waitForTimeout(1_500);
const carousel: Array<{ path: string; loaded: boolean }> = await currencyImages(visitor);
const logos = [...new Set(carousel.map((i) => i.path))].sort();
console.log(`  carousel: ${logos.map((p) => p.replace('/currencies/', '')).join(' ')}`);
check(
  'the carousel leaves the TUSD logo out',
  !logos.some((p) => p.includes('tusd')),
  `${logos.length} logos`
);
check(
  'every logo in the carousel loads',
  carousel.length > 0 && carousel.every((i) => i.loaded),
  carousel
    .filter((i) => !i.loaded)
    .map((i) => i.path)
    .join(' ')
);
await visitor.screenshot({ path: `${screenshots}-welcome.png` });

// 2. The transfer dialog, opened on the collateral, for a trader with an account.
console.log('\ntransfer dialog');
const fresh = Ed25519Keypair.generate();
const me = fresh.getPublicKey().toHaneulAddress();
const funded = spawnSync(
  process.execPath,
  [join(ROOT, 'scripts', 'haneul-localnet', 'fixture.mjs'), 'fund', me, '100'],
  { stdio: 'inherit' }
);
if (funded.status !== 0) throw new Error('fixture.mjs fund failed');
const trader = await newPage();
await trader.addInitScript((key: string) => {
  window.localStorage.setItem('haneul:dev-wallet:secret', key);
}, fresh.getSecretKey());
await trader.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await trader.waitForFunction(() => (window as any).haneulPerp != null, null, { timeout: 60_000 });
await trader.evaluate(async () => {
  const { dAppKit } = (window as any).haneulPerp;
  const wallet = dAppKit.stores.$wallets.get().find((w: any) => w.name === 'Haneul Dev Wallet');
  await dAppKit.connectWallet({ wallet });
});
await trader.waitForFunction(
  () =>
    (window as any).haneulPerp?.supervisor.store.getState().wallet.sourceAccount?.address != null,
  null,
  { timeout: 15_000 }
);
await trader.evaluate(() =>
  (window as any).haneulPerp.supervisor.store.dispatch({
    type: 'Dialogs/openDialog',
    payload: { type: 'Transfer', props: { selectedAsset: 'usdc' } },
  })
);
const dialog = trader.getByRole('dialog');
await dialog.waitFor({ timeout: 15_000 });
await trader.waitForTimeout(1_500);
const picker = await trader.evaluate(() => {
  const box = document.querySelector('[role="dialog"]');
  const images = [...(box?.querySelectorAll('img') ?? [])].map((i) => new URL(i.src).pathname);
  // The row that names the collateral: the innermost element holding its icon and its label.
  const row = [...(box?.querySelectorAll('*') ?? [])]
    .filter(
      (e): e is HTMLElement =>
        e instanceof HTMLElement &&
        /TUSD$/.test(e.innerText.trim()) &&
        [...e.children].some((c) => !c.textContent.includes('TUSD'))
    )
    .sort((a, b) => a.innerText.length - b.innerText.length)[0];
  return {
    images,
    row: row?.innerText.replace(/\s+/g, ' ').trim(),
    rowImages: [...(row?.querySelectorAll('img') ?? [])].map((i) => new URL(i.src).pathname),
  };
});
console.log(`  row "${picker.row}", images in the dialog: ${picker.images.join(' ') || 'none'}`);
check(
  'the dialog draws no TUSD logo',
  !picker.images.some((p: string) => p.includes('tusd')),
  picker.images.join(' ')
);
check(
  'the collateral shows as a lettered disc',
  picker.row === 'T TUSD' && picker.rowImages.length === 0,
  `"${picker.row}"${picker.rowImages.length > 0 ? ` with ${picker.rowImages.join(' ')}` : ''}`
);
await trader.screenshot({ path: `${screenshots}-transfer.png` });

await browser.close();
console.log(`  screenshots ${screenshots}-{welcome,transfer}.png`);
console.log(`\n${passed} checks passed, ${failed.length} failed`);
if (failed.length > 0) process.exit(1);

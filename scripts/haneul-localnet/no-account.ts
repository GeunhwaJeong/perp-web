/* eslint-disable no-console */

/**
 * What a wallet without a trading account is offered, on a running localnet. The leverage is
 * written through the account the first deposit opens, so before there is collateral the leverage
 * dialog is to offer the deposit in place of Save, and lead to the deposit dialog; once the
 * account holds collateral the dialog saves as before. Also checks that the phone layout's trade
 * dialog offers the deposit to a wallet without an account. Requires the fixture
 * (`fixture.mjs setup` + `push`), the indexer and API, and `pnpm dev`.
 *
 *   PLAYWRIGHT=/path/to/node_modules/playwright pnpm exec tsx scripts/haneul-localnet/no-account.ts
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
const screenshots = process.env.SCREENSHOTS ?? join(ROOT, '.localnet', 'no-account');
const MARKET = 'BTC-USD';

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

const browser = await chromium.launch();

/** Opens the app at the given size with the wallet connected through the dev wallet. */
const openApp = async (keypair: Ed25519Keypair, viewport: { width: number; height: number }) => {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.on('pageerror', (e: Error) => {
    if (!/qs_|Bars are not available/.test(e.message)) console.log('  page error:', e.message);
  });
  // tsx names the functions it compiles with an `__name` helper, which code sent to the page
  // would call; a string is sent as it is.
  await page.addInitScript({ content: 'window.__name = (f) => f;' });
  await page.addInitScript((key: string) => {
    window.localStorage.setItem('haneul:dev-wallet:secret', key);
  }, keypair.getSecretKey());
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
  return page;
};

const openDialog = (page: any, type: string, props: Record<string, unknown>) =>
  page.evaluate(
    (payload: { type: string; props: Record<string, unknown> }) =>
      (window as any).haneulPerp.supervisor.store.dispatch({ type: 'Dialogs/openDialog', payload }),
    { type, props }
  );
/** The open dialog's title and buttons, once one of the buttons reads `waitFor` (or 15 s pass). */
const dialogButtons = async (page: any, waitFor: RegExp) => {
  let state = { title: '', buttons: [] as string[], text: '' };
  for (let i = 0; i < 30; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    state = await page.evaluate(() => {
      const box = document.querySelector('[role="dialog"]') as HTMLElement | null;
      return {
        title: (box?.querySelector('h2, [class*="title"]') as HTMLElement | null)?.innerText ?? '',
        buttons: [...(box?.querySelectorAll('button') ?? [])]
          .map((b) => (b as HTMLElement).innerText.trim())
          .filter(Boolean),
        text: (box?.innerText ?? '').replace(/\s+/g, ' ').trim(),
      };
    });
    if (state.buttons.some((b) => waitFor.test(b))) break;
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(500);
  }
  return state;
};

// 1. The leverage dialog before the first deposit.
console.log('\n1 the leverage dialog without a trading account');
const desk = await openApp(await fundedWallet(), { width: 1440, height: 1100 });
await desk.locator('form footer').first().waitFor({ timeout: 60_000 });
await openDialog(desk, 'SetMarketLeverage', { marketId: MARKET });
await desk.getByRole('dialog').waitFor({ timeout: 15_000 });
const before = await dialogButtons(desk, /^Deposit funds$/);
await desk.screenshot({ path: `${screenshots}-1.png` });
console.log(`  buttons ${JSON.stringify(before.buttons)}`);
check(
  'the leverage dialog offers the deposit in place of Save',
  before.buttons.includes('Deposit funds') && !before.buttons.includes('Save')
);
let depositOpened = '';
if (before.buttons.includes('Deposit funds')) {
  await desk.getByRole('dialog').getByRole('button', { name: 'Deposit funds' }).click();
  await desk.waitForTimeout(1_500);
  const next = await dialogButtons(desk, /^Deposit$/);
  depositOpened = next.text;
}
console.log(`  after the button: "${depositOpened.slice(0, 120)}"`);
check(
  'the button leads to the deposit dialog with the wallet balance',
  /^Deposit\b/.test(depositOpened) && depositOpened.includes('1,000'),
  depositOpened.slice(0, 60)
);
await desk.screenshot({ path: `${screenshots}-2.png` });
await desk.keyboard.press('Escape');
await desk.waitForTimeout(500);

// 2. With collateral in the account the dialog saves as before.
console.log('\n2 the leverage dialog with collateral in the account');
const deposited = await desk.evaluate(async () => {
  const r = await (window as any).haneulPerp.supervisor.depositCollateral(100);
  return r.type;
});
check('100 TUSD deposited', deposited === 'success', deposited);
await desk.waitForTimeout(5_000);
await openDialog(desk, 'SetMarketLeverage', { marketId: MARKET });
await desk.getByRole('dialog').waitFor({ timeout: 15_000 });
const funded = await dialogButtons(desk, /^Save$/);
console.log(`  buttons ${JSON.stringify(funded.buttons)}`);
check('the dialog shows Save once the account holds collateral', funded.buttons.includes('Save'));
let saved: unknown;
if (funded.buttons.includes('Save')) {
  // The slider keeps a hidden input of its own; the leverage is typed in the visible one.
  await desk.getByRole('dialog').locator('input:visible').first().fill('5');
  await desk.waitForTimeout(500);
  await desk.getByRole('dialog').locator('button[type="submit"]').click();
  await desk
    .getByRole('dialog')
    .waitFor({ state: 'detached', timeout: 60_000 })
    .catch(() => {});
  saved = await desk.evaluate(async () =>
    (window as any).haneulPerp.supervisor.readMarketLeverages()
  );
}
check(
  'Save writes 5x to the position on chain',
  (saved as Record<string, number> | undefined)?.[MARKET] === 5,
  JSON.stringify(saved)
);
await desk.context().close();

// 3. The phone layout's trade dialog, for a wallet without an account.
console.log('\n3 the phone trade dialog without a trading account');
const phone = await openApp(await fundedWallet(), { width: 390, height: 844 });
// The phone layout opens on the markets list; the market's page holds the Long and Short buttons.
await phone.goto(url.replace(/#.*$/, '#/markets'), { waitUntil: 'domcontentloaded' });
await phone.getByText('BTC', { exact: true }).first().click({ timeout: 60_000 });
await phone.getByRole('button', { name: 'Long', exact: true }).click({ timeout: 30_000 });
await phone.getByRole('dialog').waitFor({ timeout: 15_000 });
const simple = await dialogButtons(phone, /^Deposit funds$/);
await phone.screenshot({ path: `${screenshots}-3.png` });
console.log(`  buttons ${JSON.stringify(simple.buttons)}`);
check('the phone trade dialog offers the deposit', simple.buttons.includes('Deposit funds'));
await phone.context().close();

await browser.close();
console.log(`  screenshots ${screenshots}-{1,2,3}.png`);
console.log(`\n${passed} checks passed, ${failed.length} failed`);
if (failed.length > 0) process.exit(1);

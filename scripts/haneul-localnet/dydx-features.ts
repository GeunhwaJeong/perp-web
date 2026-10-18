/* eslint-disable no-console */

/**
 * Two dYdX features that had nothing behind them on this chain, on a running localnet: the API
 * Trading Keys entry of the More menu (dYdX chain authenticators) and the Equity Tiers page
 * (dYdX order count limits by equity, a validator query that never answers here). Both are to be
 * gone, an old link to the Equity Tiers page is to land on the portfolio overview, and the
 * position's TP/SL dialog, which the missing equity tiers blocked without a word, is to say the
 * orders are coming soon. A market buy and the position it opens show the trade form unchanged.
 * Requires the fixture (`fixture.mjs setup` + `push`), the indexer and API, and `pnpm dev`.
 *
 *   PLAYWRIGHT=/path/to/node_modules/playwright pnpm exec tsx scripts/haneul-localnet/dydx-features.ts
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
const screenshots = process.env.SCREENSHOTS ?? join(ROOT, '.localnet', 'dydx-features');
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

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors: string[] = [];
page.on('pageerror', (e: Error) => {
  if (!/qs_|Bars are not available/.test(e.message)) errors.push(e.message);
});
// tsx names the functions it compiles with an `__name` helper, which code sent to the page would
// call; a string is sent as it is.
await page.addInitScript({ content: 'window.__name = (f) => f;' });
await page.addInitScript((key: string) => {
  window.localStorage.setItem('haneul:dev-wallet:secret', key);
}, keypair.getSecretKey());

const text = () => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
/** Loads a route afresh and waits for the app, with the dev wallet connected. */
const open = async (route: string) => {
  await page.goto(`${APP}#${route}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForFunction(() => (window as any).haneulPerp != null, null, { timeout: 60_000 });
  await page.evaluate(async () => {
    const { dAppKit, supervisor } = (window as any).haneulPerp;
    if (supervisor.store.getState().wallet.sourceAccount?.address != null) return;
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
const supervisor = (method: string, ...args: unknown[]) =>
  page.evaluate(
    async ({ m, a }: { m: string; a: unknown[] }) => {
      const r = await (window as any).haneulPerp.supervisor[m](...a);
      return JSON.parse(JSON.stringify(r));
    },
    { m: method, a: args }
  );
const outcome = (r: any) => (r.type === 'success' ? r.type : `${r.type}: ${r.errorString}`);

// 1. A position, opened through the trade form's path, for the TP/SL dialog to act on.
console.log('\n1 a position');
await open(`/trade/${MARKET}`);
await page.locator('form footer').first().waitFor({ timeout: 60_000 });
const deposit = await supervisor('depositCollateral', 100);
check('100 TUSD deposited', deposit.type === 'success', outcome(deposit));
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
check('market buy 0.001 BTC', buy.type === 'success', outcome(buy));
const positionShown = () =>
  page
    .waitForFunction(
      () => {
        const { haneulPerp } = window as any;
        const positions = haneulPerp.BonsaiCore.account.parentSubaccountPositions.data(
          haneulPerp.supervisor.store.getState()
        );
        return (positions?.length ?? 0) > 0;
      },
      null,
      { timeout: 60_000 }
    )
    .then(() => true)
    .catch(() => false);
check('the app shows the position', await positionShown());

// 2. The More menu.
console.log('\n2 the More menu');
await page.getByRole('button', { name: 'More', exact: true }).first().click({ timeout: 20_000 });
const menuOpen = await page
  .getByText('Privacy Policy', { exact: true })
  .first()
  .waitFor({ timeout: 10_000 })
  .then(() => true)
  .catch(() => false);
const menu = await text();
await page.screenshot({ path: `${screenshots}-1.png` });
check('the More menu opens with its links', menuOpen);
check('the More menu has no API Trading Keys entry', !menu.includes('API Trading Keys'));
await page.keyboard.press('Escape');

// 3. The portfolio sidebar.
console.log('\n3 the portfolio sidebar');
await open('/portfolio/overview');
const sidebar = await page
  .getByRole('link', { name: 'Fees', exact: true })
  .first()
  .waitFor({ timeout: 30_000 })
  .then(() => true)
  .catch(() => false);
const portfolio = await text();
await page.screenshot({ path: `${screenshots}-2.png` });
check('the portfolio sidebar shows Fees', sidebar);
check('the portfolio sidebar has no Equity Tiers entry', !portfolio.includes('Equity Tiers'));

// 4. An old link to the Equity Tiers page.
console.log('\n4 an old link to the Equity Tiers page');
await open('/portfolio/equity-tiers');
await page.waitForTimeout(5_000);
const landed = await page.evaluate(() => window.location.pathname);
const equityPage = await text();
await page.screenshot({ path: `${screenshots}-3.png` });
check('the old link lands on the portfolio overview', landed === '/portfolio/overview', landed);
check('no Equity Tiers page is shown', !equityPage.includes('Equity Tiers'));

// 5. The position's TP/SL dialog: the one its TP/SL cell opens, with the position's own ids.
console.log('\n5 the TP/SL dialog');
await open(`/trade/${MARKET}`);
await page.locator('form footer').first().waitFor({ timeout: 60_000 });
await positionShown();
const requested = await page.evaluate(() => {
  const { haneulPerp } = window as any;
  const { store } = haneulPerp.supervisor;
  const position = haneulPerp.BonsaiCore.account.parentSubaccountPositions.data(
    store.getState()
  )?.[0];
  if (position == null) return false;
  store.dispatch({
    type: 'Dialogs/openDialog',
    payload: {
      type: 'Triggers',
      props: {
        positionUniqueId: position.uniqueId,
        marketId: position.market,
        assetId: position.assetId,
        navigateToMarketOrders: () => {},
      },
    },
  });
  return true;
});
const dialogOpen =
  requested &&
  (await page
    .locator('#take-profit-price')
    .waitFor({ timeout: 20_000 })
    .then(() => true)
    .catch(() => false));
check('the TP/SL dialog opens for the position', dialogOpen, requested ? '' : 'no position');
let label = '';
let disabled = false;
if (dialogOpen) {
  await page.locator('#take-profit-price').click();
  await page.keyboard.type('110000');
  await page.waitForTimeout(1_500);
  const submit = page.getByRole('dialog').locator('button[type="submit"]').first();
  label = ((await submit.innerText().catch(() => '')) as string).trim();
  disabled = await submit.isDisabled().catch(() => false);
}
await page.screenshot({ path: `${screenshots}-4.png` });
console.log(`  TP/SL button "${label}", disabled ${disabled}`);
check('the TP/SL button stays disabled', disabled);
check('the TP/SL button says the orders are coming soon', label === 'Coming soon', label);
check('no page error on the way', errors.length === 0, errors.join(' | ').slice(0, 160));

await browser.close();
console.log(`  screenshots ${screenshots}-{1,2,3,4}.png`);
console.log(`\n${passed} checks passed, ${failed.length} failed`);
if (failed.length > 0) process.exit(1);

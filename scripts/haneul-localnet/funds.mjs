/* eslint-disable no-console */

/**
 * Deposits, withdrawals, margin moves and leverage through the app against a running localnet,
 * with a fresh wallet so the first deposit also opens the trading account the way a new user's
 * does. Requires the fixture (`fixture.mjs setup` + `push`, with or without `--no-relay`) and
 * `pnpm dev`.
 *
 *   PLAYWRIGHT=/path/to/node_modules/playwright node scripts/haneul-localnet/funds.mjs
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
const MARKET = 'BTC-USD';

let passed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) throw new Error(`FAIL ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}${detail ? ` (${detail})` : ''}`);
};
const close = (a, b) => Math.abs(a - b) < 1e-6;

// A first-time user: gas and 5,000 TUSD in the wallet, no trading account yet.
const fresh = Ed25519Keypair.generate();
const freshAddress = fresh.getPublicKey().toHaneulAddress();
const funded = spawnSync(
  process.execPath,
  [join(ROOT, 'scripts', 'haneul-localnet', 'fixture.mjs'), 'fund', freshAddress, '5000'],
  { stdio: 'inherit' }
);
if (funded.status !== 0) throw new Error('fixture.mjs fund failed');

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => {
  if (!e.message.includes('qs_')) console.log('  page error:', e.message);
});
await page.addInitScript((key) => {
  window.localStorage.setItem('haneul:dev-wallet:secret', key);
}, fresh.getSecretKey());
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.waitForFunction(() => window.haneulPerp != null, null, { timeout: 60_000 });
const address = await page.evaluate(async () => {
  const { dAppKit } = window.haneulPerp;
  const wallet = dAppKit.stores.$wallets.get().find((w) => w.name === 'Haneul Dev Wallet');
  const result = await dAppKit.connectWallet({ wallet });
  return result.accounts[0]?.address ?? null;
});
check('fresh wallet connected', address === freshAddress, address);
await page.waitForFunction(
  () => window.haneulPerp?.supervisor.store.getState().wallet.sourceAccount?.address != null,
  null,
  { timeout: 15_000 }
);

const supervisor = (method, ...args) =>
  page.evaluate(
    async ({ m, a }) => {
      const r = await window.haneulPerp.supervisor[m](...a);
      return JSON.parse(JSON.stringify(r));
    },
    { m: method, a: args }
  );
const balances = async () => (await supervisor('collateralBalances')).payload;

let b = await balances();
check(
  'wallet holds the test dollars and has no trading account',
  close(b.wallet, 5000) && b.account === undefined,
  JSON.stringify(b)
);

// 1. first deposit through the dialog opens the account
await page.evaluate(() =>
  window.haneulPerp.supervisor.store.dispatch({
    type: 'Dialogs/openDialog',
    payload: { type: 'Deposit2', props: {} },
  })
);
const dialog = page.getByRole('dialog');
await dialog.waitFor({ timeout: 15_000 });
await page.waitForFunction(
  () => document.querySelector('[role="dialog"]')?.textContent?.includes('5,000') === true,
  null,
  { timeout: 15_000 }
);
check('deposit dialog shows the wallet balance', true);
await dialog.locator('input').first().fill('1200');
await dialog.locator('button[type="submit"]').click();
await dialog.waitFor({ state: 'detached', timeout: 60_000 });
b = await balances();
check(
  'the first deposit opened the account and funded it',
  close(b.account, 1200) && close(b.wallet, 3800),
  JSON.stringify(b)
);

// 2. a second deposit adds to the account
let r = await supervisor('depositCollateral', 300);
check('second deposit', r.type === 'success' && r.payload.createdAccount === false);
b = await balances();
check('account balance 1,500', close(b.account, 1500), JSON.stringify(b));

// 3. leverage before the first trade: the position object is created at 5x
r = await supervisor('setMarketLeverage', { marketId: MARKET, leverage: 5 });
check('set 5x leverage on a market without a position', r.type === 'success', JSON.stringify(r));
let leverages = await supervisor('readMarketLeverages');
check('the position trades at 5x', leverages[MARKET] === 5, JSON.stringify(leverages));
r = await supervisor('setMarketLeverage', { marketId: MARKET, leverage: 20 });
check(
  'leverage above the market maximum is refused',
  r.type === 'failure' && /maximum/.test(r.errorString),
  r.errorString
);
r = await supervisor('setMarketLeverage', { marketId: MARKET, leverage: 2 });
leverages = await supervisor('readMarketLeverages');
check('lowered to 2x', r.type === 'success' && leverages[MARKET] === 2, JSON.stringify(leverages));
await page
  .waitForFunction(
    (m) =>
      window.haneulPerp.supervisor.store.getState().raw.markets.selectedMarketLeverages.data?.[m] !=
      null,
    MARKET,
    { timeout: 15_000 }
  )
  .catch(() => undefined);

// 4. the dYdX subaccount numbering maps onto the engine's markets
const mapped = await page.evaluate(() => [
  window.haneulPerp.supervisor.marketIdForClobPair(0),
  window.haneulPerp.supervisor.marketIdForSubaccount(128),
  window.haneulPerp.supervisor.marketIdForSubaccount(0) ?? null,
]);
check(
  'clob pair 0 and child subaccount 128 are BTC-USD, the parent is no market',
  mapped[0] === MARKET && mapped[1] === MARKET && mapped[2] === null,
  JSON.stringify(mapped)
);

// 5. margin into the market and back out (out carries signed prices)
r = await supervisor('transferMargin', { marketId: MARKET, amount: 400, toMarket: true });
check('allocate 400 to the market', r.type === 'success', JSON.stringify(r).slice(0, 120));
b = await balances();
check('account balance 1,100 after allocating', close(b.account, 1100), JSON.stringify(b));
r = await supervisor('transferMargin', { marketId: MARKET, amount: 150, toMarket: false });
check('deallocate 150 from the market', r.type === 'success', JSON.stringify(r).slice(0, 120));
b = await balances();
check('account balance 1,250 after deallocating', close(b.account, 1250), JSON.stringify(b));

// 6. withdrawals: through the dialog, then over the balance
await page.evaluate(() =>
  window.haneulPerp.supervisor.store.dispatch({
    type: 'Dialogs/openDialog',
    payload: { type: 'Withdraw2', props: {} },
  })
);
await dialog.waitFor({ timeout: 15_000 });
await page.waitForFunction(
  () => document.querySelector('[role="dialog"]')?.textContent?.includes('1,250') === true,
  null,
  { timeout: 15_000 }
);
check('withdraw dialog shows the withdrawable balance', true);
await dialog.locator('input').first().fill('250');
await dialog.locator('button[type="submit"]').click();
await dialog.waitFor({ state: 'detached', timeout: 60_000 });
b = await balances();
check(
  'withdrawal paid the wallet from the account',
  close(b.account, 1000) && close(b.wallet, 3750),
  JSON.stringify(b)
);
r = await supervisor('withdrawCollateral', 5000);
check(
  'a withdrawal over the account balance is refused before signing',
  r.type === 'failure' && /free collateral/.test(r.errorString),
  r.errorString
);

// 7. the market leverage dialog writes the position's ratio through the same path
await page.evaluate(
  (marketId) =>
    window.haneulPerp.supervisor.store.dispatch({
      type: 'Dialogs/openDialog',
      payload: { type: 'SetMarketLeverage', props: { marketId } },
    }),
  MARKET
);
await dialog.waitFor({ timeout: 15_000 });
// The slider keeps a hidden range input; the typed value goes into the visible one.
await dialog.locator('input:visible').last().fill('3');
await dialog.locator('button[type="submit"]').click();
await dialog.waitFor({ state: 'detached', timeout: 60_000 });
leverages = await supervisor('readMarketLeverages');
const shown = await page.evaluate(
  (m) =>
    window.haneulPerp.supervisor.store.getState().raw.markets.selectedMarketLeverages.data?.[m],
  MARKET
);
check(
  'the leverage dialog sets 3x on chain and in the app',
  leverages[MARKET] === 3 && shown === 3,
  `chain ${leverages[MARKET]}, app ${shown}`
);

await browser.close();
console.log(`\n${passed} fund checks passed`);

/* eslint-disable no-console */

/**
 * What the app says when a transaction fails, on a running localnet. The write path knows why
 * (its own checks name the reason, and a chain rejection carries the engine's abort), and each
 * form is to show that reason rather than "Something went wrong", "Unknown error" or the error
 * as JSON. Checks the transfer form with a name that does not resolve, a post-only order the
 * engine refuses from the trade form and a margin removal the engine refuses from the margin
 * dialog (the leverage dialog offers a deposit before there is an account, see no-account.ts).
 * Requires the fixture (`fixture.mjs setup` + `push`), the indexer and API, and `pnpm dev`.
 *
 *   PLAYWRIGHT=/path/to/node_modules/playwright pnpm exec tsx scripts/haneul-localnet/error-text.ts
 */
import { bcs } from '@haneullabs/haneul/bcs';
import { HaneulGrpcClient } from '@haneullabs/haneul/grpc';
import { Ed25519Keypair } from '@haneullabs/haneul/keypairs/ed25519';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { findPerpAccount, type PerpDeployment } from '../../src/haneul/perp';

const require = createRequire(import.meta.url);
// eslint-disable-next-line import/no-dynamic-require -- resolved from an external checkout
const { chromium } = require(process.env.PLAYWRIGHT ?? 'playwright');

const ROOT = join(import.meta.dirname, '..', '..');
const url = process.env.APP_URL ?? 'http://localhost:5173/#/trade/BTC-USD';
const rpc = process.env.RPC_URL ?? 'http://127.0.0.1:9000';
const screenshots = process.env.SCREENSHOTS ?? join(ROOT, '.localnet', 'error-text');
const MARKET = 'BTC-USD';
const deployment: PerpDeployment = JSON.parse(
  readFileSync(join(ROOT, 'public/configs/haneul/perp.localnet.json'), 'utf8')
);
const client = new HaneulGrpcClient({ network: 'localnet', baseUrl: rpc });

let passed = 0;
const failed: string[] = [];
// Every check runs, so a run without the change shows each message it gets wrong.
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
  if (ok) passed += 1;
  else failed.push(name);
};
const tusd = (units: bigint) => (Number(units) / 1e6).toFixed(6);

const signed = (v: bigint) => (v >= 2n ** 255n ? v - 2n ** 256n : v);
const PositionKeyBcs = bcs.struct('PositionKey', { account_id: bcs.u64() });
const PositionBcs = bcs.struct('Position', {
  collateral: bcs.u256(),
  base_asset_amount: bcs.u256(),
  quote_asset_notional_amount: bcs.u256(),
  cum_funding_rate_long: bcs.u256(),
  cum_funding_rate_short: bcs.u256(),
  asks_quantity: bcs.u256(),
  bids_quantity: bcs.u256(),
  pending_orders: bcs.u64(),
  initial_margin_ratio: bcs.u256(),
});
// The market's collateral in coin units; zero before the first order creates the position.
const marketCollateral = async (accountId: bigint) => {
  const found = await client.core
    .getDynamicField({
      parentId: deployment.markets[MARKET]!.clearingHouse,
      name: {
        type: `${deployment.packages.perpetuals}::keys::PositionKey`,
        bcs: PositionKeyBcs.serialize({ account_id: accountId }).toBytes(),
      },
    })
    .catch(() => undefined);
  if (found == null) return 0n;
  return signed(BigInt(PositionBcs.parse(found.dynamicField.value.bcs).collateral)) / 10n ** 12n;
};

// A trader with gas and 1,000 TUSD in the wallet, and no trading account yet.
const fresh = Ed25519Keypair.generate();
const me = fresh.getPublicKey().toHaneulAddress();
const funded = spawnSync(
  process.execPath,
  [join(ROOT, 'scripts', 'haneul-localnet', 'fixture.mjs'), 'fund', me, '1000'],
  { stdio: 'inherit' }
);
if (funded.status !== 0) throw new Error('fixture.mjs fund failed');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
page.on('pageerror', (e: Error) => {
  if (!/qs_|Bars are not available/.test(e.message)) console.log('  page error:', e.message);
});
// tsx names the functions it compiles with an `__name` helper, which code sent to the page would
// call; a string is sent as it is.
await page.addInitScript({ content: 'window.__name = (f) => f;' });
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
await page.locator('form footer').first().waitFor({ timeout: 60_000 });

const supervisor = (method: string, ...args: unknown[]) =>
  page.evaluate(
    async ({ m, a }: { m: string; a: unknown[] }) => {
      const r = await (window as any).haneulPerp.supervisor[m](...a);
      return JSON.parse(JSON.stringify(r));
    },
    { m: method, a: args }
  );

const openDialog = async (type: string, props: Record<string, unknown>) => {
  await page.evaluate(
    (payload: { type: string; props: Record<string, unknown> }) =>
      (window as any).haneulPerp.supervisor.store.dispatch({ type: 'Dialogs/openDialog', payload }),
    { type, props }
  );
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ timeout: 15_000 });
  await page.waitForTimeout(1_000);
  return dialog;
};
const closeDialog = async () => {
  await page.keyboard.press('Escape');
  await page
    .getByRole('dialog')
    .waitFor({ state: 'detached', timeout: 10_000 })
    .catch(() => {});
};
const textOf = async (scope: any) =>
  ((await scope.count()) ? await scope.first().innerText() : '').replace(/\s+/g, ' ').trim();
// What the app showed in place of the reason before this change.
const GENERIC = /Something went wrong|Unknown error|\{"error"/;
/**
 * Waits until the text in scope shows the expected message or a generic one, prints the part
 * around it and returns the text.
 */
const waitForMessage = async (scope: any, label: string, expected: RegExp) => {
  const either = new RegExp(`${expected.source}|${GENERIC.source}`);
  let text = '';
  for (let i = 0; i < 30; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    text = await textOf(scope);
    if (either.test(text)) break;
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(500);
  }
  const at = text.search(either);
  const part = at < 0 ? text.slice(-160) : text.slice(Math.max(0, at - 20), at + 140);
  console.log(`  ${label} "${part}"`);
  return text;
};
const shows = (text: string, expected: RegExp) => expected.test(text) && !GENERIC.test(text);

// 1. The transfer form, sending to a name that does not resolve.
console.log('\n1 the transfer form with a name that does not resolve');
const NO_NAME =
  /is not a registered name, or points nowhere|Names are not available on this network/;
const transfer = await openDialog('Transfer', {});
await transfer.getByPlaceholder('0x… or name.haneul').fill('nobody-here.haneul');
await transfer.locator('input').last().fill('0.1');
await page.waitForTimeout(500);
await transfer.locator('button[type="submit"]').click();
const transferText = await waitForMessage(page.getByRole('dialog'), 'dialog', NO_NAME);
await page.screenshot({ path: `${screenshots}-1.png` });
check('the transfer form says the name does not resolve, in words', shows(transferText, NO_NAME));
await closeDialog();

const deposited = await supervisor('depositCollateral', 100);
check('100 TUSD deposited', deposited.type === 'success', JSON.stringify(deposited).slice(0, 120));
const acct = await findPerpAccount(client, deployment, me);
if (!acct) throw new Error('no account after the deposit');

const fill = (actions: Array<[string, unknown]>) =>
  page.evaluate((list: Array<[string, unknown]>) => {
    const { store } = (window as any).haneulPerp.supervisor;
    store.dispatch({ type: 'TradeForm/resetPrimaryInputs' });
    list.forEach(([type, payload]) => store.dispatch({ type: `TradeForm/${type}`, payload }));
  }, actions);

// 2. A post-only bid above the asks: the engine refuses it rather than let it match.
console.log('\n2 a post-only order the engine refuses');
await fill([
  ['setOrderType', 'LIMIT'],
  ['setSide', 'BUY'],
  ['setLimitPrice', '100500'],
  ['setSizeToken', '0.001'],
  ['setPostOnly', true],
]);
await page.waitForTimeout(1_500);
await page.locator('form footer button[type="submit"]:visible').click();
// The form clears its inputs as the order goes out, and with order status notifications on (the
// default) a failed order is reported in its notification rather than above the button.
const orderText = await waitForMessage(
  page.getByRole('region', { name: /Notifications/ }),
  'notification',
  /Post-only order would match immediately/
);
await page.screenshot({ path: `${screenshots}-2.png` });
check(
  "the order's notification names the engine's rejection",
  shows(orderText, /Post-only order would match immediately/)
);
check(
  'the refused order left the market empty',
  (await marketCollateral(acct.accountId)) === 0n,
  tusd(await marketCollateral(acct.accountId))
);
// Lets the trade form's message clear before the next order.
await fill([]);

// 3. The margin dialog offers what the position can spare, then $5 of it leaves another way
// before the dialog's removal lands, so the engine refuses the dialog's amount.
console.log('\n3 a margin removal the engine refuses');
const before = await marketCollateral(acct.accountId);
await fill([
  ['setOrderType', 'MARKET'],
  ['setSide', 'BUY'],
  ['setSizeToken', '0.001'],
]);
await page.waitForTimeout(1_500);
await page.locator('form footer button[type="submit"]:visible').click();
for (let i = 0; i < 60; i += 1) {
  // eslint-disable-next-line no-await-in-loop
  if ((await marketCollateral(acct.accountId)) !== before) break;
  // eslint-disable-next-line no-await-in-loop
  await page.waitForTimeout(1_000);
}
check('a market buy opens the position', (await marketCollateral(acct.accountId)) > 0n);
await page.waitForTimeout(5_000);

const openMarginDialog = async () => {
  await page.evaluate((m: string) => {
    const { haneulPerp } = window as any;
    const state = haneulPerp.supervisor.store.getState();
    const position = (
      haneulPerp.BonsaiCore.account.parentSubaccountPositions.data(state) ?? []
    ).find((p: any) => p.market === m && p.status === 'OPEN');
    haneulPerp.supervisor.store.dispatch({
      type: 'Dialogs/openDialog',
      payload: { type: 'AdjustIsolatedMargin', props: { positionId: position.uniqueId } },
    });
  }, MARKET);
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ timeout: 15_000 });
  await page.waitForTimeout(1_000);
  return dialog;
};
const added = await openMarginDialog();
await added.getByText('Add Margin', { exact: true }).first().click();
await added.locator('input').first().fill('10');
await page.waitForTimeout(1_000);
const beforeAdd = await marketCollateral(acct.accountId);
await added.locator('button[type="submit"]').click();
await page.waitForTimeout(8_000);
await closeDialog();
const afterAdd = await marketCollateral(acct.accountId);
check(
  '$10 more goes into the market',
  afterAdd - beforeAdd === 10_000_000n,
  tusd(afterAdd - beforeAdd)
);
// Time for the indexer to show the added margin.
await page.waitForTimeout(5_000);

const removal = await openMarginDialog();
await removal.getByText('Remove Margin', { exact: true }).first().click();
await removal.getByText('100%', { exact: true }).first().click();
await page.waitForTimeout(1_000);
const offered = await removal.locator('input').first().inputValue();
const beforeRemove = await marketCollateral(acct.accountId);
// Taking the $5 out ahead of the dialog would race the indexer, which can show it leaving and
// lower the offer before the dialog sends. Instead the dialog's own removal takes the $5 first,
// once, and then sends the amount the dialog offered.
await page.evaluate((m: string) => {
  const w = window as any;
  const { supervisor: s } = w.haneulPerp;
  const original = s.transferMargin.bind(s);
  s.transferMargin = async (args: unknown) => {
    s.transferMargin = original;
    w.sideTransfer = JSON.parse(
      JSON.stringify(await original({ marketId: m, amount: 5, toMarket: false }))
    );
    return original(args);
  };
}, MARKET);
await removal.locator('button[type="submit"]').click();
console.log(`  dialog offered ${offered}`);
const marginText = await waitForMessage(
  page.getByRole('dialog'),
  'dialog',
  /Insufficient free collateral/
);
await page.screenshot({ path: `${screenshots}-3.png` });
const side = await page.evaluate(() => (window as any).sideTransfer ?? null);
check('$5 leaves the market first', side?.type === 'success', JSON.stringify(side).slice(0, 120));
const afterRemove = await marketCollateral(acct.accountId);
// Funding settled by the $5 withdrawal can move a unit beside it; the dialog's $9.90 would not.
const letOut = beforeRemove - afterRemove;
check(
  'the chain let out only the $5 taken first',
  letOut >= 4_999_000n && letOut <= 5_001_000n,
  `${tusd(beforeRemove)} → ${tusd(afterRemove)}`
);
check(
  "the margin dialog names the engine's rejection",
  shows(marginText, /Insufficient free collateral/)
);
await closeDialog();

await supervisor('cancelAllOrders', { marketId: MARKET });
await supervisor('closeAllPositions');
await page.waitForTimeout(5_000);

await browser.close();
console.log(`  screenshots ${screenshots}-{1,2,3}.png`);
console.log(`\n${passed} checks passed, ${failed.length} failed`);
if (failed.length > 0) process.exit(1);

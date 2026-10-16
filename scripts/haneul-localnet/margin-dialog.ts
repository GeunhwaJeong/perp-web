/* eslint-disable no-console */

/**
 * The positions table's leverage note and the margin dialog's removal limit against the engine,
 * on a running localnet. The engine holds an isolated position to its own initial margin ratio
 * on its size with its resting orders, and lets out only collateral less any loss; the app is to
 * show the leverage and offer the removal the same way. Checks a position with a bid resting
 * beside it, a 5x position and a position given more margin than its leverage needs, reading the
 * table and the dialog, and taking out what the dialog offers. Requires the fixture
 * (`fixture.mjs setup` + `push`), the indexer and API, and `pnpm dev`.
 *
 *   PLAYWRIGHT=/path/to/node_modules/playwright pnpm exec tsx scripts/haneul-localnet/margin-dialog.ts
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
const screenshots = process.env.SCREENSHOTS ?? join(ROOT, '.localnet', 'margin-dialog');
const MARKET = 'BTC-USD';
const deployment: PerpDeployment = JSON.parse(
  readFileSync(join(ROOT, 'public/configs/haneul/perp.localnet.json'), 'utf8')
);
const client = new HaneulGrpcClient({ network: 'localnet', baseUrl: rpc });

let passed = 0;
const failed: string[] = [];
// Every check runs, so a run without the change shows each number it gets wrong.
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
/** Places an order from the form and waits for the market's collateral to settle. */
const place = async (actions: Array<[string, unknown]>) => {
  const before = await marketCollateral(acct.accountId);
  await fill(actions);
  await page.waitForTimeout(1_500);
  await page.locator('form footer button[type="submit"]:visible').click();
  for (let i = 0; i < 60; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    if ((await marketCollateral(acct.accountId)) !== before) break;
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(1_000);
  }
  // Time for the indexer to show the position and its orders.
  await page.waitForTimeout(5_000);
};
const marketBuy = (size: string): Array<[string, unknown]> => [
  ['setOrderType', 'MARKET'],
  ['setSide', 'BUY'],
  ['setSizeToken', size],
];

// The position row's margin cell, as the table shows it.
const marginCell = () =>
  page.evaluate(() => {
    const table = [...document.querySelectorAll('table')].find((t) =>
      [...t.querySelectorAll('th')].some((h) => (h as HTMLElement).innerText.trim() === 'Margin')
    );
    const headers = [...(table?.querySelectorAll('th') ?? [])].map((h) =>
      (h as HTMLElement).innerText.trim()
    );
    const cell = table?.querySelector('tbody tr')?.querySelectorAll('td')[
      headers.indexOf('Margin')
    ];
    return ((cell as HTMLElement | undefined)?.innerText ?? '').replace(/\s+/g, ' ').trim();
  });

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
const dialogState = (dialog: any) =>
  dialog.evaluate((box: HTMLElement) => {
    const submit = box.querySelector('button[type="submit"]') as HTMLButtonElement | null;
    return {
      amount: (box.querySelector('input') as HTMLInputElement | null)?.value ?? '',
      button: submit?.innerText.trim() ?? '',
      disabled: submit?.disabled ?? true,
      text: box.innerText.replace(/\s+/g, ' ').trim(),
    };
  });
const amountOf = (text: string) => Number(text.replace(/[$,]/g, '')) || 0;
const closeDialog = async () => {
  await page.keyboard.press('Escape');
  await page
    .getByRole('dialog')
    .waitFor({ state: 'detached', timeout: 10_000 })
    .catch(() => {});
};

/**
 * Opens the margin dialog on the position, asks for 100% of the removal it allows and takes that
 * out when it is more than nothing. Returns what it offered and what the chain did with it.
 */
const removeAll = async (name: string) => {
  const dialog = await openMarginDialog();
  await dialog.getByText('Remove Margin', { exact: true }).first().click();
  await dialog.getByText('100%', { exact: true }).first().click();
  await page.waitForTimeout(1_000);
  const offered = await dialogState(dialog);
  const offeredAmount = amountOf(offered.amount);
  let taken: { before: bigint; after: bigint; shown: string } | undefined;
  if (offeredAmount > 0 && !offered.disabled) {
    const before = await marketCollateral(acct.accountId);
    await dialog.locator('button[type="submit"]').click();
    await page.waitForTimeout(8_000);
    const shown = (await page.getByRole('dialog').count())
      ? (await dialogState(page.getByRole('dialog'))).text
      : 'dialog closed';
    taken = { before, after: await marketCollateral(acct.accountId), shown };
  }
  await page.screenshot({ path: `${screenshots}-${name}.png` });
  await closeDialog();
  const button = offered.disabled ? 'button disabled' : `button "${offered.button}"`;
  const outcome = taken
    ? `; taking it out moved the market ${tusd(taken.before)} → ${tusd(taken.after)} (${taken.shown.slice(0, 160)})`
    : '';
  console.log(`  dialog offers ${offered.amount || '0'} (${button})${outcome}`);
  return { offeredAmount, taken };
};
// The dialog shows the amount to the cent and sends it in full.
const tookOut = (r: Awaited<ReturnType<typeof removeAll>>) => {
  if (r.taken == null) return false;
  const moved = Number(r.taken.before - r.taken.after) / 1e6;
  return Math.abs(moved - r.offeredAmount) <= 0.005;
};

const flatten = async () => {
  await supervisor('cancelAllOrders', { marketId: MARKET });
  await supervisor('closeAllPositions');
  await page.waitForTimeout(5_000);
};

// 1. A 10x position with a bid resting beside it.
console.log('\n1 a position with a bid resting beside it');
await place(marketBuy('0.002'));
await place([
  ['setOrderType', 'LIMIT'],
  ['setSide', 'BUY'],
  ['setLimitPrice', '99000'],
  ['setSizeToken', '0.001'],
]);
const withBid = await marginCell();
console.log(`  margin cell "${withBid}"`);
check('the table shows no leverage apart from the one selected', !/×/.test(withBid), withBid);
const one = await removeAll('1');
check(
  'the margin dialog offers nothing the resting bid needs',
  one.offeredAmount === 0,
  `offered ${one.offeredAmount}`
);
await flatten();

// 2. A position held at 5x.
console.log('\n2 a position at 5x');
const five = await supervisor('setMarketLeverage', { marketId: MARKET, leverage: 5 });
check('the leverage is set to 5x', five.type === 'success', JSON.stringify(five).slice(0, 120));
await place(marketBuy('0.001'));
const fiveCell = await marginCell();
console.log(`  margin cell "${fiveCell}"`);
const two = await removeAll('2');
check(
  "the margin dialog offers nothing below the position's own margin",
  two.offeredAmount === 0,
  `offered ${two.offeredAmount}`
);
await flatten();
const ten = await supervisor('setMarketLeverage', { marketId: MARKET, leverage: 10 });
check('the leverage is back at 10x', ten.type === 'success', JSON.stringify(ten).slice(0, 120));

// 3. A 10x position given $10 more than it needs: what is above its margin can come out.
console.log('\n3 a position given more margin than it needs');
await place(marketBuy('0.001'));
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
await page.waitForTimeout(4_000);
const addedCell = await marginCell();
console.log(`  margin cell "${addedCell}"`);
check('the table still shows the lower leverage', /\(\s*5×\s*\)/.test(addedCell), addedCell);
const three = await removeAll('3');
check(
  'the margin dialog offers what is above the margin, and the chain lets it out',
  three.offeredAmount > 9.8 && three.offeredAmount < 10 && tookOut(three),
  `offered ${three.offeredAmount}`
);
await flatten();

await browser.close();
console.log(`  screenshots ${screenshots}-{1,2,3}.png`);
console.log(`\n${passed} checks passed, ${failed.length} failed`);
if (failed.length > 0) process.exit(1);

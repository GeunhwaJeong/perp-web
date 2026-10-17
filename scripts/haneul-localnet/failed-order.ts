/* eslint-disable no-console */

/**
 * What the trade form does with an order once it has gone out, on a running localnet. A failed
 * order is to keep its inputs and show its reason above the button (its notification reports it
 * too), the reason is to go once an input changes, the button is to hold while the order is out
 * so it cannot go twice, and an order that succeeds still clears the form. Requires the fixture
 * (`fixture.mjs setup` + `push`), the indexer and API, and `pnpm dev`.
 *
 *   PLAYWRIGHT=/path/to/node_modules/playwright pnpm exec tsx scripts/haneul-localnet/failed-order.ts
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
const screenshots = process.env.SCREENSHOTS ?? join(ROOT, '.localnet', 'failed-order');
const MARKET = 'BTC-USD';
const deployment: PerpDeployment = JSON.parse(
  readFileSync(join(ROOT, 'public/configs/haneul/perp.localnet.json'), 'utf8')
);
const client = new HaneulGrpcClient({ network: 'localnet', baseUrl: rpc });

let passed = 0;
const failed: string[] = [];
// Every check runs, so a run without the change shows each step it gets wrong.
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
  if (ok) passed += 1;
  else failed.push(name);
};

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
// The orders resting for the account in the market; zero before the first order creates the
// position.
const pendingOrders = async (accountId: bigint) => {
  const found = await client.core
    .getDynamicField({
      parentId: deployment.markets[MARKET]!.clearingHouse,
      name: {
        type: `${deployment.packages.perpetuals}::keys::PositionKey`,
        bcs: PositionKeyBcs.serialize({ account_id: accountId }).toBytes(),
      },
    })
    .catch(() => undefined);
  if (found == null) return 0;
  return Number(PositionBcs.parse(found.dynamicField.value.bcs).pending_orders);
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
// The form's own inputs, as the store holds them.
const inputs = () =>
  page.evaluate(() => {
    const { tradeForm } = (window as any).haneulPerp.supervisor.store.getState();
    return {
      price: (tradeForm.limitPrice ?? '') as string,
      size: (tradeForm.size?.value?.value ?? '') as string,
    };
  });
const tradeForm = page.locator('form:has(footer button[type="submit"])').first();
const submit = page.locator('form footer button[type="submit"]:visible').first();
const textOf = async (scope: any) =>
  ((await scope.count()) ? await scope.innerText() : '').replace(/\s+/g, ' ').trim();
const POST_ONLY = 'Post-only order would match immediately';
const GENERIC = /Something went wrong|Unknown error|unavailable for consumption/;

// 1. A post-only bid above the asks, which the engine refuses.
console.log('\n1 a post-only order the engine refuses');
await fill([
  ['setOrderType', 'LIMIT'],
  ['setSide', 'BUY'],
  ['setLimitPrice', '100500'],
  ['setSizeToken', '0.001'],
  ['setPostOnly', true],
]);
await page.waitForTimeout(1_500);
await submit.click();
// While the order is out the button holds, and the inputs are still there.
let heldWithInputs = false;
let sawHold = '';
for (let i = 0; i < 40 && !heldWithInputs; i += 1) {
  // eslint-disable-next-line no-await-in-loop
  const [disabled, now] = await Promise.all([
    page.evaluate(() => {
      const button = [...document.querySelectorAll('form footer button[type="submit"]')].find(
        (b) => (b as HTMLElement).offsetParent != null
      ) as HTMLButtonElement | undefined;
      return button?.disabled ?? false;
    }),
    inputs(),
  ]);
  if (disabled) sawHold = `button held with price "${now.price}" size "${now.size}"`;
  heldWithInputs = disabled && now.price === '100500' && now.size === '0.001';
  // eslint-disable-next-line no-await-in-loop
  if (!heldWithInputs) await page.waitForTimeout(25);
}
check('the button holds while the order is out, inputs still filled', heldWithInputs, sawHold);
// The notification goes after a while, so it is read in the same wait as the form.
let formText = '';
let toastShown = false;
for (let i = 0; i < 30; i += 1) {
  // eslint-disable-next-line no-await-in-loop
  const [form, toast] = await Promise.all([
    textOf(tradeForm),
    textOf(page.getByRole('region', { name: /Notifications/ })),
  ]);
  formText = form;
  toastShown ||= toast.includes(POST_ONLY);
  if (formText.includes(POST_ONLY) && toastShown) break;
  // eslint-disable-next-line no-await-in-loop
  await page.waitForTimeout(500);
}
const after = await inputs();
await page.screenshot({ path: `${screenshots}-1.png` });
console.log(`  form "${formText.slice(-170)}"`);
console.log(`  inputs after the failure: price "${after.price}" size "${after.size}"`);
check(
  'the failed order keeps its inputs',
  after.price === '100500' && after.size === '0.001',
  `price "${after.price}" size "${after.size}"`
);
check('the form shows the reason above the button', formText.includes(POST_ONLY));
check("the order's notification reports it too", toastShown);
check('the refused order left nothing resting', (await pendingOrders(acct.accountId)) === 0);

// 2. Changing an input makes the reason go.
console.log('\n2 changing the price after the failure');
await page.evaluate(() =>
  (window as any).haneulPerp.supervisor.store.dispatch({
    type: 'TradeForm/setLimitPrice',
    payload: '99000',
  })
);
await page.waitForTimeout(800);
const editedText = await textOf(tradeForm);
check(
  'the reason was shown and goes once the price changes',
  formText.includes(POST_ONLY) && !editedText.includes(POST_ONLY)
);

// 3. A limit bid below the book, submitted twice in the same moment.
console.log('\n3 a resting order submitted twice at once');
await fill([
  ['setOrderType', 'LIMIT'],
  ['setSide', 'BUY'],
  ['setLimitPrice', '99000'],
  ['setSizeToken', '0.001'],
]);
await page.waitForTimeout(1_500);
await page.evaluate(() => {
  const button = [...document.querySelectorAll('form footer button[type="submit"]')].find(
    (b) => (b as HTMLElement).offsetParent != null
  ) as HTMLButtonElement;
  button.click();
  button.click();
});
for (let i = 0; i < 30; i += 1) {
  // eslint-disable-next-line no-await-in-loop
  if ((await pendingOrders(acct.accountId)) > 0) break;
  // eslint-disable-next-line no-await-in-loop
  await page.waitForTimeout(1_000);
}
// Time for a second order, if one went, to land or fail.
await page.waitForTimeout(8_000);
const resting = await pendingOrders(acct.accountId);
const cleared = await inputs();
const afterDouble = `${await textOf(tradeForm)} ${await textOf(
  page.getByRole('region', { name: /Notifications/ })
)}`;
await page.screenshot({ path: `${screenshots}-3.png` });
console.log(`  orders resting ${resting}; inputs price "${cleared.price}" size "${cleared.size}"`);
check('one order rests', resting === 1, `${resting}`);
check('no second order failed beside it', !GENERIC.test(afterDouble));
check(
  'the order that went clears the form',
  cleared.price === '' && cleared.size === '',
  `price "${cleared.price}" size "${cleared.size}"`
);

await supervisor('cancelAllOrders', { marketId: MARKET });
await supervisor('closeAllPositions');
await page.waitForTimeout(5_000);

await browser.close();
console.log(`  screenshots ${screenshots}-{1,3}.png`);
console.log(`\n${passed} checks passed, ${failed.length} failed`);
if (failed.length > 0) process.exit(1);

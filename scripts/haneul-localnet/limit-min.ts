/* eslint-disable no-console */

/**
 * The smallest limit order through the trade form, against a running localnet. A trader with 20
 * TUSD in the account rests 0.001 BTC (the lot size) at the default leverage: the engine asks
 * about $10 of margin for it and has no minimum margin of its own, so the form must not hold the
 * order back with dYdX's $20 isolated-margin minimum. The form is filled through its redux
 * actions, read from the page (alerts and the place-order button) and submitted by pressing the
 * button; the order is read back from chain. Requires the fixture (`fixture.mjs setup` + `push`),
 * the indexer and API, and `pnpm dev`.
 *
 *   PLAYWRIGHT=/path/to/node_modules/playwright pnpm exec tsx scripts/haneul-localnet/limit-min.ts
 */
import { HaneulGrpcClient } from '@haneullabs/haneul/grpc';
import { Ed25519Keypair } from '@haneullabs/haneul/keypairs/ed25519';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import {
  findPerpAccount,
  readAccount,
  readPosition,
  type PerpDeployment,
} from '../../src/haneul/perp';

const require = createRequire(import.meta.url);
// eslint-disable-next-line import/no-dynamic-require -- resolved from an external checkout
const { chromium } = require(process.env.PLAYWRIGHT ?? 'playwright');

const ROOT = join(import.meta.dirname, '..', '..');
const url = process.env.APP_URL ?? 'http://localhost:5173/#/trade/BTC-USD';
const screenshot = process.env.SCREENSHOT ?? join(ROOT, '.localnet', 'limit-min.png');
const MARKET = 'BTC-USD';
const deployment: PerpDeployment = JSON.parse(
  readFileSync(join(ROOT, 'public/configs/haneul/perp.localnet.json'), 'utf8')
);
const client = new HaneulGrpcClient({ network: 'localnet', baseUrl: 'http://127.0.0.1:9000' });

const ONE = 10n ** 18n;
const UNIT = 10n ** 6n; // TUSD
const PER_UNIT = 10n ** 12n; // ifixed collateral per TUSD unit
// Wording of dYdX's "isolated margin orders require at least $20 of collateral" alert.
const DYDX_MINIMUM = 'minimum collateral requirement';

let passed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) throw new Error(`FAIL ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}${detail ? ` (${detail})` : ''}`);
};
const tusd = (units: bigint) => `${Number(units) / 1e6}`;

// A trader with gas and 1,000 TUSD in the wallet, of which only 20 goes into the account.
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
  if (!e.message.includes('qs_')) console.log('  page error:', e.message);
});
await page.addInitScript((key: string) => {
  window.localStorage.setItem('haneul:dev-wallet:secret', key);
}, fresh.getSecretKey());
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.waitForFunction(() => (window as any).haneulPerp != null, null, { timeout: 60_000 });
const connected = await page.evaluate(async () => {
  const { dAppKit } = (window as any).haneulPerp;
  const wallet = dAppKit.stores.$wallets.get().find((w: any) => w.name === 'Haneul Dev Wallet');
  const result = await dAppKit.connectWallet({ wallet });
  return result.accounts[0]?.address ?? null;
});
check('fresh wallet connected', connected === me, connected);
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
const ok = (r: any) => r.type === 'success';

// 0. account with 20 TUSD
const r = await supervisor('depositCollateral', 20);
check('deposit opens the account with 20', ok(r), JSON.stringify(r).slice(0, 120));
const acct = await findPerpAccount(client, deployment, me);
if (!acct) throw new Error('no account');
const chain = async () => {
  const [account, position] = await Promise.all([
    readAccount(client, acct.account),
    readPosition(client, deployment, MARKET, acct.accountId),
  ]);
  return {
    balance: account.collateral,
    base: position?.base ?? 0n,
    collateral: position?.collateral ?? 0n,
    imr: position?.initialMarginRatio ?? 0n,
    pending: position?.pendingOrders ?? 0n,
  };
};
const describe = (s: Awaited<ReturnType<typeof chain>>) =>
  `balance ${tusd(s.balance)}, market collateral ${
    Number(s.collateral / PER_UNIT) / 1e6
  }, resting ${s.pending}, imr ${Number(s.imr) / 1e18}`;
const before = await chain();
check('account balance 20 on chain', before.balance === 20n * UNIT, describe(before));

// The form reads free collateral from the indexer; wait until the app has the deposit.
await page.waitForFunction(
  () => {
    const { haneulPerp } = window as any;
    const summary = haneulPerp.BonsaiCore.account.parentSubaccountSummary.data(
      haneulPerp.supervisor.store.getState()
    );
    return summary != null && Math.abs(summary.freeCollateral.toNumber() - 20) < 1e-6;
  },
  null,
  { timeout: 60_000 }
);
check('the app shows 20 of free collateral', true);

const fill = (actions: Array<[string, unknown]>) =>
  page.evaluate((list: Array<[string, unknown]>) => {
    const { store } = (window as any).haneulPerp.supervisor;
    store.dispatch({ type: 'TradeForm/resetPrimaryInputs' });
    list.forEach(([type, payload]) => store.dispatch({ type: `TradeForm/${type}`, payload }));
  }, actions);
// What the trader sees: the visible place-order button and any alert in its form.
const form = async () => {
  await page.waitForTimeout(1_500);
  return page.evaluate(() => {
    const buttons = [...document.querySelectorAll('form button[type="submit"]')].filter(
      (b) => (b as HTMLElement).offsetParent != null
    ) as HTMLButtonElement[];
    const button = buttons[0];
    const { type, side, size, limitPrice } = (window as any).haneulPerp.supervisor.store.getState()
      .tradeForm;
    return {
      buttons: buttons.length,
      label: button?.innerText.trim() ?? '',
      disabled: button?.disabled ?? true,
      text: (button?.closest('form') as HTMLElement | null)?.innerText ?? '',
      state: JSON.stringify({ type, side, size, limitPrice }),
    };
  });
};
const shown = (f: Awaited<ReturnType<typeof form>>) =>
  `button "${f.label}"${f.disabled ? ' disabled' : ''}; form ${f.state}`;

// The form resets itself when it mounts, so it is filled only once its button is on the page.
await page.locator('form button[type="submit"]:visible').waitFor({ timeout: 60_000 });

// 1. a market order of the same size was never held back
await fill([
  ['setOrderType', 'MARKET'],
  ['setSide', 'BUY'],
  ['setSizeToken', '0.001'],
]);
let f = await form();
check('one place-order button on the page', f.buttons === 1, `${f.buttons}`);
check(
  'market 0.001 BTC: no minimum alert, button enabled',
  !f.text.includes(DYDX_MINIMUM) && !f.disabled,
  shown(f)
);

// 2. a limit order beyond the balance is still refused by the margin check
await fill([
  ['setOrderType', 'LIMIT'],
  ['setSide', 'BUY'],
  ['setLimitPrice', '99000'],
  ['setSizeToken', '0.01'],
]);
f = await form();
check(
  'limit 0.01 BTC (about $100 of margin): refused for margin, not for a minimum',
  f.disabled && !f.text.includes(DYDX_MINIMUM),
  shown(f)
);

// 3. the smallest limit order: about $10 of margin out of 20
await fill([
  ['setOrderType', 'LIMIT'],
  ['setSide', 'BUY'],
  ['setLimitPrice', '99000'],
  ['setSizeToken', '0.001'],
]);
f = await form();
await page.screenshot({ path: screenshot });
console.log(`  screenshot ${screenshot}`);
check('limit 0.001 BTC: no $20 minimum alert', !f.text.includes(DYDX_MINIMUM), shown(f));
check('limit 0.001 BTC: place-order button enabled', !f.disabled, shown(f));

await page.locator('form button[type="submit"]:visible').click();
let rested = before;
for (let i = 0; i < 60 && rested.pending === 0n; i += 1) {
  await page.waitForTimeout(1_000);
  rested = await chain();
}
check(
  'the order rests on chain with no fill',
  rested.pending === 1n && rested.base === 0n,
  describe(rested)
);
check(
  'its margin came out of the 20 and the position trades at 10x',
  rested.balance < before.balance && rested.collateral > 0n && rested.imr === ONE / 10n,
  describe(rested)
);
const orderId: string = await page
  .waitForFunction(
    (m: string) => {
      const { haneulPerp } = window as any;
      const orders =
        haneulPerp.BonsaiCore.account.openOrders.data(haneulPerp.supervisor.store.getState()) ?? [];
      const order = orders.find(
        (o: any) => o.marketId === m && o.size.toNumber() === 0.001 && o.price.toNumber() === 99_000
      );
      return order?.id;
    },
    MARKET,
    { timeout: 60_000 }
  )
  .then((h: any) => h.jsonValue());
check('the app lists the resting 0.001 @ 99,000 bid', orderId.length > 0, orderId);

const cancel = await supervisor('cancelOrder', { orderId, withNotification: false });
const after = await chain();
check(
  'canceled; nothing rests',
  ok(cancel) && after.pending === 0n && after.base === 0n,
  describe(after)
);

await browser.close();
console.log(`\n${passed} checks passed`);

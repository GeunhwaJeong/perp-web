/* eslint-disable no-console */

/**
 * A first-time trader through the trade form, against a running localnet. With TUSD in the wallet
 * but no trading account, the order button offers a deposit instead of checking an order the
 * engine could not take, and the deposit dialog it opens funds the account. With 20 TUSD there,
 * the trader rests 0.001 BTC (the lot size) at the default leverage: the engine asks about $10 of
 * margin for it and has no minimum margin of its own, so the form must not hold the order back
 * with dYdX's $20 isolated-margin minimum. With the market's fee rates served by the API, the
 * receipt prices market and limit orders from them and the form does not warn that the account's
 * fee rates are unknown (dYdX loads those from its validator, which Haneul does not have). On
 * laptop-height windows, where the order footer is sticky, an alert holding the order back shows
 * in full next to the button, with nothing in the footer over it. The form is filled
 * through its redux actions, read from the page (alerts and the order button) and driven by
 * pressing its buttons; the account and the order are read back from chain. Requires the fixture
 * (`fixture.mjs setup` + `push`), the indexer and API (perp-indexer fea64d4 or later), and
 * `pnpm dev`.
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
const screenshots = process.env.SCREENSHOTS ?? join(ROOT, '.localnet', 'limit-min');
const MARKET = 'BTC-USD';
const deployment: PerpDeployment = JSON.parse(
  readFileSync(join(ROOT, 'public/configs/haneul/perp.localnet.json'), 'utf8')
);
const client = new HaneulGrpcClient({ network: 'localnet', baseUrl: 'http://127.0.0.1:9000' });

const ONE = 10n ** 18n;
const UNIT = 10n ** 6n; // TUSD
const PER_UNIT = 10n ** 12n; // ifixed collateral per TUSD unit
// Wording of the form alerts this suite looks for.
const ALERTS = {
  // dYdX's "isolated margin orders require at least $20 of collateral"
  dydxMinimum: 'minimum collateral requirement',
  feeUnknown: 'fee rates may have changed',
  belowLotSize: 'below the minimum order size',
  marginUsage: 'margin usage',
};
const alertsIn = (text: string) =>
  Object.entries(ALERTS)
    .filter(([, wording]) => text.includes(wording))
    .map(([name]) => name);

let passed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) throw new Error(`FAIL ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}${detail ? ` (${detail})` : ''}`);
};
const tusd = (units: bigint) => `${Number(units) / 1e6}`;

// A trader with gas and 1,000 TUSD in the wallet and no trading account; 20 goes in.
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

const fill = (actions: Array<[string, unknown]>) =>
  page.evaluate((list: Array<[string, unknown]>) => {
    const { store } = (window as any).haneulPerp.supervisor;
    store.dispatch({ type: 'TradeForm/resetPrimaryInputs' });
    list.forEach(([type, payload]) => store.dispatch({ type: `TradeForm/${type}`, payload }));
  }, actions);
const limitBuy = (size: string): Array<[string, unknown]> => [
  ['setOrderType', 'LIMIT'],
  ['setSide', 'BUY'],
  ['setLimitPrice', '99000'],
  ['setSizeToken', size],
];
// What the trader sees: the order form's button (the order, or the deposit standing in for it)
// and any alert in the form.
const form = async () => {
  await page.waitForTimeout(1_500);
  return page.evaluate(() => {
    const footers = [...document.querySelectorAll('form footer')].filter(
      (e) => (e as HTMLElement).offsetParent != null
    );
    const buttons = [...(footers[0]?.querySelectorAll('button') ?? [])] as HTMLButtonElement[];
    const button =
      buttons.find((b) => b.type === 'submit') ?? buttons.find((b) => /deposit/i.test(b.innerText));
    const { type, side, size, limitPrice } = (window as any).haneulPerp.supervisor.store.getState()
      .tradeForm;
    return {
      forms: footers.length,
      label: button?.innerText.trim() ?? '',
      disabled: button?.disabled ?? true,
      text: (footers[0]?.closest('form') as HTMLElement | null)?.innerText ?? '',
      state: JSON.stringify({ type, side, size, limitPrice }),
    };
  });
};
const shown = (f: Awaited<ReturnType<typeof form>>) =>
  `button "${f.label}"${f.disabled ? ' disabled' : ''}; alerts [${alertsIn(f.text)}]; form ${
    f.state
  }`;

// The form resets itself when it mounts, so it is filled only once it is on the page.
await page.locator('form footer').first().waitFor({ timeout: 60_000 });

// 0. no trading account: the button offers a deposit instead of an order the engine cannot take
const empty = await page
  .waitForFunction(
    () => {
      const { haneulPerp } = window as any;
      const summary = haneulPerp.BonsaiCore.account.parentSubaccountSummary.data(
        haneulPerp.supervisor.store.getState()
      );
      return summary == null ? null : { equity: summary.equity.toNumber() };
    },
    null,
    { timeout: 30_000 }
  )
  .then((h: any) => h.jsonValue())
  .catch(() => null);
check('without an account the app reads an empty one', empty?.equity === 0, JSON.stringify(empty));

await fill(limitBuy('0.001'));
let f = await form();
await page.screenshot({ path: `${screenshots}-no-account.png` });
console.log(`  screenshot ${screenshots}-no-account.png`);
check('one order form on the page', f.forms === 1, `${f.forms}`);
check(
  'no account, limit 0.001 BTC: the button offers a deposit, with no alert',
  /deposit/i.test(f.label) && !f.disabled && alertsIn(f.text).length === 0,
  shown(f)
);
await fill([...limitBuy(''), ['setSizeAvailablePercent', '0.10']]);
f = await form();
check(
  'no account, 10% of the balance: still the deposit, no minimum-size alert',
  /deposit/i.test(f.label) && alertsIn(f.text).length === 0,
  shown(f)
);

// The deposit button opens the deposit dialog, and 20 TUSD through it opens the account.
await page.locator('form footer button', { hasText: /deposit/i }).click();
const dialog = page.getByRole('dialog');
await dialog.waitFor({ timeout: 15_000 });
await page.waitForFunction(
  () => document.querySelector('[role="dialog"]')?.textContent?.includes('1,000') === true,
  null,
  { timeout: 15_000 }
);
check('the deposit button opens the deposit dialog with the wallet balance', true);
await dialog.locator('input').first().fill('20');
await dialog.locator('button[type="submit"]').click();
await dialog.waitFor({ state: 'detached', timeout: 60_000 });
const acct = await findPerpAccount(client, deployment, me);
if (!acct) throw new Error('no account after the deposit');
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
check(
  'the deposit opened the account with 20 on chain',
  before.balance === 20n * UNIT,
  describe(before)
);

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

// 1. a market order of the same size was never held back
await fill([
  ['setOrderType', 'MARKET'],
  ['setSide', 'BUY'],
  ['setSizeToken', '0.001'],
]);
f = await form();
const marketOrder = f;
await page.screenshot({ path: `${screenshots}-market.png` });
console.log(`  screenshot ${screenshots}-market.png`);
check(
  'market 0.001 BTC: an order again, no minimum alert, button enabled',
  /place/i.test(f.label) && !f.text.includes(ALERTS.dydxMinimum) && !f.disabled,
  shown(f)
);
// 0.001 BTC from the best ask (100,010) at the 5 bp taker rate
check(
  'the receipt prices the market order at the market taker rate',
  /Fee\s+\$0\.05\b/.test(f.text),
  f.text.match(/Fee\s+\S+/)?.[0] ?? 'no fee row'
);

// 2. a limit order beyond the balance is still refused by the margin check
await fill(limitBuy('0.01'));
f = await form();
check(
  'limit 0.01 BTC (about $100 of margin): refused for margin, not for a minimum',
  f.disabled && !f.text.includes(ALERTS.dydxMinimum),
  shown(f)
);

// On laptop-height windows the order footer is sticky and the inputs scroll beneath it; the
// alert saying why the button is held back must stay in sight, with nothing in the footer over it.
const alertLayout = (wording: string) =>
  page.evaluate((w: string) => {
    const footer = [...document.querySelectorAll('form footer')].find(
      (e) => (e as HTMLElement).offsetParent != null
    );
    const holders = [...document.querySelectorAll('form *')].filter((e) =>
      e.textContent?.includes(w)
    );
    const text = holders.find((e) => ![...e.children].some((c) => c.textContent?.includes(w)));
    if (footer == null || text == null) return { found: false, inWindow: false, covers: [] };
    const box = text.getBoundingClientRect();
    const y = box.top + box.height / 2;
    const covers = [box.left + 4, box.left + box.width / 2, box.right - 4]
      .map((x) => document.elementFromPoint(x, y))
      .filter((hit) => hit == null || !(hit === text || text.contains(hit) || hit.contains(text)))
      .map((hit) =>
        hit == null
          ? 'nothing'
          : `${hit.tagName.toLowerCase()} "${(hit as HTMLElement).innerText.slice(0, 20)}"`
      );
    return {
      found: true,
      inWindow: box.top >= 0 && box.bottom <= window.innerHeight,
      covers,
      footerBackground: getComputedStyle(footer).backgroundColor,
    };
  }, wording);
for (const [width, height] of [
  [1728, 875],
  [1549, 784],
]) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(1_500);
  const layout = await alertLayout(ALERTS.marginUsage);
  await page.screenshot({ path: `${screenshots}-alert-${width}x${height}.png` });
  console.log(`  screenshot ${screenshots}-alert-${width}x${height}.png`);
  check(
    `${width}x${height}: the margin alert shows in full, with nothing over it`,
    layout.found && layout.inWindow && layout.covers.length === 0,
    JSON.stringify(layout)
  );
  check(
    `${width}x${height}: the footer is opaque`,
    layout.footerBackground !== 'rgba(0, 0, 0, 0)',
    layout.footerBackground
  );
}
await page.setViewportSize({ width: 1440, height: 1100 });

// 3. the smallest limit order: about $10 of margin out of 20
await fill(limitBuy('0.001'));
f = await form();
await page.screenshot({ path: `${screenshots}-order.png` });
console.log(`  screenshot ${screenshots}-order.png`);
check('limit 0.001 BTC: no $20 minimum alert', !f.text.includes(ALERTS.dydxMinimum), shown(f));
check('limit 0.001 BTC: place-order button enabled', !f.disabled, shown(f));
const emptyAlertSpace = await page.evaluate(() => {
  const footer = [...document.querySelectorAll('form footer')].find(
    (e) => (e as HTMLElement).offsetParent != null
  );
  return [...(footer?.children ?? [])].filter(
    (c) => c.getBoundingClientRect().height > 0 && c.querySelector('button') == null
  ).length;
});
check(
  'limit 0.001 BTC: with no alert the footer keeps no room for one',
  emptyAlertSpace === 0,
  `${emptyAlertSpace}`
);
check(
  'no fee-rate warning on the market or the limit order',
  !marketOrder.text.includes(ALERTS.feeUnknown) && !f.text.includes(ALERTS.feeUnknown),
  shown(f)
);
// 0.001 BTC at 99,000 and the 2 bp maker rate of a resting order
check(
  'the receipt prices the limit order at the market rate',
  /Fee\s+\$0\.02\b/.test(f.text),
  f.text.match(/Fee\s+\S+/)?.[0] ?? 'no fee row'
);

await page.locator('form footer button[type="submit"]:visible').click();
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

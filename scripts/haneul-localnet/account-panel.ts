/* eslint-disable no-console */

/**
 * The account panel beside the order form, the header and the portfolio page, for a trader
 * whose position sits isolated in its market's subaccount, against a running localnet. With 20
 * TUSD in and 0.001 BTC open, the panel shows the position's unrealized P&L and funding and, as
 * margin used, the share of the portfolio the account balance cannot spend; the portfolio page
 * shows the same usage and the account's leverage. The header's Deposit opens the deposit
 * dialog, and the panel keeps its own deposit and withdraw buttons. Expected values come from
 * chain (the balance) and the API (equity, P&L, mark price), not from the app's own summary.
 * Requires the fixture (`fixture.mjs setup` + `push`), the indexer and API, and `pnpm dev`.
 *
 *   PLAYWRIGHT=/path/to/node_modules/playwright pnpm exec tsx scripts/haneul-localnet/account-panel.ts
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
const api = process.env.API_URL ?? 'http://127.0.0.1:3002';
const screenshots = process.env.SCREENSHOTS ?? join(ROOT, '.localnet', 'account-panel');
const MARKET = 'BTC-USD';
const deployment: PerpDeployment = JSON.parse(
  readFileSync(join(ROOT, 'public/configs/haneul/perp.localnet.json'), 'utf8')
);
const client = new HaneulGrpcClient({ network: 'localnet', baseUrl: 'http://127.0.0.1:9000' });

let passed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) throw new Error(`FAIL ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}${detail ? ` (${detail})` : ''}`);
};
// "$1,234.56", "−$0.01" (a minus sign, U+2212), "42.20%", "4.12×" as numbers
const amount = (shown: string | undefined) =>
  shown != null && /\d/.test(shown)
    ? Number(shown.replace('−', '-').replace(/[^0-9.-]/g, ''))
    : NaN;

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
  if (!e.message.includes('qs_')) console.log('  page error:', e.message);
});
await page.addInitScript((key: string) => {
  window.localStorage.setItem('haneul:dev-wallet:secret', key);
}, fresh.getSecretKey());
const openPage = async (at: string) => {
  await page.goto(at, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForFunction(() => (window as any).haneulPerp != null, null, { timeout: 60_000 });
  const address = await page.evaluate(async () => {
    const { dAppKit } = (window as any).haneulPerp;
    const wallet = dAppKit.stores.$wallets.get().find((w: any) => w.name === 'Haneul Dev Wallet');
    const result = await dAppKit.connectWallet({ wallet });
    return result.accounts[0]?.address ?? null;
  });
  await page.waitForFunction(
    () =>
      (window as any).haneulPerp?.supervisor.store.getState().wallet.sourceAccount?.address != null,
    null,
    { timeout: 15_000 }
  );
  return address;
};
const connected = await openPage(url);
check('fresh wallet connected', connected === me, connected);

const supervisor = (method: string, ...args: unknown[]) =>
  page.evaluate(
    async ({ m, a }: { m: string; a: unknown[] }) => {
      const r = await (window as any).haneulPerp.supervisor[m](...a);
      return JSON.parse(JSON.stringify(r));
    },
    { m: method, a: args }
  );
const appSummary = () =>
  page.evaluate(() => {
    const { haneulPerp } = window as any;
    const s = haneulPerp.BonsaiCore.account.parentSubaccountSummary.data(
      haneulPerp.supervisor.store.getState()
    );
    return s == null ? null : { equity: s.equity.toNumber(), free: s.freeCollateral.toNumber() };
  });

// What the panel shows, label by label, and the buttons beneath it.
const panel = () =>
  page.evaluate(() => {
    const label = [...document.querySelectorAll('*')].find(
      (e) =>
        e instanceof HTMLElement &&
        e.childElementCount === 0 &&
        e.innerText.trim() === 'Margin Used'
    ) as HTMLElement | undefined;
    let box: HTMLElement | null = label ?? null;
    while (box != null && !box.innerText.includes('Portfolio Value')) box = box.parentElement;
    const lines = (box?.innerText ?? '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    // No named functions in here: tsx would wrap them in a helper the page does not have.
    const labels = [
      'Portfolio Value',
      'Available Balance',
      'Unrealized P&L',
      'Unrealized Funding',
      'Margin Used',
    ];
    // An item with no value is followed straight by the next label; a sign shows on a line of
    // its own before the amount.
    const shown = Object.fromEntries(
      labels.map((name) => {
        const i = lines.indexOf(name);
        const next = i < 0 ? undefined : lines[i + 1];
        if (next == null || labels.includes(next)) return [name, undefined];
        return [name, /^[-+−]$/.test(next) ? `${next}${lines[i + 2]}` : next];
      })
    );
    let container: HTMLElement | null = box;
    let buttons: HTMLButtonElement[] = [];
    for (let i = 0; i < 4 && container != null; i += 1) {
      if (container.innerText.includes('Buy | Long')) break;
      buttons = [...container.querySelectorAll('button')] as HTMLButtonElement[];
      if (buttons.some((b) => b.innerText.trim() === 'Deposit')) break;
      container = container.parentElement;
    }
    return {
      portfolio: shown['Portfolio Value'],
      available: shown['Available Balance'],
      pnl: shown['Unrealized P&L'],
      funding: shown['Unrealized Funding'],
      marginUsed: shown['Margin Used'],
      deposit: buttons.some((b) => b.innerText.trim() === 'Deposit'),
      iconButtons: buttons.filter((b) => b.innerText.trim() === '' && b.querySelector('svg'))
        .length,
    };
  });
// Order and transfer notifications sit over the panel, in the toast area (an `aside`); it is
// hidden for the screenshots only.
const hideNotifications = () =>
  page.evaluate(() => {
    document.querySelectorAll('aside').forEach((e) => {
      const el = e as HTMLElement;
      if (/Submitting|Filled|Transfer In/.test(el.innerText)) el.style.display = 'none';
    });
  });
const headerDeposit = page.locator('header button', { hasText: /^\s*Deposit\s*$/ });

// 20 TUSD in and 0.001 BTC bought through the app's own write path.
await page.locator('form footer').first().waitFor({ timeout: 60_000 });
const deposited = await supervisor('depositCollateral', 20);
check('20 TUSD deposited', deposited.type === 'success', JSON.stringify(deposited).slice(0, 200));
await page.waitForFunction(
  () => {
    const { haneulPerp } = window as any;
    const s = haneulPerp.BonsaiCore.account.parentSubaccountSummary.data(
      haneulPerp.supervisor.store.getState()
    );
    return s != null && Math.abs(s.freeCollateral.toNumber() - 20) < 1e-6;
  },
  null,
  { timeout: 60_000 }
);
await page.waitForTimeout(1_500);
const flat = await panel();
const headerEnabled = (await headerDeposit.count()) === 1 && !(await headerDeposit.isDisabled());

const bought = await supervisor(
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
check('0.001 BTC bought', bought.type === 'success', JSON.stringify(bought).slice(0, 200));
const acct = await findPerpAccount(client, deployment, me);
if (!acct) throw new Error('no account after the deposit');
await page.waitForFunction(
  (m: string) =>
    (
      (window as any).haneulPerp.BonsaiCore.account.parentSubaccountPositions.data(
        (window as any).haneulPerp.supervisor.store.getState()
      ) ?? []
    ).some((p: any) => p.market === m && Math.abs(p.unsignedSize.toNumber() - 0.001) < 1e-9),
  MARKET,
  { timeout: 60_000 }
);
await page.waitForTimeout(3_000);
const open = await panel();
await hideNotifications();
await page.screenshot({ path: `${screenshots}-position.png` });
console.log(`  screenshot ${screenshots}-position.png`);

// What the panel should show: the balance from chain, equity, P&L and the mark from the API.
const [account, position] = await Promise.all([
  readAccount(client, acct.account),
  readPosition(client, deployment, MARKET, acct.accountId),
]);
const balance = Number(account.collateral) / 1e6;
const indexed = await fetch(`${api}/v4/addresses/${me}/parentSubaccountNumber/0`).then((r) =>
  r.json()
);
const children = (indexed.subaccount ?? indexed).childSubaccounts as any[];
const equity = Number((indexed.subaccount ?? indexed).equity);
const pnl = children
  .flatMap((c) => Object.values(c.openPerpetualPositions ?? {}) as any[])
  .reduce((sum, p) => sum + Number(p.unrealizedPnl), 0);
const mark = Number(
  (await fetch(`${api}/v4/perpetualMarkets`).then((r) => r.json())).markets[MARKET].markPrice
);
const usage = 1 - balance / equity;
const leverage = (0.001 * mark) / equity;
const app = await appSummary();
console.log(
  `  chain balance ${balance}, market collateral ${
    Number((position?.collateral ?? 0n) / 10n ** 12n) / 1e6
  }; API equity ${equity}, P&L ${pnl}, mark ${mark}; app ${JSON.stringify(app)}`
);
console.log(`  panel flat ${JSON.stringify(flat)}`);
console.log(`  panel open ${JSON.stringify(open)}`);

// 1. the header's Deposit works for a connected account
check('the header Deposit is enabled', headerEnabled);
await headerDeposit.click();
const dialog = page.getByRole('dialog');
await dialog.waitFor({ timeout: 15_000 });
// the wallet's 980 TUSD left after the deposit, once the dialog has read it
const opened = await page
  .waitForFunction(
    () => document.querySelector('[role="dialog"]')?.textContent.includes('980') === true,
    null,
    { timeout: 15_000 }
  )
  .then(() => true)
  .catch(() => false);
check(
  'it opens the deposit dialog with the wallet balance',
  opened,
  ((await dialog.textContent()) ?? '').slice(0, 120)
);
await page.keyboard.press('Escape');
await dialog.waitFor({ state: 'detached', timeout: 15_000 });

// 2. with nothing open: buttons, no P&L, nothing in use
check(
  'the panel keeps its deposit and withdraw buttons',
  flat.deposit && flat.iconButtons >= 1,
  JSON.stringify(flat)
);
check(
  'with no position: P&L and funding $0.00, margin used 0.00%',
  flat.pnl === '$0.00' && flat.funding === '$0.00' && flat.marginUsed === '0.00%',
  JSON.stringify(flat)
);

// 3. with 0.001 BTC open
check(
  'with the position open the panel shows its unrealized P&L',
  /\$/.test(open.pnl ?? '') && Math.abs(amount(open.pnl) - pnl) <= 0.011,
  `${open.pnl} vs ${pnl.toFixed(4)}`
);
check('and its unrealized funding', /\$/.test(open.funding ?? ''), open.funding ?? 'none');
check(
  'margin used is the share of the portfolio the balance cannot spend',
  Math.abs(amount(open.marginUsed) / 100 - usage) <= 0.005 && usage > 0.3,
  `${open.marginUsed} vs ${(usage * 100).toFixed(2)}%`
);
check(
  'available balance is the balance on chain',
  Math.abs(amount(open.available) - balance) <= 0.006,
  `${open.available} vs ${balance}`
);

// 4. the portfolio page shows the same usage and the account's leverage
// Opened afresh: under the dev server, leaving the trade page from inside the app stalls on the
// chart's teardown ("doWhenApiIsReady" of null), which the production build does not.
await openPage(new URL('/portfolio', url).toString());
await page.waitForFunction(
  () => {
    const { haneulPerp } = window as any;
    const s = haneulPerp.BonsaiCore.account.parentSubaccountSummary.data(
      haneulPerp.supervisor.store.getState()
    );
    return s?.accountLeverage != null && s.accountLeverage.toNumber() > 0;
  },
  null,
  { timeout: 60_000 }
);
const reached = await page
  .waitForFunction(
    () =>
      [...document.querySelectorAll('*')].some(
        (e) =>
          e instanceof HTMLElement &&
          e.childElementCount === 0 &&
          e.innerText.trim() === 'Margin Usage' &&
          e.offsetParent != null
      ),
    null,
    { timeout: 120_000 }
  )
  .then(() => true)
  .catch(() => false);
if (!reached) {
  await page.screenshot({ path: `${screenshots}-portfolio.png` });
  throw new Error(`the portfolio page did not show Margin Usage (${page.url()})`);
}
await page.waitForTimeout(2_000);
const portfolio = await page.evaluate(() => {
  const [shownUsage, shownLeverage] = ['Margin Usage', 'Leverage'].map((name) => {
    const label = [...document.querySelectorAll('*')].find(
      (e) => e instanceof HTMLElement && e.childElementCount === 0 && e.innerText.trim() === name
    ) as HTMLElement | undefined;
    const lines = (label?.parentElement?.parentElement?.innerText ?? '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    return lines[lines.indexOf(name) + 1];
  });
  return { usage: shownUsage, leverage: shownLeverage };
});
await hideNotifications();
await page.screenshot({ path: `${screenshots}-portfolio.png` });
console.log(`  screenshot ${screenshots}-portfolio.png`);
check(
  'the portfolio page shows the same margin usage',
  Math.abs(amount(portfolio.usage) / 100 - usage) <= 0.005,
  `${portfolio.usage} vs ${(usage * 100).toFixed(2)}%`
);
check(
  "and the account's leverage",
  Math.abs(amount(portfolio.leverage) - leverage) <= 0.02 && leverage > 1,
  `${portfolio.leverage} vs ${leverage.toFixed(3)}x`
);

await browser.close();
console.log(`\n${passed} checks passed`);

/* eslint-disable no-console */

/**
 * The isolated-margin dialog and the close-position panel, against a running localnet. With 0.001
 * BTC open, the margin dialog names its account lines as the account panel does (available
 * balance and margin used, no cross margin, which the engine does not have) with the same margin
 * used, and putting margin in moves the estimated liquidation price down instead of repeating the
 * indexer's current one (a 10x position has almost nothing to take out). Closing the position
 * through the close panel's market order then closes the panel, although the indexer lists that
 * order without its client id. Requires the fixture
 * (`fixture.mjs setup` + `push`), the indexer and API, and `pnpm dev`.
 *
 *   PLAYWRIGHT=/path/to/node_modules/playwright pnpm exec tsx scripts/haneul-localnet/margin-close.ts
 */
import { HaneulGrpcClient } from '@haneullabs/haneul/grpc';
import { Ed25519Keypair } from '@haneullabs/haneul/keypairs/ed25519';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { findPerpAccount, readPosition, type PerpDeployment } from '../../src/haneul/perp';

const require = createRequire(import.meta.url);
// eslint-disable-next-line import/no-dynamic-require -- resolved from an external checkout
const { chromium } = require(process.env.PLAYWRIGHT ?? 'playwright');

const ROOT = join(import.meta.dirname, '..', '..');
const url = process.env.APP_URL ?? 'http://localhost:5173/#/trade/BTC-USD';
const screenshots = process.env.SCREENSHOTS ?? join(ROOT, '.localnet', 'margin-close');
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
// "$94,737", "50.15%" as numbers
const amount = (shown: string | undefined) =>
  shown != null && /\d/.test(shown) ? Number(shown.replace(/[^0-9.-]/g, '')) : NaN;

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
const supervisor = (method: string, ...args: unknown[]) =>
  page.evaluate(
    async ({ m, a }: { m: string; a: unknown[] }) => {
      const r = await (window as any).haneulPerp.supervisor[m](...a);
      return JSON.parse(JSON.stringify(r));
    },
    { m: method, a: args }
  );
// Order notifications sit over the page's right side; hidden for the screenshots only.
const hideNotifications = () =>
  page.evaluate(() => {
    document.querySelectorAll('aside').forEach((e) => {
      const el = e as HTMLElement;
      if (/Submitting|Filled|Transfer In/.test(el.innerText)) el.style.display = 'none';
    });
  });
const hasPositionInApp = (want: boolean) =>
  page.waitForFunction(
    ({ m, w }: { m: string; w: boolean }) =>
      (
        (window as any).haneulPerp.BonsaiCore.account.parentSubaccountPositions.data(
          (window as any).haneulPerp.supervisor.store.getState()
        ) ?? []
      ).some((p: any) => p.market === m) === w,
    { m: MARKET, w: want },
    { timeout: 60_000 }
  );
// Marks a button of the position's row: the one in the named column, or the close toggle.
const markRowButton = (column: string | null, mark: string) =>
  page.evaluate(
    ({ c, k }: { c: string | null; k: string }) => {
      const table = [...document.querySelectorAll('table')].find((t) =>
        [...t.querySelectorAll('th')].some((h) => (h as HTMLElement).innerText.trim() === 'Margin')
      );
      const row = table?.querySelector('tbody tr');
      const headers = [...(table?.querySelectorAll('th') ?? [])].map((h) =>
        (h as HTMLElement).innerText.trim()
      );
      const button =
        c == null
          ? row?.querySelector('button[aria-pressed]')
          : row?.querySelectorAll('td')[headers.indexOf(c)]?.querySelector('button');
      button?.setAttribute('data-check', k);
      return button != null;
    },
    { c: column, k: mark }
  );
const panelMarginUsed = () =>
  page.evaluate(() => {
    const label = [...document.querySelectorAll('*')].find(
      (e) =>
        e instanceof HTMLElement &&
        e.childElementCount === 0 &&
        e.innerText.trim() === 'Margin Used'
    );
    let box = label?.parentElement ?? null;
    while (box != null && !box.innerText.includes('Portfolio Value')) box = box.parentElement;
    const lines = (box?.innerText ?? '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    return lines[lines.indexOf('Margin Used') + 1];
  });

await page.locator('form footer').first().waitFor({ timeout: 60_000 });

// 20 TUSD in and 0.001 BTC bought through the app's own write path.
const deposited = await supervisor('depositCollateral', 20);
check('20 TUSD deposited', deposited.type === 'success', JSON.stringify(deposited).slice(0, 160));
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
check('0.001 BTC bought', bought.type === 'success', JSON.stringify(bought).slice(0, 160));
const acct = await findPerpAccount(client, deployment, me);
if (!acct) throw new Error('no account after the deposit');
await hasPositionInApp(true);
await page.waitForTimeout(3_000);
const panelUsage = await panelMarginUsed();

// The margin dialog from the position row's margin button: as it opens, then with half the
// available balance to add (nothing is sent).
check('the margin button is in the position row', await markRowButton('Margin', 'margin'));
await page.locator('[data-check="margin"]').click();
const dialog = page.getByRole('dialog');
await dialog.waitFor({ timeout: 15_000 });
await page.waitForTimeout(1_500);
const addView = ((await dialog.innerText()) as string).replace(/\s+/g, ' ');
await dialog.getByText('50%', { exact: true }).first().click();
await page.waitForTimeout(1_500);
const addAmountView = ((await dialog.innerText()) as string).replace(/\s+/g, ' ');
await hideNotifications();
await page.screenshot({ path: `${screenshots}-margin.png` });
console.log(`  screenshot ${screenshots}-margin.png`);
await page.keyboard.press('Escape');
await dialog.waitFor({ state: 'detached', timeout: 15_000 });

// The close panel from the position row's close toggle, and its market order sent.
check('the close toggle is in the position row', await markRowButton(null, 'close'));
await page.locator('[data-check="close"]').click();
await page
  .locator('button', { hasText: /^\s*Close position\s*$/ })
  .last()
  .waitFor({ timeout: 15_000 });
await page.waitForTimeout(2_000);
await page
  .locator('button', { hasText: /^\s*Close position\s*$/ })
  .last()
  .click();
let closedOnChain = false;
for (let i = 0; i < 60 && !closedOnChain; i += 1) {
  // eslint-disable-next-line no-await-in-loop
  const position = await readPosition(client, deployment, MARKET, acct.accountId);
  closedOnChain = (position?.base ?? 0n) === 0n;
  // eslint-disable-next-line no-await-in-loop
  if (!closedOnChain) await page.waitForTimeout(1_000);
}
await hasPositionInApp(false);
// Up to 15 seconds for the panel to close itself; its "Limit Close" box shows while it is open.
const panelOpen = async () =>
  page.evaluate(() =>
    [...document.querySelectorAll('*')].some(
      (e) =>
        e instanceof HTMLElement &&
        e.childElementCount === 0 &&
        e.offsetParent != null &&
        e.innerText.trim() === 'Limit Close'
    )
  );
let stillOpen = await panelOpen();
for (let i = 0; i < 15 && stillOpen; i += 1) {
  // eslint-disable-next-line no-await-in-loop
  await page.waitForTimeout(1_000);
  // eslint-disable-next-line no-await-in-loop
  stillOpen = await panelOpen();
}
await hideNotifications();
await page.screenshot({ path: `${screenshots}-closed.png` });
console.log(`  screenshot ${screenshots}-closed.png`);

console.log(`  panel margin used ${panelUsage}`);
console.log(`  margin dialog, add: ${addView.slice(0, 300)}`);
console.log(`  margin dialog, add 50%: ${addAmountView.slice(0, 400)}`);
console.log(`  closed on chain ${closedOnChain}; close panel still open ${stillOpen}`);

// The dialog's account lines, named as the account panel names them.
check(
  'the margin dialog shows available balance and margin used, with no cross margin',
  addView.includes('Available Balance') &&
    addView.includes('Margin Used') &&
    !/Cross/.test(addView),
  addView.slice(0, 200)
);
const dialogUsage = addView.match(/Margin Used\s+([\d.]+%)/)?.[1];
check(
  "its margin used is the account panel's",
  dialogUsage != null && dialogUsage === panelUsage,
  `${dialogUsage} vs ${panelUsage}`
);
// "Estimated Liquidation Price $94,737 $90,000": the current price, then the new one once an
// amount is in (the arrow between them is an icon, not text).
const liquidation =
  addAmountView
    .split('Liquidation Price')[1]
    ?.split('Position')[0]
    ?.match(/\$[\d,]+/g) ?? [];
check(
  'putting margin in moves the estimated liquidation price down',
  liquidation[1] != null && amount(liquidation[1]) < amount(liquidation[0]),
  `${liquidation[0]} -> ${liquidation[1] ?? '(unchanged)'}`
);
check('the close panel closed the position on chain', closedOnChain);
check('and then closed itself', !stillOpen);

await browser.close();
console.log(`\n${passed} checks passed`);

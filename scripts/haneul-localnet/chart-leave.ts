/* eslint-disable no-console */

/**
 * Leaving the trade page while the chart shows a position line, on a running localnet. The chart
 * draws the position's entry as a line and removes it when the page unmounts, after the chart
 * widget itself is gone; the app is to move on to the next page rather than fail into its error
 * screen. Requires the fixture (`fixture.mjs setup` + `push`), the indexer and API, and `pnpm dev`.
 *
 *   PLAYWRIGHT=/path/to/node_modules/playwright pnpm exec tsx scripts/haneul-localnet/chart-leave.ts
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
const screenshots = process.env.SCREENSHOTS ?? join(ROOT, '.localnet', 'chart-leave');
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
await page.goto(`${APP}#/trade/${MARKET}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
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

// 1. A position, so the chart draws its entry line.
console.log('\n1 a position on the chart');
const deposit = await supervisor('depositCollateral', 100);
check('100 TUSD deposited', deposit.type === 'success', deposit.type);
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
check('market buy 0.001 BTC', buy.type === 'success', buy.type);
const shown = await page
  .waitForFunction(
    () => {
      const { haneulPerp } = window as any;
      const positions = haneulPerp.BonsaiCore.account.parentSubaccountPositions.data(
        haneulPerp.supervisor.store.getState()
      );
      const frame = [...document.querySelectorAll('iframe')].find((f) =>
        /tradingview/i.test(f.id)
      ) as HTMLIFrameElement | undefined;
      return (
        (positions?.length ?? 0) > 0 && (frame?.contentWindow as any)?.ChartApiInstance != null
      );
    },
    null,
    { timeout: 60_000 }
  )
  .then(() => true)
  .catch(() => false);
check('the app shows the position and the chart is up', shown);
// The entry line is drawn asynchronously once the chart has the position.
await page.waitForTimeout(5_000);
await page.screenshot({ path: `${screenshots}-1.png` });

// 2. Away from the trade page and back, twice.
const leave = async (step: string, link: string, landmark: RegExp) => {
  console.log(`\n${step} from the trade page to ${link}`);
  const before = errors.length;
  await page.getByRole('link', { name: link, exact: true }).first().click();
  const arrived = await page
    .getByText(landmark)
    .first()
    .waitFor({ timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  await page.screenshot({ path: `${screenshots}-${step}.png` });
  const thrown = errors.slice(before);
  check(`${link} opens`, arrived);
  check(`no page error on the way`, thrown.length === 0, thrown.join(' | ').slice(0, 160));
};
await leave('2', 'Portfolio', /^Overview$/);
await page.getByRole('link', { name: 'Trade', exact: true }).first().click();
await page.locator('form footer').first().waitFor({ timeout: 60_000 });
await page.waitForTimeout(8_000);
await leave('3', 'Markets', /^Markets$/);

await browser.close();
console.log(`  screenshots ${screenshots}-{1,2,3}.png`);
console.log(`\n${passed} checks passed, ${failed.length} failed`);
if (failed.length > 0) process.exit(1);

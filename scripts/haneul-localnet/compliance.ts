/* eslint-disable no-console */

/**
 * The compliance screens, on a running localnet. Only the connected address is screened; the
 * local address screen (it waited for an HD key nonce nothing sets) and the Solana screen (it
 * waited for a Solana address nothing sets) never ran, and are gone along with their store
 * entries, the HD key nonce slice and the Noble USDC balance nothing filled. The status the app
 * computes stays UNKNOWN, which reads as full access, so the trade form offers the order as
 * before. Requires the fixture (`fixture.mjs setup` + `push`), the indexer and API, and `pnpm dev`.
 *
 *   PLAYWRIGHT=/path/to/node_modules/playwright pnpm exec tsx scripts/haneul-localnet/compliance.ts
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
const screenshots = process.env.SCREENSHOTS ?? join(ROOT, '.localnet', 'compliance');

let passed = 0;
const failed: string[] = [];
// Every check runs, so a run without the change shows each step it gets wrong.
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
  if (ok) passed += 1;
  else failed.push(name);
};

/** A wallet with gas and 1,000 TUSD, and no trading account. */
const fundedWallet = async () => {
  const keypair = Ed25519Keypair.generate();
  const address = keypair.getPublicKey().toHaneulAddress();
  // The fixture's admin coin also pays the price relay, and a clash between the two locks it
  // until the next epoch (a minute on localnet).
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const funded = spawnSync(
      process.execPath,
      [join(ROOT, 'scripts', 'haneul-localnet', 'fixture.mjs'), 'fund', address, '1000'],
      { stdio: 'inherit' }
    );
    if (funded.status === 0) return keypair;
    console.log(`  funding attempt ${attempt} failed; trying again after the epoch`);
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      setTimeout(resolve, 65_000);
    });
  }
  throw new Error('fixture.mjs fund failed');
};

const keypair = await fundedWallet();
const me = keypair.getPublicKey().toHaneulAddress();
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
const page = await context.newPage();
page.on('pageerror', (e: Error) => {
  if (!/qs_|Bars are not available/.test(e.message)) console.log('  page error:', e.message);
});
const screens: Array<{ address: string; status: number; body: string }> = [];
page.on('response', async (response: any) => {
  const { pathname } = new URL(response.url());
  if (!pathname.startsWith('/v4/compliance/screen/')) return;
  const body = await response.text().catch(() => '');
  screens.push({
    address: decodeURIComponent(pathname.slice('/v4/compliance/screen/'.length)),
    status: response.status(),
    body,
  });
});
// tsx names the functions it compiles with an `__name` helper, which code sent to the page
// would call; a string is sent as it is.
await page.addInitScript({ content: 'window.__name = (f) => f;' });
await page.addInitScript((key: string) => {
  window.localStorage.setItem('haneul:dev-wallet:secret', key);
}, keypair.getSecretKey());
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
await page
  .waitForFunction(
    () =>
      (window as any).haneulPerp.supervisor.store.getState().raw.compliance.sourceAddressScreenV2
        .status === 'success',
    null,
    { timeout: 60_000 }
  )
  .catch(() => {});
// Later screens would show up here; the queries fetch once and keep the answer.
await page.waitForTimeout(5_000);

// 1. What is screened.
console.log('\n1 the screens sent to perp-api');
console.log(`  ${JSON.stringify(screens)}`);
check(
  'one screen, for the connected address',
  screens.length === 1 && screens[0]?.address === me,
  `${screens.length} screens`
);
check(
  'perp-api answers COMPLIANT',
  screens[0]?.status === 200 && JSON.parse(screens[0]?.body || '{}').status === 'COMPLIANT',
  screens[0]?.body
);

// 2. What the store holds.
console.log('\n2 the store');
const state = await page.evaluate(() => {
  const s = (window as any).haneulPerp.supervisor.store.getState();
  return {
    sliceKeys: Object.keys(s),
    complianceKeys: Object.keys(s.raw.compliance),
    accountKeys: Object.keys(s.raw.account),
    localWalletKeys: Object.keys(s.wallet.localWallet ?? {}),
    source: s.raw.compliance.sourceAddressScreenV2,
  };
});
console.log(`  raw.compliance ${JSON.stringify(state.complianceKeys)}`);
console.log(`  raw.account ${JSON.stringify(state.accountKeys)}`);
console.log(`  wallet.localWallet ${JSON.stringify(state.localWalletKeys)}`);
check(
  'the connected address screen is stored as COMPLIANT',
  state.source.status === 'success' && state.source.data?.status === 'COMPLIANT',
  `${state.source.status} ${state.source.data?.status}`
);
check(
  'raw.compliance holds the geo answers and the connected address screen only',
  JSON.stringify([...state.complianceKeys].sort()) ===
    JSON.stringify(['geo', 'geoHeaders', 'sourceAddressScreenV2'])
);
check('no HD key nonce slice', !state.sliceKeys.includes('walletEphemeral'));
check('no Noble USDC balance entry', !state.accountKeys.includes('nobleUsdcBalance'));
check(
  'the local wallet carries the address and subaccount only',
  state.localWalletKeys.every((k: string) => k === 'address' || k === 'subaccountNumber'),
  JSON.stringify(state.localWalletKeys)
);

// 3. The status the app computes. The dev server serves the module the app runs, and the
// selectors are pure, so calling them on the store's state gives the app's answer.
console.log('\n3 the computed status');
const computed = await page.evaluate(`(async () => {
  const m = await import('/src/bonsai/selectors/compliance.ts');
  const s = window.haneulPerp.supervisor.store.getState();
  return { data: m.selectCompliance(s), loading: m.selectComplianceLoading(s) };
})()`);
console.log(`  ${JSON.stringify(computed)}`);
// Nothing reads the loading status; it is printed because dropping the two idle screens moves it.
check(
  'the status stays UNKNOWN, with the geo unblocked',
  (computed as any).data?.status === 'UNKNOWN' &&
    (computed as any).data?.geo?.isPerpetualsGeoBlocked === false,
  JSON.stringify((computed as any).data)
);
const bannerHeight = await page.evaluate(() =>
  document.documentElement.style.getPropertyValue('--complianceBanner-height')
);
check('no compliance banner', bannerHeight === '', bannerHeight);

// 4. Full access: the trade form offers the order once the account holds collateral.
console.log('\n4 the trade form');
const deposited = await page.evaluate(async () => {
  const r = await (window as any).haneulPerp.supervisor.depositCollateral(100);
  return r.type;
});
check('100 TUSD deposited', deposited === 'success', deposited);
await page.waitForTimeout(5_000);
await page.evaluate(() => {
  const { store } = (window as any).haneulPerp.supervisor;
  store.dispatch({ type: 'TradeForm/resetPrimaryInputs' });
  [
    ['setOrderType', 'LIMIT'],
    ['setSide', 'BUY'],
    ['setLimitPrice', '99000'],
    ['setSizeToken', '0.001'],
  ].forEach(([type, payload]) => store.dispatch({ type: `TradeForm/${type}`, payload }));
});
await page.waitForTimeout(2_000);
const submit = await page.evaluate(() => {
  const button = [...document.querySelectorAll('form footer button[type="submit"]')].find(
    (b) => (b as HTMLElement).offsetParent != null
  ) as HTMLButtonElement | undefined;
  return { text: button?.innerText.replace(/\s+/g, ' ').trim() ?? '', disabled: button?.disabled };
});
await page.screenshot({ path: `${screenshots}-trade.png` });
check(
  'the trade form offers the limit order',
  /Place/i.test(submit.text) && submit.disabled === false,
  JSON.stringify(submit)
);
await page.evaluate(() =>
  (window as any).haneulPerp.supervisor.store.dispatch({ type: 'TradeForm/resetPrimaryInputs' })
);

await browser.close();
console.log(`  screenshot ${screenshots}-trade.png`);
console.log(`\n${passed} checks passed, ${failed.length} failed`);
if (failed.length > 0) process.exit(1);

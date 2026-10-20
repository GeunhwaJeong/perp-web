/* eslint-disable no-console */

/**
 * What the app stores across reloads, on a running localnet. The store starts from the slices'
 * own initial state: the persist migrations that copied dYdX's old localStorage items over are
 * gone, and with them the one-time switch from the Classic theme a first visit used to get. A
 * connected wallet stays connected after a reload, and a wallet saved by the dYdX connectors
 * (here an injected EVM wallet with a derived-key signature) neither breaks the page nor
 * survives the next connection. Requires the fixture (`fixture.mjs setup` + `push`), the indexer
 * and API, and `pnpm dev`.
 *
 *   PLAYWRIGHT=/path/to/node_modules/playwright pnpm exec tsx scripts/haneul-localnet/persist.ts
 */
import { Ed25519Keypair } from '@haneullabs/haneul/keypairs/ed25519';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
// eslint-disable-next-line import/no-dynamic-require -- resolved from an external checkout
const { chromium } = require(process.env.PLAYWRIGHT ?? 'playwright');

const ROOT = join(import.meta.dirname, '..', '..');
const url = process.env.APP_URL ?? 'http://localhost:5173/#/trade/BTC-USD';
const screenshots = process.env.SCREENSHOTS ?? join(ROOT, '.localnet', 'persist');

let passed = 0;
const failed: string[] = [];
// Every check runs, so a run without the change shows each step it gets wrong.
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
  if (ok) passed += 1;
  else failed.push(name);
};

// Connecting needs no funds, so the wallet is never funded.
const keypair = Ed25519Keypair.generate();
const me = keypair.getPublicKey().toHaneulAddress();
const browser = await chromium.launch();
const pageErrors: string[] = [];

const openPage = async (context: any) => {
  const page = await context.newPage();
  page.on('pageerror', (e: Error) => {
    if (/qs_|Bars are not available/.test(e.message)) return;
    pageErrors.push(e.message);
    console.log('  page error:', e.message);
  });
  // tsx names the functions it compiles with an `__name` helper, which code sent to the page
  // would call; a string is sent as it is.
  await page.addInitScript({ content: 'window.__name = (f) => f;' });
  await page.addInitScript((key: string) => {
    window.localStorage.setItem('haneul:dev-wallet:secret', key);
  }, keypair.getSecretKey());
  return page;
};

const appReady = async (page: any) => {
  await page.waitForFunction(() => (window as any).haneulPerp != null, null, { timeout: 60_000 });
  await page.locator('form footer').first().waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => window.localStorage.getItem('persist:root') != null, null, {
    timeout: 30_000,
  });
};

/** The saved source account, with the wallet's icon (a long data URL) left out. */
const brief = (source: any) =>
  source == null
    ? source
    : {
        ...source,
        walletInfo: source.walletInfo && { ...source.walletInfo, icon: undefined },
      };

/** redux-persist keeps each persisted slice as a JSON string inside `persist:root`. */
const readPersisted = (page: any) =>
  page.evaluate(() => {
    const root = JSON.parse(window.localStorage.getItem('persist:root') ?? '{}');
    return Object.fromEntries(Object.entries(root).map(([k, v]) => [k, JSON.parse(v as string)]));
  });

const dydxKeys = (page: any) =>
  page.evaluate(() =>
    Object.keys(window.localStorage)
      .filter((k) => k.startsWith('dydx.'))
      .sort()
  );

const connectDevWallet = (page: any) =>
  page.evaluate(async () => {
    const { dAppKit } = (window as any).haneulPerp;
    const wallet = dAppKit.stores.$wallets.get().find((w: any) => w.name === 'Haneul Dev Wallet');
    await dAppKit.connectWallet({ wallet });
  });

const connection = (page: any) =>
  page.evaluate(() => {
    const c = (window as any).haneulPerp.dAppKit.stores.$connection.get();
    const s = (window as any).haneulPerp.supervisor.store.getState();
    return {
      status: c.status as string,
      account: (c.account?.address ?? null) as string | null,
      source: s.wallet.sourceAccount,
      header: document.querySelector('header')?.innerText.replace(/\s+/g, ' ').trim() ?? '',
    };
  });

// 1. A first visit, in a browser that has never opened the app.
console.log('\n1 a first visit');
const first = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
const page = await openPage(first);
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await appReady(page);
await page.waitForTimeout(3_000);
const stored = await readPersisted(page);
const live = await page.evaluate(() => {
  const s = (window as any).haneulPerp.supervisor.store.getState();
  return { theme: s.appUiConfigs.appThemeSetting, wallet: s.wallet };
});
console.log(`  persisted slices ${JSON.stringify(Object.keys(stored).sort())}`);
console.log(`  dydx.* keys ${JSON.stringify(await dydxKeys(page))}`);
check(
  'the stored state is at version 6',
  stored._persist?.version === 6,
  JSON.stringify(stored._persist)
);
check(
  'the theme is Dark, in the store and in storage',
  live.theme === 'Dark' && stored.appUiConfigs?.appThemeSetting === 'Dark',
  `${live.theme} / ${stored.appUiConfigs?.appThemeSetting}`
);
check(
  'the display settings are the slice defaults',
  stored.appUiConfigs?.appColorMode === 'GreenUp' &&
    stored.appUiConfigs?.displayUnit === 'asset' &&
    stored.appUiConfigs?.defaultToAllMarketsInPositionsOrdersFills === true &&
    stored.appUiConfigs?.hasSeenLaunchIncentives === false,
  JSON.stringify({
    appColorMode: stored.appUiConfigs?.appColorMode,
    displayUnit: stored.appUiConfigs?.displayUnit,
  })
);
check(
  'no wallet is saved',
  live.wallet.sourceAccount?.address == null && live.wallet.sourceAccount?.walletInfo == null,
  JSON.stringify(live.wallet.sourceAccount)
);
check(
  'the transfers and banner slices hold their defaults',
  JSON.stringify(stored.transfers) === '{"transfersByDydxAddress":{}}' &&
    stored.dismissable?.hasSeenPredictionMarketIntroDialog === false &&
    stored.dismissable?.dismissedAffiliateBanner === false
);
check(
  'no UI refresh flag in localStorage',
  !(await dydxKeys(page)).includes('dydx.HasSeenUiRefresh')
);

// 2. Connect, reload, and stay connected.
console.log('\n2 a reload keeps the connection');
await connectDevWallet(page);
await page.waitForFunction(
  () =>
    (window as any).haneulPerp?.supervisor.store.getState().wallet.sourceAccount?.address != null,
  null,
  { timeout: 15_000 }
);
await page.waitForTimeout(2_000);
const saved = (await readPersisted(page)).wallet?.sourceAccount;
console.log(`  saved ${JSON.stringify(brief(saved))}`);
check(
  'the saved wallet is the Wallet Standard dev wallet on Haneul',
  saved?.address === me &&
    saved?.chain === 'haneul' &&
    saved?.walletInfo?.connectorType === 'walletStandard' &&
    saved?.walletInfo?.name === 'Haneul Dev Wallet' &&
    typeof saved?.walletInfo?.walletId === 'string',
  saved?.walletInfo?.walletId
);
check(
  'the saved wallet carries the address, chain and wallet only',
  Object.keys(saved ?? {}).every((k) => ['address', 'chain', 'walletInfo'].includes(k)),
  JSON.stringify(Object.keys(saved ?? {}))
);
await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
await appReady(page);
await page
  .waitForFunction(
    () => (window as any).haneulPerp.dAppKit.stores.$connection.get().status === 'connected',
    null,
    { timeout: 30_000 }
  )
  .catch(() => {});
// The bridge clears the saved wallet when dapp-kit settles on disconnected; give it the time.
await page.waitForTimeout(5_000);
const afterReload = await connection(page);
await page.screenshot({ path: `${screenshots}-reload.png` });
console.log(
  `  ${JSON.stringify({ ...afterReload, source: brief(afterReload.source), header: afterReload.header.slice(0, 80) })}`
);
check(
  'dapp-kit reconnects the same account',
  afterReload.status === 'connected' && afterReload.account === me,
  `${afterReload.status} ${afterReload.account}`
);
check(
  'the app keeps the same source account',
  afterReload.source?.address === me &&
    afterReload.source?.walletInfo?.connectorType === 'walletStandard',
  afterReload.source?.address
);
// Logged out, the header offers Log in on mainnet and Get started on localnet.
check('the header no longer offers to log in', !/Log in|Get started/.test(afterReload.header));
await first.close();

// 3. A wallet saved by the dYdX connectors.
console.log('\n3 a wallet saved by the dYdX connectors');
const old = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
const oldPage = await openPage(old);
const oldAddress = '0x00000000000000000000000000000000000000ab';
await oldPage.addInitScript((address: string) => {
  if (window.localStorage.getItem('persist:root') != null) return;
  const wallet = {
    sourceAccount: {
      address,
      chain: 'evm',
      encryptedSignature: '0x5eed',
      walletInfo: {
        connectorType: 'injected',
        name: 'MetaMask',
        rdns: 'io.metamask',
        icon: 'data:image/svg+xml;base64,PHN2Zy8+',
      },
    },
    localWallet: { subaccountNumber: 0 },
  };
  window.localStorage.setItem(
    'persist:root',
    JSON.stringify({
      wallet: JSON.stringify(wallet),
      _persist: JSON.stringify({ version: 6, rehydrated: true }),
    })
  );
}, oldAddress);
const errorsBefore = pageErrors.length;
await oldPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await appReady(oldPage);
await oldPage.waitForTimeout(5_000);
const settled = await connection(oldPage);
console.log(
  `  ${JSON.stringify({ ...settled, source: brief(settled.source), header: settled.header.slice(0, 80) })}`
);
check(
  'the page loads without errors',
  pageErrors.length === errorsBefore,
  `${pageErrors.length - errorsBefore} errors`
);
check(
  'the old wallet is not reconnected, and the saved account is cleared',
  settled.status !== 'connected' && settled.source?.address == null,
  `${settled.status} ${settled.source?.address}`
);
check('the header offers to log in', /Log in|Get started/.test(settled.header));
await connectDevWallet(oldPage);
await oldPage.waitForFunction(
  () =>
    (window as any).haneulPerp?.supervisor.store.getState().wallet.sourceAccount?.address != null,
  null,
  { timeout: 15_000 }
);
await oldPage.waitForTimeout(2_000);
const replaced = (await readPersisted(oldPage)).wallet?.sourceAccount;
console.log(`  saved ${JSON.stringify(brief(replaced))}`);
check(
  'connecting saves the Wallet Standard wallet in its place',
  replaced?.address === me &&
    replaced?.chain === 'haneul' &&
    replaced?.walletInfo?.connectorType === 'walletStandard' &&
    replaced?.encryptedSignature === undefined,
  JSON.stringify(Object.keys(replaced ?? {}))
);
await old.close();

await browser.close();
console.log(`  screenshot ${screenshots}-reload.png`);
console.log(`\n${passed} checks passed, ${failed.length} failed`);
if (failed.length > 0) process.exit(1);

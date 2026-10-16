/* eslint-disable no-console */

/**
 * How the trade page and the markets page show a market, against a running localnet. After a
 * trader buys 0.001 BTC (the lot size), open interest shows to the lot's decimals instead of
 * rounding to 0.00, the trades list writes prices with thousands separators like the order book,
 * the price the indexer calls oraclePrice (the engine's mark price) is labelled as the mark in
 * the positions table and on the markets page, and the markets page shows funding over the
 * market's period, under a label that names it, as the trade page's header does. Expected values
 * come from the API. Requires the fixture (`fixture.mjs setup` + `push`), the indexer and API,
 * and `pnpm dev`.
 *
 *   PLAYWRIGHT=/path/to/node_modules/playwright pnpm exec tsx scripts/haneul-localnet/market-display.ts
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
const api = process.env.API_URL ?? 'http://127.0.0.1:3002';
const screenshots = process.env.SCREENSHOTS ?? join(ROOT, '.localnet', 'market-display');
const MARKET = 'BTC-USD';

let passed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) throw new Error(`FAIL ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}${detail ? ` (${detail})` : ''}`);
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
  if (!e.message.includes('qs_')) console.log('  page error:', e.message);
});
await page.addInitScript((key: string) => {
  window.localStorage.setItem('haneul:dev-wallet:secret', key);
}, fresh.getSecretKey());
const openPage = async (at: string) => {
  await page.goto(at, { waitUntil: 'domcontentloaded', timeout: 120_000 });
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
};
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
const market = async () =>
  (await fetch(`${api}/v4/perpetualMarkets`).then((r) => r.json())).markets[MARKET];

await openPage(url);
await page.locator('form footer').first().waitFor({ timeout: 60_000 });

// 20 TUSD in and 0.001 BTC bought through the app's own write path.
const deposited = await supervisor('depositCollateral', 20);
check('20 TUSD deposited', deposited.type === 'success', JSON.stringify(deposited).slice(0, 160));
// Open interest before the purchase: earlier runs on the same localnet leave positions open.
const openInterestBefore = Number((await market()).openInterest);
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

// The API's open interest, once it counts the new position.
let indexed = await market();
for (
  let i = 0;
  i < 30 && Number(indexed.openInterest) < openInterestBefore + 0.001 - 1e-9;
  i += 1
) {
  // eslint-disable-next-line no-await-in-loop
  await page.waitForTimeout(1_000);
  // eslint-disable-next-line no-await-in-loop
  indexed = await market();
}
await page.waitForFunction(
  (m: string) =>
    (
      (window as any).haneulPerp.BonsaiCore.account.parentSubaccountPositions.data(
        (window as any).haneulPerp.supervisor.store.getState()
      ) ?? []
    ).some((p: any) => p.market === m),
  MARKET,
  { timeout: 60_000 }
);
await page.waitForTimeout(3_000);

// What the trade page shows: the header's open interest, the trades list, the positions table.
await page.getByRole('tab', { name: 'Trades', exact: true }).first().click();
await page.waitForTimeout(1_500);
const trade = await page.evaluate(() => {
  const label = [...document.querySelectorAll('*')].find(
    (e) =>
      e instanceof HTMLElement &&
      e.childElementCount === 0 &&
      e.innerText.trim() === 'Open Interest'
  );
  // The stat's own box: the nearest ancestor of the label that holds a number.
  let item = label?.parentElement ?? null;
  while (item != null && !/\d/.test(item.innerText)) item = item.parentElement;
  const openInterest = (item?.innerText ?? '')
    .replace('Open Interest', '')
    .replace(/\s+/g, ' ')
    .trim();
  const panel = [...document.querySelectorAll('[role="tabpanel"]')].find(
    (p) =>
      p instanceof HTMLElement &&
      p.offsetParent != null &&
      /Price/.test(p.innerText) &&
      /Time/.test(p.innerText)
  ) as HTMLElement | undefined;
  const prices = (panel?.innerText ?? '').match(/\$[\d,]+(\.\d+)?/g) ?? [];
  const headers = [...document.querySelectorAll('th, [role="columnheader"]')]
    .map((h) => (h as HTMLElement).innerText.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return { openInterest, firstPrice: prices[0] ?? '', headers };
});
await hideNotifications();
await page.screenshot({ path: `${screenshots}-trade.png` });
console.log(`  screenshot ${screenshots}-trade.png`);

// The markets page, opened afresh (the dev server stalls leaving the trade page in-app).
await openPage(new URL('/markets', url).toString());
await page
  .getByText('BTC', { exact: true })
  .first()
  .waitFor({ timeout: 120_000 })
  .catch(() => undefined);
await page.waitForTimeout(3_000);
const markets = await page.evaluate(() => {
  const table = [...document.querySelectorAll('table')].find((t) =>
    /Funding/.test((t as HTMLElement).innerText)
  );
  const headers = [...(table?.querySelectorAll('th') ?? [])].map((h) =>
    (h as HTMLElement).innerText.replace(/\s+/g, ' ').trim()
  );
  const fundingIndex = headers.findIndex((h) => h.includes('Funding'));
  const row = table?.querySelector('tbody tr');
  const cells = [...(row?.querySelectorAll('td') ?? [])].map((c) =>
    (c as HTMLElement).innerText.replace(/\s+/g, ' ').trim()
  );
  return { headers, funding: fundingIndex >= 0 ? cells[fundingIndex] : undefined };
});
await hideNotifications();
await page.screenshot({ path: `${screenshots}-markets.png` });
console.log(`  screenshot ${screenshots}-markets.png`);

const hours = Number(indexed.fundingPeriodMs) > 0 ? Number(indexed.fundingPeriodMs) / 3_600_000 : 1;
const fundingPercent = Number(indexed.nextFundingRate) * hours * 100;
console.log(
  `  API open interest ${indexed.openInterest}, funding ${indexed.nextFundingRate}/h over ${hours}h`
);
console.log(`  trade page ${JSON.stringify(trade)}`);
console.log(`  markets page ${JSON.stringify(markets)}`);

check(
  'open interest shows to the lot size',
  trade.openInterest === `${Number(indexed.openInterest).toFixed(3)} BTC`,
  `${trade.openInterest} vs ${indexed.openInterest}`
);
check(
  'the trades list writes the price with separators',
  trade.firstPrice === '$100,010',
  trade.firstPrice
);
check(
  "the positions table labels the indexer's oraclePrice as the mark",
  trade.headers.includes('Mark') && !trade.headers.some((h: string) => /^Oracle/.test(h)),
  JSON.stringify(trade.headers)
);
check(
  'the markets page labels it the mark price',
  markets.headers.includes('Mark Price') && !markets.headers.includes('Oracle Price'),
  JSON.stringify(markets.headers)
);
check(
  "the markets page names the funding period, as the trade page's header does",
  markets.headers.includes(`Funding (${hours}h)`),
  JSON.stringify(markets.headers)
);
check(
  'and shows funding over that period',
  markets.funding != null &&
    Math.abs(Number(markets.funding.replace('−', '-').replace(/[^0-9.-]/g, '')) - fundingPercent) <
      0.0001,
  `${markets.funding} vs ${fundingPercent.toFixed(6)}%`
);

await browser.close();
console.log(`\n${passed} checks passed`);

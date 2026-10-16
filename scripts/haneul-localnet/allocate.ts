/* eslint-disable no-console */

/**
 * How much collateral an order takes into its market, against a running localnet. An order's
 * session ends with `allocate_missing_margin`, which takes what the position is short of its
 * initial margin at the prices the order ran at; the app must not move more ahead of the order.
 * dYdX's form did (a buffered estimate at 98% of the leverage, with half a percent on the price
 * twice, and 1% more for limit orders), which opened a 10x position at 8.9x. Places a market buy,
 * a second one, and a resting limit buy from the order form, and after each checks on chain that
 * the session moved no collateral of its own and that the position holds exactly its initial
 * margin, and on screen that the margin the form previewed is the margin the position shows.
 * Requires the fixture (`fixture.mjs setup` + `push`), the indexer and API, and `pnpm dev`.
 *
 *   PLAYWRIGHT=/path/to/node_modules/playwright pnpm exec tsx scripts/haneul-localnet/allocate.ts
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
const screenshots = process.env.SCREENSHOTS ?? join(ROOT, '.localnet', 'allocate');
const MARKET = 'BTC-USD';
const ONE = 10n ** 18n;
// One collateral unit (1e-6 TUSD) in ifixed: the engine rounds its allocation up to whole units.
const UNIT = 10n ** 12n;
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

const usd = (v: bigint) => (Number(v) / 1e18).toFixed(6);
const signed = (v: bigint) => (v >= 2n ** 255n ? v - 2n ** 256n : v);
const abs = (v: bigint) => (v < 0n ? -v : v);

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
const EMPTY = { collateral: 0n, base: 0n, quote: 0n, bids: 0n, asks: 0n, imr: 0n };
// The account's position on the market; empty until its first order creates the object.
const readPositionFull = async (accountId: bigint) => {
  const found = await client.core
    .getDynamicField({
      parentId: deployment.markets[MARKET]!.clearingHouse,
      name: {
        type: `${deployment.packages.perpetuals}::keys::PositionKey`,
        bcs: PositionKeyBcs.serialize({ account_id: accountId }).toBytes(),
      },
    })
    .catch(() => undefined);
  if (found == null) return EMPTY;
  const p = PositionBcs.parse(found.dynamicField.value.bcs);
  return {
    collateral: signed(BigInt(p.collateral)),
    base: signed(BigInt(p.base_asset_amount)),
    quote: signed(BigInt(p.quote_asset_notional_amount)),
    bids: BigInt(p.bids_quantity),
    asks: BigInt(p.asks_quantity),
    imr: BigInt(p.initial_margin_ratio),
  };
};

type Sent = { digest: string; ok: boolean; calls: string[]; events: any[] };
// The wallet's transactions, newest first, with the functions each one calls and its events.
const sentBy = async (address: string): Promise<Sent[]> => {
  const response = await fetch(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'haneulx_queryTransactionBlocks',
      params: [
        {
          filter: { FromAddress: address },
          options: { showInput: true, showEffects: true, showEvents: true },
        },
        null,
        50,
        true,
      ],
    }),
  });
  const body = await response.json();
  return body.result.data.map((t: any) => ({
    digest: t.digest,
    ok: t.effects?.status?.status === 'success',
    calls: (t.transaction?.data?.transaction?.transactions ?? [])
      .map((c: any) => c.MoveCall?.function)
      .filter(Boolean),
    events: t.events ?? [],
  }));
};
const eventsNamed = (tx: Sent, name: string) =>
  tx.events.filter((e) => e.type.endsWith(`::events::${name}`)).map((e) => e.parsedJson);

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
await page.evaluate(() => {
  const w = window as any;
  w.appErrors = [];
  window.addEventListener('dydx:log', (e: any) => {
    w.appErrors.push(`${e.detail.location}: ${e.detail.error?.message ?? ''}`);
  });
});
await page.locator('form footer').first().waitFor({ timeout: 60_000 });

const deposited = await page.evaluate(async () =>
  JSON.parse(JSON.stringify(await (window as any).haneulPerp.supervisor.depositCollateral(50)))
);
check('50 TUSD deposited', deposited.type === 'success', JSON.stringify(deposited).slice(0, 160));
const acct = await findPerpAccount(client, deployment, me);
if (!acct) throw new Error('no account after the deposit');

const fill = (actions: Array<[string, unknown]>) =>
  page.evaluate((list: Array<[string, unknown]>) => {
    const { store } = (window as any).haneulPerp.supervisor;
    store.dispatch({ type: 'TradeForm/resetPrimaryInputs' });
    list.forEach(([type, payload]) => store.dispatch({ type: `TradeForm/${type}`, payload }));
  }, actions);
// The order form's button and receipt, the position row's margin cell and the notifications.
const screen = () =>
  page.evaluate(() => {
    const text = (e: Element | null | undefined) =>
      ((e as HTMLElement | null | undefined)?.innerText ?? '').replace(/\s+/g, ' ').trim();
    const button = [...document.querySelectorAll('form footer button[type="submit"]')].find(
      (e) => (e as HTMLElement).offsetParent != null
    );
    const label = [...document.querySelectorAll('*')].find(
      (e) =>
        e instanceof HTMLElement &&
        e.childElementCount === 0 &&
        e.innerText.trim() === 'Position Margin' &&
        e.offsetParent != null
    );
    let row = label?.parentElement ?? null;
    while (row != null && !/\$/.test(row.innerText)) row = row.parentElement;
    const table = [...document.querySelectorAll('table')].find((t) =>
      [...t.querySelectorAll('th')].some((h) => (h as HTMLElement).innerText.trim() === 'Margin')
    );
    const headers = [...(table?.querySelectorAll('th') ?? [])].map((th) => text(th));
    const cell = table?.querySelector('tbody tr')?.querySelectorAll('td')[
      headers.indexOf('Margin')
    ];
    return {
      button: text(button),
      disabled: (button as HTMLButtonElement | undefined)?.disabled ?? true,
      previewMargin: text(row)
        .match(/\$[\d,]+\.\d{2}/g)
        ?.at(-1),
      tableMargin: text(cell),
      notifications: [...document.querySelectorAll('aside')]
        .map((e) => text(e))
        .filter(Boolean)
        .join(' | '),
    };
  });
const dollars = (s: string | undefined) => Number((s ?? '').replace(/[$,]/g, '').split(' ')[0]);

/**
 * Places one order from the form and checks the session it sent and the position it left.
 * `previewIsResult` holds where the receipt's margin is what the position shows afterwards: the
 * receipt shows a limit order as filled, which a resting one is not.
 */
const place = async (name: string, actions: Array<[string, unknown]>, previewIsResult: boolean) => {
  console.log(`\n${name}`);
  const before = await readPositionFull(acct.accountId);
  const sentBefore = new Set((await sentBy(me)).map((t) => t.digest));
  await page.evaluate(() => {
    (window as any).appErrors = [];
  });
  await fill(actions);
  await page.waitForTimeout(1_500);
  const ready = await screen();
  check(
    'the order form offers the order',
    /place/i.test(ready.button) && !ready.disabled,
    `button "${ready.button}"${ready.disabled ? ' disabled' : ''}`
  );
  await page.locator('form footer button[type="submit"]:visible').click();
  let after = before;
  let shown = await screen();
  const settled = () =>
    after.base !== before.base || after.bids !== before.bids || /error/i.test(shown.notifications);
  for (let i = 0; i < 60 && !settled(); i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(1_000);
    // eslint-disable-next-line no-await-in-loop
    after = await readPositionFull(acct.accountId);
    // eslint-disable-next-line no-await-in-loop
    shown = await screen();
  }
  // Time for the indexer and the positions table to catch up.
  await page.waitForTimeout(5_000);
  shown = await screen();
  const sent = (await sentBy(me)).filter((t) => !sentBefore.has(t.digest));
  const session = sent[0];
  const allocated = (session ? eventsNamed(session, 'AllocatedCollateral') : []).reduce(
    (sum, e) => sum + BigInt(e.collateral),
    0n
  );
  const mark = BigInt(
    (session
      ? [...eventsNamed(session, 'FilledTakerOrder'), ...eventsNamed(session, 'PostedOrder')]
      : [])[0]?.mark_price ?? 0
  );
  const margin = after.collateral + (after.base * mark) / ONE - after.quote;
  const net = [abs(after.base + after.bids), abs(after.base - after.asks)].reduce((a, b) =>
    a > b ? a : b
  );
  const required = (((net * mark) / ONE) * after.imr) / ONE;
  const surplus = margin - required;

  console.log(
    `  sent: ${sent.map((t) => `${t.digest.slice(0, 8)} ${t.ok ? 'ok' : 'failed'} [${t.calls.join(' ')}]`).join('; ') || 'none'}`
  );
  console.log(
    `  allocated ${(Number(allocated) / 1e6).toFixed(6)}; at mark ${usd(mark)} margin ${usd(margin)}, required ${usd(required)}, surplus ${usd(surplus)}`
  );
  console.log(
    `  preview ${ready.previewMargin}, table "${shown.tableMargin}", notifications: ${shown.notifications || 'none'}`
  );

  check(
    'the wallet sends one transaction, and it goes through',
    sent.length === 1 && session!.ok,
    `${sent.length} sent`
  );
  check(
    'the session moves no collateral ahead of the order',
    session != null && !session.calls.includes('allocate_collateral'),
    session?.calls.join(' ')
  );
  check('the session allocates margin to the market', allocated > 0n, `${allocated}`);
  check(
    'the position holds exactly its initial margin, to the collateral unit',
    mark > 0n && surplus > -10n && surplus < UNIT,
    `surplus ${usd(surplus)}`
  );
  if (previewIsResult) {
    check(
      'the margin the form previewed is the margin the position shows',
      Math.abs(dollars(ready.previewMargin) - dollars(shown.tableMargin)) < 0.011,
      `${ready.previewMargin} previewed, ${shown.tableMargin} shown`
    );
    check(
      'the position shows no leverage apart from the one selected',
      !/×|x\)/.test(shown.tableMargin),
      shown.tableMargin
    );
  }
  check('no order error is shown', !/error/i.test(shown.notifications), shown.notifications);
  const appErrors: string[] = await page.evaluate(() => (window as any).appErrors);
  check(
    'the app logs no errors while the order runs',
    appErrors.length === 0,
    appErrors.join(' | ').slice(0, 400)
  );
  await page.screenshot({ path: `${screenshots}-${name.split(' ')[0]}.png` });
};

await place(
  'A 0.001 BTC market buy',
  [
    ['setOrderType', 'MARKET'],
    ['setSide', 'BUY'],
    ['setSizeToken', '0.001'],
  ],
  true
);
await place(
  'B another 0.001 BTC market buy',
  [
    ['setOrderType', 'MARKET'],
    ['setSide', 'BUY'],
    ['setSizeToken', '0.001'],
  ],
  true
);
await place(
  'C 0.001 BTC limit buy resting at 99,000',
  [
    ['setOrderType', 'LIMIT'],
    ['setSide', 'BUY'],
    ['setLimitPrice', '99000'],
    ['setSizeToken', '0.001'],
  ],
  false
);

console.log(`  screenshots ${screenshots}-{A,B,C}.png`);

await browser.close();
console.log(`\n${passed} checks passed, ${failed.length} failed`);
if (failed.length > 0) process.exit(1);

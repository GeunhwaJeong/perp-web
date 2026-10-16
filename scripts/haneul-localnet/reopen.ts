/* eslint-disable no-console */

/**
 * Opening a position again from the order form after closing it, against a running localnet.
 * Closing a position leaves its position object on chain with its leverage, which the app reads
 * as the market's selected leverage. The order form must then send the order alone: on mainnet it
 * also sent that leverage in a transaction of its own, which took the account's cap at the version
 * the order was built with, and the validators rejected the order. Requires the fixture
 * (`fixture.mjs setup` + `push`), the indexer and API, and `pnpm dev`.
 *
 *   PLAYWRIGHT=/path/to/node_modules/playwright pnpm exec tsx scripts/haneul-localnet/reopen.ts
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
const rpc = process.env.RPC_URL ?? 'http://127.0.0.1:9000';
const screenshots = process.env.SCREENSHOTS ?? join(ROOT, '.localnet', 'reopen');
const MARKET = 'BTC-USD';
const ONE = 10n ** 18n;
const deployment: PerpDeployment = JSON.parse(
  readFileSync(join(ROOT, 'public/configs/haneul/perp.localnet.json'), 'utf8')
);
const client = new HaneulGrpcClient({ network: 'localnet', baseUrl: rpc });

let passed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) throw new Error(`FAIL ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}${detail ? ` (${detail})` : ''}`);
};

type Sent = { digest: string; ok: boolean; calls: string[] };
// The wallet's transactions, newest first, with the functions each one calls.
const sentBy = async (address: string): Promise<Sent[]> => {
  const response = await fetch(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'haneulx_queryTransactionBlocks',
      params: [
        { filter: { FromAddress: address }, options: { showInput: true, showEffects: true } },
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
  }));
};
const describe = (sent: Sent[]) =>
  sent
    .map((t) => `${t.digest.slice(0, 8)} ${t.ok ? 'ok' : 'failed'} [${t.calls.join(' ')}]`)
    .join('; ') || 'none';

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
const showsPosition = (want: boolean) =>
  page.waitForFunction(
    ({ m, w }: { m: string; w: boolean }) =>
      (
        (window as any).haneulPerp.BonsaiCore.account.parentSubaccountPositions.data(
          (window as any).haneulPerp.supervisor.store.getState()
        ) ?? []
      ).some((p: any) => p.market === m && p.status === 'OPEN') === w,
    { m: MARKET, w: want },
    { timeout: 60_000 }
  );
const fill = (actions: Array<[string, unknown]>) =>
  page.evaluate((list: Array<[string, unknown]>) => {
    const { store } = (window as any).haneulPerp.supervisor;
    store.dispatch({ type: 'TradeForm/resetPrimaryInputs' });
    list.forEach(([type, payload]) => store.dispatch({ type: `TradeForm/${type}`, payload }));
  }, actions);
// The order form's submit button and the notifications on the page.
const screen = () =>
  page.evaluate(() => {
    const button = [...document.querySelectorAll('form footer button[type="submit"]')].find(
      (e) => (e as HTMLElement).offsetParent != null
    ) as HTMLButtonElement | undefined;
    return {
      button: button?.innerText.trim() ?? '',
      disabled: button?.disabled ?? true,
      notifications: [...document.querySelectorAll('aside')]
        .map((e) => (e as HTMLElement).innerText.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join(' | '),
    };
  });

await page.locator('form footer').first().waitFor({ timeout: 60_000 });

// 20 TUSD in, then 0.001 BTC bought and sold back through the app's own write path: the market's
// position object stays on chain with the 10x it traded at.
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
await showsPosition(true);
const closed = await supervisor('closeAllPositions');
check('and closed', closed.type === 'success', JSON.stringify(closed).slice(0, 160));
const flat = await readPosition(client, deployment, MARKET, acct.accountId);
check(
  'the position object stays on chain, flat, at 10x',
  flat != null && flat.base === 0n && flat.initialMarginRatio === ONE / 10n,
  `base ${flat?.base}, ratio ${flat?.initialMarginRatio}`
);
await showsPosition(false);
const selected = await page
  .waitForFunction(
    (m: string) =>
      (window as any).haneulPerp.supervisor.store.getState().raw.markets.selectedMarketLeverages
        .data?.[m],
    MARKET,
    { timeout: 60_000 }
  )
  .then((h: any) => h.jsonValue())
  .catch(() => undefined);
check("the app reads that 10x as the market's leverage", selected === 10, `${selected}`);

// Every leverage change the app makes from here on is counted, and the errors it logs kept.
await page.evaluate(() => {
  const w = window as any;
  const s = w.haneulPerp.supervisor;
  w.appErrors = [];
  window.addEventListener('dydx:log', (e: any) => {
    w.appErrors.push(`${e.detail.location}: ${e.detail.error?.message ?? ''}`);
  });
  w.leverageCalls = [];
  w.setMarketLeverageUncounted = s.setMarketLeverage.bind(s);
  s.setMarketLeverage = (args: unknown) => {
    w.leverageCalls.push(args);
    return w.setMarketLeverageUncounted(args);
  };
});
const sentBefore = new Set((await sentBy(me)).map((t) => t.digest));

// The same 0.001 BTC from the order form, as a trader opens it again.
await fill([
  ['setOrderType', 'MARKET'],
  ['setSide', 'BUY'],
  ['setSizeToken', '0.001'],
]);
await page.waitForTimeout(1_500);
const ready = await screen();
check(
  'the order form offers the market order',
  /place/i.test(ready.button) && !ready.disabled,
  `button "${ready.button}"${ready.disabled ? ' disabled' : ''}`
);
await page.locator('form footer button[type="submit"]:visible').click();
let reopened = flat;
let shown = await screen();
const settled = () => (reopened?.base ?? 0n) !== 0n || /error/i.test(shown.notifications);
for (let i = 0; i < 60 && !settled(); i += 1) {
  // eslint-disable-next-line no-await-in-loop
  await page.waitForTimeout(1_000);
  // eslint-disable-next-line no-await-in-loop
  reopened = await readPosition(client, deployment, MARKET, acct.accountId);
  // eslint-disable-next-line no-await-in-loop
  shown = await screen();
}
// Time for anything sent beside the order to land and be indexed.
await page.waitForTimeout(4_000);
shown = await screen();
reopened = await readPosition(client, deployment, MARKET, acct.accountId);
const leverageCalls: unknown[] = await page.evaluate(() => (window as any).leverageCalls);
const appErrors: string[] = await page.evaluate(() => (window as any).appErrors);
const sent = (await sentBy(me)).filter((t) => !sentBefore.has(t.digest)).reverse();
await page.screenshot({ path: `${screenshots}.png` });
console.log(`  screenshot ${screenshots}.png`);

console.log(`  leverage changes sent with the order: ${JSON.stringify(leverageCalls)}`);
console.log(`  transactions sent: ${describe(sent)}`);
console.log(`  notifications: ${shown.notifications || 'none'}`);
console.log(`  errors the app logged: ${appErrors.join(' | ').slice(0, 600) || 'none'}`);
console.log(`  position on chain: base ${reopened?.base}, ratio ${reopened?.initialMarginRatio}`);

check(
  'opening it again sends no leverage change beside the order',
  leverageCalls.length === 0,
  JSON.stringify(leverageCalls)
);
check(
  'the wallet sends one transaction, and it goes through',
  sent.length === 1 && sent[0]!.ok,
  describe(sent)
);
check('no order error is shown', !/error/i.test(shown.notifications), shown.notifications);
check(
  'the position is open again on chain, 0.001 BTC at 10x',
  reopened?.base === ONE / 1000n && reopened.initialMarginRatio === ONE / 10n,
  `base ${reopened?.base}, ratio ${reopened?.initialMarginRatio}`
);

await browser.close();
console.log(`\n${passed} checks passed`);

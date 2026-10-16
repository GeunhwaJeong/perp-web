/* eslint-disable no-console */

/**
 * What cancelling an order does with the collateral it took, against a running localnet. A
 * resting order takes its initial margin into its market; a cancel that leaves the market
 * without size or resting orders returns that collateral to the account balance in the same
 * transaction, and any other cancel goes alone, without prices. When the return cannot go
 * through (here: the price relay stopped, so the chain's prices go stale), the cancel still goes
 * alone and the collateral waits in the market. Places orders from the order form and cancels
 * them through the app's own cancel, checking each transaction and the balances on chain.
 * Requires the fixture (`fixture.mjs setup` + `push`), the indexer and API, and `pnpm dev`; it
 * stops the localnet price relay for one scenario and starts it again.
 *
 *   PLAYWRIGHT=/path/to/node_modules/playwright pnpm exec tsx scripts/haneul-localnet/cancel-return.ts
 */
import { bcs } from '@haneullabs/haneul/bcs';
import { HaneulGrpcClient } from '@haneullabs/haneul/grpc';
import { Ed25519Keypair } from '@haneullabs/haneul/keypairs/ed25519';
import { spawn, spawnSync } from 'node:child_process';
import { openSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { findPerpAccount, readAccount, type PerpDeployment } from '../../src/haneul/perp';

const require = createRequire(import.meta.url);
// eslint-disable-next-line import/no-dynamic-require -- resolved from an external checkout
const { chromium } = require(process.env.PLAYWRIGHT ?? 'playwright');

const ROOT = join(import.meta.dirname, '..', '..');
const url = process.env.APP_URL ?? 'http://localhost:5173/#/trade/BTC-USD';
const rpc = process.env.RPC_URL ?? 'http://127.0.0.1:9000';
const relayUrl = 'http://127.0.0.1:8787/v1/updates';
const screenshots = process.env.SCREENSHOTS ?? join(ROOT, '.localnet', 'cancel-return');
const MARKET = 'BTC-USD';
const FIXTURE = join(ROOT, 'scripts', 'haneul-localnet', 'fixture.mjs');
if (!/^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  throw new Error('cancel-return.ts stops and starts the localnet price relay; localnet only');
}
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
const tusd = (units: bigint) => (Number(units) / 1e6).toFixed(6);

const signed = (v: bigint) => (v >= 2n ** 255n ? v - 2n ** 256n : v);
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
// The position's collateral in coin units and its resting orders; empty before the first order.
const marketState = async (accountId: bigint) => {
  const found = await client.core
    .getDynamicField({
      parentId: deployment.markets[MARKET]!.clearingHouse,
      name: {
        type: `${deployment.packages.perpetuals}::keys::PositionKey`,
        bcs: PositionKeyBcs.serialize({ account_id: accountId }).toBytes(),
      },
    })
    .catch(() => undefined);
  if (found == null) return { collateral: 0n, base: 0n, pending: 0n };
  const p = PositionBcs.parse(found.dynamicField.value.bcs);
  return {
    collateral: signed(BigInt(p.collateral)) / 10n ** 12n,
    base: signed(BigInt(p.base_asset_amount)),
    pending: BigInt(p.pending_orders),
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
const describeSent = (sent: Sent[]) =>
  sent
    .map((t) => `${t.digest.slice(0, 8)} ${t.ok ? 'ok' : 'failed'} [${t.calls.join(' ')}]`)
    .join('; ') || 'none';

// The localnet price relay, which also serves the signed prices the app fetches.
const relay = {
  stop: () => spawnSync('pkill', ['-f', 'fixture.mjs push']),
  start: () => {
    const log = openSync(join(ROOT, '.localnet', 'push.log'), 'a');
    spawn(process.execPath, [FIXTURE, 'push'], {
      detached: true,
      stdio: ['ignore', log, log],
    }).unref();
  },
  up: async () => {
    for (let i = 0; i < 30; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const served = await fetch(relayUrl).then(
        (r) => r.ok,
        () => false
      );
      if (served) return true;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => {
        setTimeout(resolve, 1_000);
      });
    }
    return false;
  },
};

// A trader with gas and 1,000 TUSD in the wallet.
const fresh = Ed25519Keypair.generate();
const me = fresh.getPublicKey().toHaneulAddress();
const funded = spawnSync(process.execPath, [FIXTURE, 'fund', me, '1000'], { stdio: 'inherit' });
if (funded.status !== 0) throw new Error('fixture.mjs fund failed');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const appLogs: string[] = [];
// The supervisor's own account of each cancel, from its info logs.
page.on('console', (m: any) => {
  const logged = /^\[Info\] bonsai: AccountTransactionSupervisor: ([^{]+?) \{/.exec(m.text());
  if (logged && /cancel/.test(logged[1]!)) appLogs.push(logged[1]!);
});
page.on('pageerror', (e: Error) => {
  if (!/qs_|Bars are not available/.test(e.message)) console.log('  page error:', e.message);
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
await page.locator('form footer').first().waitFor({ timeout: 60_000 });

const deposited = await page.evaluate(async () =>
  JSON.parse(JSON.stringify(await (window as any).haneulPerp.supervisor.depositCollateral(50)))
);
check('50 TUSD deposited', deposited.type === 'success', JSON.stringify(deposited).slice(0, 120));
const acct = await findPerpAccount(client, deployment, me);
if (!acct) throw new Error('no account after the deposit');
const balance = async () => (await readAccount(client, acct.account)).collateral;

const fill = (actions: Array<[string, unknown]>) =>
  page.evaluate((list: Array<[string, unknown]>) => {
    const { store } = (window as any).haneulPerp.supervisor;
    store.dispatch({ type: 'TradeForm/resetPrimaryInputs' });
    list.forEach(([type, payload]) => store.dispatch({ type: `TradeForm/${type}`, payload }));
  }, actions);
const availableBalance = () =>
  page.evaluate(() => {
    const lines = document.body.innerText.split('\n').map((s) => s.trim());
    return lines[lines.indexOf('Available Balance') + 1] ?? '';
  });

/** Places an order from the form and returns the id it rests under, if it rests. */
const place = async (actions: Array<[string, unknown]>) => {
  const before = new Set((await sentBy(me)).map((t) => t.digest));
  await fill(actions);
  await page.waitForTimeout(1_500);
  await page.locator('form footer button[type="submit"]:visible').click();
  for (let i = 0; i < 60; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const sent = (await sentBy(me)).filter((t) => !before.has(t.digest));
    if (sent.length > 0) {
      // Time for the indexer to show the order, which the app's cancel looks up.
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(4_000);
      const posted = eventsNamed(sent[0]!, 'PostedOrder')[0];
      return { tx: sent[0]!, orderId: posted ? String(posted.order_id) : undefined };
    }
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(1_000);
  }
  throw new Error('the order form sent nothing');
};
const restingBuy = (price: string): Array<[string, unknown]> => [
  ['setOrderType', 'LIMIT'],
  ['setSide', 'BUY'],
  ['setLimitPrice', price],
  ['setSizeToken', '0.001'],
];

/** Cancels through the app and returns what it sent and the state it left. */
const cancel = async (orderId: string) => {
  const before = new Set((await sentBy(me)).map((t) => t.digest));
  const result = await page.evaluate(
    async (id: string) =>
      JSON.parse(
        JSON.stringify(await (window as any).haneulPerp.supervisor.cancelOrder({ orderId: id }))
      ),
    orderId
  );
  const sent = (await sentBy(me)).filter((t) => !before.has(t.digest)).reverse();
  const returned = sent.flatMap((t) => eventsNamed(t, 'DeallocatedCollateral'));
  const returnedUnits = returned.reduce((sum, e) => sum + BigInt(e.collateral), 0n);
  const market = await marketState(acct.accountId);
  console.log(
    `  cancel ${result.type}: ${describeSent(sent)}; returned ${tusd(returnedUnits)}; market ${tusd(market.collateral)} with ${market.pending} resting; balance ${tusd(await balance())}`
  );
  return { result, sent, returnedUnits, market };
};
const allocatedBy = (tx: Sent) =>
  eventsNamed(tx, 'AllocatedCollateral').reduce((sum, e) => sum + BigInt(e.collateral), 0n);

// 1. One resting order, cancelled: the market is left empty.
console.log('\n1 cancel the only resting order');
const startBalance = await balance();
const one = await place(restingBuy('99000'));
const oneAllocated = allocatedBy(one.tx);
console.log(`  placed ${one.orderId}, allocated ${tusd(oneAllocated)}`);
const c1 = await cancel(one.orderId!);
check(
  'the cancel goes through',
  c1.result.type === 'success' && c1.sent.length === 1 && c1.sent[0]!.ok
);
check(
  'it returns the collateral the order took, in the same transaction',
  c1.returnedUnits === oneAllocated && oneAllocated > 0n,
  `${tusd(c1.returnedUnits)} of ${tusd(oneAllocated)}`
);
check(
  'the market holds nothing and the balance is whole again',
  c1.market.collateral === 0n && (await balance()) === startBalance,
  `market ${tusd(c1.market.collateral)}, balance ${tusd(await balance())} vs ${tusd(startBalance)}`
);
await page.waitForTimeout(4_000);
const shown = await availableBalance();
check(
  'the account panel shows the balance available again',
  shown === `$${Number(tusd(startBalance)).toFixed(2)}`,
  shown
);
await page.screenshot({ path: `${screenshots}-1.png` });

// 2. Two resting orders: cancelling one leaves the market in use; the second empties it.
console.log('\n2 cancel one of two resting orders, then the other');
const first = await place(restingBuy('99000'));
const second = await place(restingBuy('98000'));
const twoAllocated = allocatedBy(first.tx) + allocatedBy(second.tx);
const c2a = await cancel(first.orderId!);
check(
  'cancelling one sends the cancel alone, without prices',
  c2a.result.type === 'success' &&
    c2a.sent.length === 1 &&
    c2a.sent[0]!.calls.join(' ') === 'cancel_orders',
  c2a.sent[0]?.calls.join(' ')
);
check(
  'and leaves the collateral with the order still resting',
  c2a.returnedUnits === 0n && c2a.market.collateral === twoAllocated && c2a.market.pending === 1n,
  `market ${tusd(c2a.market.collateral)}, ${c2a.market.pending} resting`
);
const c2b = await cancel(second.orderId!);
check(
  'cancelling the other returns all of it',
  c2b.returnedUnits === twoAllocated && c2b.market.collateral === 0n,
  `${tusd(c2b.returnedUnits)} of ${tusd(twoAllocated)}`
);

// 3. A resting order beside an open position: the position keeps the market in use.
console.log('\n3 cancel a resting order beside an open position');
await place([
  ['setOrderType', 'MARKET'],
  ['setSide', 'BUY'],
  ['setSizeToken', '0.001'],
]);
const beside = await place(restingBuy('99000'));
const beforeCancel = await marketState(acct.accountId);
const c3 = await cancel(beside.orderId!);
check(
  'the cancel goes alone, without prices',
  c3.result.type === 'success' &&
    c3.sent.length === 1 &&
    c3.sent[0]!.calls.join(' ') === 'cancel_orders',
  c3.sent[0]?.calls.join(' ')
);
check(
  "and leaves the position's collateral where it is",
  c3.returnedUnits === 0n && c3.market.collateral === beforeCancel.collateral,
  `${tusd(beforeCancel.collateral)} → ${tusd(c3.market.collateral)}`
);
const closed = await page.evaluate(async () =>
  JSON.parse(JSON.stringify(await (window as any).haneulPerp.supervisor.closeAllPositions()))
);
check('the position closes', closed.type === 'success', JSON.stringify(closed).slice(0, 120));
await page.waitForTimeout(4_000);

// 4. Stale prices: the return cannot go through, the cancel still must.
console.log('\n4 cancel with the price relay stopped');
const stale = await place(restingBuy('99000'));
const staleAllocated = allocatedBy(stale.tx);
relay.stop();
// The engine refuses prices older than ten seconds.
await page.waitForTimeout(15_000);
appLogs.length = 0;
const c4 = await cancel(stale.orderId!);
check(
  'the cancel goes through, alone',
  c4.result.type === 'success' &&
    c4.sent.length === 1 &&
    c4.sent[0]!.ok &&
    c4.sent[0]!.calls.join(' ') === 'cancel_orders',
  `${c4.result.type}: ${describeSent(c4.sent)}`
);
check(
  'the app sent it alone after the returns failed to simulate',
  appLogs.includes('cancel sent without returning collateral'),
  appLogs.join(' | ')
);
check(
  'and the collateral waits in the market',
  c4.returnedUnits === 0n && c4.market.collateral === staleAllocated && c4.market.pending === 0n,
  `market ${tusd(c4.market.collateral)}`
);
relay.start();
check('the price relay runs again', await relay.up());
await page.waitForTimeout(6_000);

// 5. The same order again: the collateral waiting in the market covers it.
console.log('\n5 the same order again, on the collateral left in the market');
const again = await place(restingBuy('99000'));
check(
  'it rests without taking more collateral',
  again.tx.ok && again.orderId != null && allocatedBy(again.tx) === 0n,
  `allocated ${tusd(allocatedBy(again.tx))}`
);
const c5 = await cancel(again.orderId!);
check(
  'and cancelling it returns what waited',
  c5.returnedUnits === staleAllocated && c5.market.collateral === 0n,
  `${tusd(c5.returnedUnits)}`
);

await page.screenshot({ path: `${screenshots}-5.png` });
await browser.close();
console.log(`\n${passed} checks passed, ${failed.length} failed`);
if (failed.length > 0) process.exit(1);

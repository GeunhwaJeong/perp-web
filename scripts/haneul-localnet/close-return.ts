/* eslint-disable no-console */

/**
 * Returning a market's collateral to the account balance, through the app against a running
 * localnet: a full close returns it, a partial close (asked or forced by a thin book) keeps all
 * of the remaining position's margin, and a withdrawal returns collateral left in a market
 * without a position on the way. Every check reads the account and the position from chain.
 * Requires the fixture (`fixture.mjs setup` + `push`), the indexer and API, and `pnpm dev`.
 *
 *   PLAYWRIGHT=/path/to/node_modules/playwright pnpm exec tsx scripts/haneul-localnet/close-return.ts
 */
import { HaneulGrpcClient } from '@haneullabs/haneul/grpc';
import { Ed25519Keypair } from '@haneullabs/haneul/keypairs/ed25519';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import {
  findPerpAccount,
  listCollateralCoins,
  readAccount,
  readPosition,
  returnableCollateral,
  type PerpDeployment,
} from '../../src/haneul/perp';

const require = createRequire(import.meta.url);
// eslint-disable-next-line import/no-dynamic-require -- resolved from an external checkout
const { chromium } = require(process.env.PLAYWRIGHT ?? 'playwright');

const ROOT = join(import.meta.dirname, '..', '..');
const url = process.env.APP_URL ?? 'http://localhost:5173/#/trade/BTC-USD';
const API = process.env.API_URL ?? 'http://127.0.0.1:3002';
const MARKET = 'BTC-USD';
const deployment: PerpDeployment = JSON.parse(
  readFileSync(join(ROOT, 'public/configs/haneul/perp.localnet.json'), 'utf8')
);
const client = new HaneulGrpcClient({ network: 'localnet', baseUrl: 'http://127.0.0.1:9000' });

const ONE = 10n ** 18n;
const UNIT = 10n ** 6n; // TUSD
const PER_UNIT = 10n ** 12n; // ifixed collateral per TUSD unit

let passed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) throw new Error(`FAIL ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}${detail ? ` (${detail})` : ''}`);
};
const signed = (raw: bigint) => (raw >= 2n ** 255n ? raw - 2n ** 256n : raw);
const tusd = (units: bigint) => `${Number(units) / 1e6}`;

// A trader with gas and 20,000 TUSD in the wallet, no trading account yet.
const fresh = Ed25519Keypair.generate();
const me = fresh.getPublicKey().toHaneulAddress();
const funded = spawnSync(
  process.execPath,
  [join(ROOT, 'scripts', 'haneul-localnet', 'fixture.mjs'), 'fund', me, '20000'],
  { stdio: 'inherit' }
);
if (funded.status !== 0) throw new Error('fixture.mjs fund failed');

const browser = await chromium.launch();
const page = await browser.newPage();
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
// The withdrawal path reads market status from the indexer; wait until the app has it.
await page.waitForFunction(
  (m: string) =>
    (window as any).haneulPerp.BonsaiCore.markets.markets.data(
      (window as any).haneulPerp.supervisor.store.getState()
    )?.[m]?.status === 'ACTIVE',
  MARKET,
  { timeout: 60_000 }
);

const supervisor = (method: string, ...args: unknown[]) =>
  page.evaluate(
    async ({ m, a }: { m: string; a: unknown[] }) => {
      const r = await (window as any).haneulPerp.supervisor[m](...a);
      return JSON.parse(JSON.stringify(r));
    },
    { m: method, a: args }
  );
const payload = (over: Record<string, unknown>) => ({
  subaccountNumber: 0,
  transferToSubaccountAmount: undefined,
  marketId: MARKET,
  clobPairId: 0,
  type: 'MARKET',
  side: 'BUY',
  price: 105_000,
  size: 0.01,
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
  ...over,
});
const place = (over: Record<string, unknown>) =>
  supervisor('placeOrder', payload(over), 'TradeForm');
// "Close all positions" works from the positions the indexer reports, so it waits until the app
// shows the size the chain holds.
const closeAll = async () => {
  const position = await readPosition(client, deployment, MARKET, accountId);
  const size = Number(signed(position!.base)) / 1e18;
  await page.waitForFunction(
    ({ m, want }: { m: string; want: number }) =>
      (
        (window as any).haneulPerp.BonsaiCore.account.parentSubaccountPositions.data(
          (window as any).haneulPerp.supervisor.store.getState()
        ) ?? []
      ).some(
        (p: any) =>
          p.market === m && p.status === 'OPEN' && Math.abs(p.signedSize.toNumber() - want) < 1e-9
      ),
    { m: MARKET, want: size },
    { timeout: 60_000 }
  );
  return supervisor('closeAllPositions');
};

let accountId: bigint;
let accountObject: string;
const chain = async () => {
  const [account, position, coins] = await Promise.all([
    readAccount(client, accountObject),
    readPosition(client, deployment, MARKET, accountId),
    listCollateralCoins(client, deployment, me),
  ]);
  return {
    balance: account.collateral,
    wallet: coins.reduce((sum, c) => sum + c.balance, 0n),
    base: position ? signed(position.base) : 0n,
    collateral: position ? signed(position.collateral) : 0n,
    imr: position?.initialMarginRatio ?? 0n,
    pending: position?.pendingOrders ?? 0n,
    returnable: position ? returnableCollateral(position, deployment.collateral.decimals) : 0n,
  };
};
const describe = (s: Awaited<ReturnType<typeof chain>>) =>
  `balance ${tusd(s.balance)}, base ${Number(s.base) / 1e18}, collateral ${
    Number(s.collateral / PER_UNIT) / 1e6
  }, imr ${Number(s.imr) / 1e18}`;
const ok = (r: any) => r.type === 'success';

// 0. account
let r = await supervisor('depositCollateral', 19_000);
check('deposit opens the account with 19,000', ok(r), JSON.stringify(r).slice(0, 120));
const acct = await findPerpAccount(client, deployment, me);
if (!acct) throw new Error('no account');
accountId = acct.accountId;
accountObject = acct.account;
let s = await chain();
check('account balance 19,000 on chain', s.balance === 19_000n * UNIT, describe(s));

// The write path refuses TWAP before signing.
r = await place({
  type: 'TWAP',
  twapParameters: { duration: 300, interval: 30, priceTolerance: 1 },
});
const afterTwap = await chain();
check(
  'a TWAP order is refused and nothing changes',
  r.type === 'failure' &&
    /TWAP orders are not available yet/.test(r.errorString) &&
    afterTwap.balance === s.balance &&
    afterTwap.base === 0n,
  r.errorString
);

// A. full close returns everything
r = await place({ size: 0.01 });
check('A: open 0.01 BTC long', ok(r), JSON.stringify(r).slice(0, 120));
const openA = await chain();
check(
  'A: position open with margin moved from the balance',
  openA.base === ONE / 100n && openA.collateral > 0n && openA.balance < s.balance,
  describe(openA)
);
r = await closeAll();
check('A: close all positions', ok(r), JSON.stringify(r).slice(0, 120));
const closedA = await chain();
check(
  'A: position flat with no collateral left in the market',
  closedA.base === 0n && closedA.collateral === 0n && closedA.pending === 0n,
  describe(closedA)
);
const backA = closedA.balance - openA.balance;
check(
  'A: the market collateral came back to the balance, less the round trip cost',
  backA <= openA.collateral / PER_UNIT && openA.collateral / PER_UNIT - backA < 3n * UNIT,
  `in market ${tusd(openA.collateral / PER_UNIT)}, back ${tusd(backA)}`
);
check('A: ratio restored to the market ratio', closedA.imr === ONE / 10n, describe(closedA));

// B1. a partial close keeps the remaining position's margin, at a 5x ratio of its own
r = await supervisor('setMarketLeverage', { marketId: MARKET, leverage: 5 });
check('B: leverage 5x', ok(r), JSON.stringify(r).slice(0, 120));
r = await place({ size: 0.02 });
check('B1: open 0.02 BTC long at 5x', ok(r), JSON.stringify(r).slice(0, 120));
const openB = await chain();
check('B1: ratio 0.2', openB.imr === ONE / 5n, describe(openB));
r = await place({ side: 'SELL', price: 95_000, size: 0.01, reduceOnly: true });
check('B1: reduce-only sell of half', ok(r), JSON.stringify(r).slice(0, 120));
const halfB = await chain();
check(
  'B1: half the position is left and the balance did not move',
  halfB.base === ONE / 100n && halfB.balance === openB.balance,
  describe(halfB)
);
check(
  'B1: the market kept its collateral (only the closed half realized)',
  halfB.collateral > 0n && (openB.collateral - halfB.collateral) / PER_UNIT < 2n * UNIT,
  `${describe(openB)} -> ${describe(halfB)}`
);
check('B1: ratio restored to 0.2, not left at 1', halfB.imr === ONE / 5n, describe(halfB));
r = await closeAll();
const closedB = await chain();
check(
  'B1: closing the rest returns the collateral',
  ok(r) && closedB.base === 0n && closedB.collateral === 0n && closedB.balance > halfB.balance,
  describe(closedB)
);

// B2. a full-size close the book can only partly fill keeps all of the remainder's margin
r = await place({ size: 0.6 });
check('B2: open 0.6 BTC long', ok(r), JSON.stringify(r).slice(0, 120));
const openB2 = await chain();
const book = await (await fetch(`${API}/v4/orderbooks/perpetualMarket/${MARKET}`)).json();
const bestBid = Number(book.bids[0].price);
const bestBidSize = Number(book.bids[0].size);
check(
  'B2: the best bid holds less than the position',
  bestBidSize > 0 && bestBidSize < 0.6,
  `${bestBidSize} at ${bestBid}`
);
r = await place({
  type: 'LIMIT',
  side: 'SELL',
  size: 0.6,
  price: bestBid,
  timeInForce: 'IOC',
  execution: 'DEFAULT',
  reduceOnly: true,
});
check('B2: full-size reduce-only IOC at the best bid', ok(r), JSON.stringify(r).slice(0, 120));
const partB2 = await chain();
check(
  'B2: only the best bid level filled and a position remains',
  partB2.base > 0n && partB2.base < openB2.base,
  describe(partB2)
);
check(
  'B2: nothing came back to the balance',
  partB2.balance === openB2.balance,
  `${tusd(openB2.balance)} -> ${tusd(partB2.balance)}`
);
check(
  "B2: the remainder kept the market's collateral (only the filled part realized)",
  (openB2.collateral - partB2.collateral) / PER_UNIT < 100n * UNIT,
  `${describe(openB2)} -> ${describe(partB2)}`
);
check('B2: ratio restored to 0.2', partB2.imr === ONE / 5n, describe(partB2));
r = await closeAll();
const closedB2 = await chain();
check(
  'B2: closing the rest returns the collateral',
  ok(r) && closedB2.base === 0n && closedB2.collateral === 0n,
  describe(closedB2)
);

// C. collateral left in a market by a close that was not reduce-only comes out with a withdrawal
r = await place({ size: 0.01 });
check('C: open 0.01 BTC long', ok(r), JSON.stringify(r).slice(0, 120));
r = await place({ side: 'SELL', price: 95_000, size: 0.01, reduceOnly: false });
check('C: plain sell of exactly the position', ok(r), JSON.stringify(r).slice(0, 120));
const stuck = await chain();
check(
  'C: flat, but the collateral stayed in the market',
  stuck.base === 0n && stuck.collateral > 0n && stuck.returnable > 0n,
  describe(stuck)
);
let balances = (await supervisor('collateralBalances')).payload;
check(
  'C: the withdrawable balance counts that collateral',
  Math.abs(balances.withdrawable - Number(stuck.balance + stuck.returnable) / 1e6) < 1e-9,
  `shown ${balances.withdrawable}, balance ${tusd(stuck.balance)} + market ${tusd(stuck.returnable)}`
);
const all = Number(stuck.balance + stuck.returnable) / 1e6;
r = await supervisor('withdrawCollateral', all);
check('C: withdraw all of it in one transaction', ok(r), JSON.stringify(r).slice(0, 160));
const out = await chain();
check(
  'C: balance and market emptied, the wallet paid',
  out.balance === 0n &&
    out.collateral === 0n &&
    out.wallet - stuck.wallet === stuck.balance + stuck.returnable,
  `${describe(out)}, wallet +${tusd(out.wallet - stuck.wallet)}`
);
check('C: ratio restored to 0.2', out.imr === ONE / 5n, describe(out));

// C'. collateral backing an open position is not withdrawable
r = await supervisor('depositCollateral', 1_000);
r = await place({ size: 0.01 });
check("C': open 0.01 BTC long", ok(r), JSON.stringify(r).slice(0, 120));
const held = await chain();
balances = (await supervisor('collateralBalances')).payload;
check(
  "C': the withdrawable balance leaves the open position's collateral out",
  Math.abs(balances.withdrawable - Number(held.balance) / 1e6) < 1e-9,
  `shown ${balances.withdrawable}, ${describe(held)}`
);
r = await supervisor('withdrawCollateral', Number(held.balance) / 1e6 + 50);
const after = await chain();
check(
  "C': withdrawing into it is refused and nothing moves",
  r.type === 'failure' &&
    /free collateral/.test(r.errorString) &&
    after.balance === held.balance &&
    after.collateral === held.collateral &&
    after.base === held.base,
  r.errorString
);
r = await closeAll();
const end = await chain();
check(
  "C': closing returns it",
  ok(r) && end.base === 0n && end.collateral === 0n && end.balance > held.balance,
  describe(end)
);

await browser.close();
console.log(`\n${passed} close-return checks passed`);

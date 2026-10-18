/* eslint-disable no-console */

/**
 * Fee tiers as the engine prices them, through the app against a running localnet. The Fees page
 * is to show the schedule's volume and staking tiers and where the account sits in them; a stake
 * deposited in the staking tier registry is to show its discount before and after; and once a
 * session has cached the discounted tier on the market, the trade receipt is to price the next
 * order at it, as the engine then charges. Every expected value is read from chain here, so the
 * script runs the same against the app before and after a change. Requires the fixture
 * (`fixture.mjs setup` + `push` + `seed`), the indexer and API, and `pnpm dev`.
 *
 *   PLAYWRIGHT=/path/to/node_modules/playwright pnpm exec tsx scripts/haneul-localnet/fees.ts
 */
import { bcs } from '@haneullabs/haneul/bcs';
import { HaneulGrpcClient } from '@haneullabs/haneul/grpc';
import { Ed25519Keypair } from '@haneullabs/haneul/keypairs/ed25519';
import { Transaction } from '@haneullabs/haneul/transactions';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import {
  findPerpAccount,
  signAndExecuteWith,
  simulateReturnValues,
  type PerpDeployment,
} from '../../src/haneul/perp';

const require = createRequire(import.meta.url);
// eslint-disable-next-line import/no-dynamic-require -- resolved from an external checkout
const { chromium } = require(process.env.PLAYWRIGHT ?? 'playwright');

const ROOT = join(import.meta.dirname, '..', '..');
const APP = (process.env.APP_URL ?? 'http://localhost:5173/#/trade/BTC-USD').replace(/#.*$/, '');
const API = process.env.API_URL ?? 'http://127.0.0.1:3002';
const screenshots = process.env.SCREENSHOTS ?? join(ROOT, '.localnet', 'fees');
const MARKET = 'BTC-USD';
const HANEUL = 1_000_000_000n;
// The fixture's schedule: one volume tier at the market's rates, 10% off from 100 HANEUL.
const STAKE = 100n * HANEUL;
const SIZE = '0.02';

const deployment: PerpDeployment = JSON.parse(
  readFileSync(join(ROOT, 'public/configs/haneul/perp.localnet.json'), 'utf8')
);
const client = new HaneulGrpcClient({ network: 'localnet', baseUrl: 'http://127.0.0.1:9000' });

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
const gas = BigInt((await client.core.getBalance({ owner: me })).balance.balance);
check('the wallet holds enough HANEUL to stake', gas > STAKE + HANEUL, `${gas / HANEUL} HANEUL`);

/** What the engine holds for the account: window volume, registry stake, cached multipliers. */
const engine = async () => {
  const account = await findPerpAccount(client, deployment, me);
  if (!account) throw new Error('no trading account');
  const ch = deployment.markets[MARKET]!.clearingHouse;
  const coin = deployment.collateral.coinType;
  const { perpetuals, perpetualsFees, stakingTiers } = deployment.packages;
  const tx = new Transaction();
  tx.setSender(me);
  const [epoch] = tx.moveCall({ target: '0x2::tx_context::epoch' });
  const [now] = tx.moveCall({ target: '0x2::clock::timestamp_ms', arguments: [tx.object('0x6')] });
  tx.moveCall({
    target: `${perpetualsFees}::fees::volume`,
    typeArguments: [coin],
    arguments: [tx.object(account.account), epoch!],
  });
  tx.moveCall({
    target: `${stakingTiers}::registry::active_stake`,
    arguments: [tx.object(deployment.fees!.tierRegistry), tx.pure.address(me)],
  });
  tx.moveCall({
    target: `${perpetuals}::clearing_house::fee_multiplier`,
    typeArguments: [coin],
    arguments: [tx.object(ch), tx.pure.u64(account.accountId), now!],
  });
  const out = await simulateReturnValues(tx, client);
  const u256 = (b: Uint8Array | undefined) => Number(BigInt(bcs.u256().parse(b!))) / 1e18;
  return {
    volume: u256(out[2]![0]),
    stake: Number(BigInt(bcs.u64().parse(out[3]![0]!))) / 1e9,
    taker: u256(out[4]![0]),
    maker: u256(out[4]![1]),
  };
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
page.on('pageerror', (e: Error) => {
  if (!/qs_|Bars are not available/.test(e.message)) console.log('  page error:', e.message);
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
const marketBuy = () =>
  supervisor(
    'placeOrder',
    {
      subaccountNumber: 0,
      transferToSubaccountAmount: undefined,
      marketId: MARKET,
      clobPairId: 0,
      type: 'MARKET',
      side: 'BUY',
      price: 105_000,
      size: Number(SIZE),
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

/** The Fees page's text, and the staking tab's once it is open (empty without the tab). */
const feesPage = async (shot: string) => {
  await page.goto(`${APP}#/portfolio/fees`, { waitUntil: 'domcontentloaded' });
  await page.getByText('Your Taker Fee').first().waitFor({ timeout: 60_000 });
  // The engine reads arrive after the page; give them the time a visitor would.
  await page.waitForTimeout(6_000);
  const text = () =>
    page.evaluate(() => (document.querySelector('main') ?? document.body).innerText);
  const fees = await text();
  await page.screenshot({ path: `${screenshots}-${shot}.png` });
  const tab = page.getByRole('tab', { name: 'Staking Tiers' });
  let staking = '';
  if ((await tab.count()) > 0) {
    await tab.first().click();
    await page.waitForTimeout(1_000);
    staking = await text();
    await page.screenshot({ path: `${screenshots}-${shot}-staking.png` });
  }
  return { fees: fees.replace(/\s+/g, ' '), staking: staking.replace(/\s+/g, ' ') };
};
const usd = (v: number) =>
  `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// 1. An account that has traded once, without a stake.
console.log('\n1 the Fees page of an account without a stake');
// Three buys of 0.02 BTC near 100,000 hold about 600 of margin at the market's 10x.
const deposit = await supervisor('depositCollateral', 1000);
check('1000 TUSD deposited', deposit.type === 'success', deposit.type);
const first = await marketBuy();
check(`market buy ${SIZE} BTC`, first.type === 'success', JSON.stringify(first).slice(0, 120));
const unstaked = await engine();
console.log(`  engine ${JSON.stringify(unstaked)}`);
const before = await feesPage('1');
console.log(`  page "${before.fees.slice(0, 260)}"`);
check('the account is in fee tier 1', before.fees.includes('Fee Tier 1'));
check(
  'the trailing volume is the engine window, over 14 days',
  before.fees.includes('Trailing Volume 14d') && before.fees.includes(usd(unstaked.volume)),
  usd(unstaked.volume)
);
check('the fee tier table marks the account’s tier', /\b1 You\b/.test(before.fees));
check('without a stake the staking tier is None', before.fees.includes('Staking Tier None'));
check(
  'the staking tab shows the level, its stake, its discount and the rates after it',
  /Level 1/.test(before.staking) &&
    /100 HANEUL/.test(before.staking) &&
    /10(\.00)?%/.test(before.staking) &&
    before.staking.includes('0.0450%') &&
    before.staking.includes('0.0180%'),
  before.staking.slice(
    before.staking.indexOf('Staking Tier'),
    before.staking.indexOf('Staking Tier') + 160
  )
);

// 2. A stake deposited in the staking tier registry, and a session to cache its tier.
console.log('\n2 a stake of 100 HANEUL in the staking tier registry');
const { response: epochInfo } = await client.ledgerService.getEpoch({
  readMask: { paths: ['system_state.validators.active_validators.address'] },
});
const validator = epochInfo.epoch?.systemState?.validators?.activeValidators[0]?.address;
if (!validator) throw new Error('no active validator to stake with');
const stakeTx = new Transaction();
const [coin] = stakeTx.splitCoins(stakeTx.gas, [stakeTx.pure.u64(STAKE)]);
const [staked] = stakeTx.moveCall({
  target: '0x3::haneul_system::request_add_stake_non_entry',
  arguments: [stakeTx.object('0x5'), coin!, stakeTx.pure.address(validator)],
});
stakeTx.moveCall({
  target: `${deployment.packages.stakingTiers}::registry::deposit`,
  arguments: [stakeTx.object(deployment.fees!.tierRegistry), staked!],
});
await signAndExecuteWith(keypair, stakeTx, client);
const second = await marketBuy();
check(`market buy ${SIZE} BTC after staking`, second.type === 'success', second.type);
const staked2 = await engine();
console.log(`  engine ${JSON.stringify(staked2)}`);
check('the registry holds the stake', staked2.stake === 100, `${staked2.stake}`);
check(
  'the session cached 10% off on the market',
  Math.abs(staked2.taker - 0.9) < 1e-9 && Math.abs(staked2.maker - 0.9) < 1e-9,
  `${staked2.taker} / ${staked2.maker}`
);

// 3. The Fees page with the stake.
console.log('\n3 the Fees page with the stake');
const after = await feesPage('3');
console.log(`  page "${after.fees.slice(0, 300)}"`);
check(
  'your fees show the tier rate struck through before the discounted one',
  /0\.0200% 0\.0180%/.test(after.fees) && /0\.0500% 0\.0450%/.test(after.fees)
);
check(
  'the staking tier is Level 1, 10% off',
  /Staking Tier Level 1/.test(after.fees) && /10(\.00)?% off fees/.test(after.fees)
);
check('the staked amount is the registry stake', /Staked HANEUL 100(\.00)?\b/.test(after.fees));
check('the staking table marks the account’s level', /Level 1 You/.test(after.staking));

// 4. The receipt of the next order, and what the engine charges for it.
console.log('\n4 the receipt and the engine fee of the next order');
await page.goto(`${APP}#/trade/${MARKET}`, { waitUntil: 'domcontentloaded' });
await page.locator('form footer').first().waitFor({ timeout: 60_000 });
await page.waitForTimeout(3_000);
await page.evaluate((size: string) => {
  const { store } = (window as any).haneulPerp.supervisor;
  store.dispatch({ type: 'TradeForm/resetPrimaryInputs' });
  store.dispatch({ type: 'TradeForm/setOrderType', payload: 'MARKET' });
  store.dispatch({ type: 'TradeForm/setSide', payload: 'BUY' });
  store.dispatch({ type: 'TradeForm/setSizeToken', payload: size });
}, SIZE);
await page.waitForTimeout(1_500);
const receipt = await page.evaluate(() => {
  const footer = [...document.querySelectorAll('form footer')].find(
    (e) => (e as HTMLElement).offsetParent != null
  );
  return ((footer?.closest('form') as HTMLElement | null)?.innerText ?? '').replace(/\s+/g, ' ');
});
await page.screenshot({ path: `${screenshots}-4.png` });
const receiptFee = Number(receipt.match(/Fee \$([\d.,]+)/)?.[1]?.replace(/,/g, '') ?? NaN);
const third = await marketBuy();
check(`market buy ${SIZE} BTC at the cached tier`, third.type === 'success', third.type);
await page.waitForTimeout(5_000);
const fills = await (
  await fetch(
    `${API}/v4/fills/parentSubaccountNumber?address=${me}&parentSubaccountNumber=0&limit=10`
  )
).json();
const latest = fills.fills?.[0];
const charged = latest ? Number(latest.fee) / (Number(latest.price) * Number(latest.size)) : NaN;
const expected = latest ? Number(latest.price) * Number(latest.size) * 0.00045 : NaN;
console.log(`  receipt fee $${receiptFee}, engine fee ${latest?.fee} at ${charged}`);
check('the engine charged 0.045% for the order', Math.abs(charged - 0.00045) < 1e-7, `${charged}`);
check(
  'the receipt priced the order at the discounted rate',
  Math.abs(receiptFee - expected) < 0.006,
  `receipt $${receiptFee}, at 0.045% $${expected.toFixed(4)}`
);

await browser.close();
console.log(`  screenshots ${screenshots}-{1,3,4}.png`);
console.log(`\n${passed} checks passed, ${failed.length} failed`);
if (failed.length > 0) process.exit(1);

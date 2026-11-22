/* eslint-disable no-console */

/**
 * Orders of a check account, placed from outside the page, for checks of the page that need an
 * order in a state the page alone does not get to: a bid that another account has filled in part.
 * The page is then read, and its Cancel All pressed, in a browser logged in as the same account.
 *
 *   pnpm exec tsx scripts/haneul-mainnet/shadow-check.ts <step> --env <mainnet|local> [options]
 *
 *   status   --address <0x…>   what the account holds: wallet, balance, position, open orders.
 *                              Reads only, and does not read the phrase.
 *   deposit  --tusd <amount>   wallet TUSD into the account's balance (a first deposit on a local
 *                              network creates the account).
 *   bid      --btc <size>      a bid one tick above the best bid, good for 30 minutes, then waits
 *                              (`--wait <seconds>`, 900 by default) until part of it has filled
 *                              and says how much. `--no-wait` only places it.
 *   cancel                     cancels every open order of the account on the market.
 *   close                      closes the position at market, within 1% of the best price; the
 *                              market's collateral returns to the balance once nothing is left.
 *
 * `deposit`, `bid`, `cancel` and `close` sign with the account's key, derived from its 12-word
 * phrase in `--phrase-file` (~/.sigma/check.phrase by default; the file must not be readable by
 * others). They build the transaction the page builds (`src/haneul/perp`) and simulate it. They
 * send it only with `--execute`, and on mainnet only with `--confirm-mainnet` as well.
 *
 * `--env local` reads `public/configs/haneul/perp.localnet.json` (or `--deployment <file>`), the
 * node on 127.0.0.1:9000 and the API on 127.0.0.1:3002.
 */
import { HaneulGrpcClient } from '@haneullabs/haneul/grpc';
import { fromBase58, toHex } from '@haneullabs/haneul/utils';
import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { isValidMnemonic, keypairFromMnemonic } from '../../src/haneul/account/mnemonic';
import {
  collateralToUnits,
  eventsOf,
  fetchPriceUpdates,
  findPerpAccount,
  hasMarketPosition,
  limitPriceToUnits,
  listCollateralCoins,
  ORDER_TYPE,
  PerpTransactionBuilder,
  priceToUnits,
  ratioToRestore,
  readPosition,
  selectPriceUpdates,
  SIDE,
  signAndExecuteWith,
  sizeToUnits,
  unitsToCollateral,
  type PerpDeployment,
} from '../../src/haneul/perp';

const ROOT = join(import.meta.dirname, '..', '..');
const MAINNET_CHAIN_ID = 'a0053d9e';
const MARKET = 'BTC-USD';
const HANEUL_TYPE = '0x2::haneul::HANEUL';
/** The largest order and deposit this script sends: it is for checks, not for trading. */
const MAX_BTC = 0.1;
const MAX_TUSD = 10_000;
const BID_GOOD_FOR_MS = 30 * 60_000;
const CLOSE_SLIPPAGE = 0.01;

const args = process.argv.slice(2);
const step = args[0];
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const fail = (message: string): never => {
  console.error(`shadow-check: ${message}`);
  process.exit(1);
};

const env = value('--env');
if (env !== 'mainnet' && env !== 'local') fail('--env mainnet or --env local is required');
const mainnet = env === 'mainnet';
const execute = flag('--execute');
if (mainnet && execute && !flag('--confirm-mainnet')) {
  fail('on mainnet --execute needs --confirm-mainnet as well');
}

const deploymentFile =
  value('--deployment') ??
  join(ROOT, 'public', 'configs', 'haneul', mainnet ? 'perp.mainnet.json' : 'perp.localnet.json');
const deployment: PerpDeployment = JSON.parse(readFileSync(deploymentFile, 'utf8'));
if (mainnet !== (deployment.network === 'mainnet')) {
  fail(`${deploymentFile} describes ${deployment.network}, not ${env}`);
}
const market = deployment.markets[MARKET] ?? fail(`${MARKET} is not in ${deploymentFile}`);
const api = mainnet ? 'https://api.sigma.haneul.io' : 'http://127.0.0.1:3002';
const client = new HaneulGrpcClient({
  network: mainnet ? 'mainnet' : 'localnet',
  baseUrl: mainnet ? 'https://rpc.haneul.io' : 'http://127.0.0.1:9000',
});
const builder = new PerpTransactionBuilder(deployment);
const decimals = Number(deployment.collateral.decimals);
const tick = Number(market.tickSize) / 1e9;

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
const short = (id: string) => `${id.slice(0, 10)}…`;
const usd = (n: number | { toNumber(): number }) =>
  (typeof n === 'number' ? n : n.toNumber()).toLocaleString('en-US', { maximumFractionDigits: 6 });
/** A signed ifixed (1e18) value held as a two's complement `u256`. */
const ifixed = (raw: bigint) => Number(raw >= 2n ** 255n ? raw - 2n ** 256n : raw) / 1e18;

const checkChain = async () => {
  const { chainIdentifier } = await client.core.getChainIdentifier();
  const id = toHex(fromBase58(chainIdentifier).slice(0, 4));
  if (mainnet !== (id === MAINNET_CHAIN_ID)) {
    fail(`the node is on chain ${id}, which is ${mainnet ? 'not ' : ''}mainnet`);
  }
  return id;
};

const signer = () => {
  const file = value('--phrase-file') ?? join(homedir(), '.sigma', 'check.phrase');
  let mode: number;
  try {
    mode = statSync(file).mode;
  } catch {
    return fail(`no phrase file at ${file}`);
  }
  // eslint-disable-next-line no-bitwise
  if ((mode & 0o077) !== 0) fail(`${file} is readable by others; chmod 600 it`);
  const phrase = readFileSync(file, 'utf8');
  if (!isValidMnemonic(phrase)) fail(`${file} does not hold a valid 12-word phrase`);
  return keypairFromMnemonic(phrase);
};

const book = async () => {
  const res = await fetch(`${api}/v4/orderbooks/perpetualMarket/${MARKET}`);
  if (!res.ok) fail(`the API answered ${res.status} for the book`);
  const { bids, asks } = (await res.json()) as {
    bids: { price: string; size: string }[];
    asks: { price: string; size: string }[];
  };
  return {
    bid: bids[0] ? Number(bids[0].price) : undefined,
    ask: asks[0] ? Number(asks[0].price) : undefined,
  };
};

type ApiOrder = { id: string; side: string; size: string; totalFilled: string; price: string };

const openOrders = async (address: string): Promise<ApiOrder[]> => {
  const query = new URLSearchParams({ address, parentSubaccountNumber: '0', status: 'OPEN' });
  const res = await fetch(`${api}/v4/orders/parentSubaccountNumber?${query}`);
  if (!res.ok) fail(`the API answered ${res.status} for the orders`);
  const orders = (await res.json()) as (ApiOrder & { ticker: string; status: string })[];
  return orders.filter((o) => o.ticker === MARKET && o.status === 'OPEN');
};

const balanceOf = async (owner: string, coinType: string) => {
  try {
    const { balance } = await client.core.getBalance({ owner, coinType });
    return BigInt(balance.balance);
  } catch {
    return 0n;
  }
};

const describe = async (address: string) => {
  const [haneul, tusd, account, { bid, ask }] = await Promise.all([
    balanceOf(address, HANEUL_TYPE),
    balanceOf(address, deployment.collateral.coinType),
    findPerpAccount(client, deployment, address),
    book(),
  ]);
  console.log(`account ${short(address)} on ${env}`);
  console.log(
    `  wallet: ${(Number(haneul) / 1e9).toFixed(4)} HANEUL, ${usd(unitsToCollateral(tusd, decimals))} TUSD`
  );
  console.log(`  book: best bid ${bid ?? '-'}, best ask ${ask ?? '-'}`);
  if (!account) {
    console.log('  no trading account yet');
    return undefined;
  }
  const [position, orders] = await Promise.all([
    readPosition(client, deployment, MARKET, account.accountId),
    openOrders(address),
  ]);
  console.log(
    `  trading account #${account.accountId}: balance ${usd(unitsToCollateral(account.collateral, decimals))} TUSD`
  );
  console.log(
    position
      ? `  position: ${ifixed(position.base)} BTC, ${usd(ifixed(position.collateral))} TUSD in the market, resting ${position.pendingOrders > 0n ? 'orders' : 'nothing'}`
      : '  position: none on this market'
  );
  orders.forEach((o) =>
    console.log(`  open order: ${o.side} ${o.size} BTC at ${o.price}, filled ${o.totalFilled}`)
  );
  if (orders.length === 0) console.log('  open orders: none');
  return { account, position, orders };
};

/** Simulates, and with `--execute` signs and sends. Answers the events of what was sent. */
const send = async (
  what: string,
  tx: Parameters<typeof signAndExecuteWith>[1],
  keypair: ReturnType<typeof signer>
) => {
  const address = keypair.toHaneulAddress();
  console.log(`signing as ${short(address)}`);
  tx.setSenderIfNotSet(address);
  const simulated = await client.core.simulateTransaction({
    transaction: tx,
    include: { effects: true },
  });
  const effects = (simulated as { transaction?: { effects?: { status?: unknown } } }).transaction
    ?.effects;
  const status = JSON.stringify(effects?.status ?? simulated).slice(0, 300);
  if (!/"success":\s*true/.test(status)) fail(`${what}: the simulation did not succeed: ${status}`);
  if (!execute) {
    console.log(`${what}: simulated, would succeed. Nothing was sent (no --execute).`);
    return undefined;
  }
  const result = await signAndExecuteWith(keypair, tx, client);
  console.log(`${what}: sent, digest ${result.digest}`);
  return result;
};

const priceUpdates = async () =>
  selectPriceUpdates({
    client,
    deployment,
    market,
    updates: await fetchPriceUpdates(deployment),
  });

const steps: Record<string, () => Promise<void>> = {
  status: async () => {
    const address = value('--address');
    if (!address?.startsWith('0x')) fail('status needs --address <0x…>');
    await describe(address!);
  },

  deposit: async () => {
    const amount = Number(value('--tusd'));
    if (!(amount > 0) || amount > MAX_TUSD)
      fail(`deposit needs --tusd above 0, ${MAX_TUSD} at most`);
    const keypair = signer();
    const address = keypair.toHaneulAddress();
    const units = collateralToUnits(amount, decimals);
    const [account, coins] = await Promise.all([
      findPerpAccount(client, deployment, address),
      listCollateralCoins(client, deployment, address),
    ]);
    const held = coins.reduce((sum, c) => sum + c.balance, 0n);
    if (held < units) {
      fail(`the wallet holds ${usd(unitsToCollateral(held, decimals))} TUSD, less than ${amount}`);
    }
    const ids = coins.map((c) => c.objectId);
    if (!account && mainnet) fail('no trading account; on mainnet the page creates it at sign-up');
    const tx = account
      ? builder.deposit({ ref: account, coins: ids, amount: units })
      : builder.createAccount({ sender: address, coins: ids, amount: units });
    await send(`deposit of ${amount} TUSD${account ? '' : ' into a new account'}`, tx, keypair);
  },

  bid: async () => {
    const size = Number(value('--btc'));
    if (!(size > 0) || size > MAX_BTC) fail(`bid needs --btc above 0, ${MAX_BTC} at most`);
    const keypair = signer();
    const address = keypair.toHaneulAddress();
    const account =
      (await findPerpAccount(client, deployment, address)) ?? fail('no trading account');
    const { bid, ask } = await book();
    if (bid == null || ask == null)
      fail('the book has no bid or no ask to place the order between');
    const price = bid! + tick < ask! ? bid! + tick : bid!;
    const before = await readPosition(client, deployment, MARKET, account.accountId);
    const createPosition = !(await hasMarketPosition(
      client,
      deployment,
      MARKET,
      account.accountId,
      address
    ));
    const tx = builder.session({
      ref: account,
      marketId: MARKET,
      orders: [
        {
          kind: 'limit',
          isAsk: SIDE.BID,
          size: sizeToUnits(size, market.lotSize),
          price: priceToUnits(price, market.tickSize),
          orderType: ORDER_TYPE.GTC,
          clientOrderId: BigInt(Math.floor(Math.random() * 2 ** 31)),
          reduceOnly: false,
          expirationTimestampMs: BigInt(Date.now() + BID_GOOD_FOR_MS),
        },
      ],
      options: {
        createPosition,
        initialMarginRatio: createPosition ? BigInt(market.initialMarginRatio) : undefined,
        allocateMissingMargin: true,
        deallocateFreeCollateral: false,
      },
      priceUpdates: await priceUpdates(),
    });
    const what = `bid of ${size} BTC at ${usd(price)} (best bid ${usd(bid!)}, best ask ${usd(ask!)})`;
    const result = await send(what, tx, keypair);
    if (!result) return;
    const posted = eventsOf(result.events, '::events::PostedOrder');
    if (posted.length === 0) fail('the order did not rest on the book');
    if (flag('--no-wait')) return;

    const held = before ? ifixed(before.base) : 0;
    const waitMs = Number(value('--wait') ?? 900) * 1000;
    const until = Date.now() + waitMs;
    console.log(`waiting up to ${waitMs / 1000} s for another account to fill part of it…`);
    while (Date.now() < until) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(4000);
      // eslint-disable-next-line no-await-in-loop
      const now = await readPosition(client, deployment, MARKET, account.accountId);
      const filled = Math.round(((now ? ifixed(now.base) : 0) - held) * 1e6) / 1e6;
      if (filled > 0) {
        const rest = Math.round((size - filled) * 1e6) / 1e6;
        console.log(
          rest > 0
            ? `FILLED IN PART: ${filled} of ${size} BTC, ${rest} BTC still rests. Open the page again and press Cancel All now.`
            : `filled in full (${filled} BTC): nothing rests. Close the position and place a larger bid.`
        );
        return;
      }
    }
    console.log('nothing filled in that time. The bid still rests; cancel it or wait longer.');
  },

  cancel: async () => {
    const keypair = signer();
    const address = keypair.toHaneulAddress();
    const account =
      (await findPerpAccount(client, deployment, address)) ?? fail('no trading account');
    const orders = await openOrders(address);
    if (orders.length === 0) {
      console.log('no open orders to cancel');
      return;
    }
    const tx = builder.cancelOrders({
      ref: account,
      marketId: MARKET,
      orderIds: orders.map((o) => BigInt(o.id)),
    });
    await send(`cancel of ${orders.length} open order(s)`, tx, keypair);
  },

  close: async () => {
    const keypair = signer();
    const address = keypair.toHaneulAddress();
    const account =
      (await findPerpAccount(client, deployment, address)) ?? fail('no trading account');
    const position = await readPosition(client, deployment, MARKET, account.accountId);
    const base = position ? ifixed(position.base) : 0;
    if (!position || base === 0) {
      console.log('no position to close');
      return;
    }
    const isAsk = base > 0;
    const { bid, ask } = await book();
    const best = isAsk ? bid : ask;
    if (best == null) fail('the book has nothing to close against');
    const worst = best! * (isAsk ? 1 - CLOSE_SLIPPAGE : 1 + CLOSE_SLIPPAGE);
    const tx = builder.session({
      ref: account,
      marketId: MARKET,
      orders: [
        {
          kind: 'limit',
          isAsk,
          size: sizeToUnits(Math.abs(base), market.lotSize),
          price: limitPriceToUnits(worst, isAsk, market.tickSize),
          orderType: ORDER_TYPE.IOC,
          clientOrderId: BigInt(Math.floor(Math.random() * 2 ** 31)),
          reduceOnly: true,
        },
      ],
      options: {
        allocateMissingMargin: true,
        deallocateFreeCollateral: false,
        returnCollateralIfFlat: {
          restoreImr: ratioToRestore(position.initialMarginRatio, [
            BigInt(market.initialMarginRatio),
          ]),
        },
      },
      priceUpdates: await priceUpdates(),
    });
    const side = isAsk ? 'sell' : 'buy';
    const what = `close: ${side} ${Math.abs(base)} BTC within ${CLOSE_SLIPPAGE * 100}% of ${usd(best!)}`;
    const result = await send(what, tx, keypair);
    if (!result) return;
    await sleep(3000);
    await describe(address);
  },
};

const run =
  steps[step ?? ''] ?? fail(`unknown step ${step}; one of ${Object.keys(steps).join(', ')}`);
const chain = await checkChain();
console.log(`chain ${chain} (${env})${execute ? '' : ' — reads and simulations only'}`);
await run();

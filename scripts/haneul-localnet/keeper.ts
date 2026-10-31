/* eslint-disable no-console */

/**
 * The order tickets' path from the front end to the keeper (perp-liquidator's perp-keeper) on
 * the localnet fixture. The details are made with `tickets.ts` and handed to the keeper, whose
 * commitment must be the one computed here; the ticket is created with the builders on that
 * commitment and the keeper executes it once its trigger price crosses:
 *
 * 1. a stop loss / take profit on the dev wallet's long, on the index price, waits at the price
 *    and closes the long once the price the service signs falls through its stop loss;
 * 2. a standalone stop on the book price places its resting bid, which is then canceled.
 *
 * Needs the fixture (`setup`, then `push` with its relay), the indexer and the API, and the
 * keeper on its key (`fixture.mjs keeper`), this deployment file, the indexer's database and the
 * price service. Moves the price the service signs and puts it back. With PAUSE_FILE set, it
 * waits for that file before moving the price, so the waiting ticket can be looked at.
 *
 *   pnpm exec tsx scripts/haneul-localnet/keeper.ts
 */
import { HaneulGrpcClient } from '@haneullabs/haneul/grpc';
import { Ed25519Keypair } from '@haneullabs/haneul/keypairs/ed25519';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  eventsOf,
  findPerpAccount,
  hasMarketPosition,
  listCollateralCoins,
  ORDER_TYPE,
  PerpTransactionBuilder,
  SIDE,
  collateralToUnits,
  leverageToImr,
  priceToIfixed,
  priceToUnits,
  readPosition,
  signAndExecuteWith,
  sizeToUnits,
  standaloneStopCommitment,
  stopLossTakeProfitCommitment,
  type PerpDeployment,
  type StandaloneStopDetails,
  type StopLossTakeProfitDetails,
} from '../../src/haneul/perp';

const ROOT = join(import.meta.dirname, '..', '..');
const KEEPER = process.env.KEEPER_URL ?? 'http://127.0.0.1:9191';
const API = process.env.API_URL ?? 'http://127.0.0.1:3002';
const PAUSE_FILE = process.env.PAUSE_FILE;
const deployment: PerpDeployment = JSON.parse(
  readFileSync(join(ROOT, 'public/configs/haneul/perp.localnet.json'), 'utf8')
);
const signer = Ed25519Keypair.fromSecretKey(
  readFileSync(join(ROOT, '.localnet/dev-wallet.key'), 'utf8').trim()
);
const client = new HaneulGrpcClient({ network: 'localnet', baseUrl: 'http://127.0.0.1:9000' });
const me = signer.getPublicKey().toHaneulAddress();
const b = new PerpTransactionBuilder(deployment);
const MARKET = 'BTC-USD';
const market = deployment.markets[MARKET]!;
const D = deployment.collateral.decimals;
const SIZE = sizeToUnits('0.1');

let passed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) throw new Error(`FAIL ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}${detail ? ` (${detail})` : ''}`);
};
const run = (tx: ReturnType<typeof b.session>) => signAndExecuteWith(signer, tx, client);
const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
const waitFor = async <T>(what: string, f: () => Promise<T | undefined>, seconds = 45) => {
  const deadline = Date.now() + seconds * 1000;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop -- polls until the condition holds
    const value = await f().catch(() => undefined);
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`FAIL timed out waiting for ${what}`);
    // eslint-disable-next-line no-await-in-loop -- polls until the condition holds
    await sleep(500);
  }
};
const sameId = (a: string, c: string) =>
  a.replace(/^0x/, '').padStart(64, '0').toLowerCase() ===
  c.replace(/^0x/, '').padStart(64, '0').toLowerCase();

const fixture = (...args: string[]) => {
  const r = spawnSync(
    process.execPath,
    [join(ROOT, 'scripts', 'haneul-localnet', 'fixture.mjs'), ...args],
    { encoding: 'utf8' }
  );
  if (r.status !== 0) throw new Error(`fixture.mjs ${args.join(' ')} failed: ${r.stderr}`);
};
const signedPrice = () => {
  const state = JSON.parse(readFileSync(join(ROOT, '.localnet/fixture-state.json'), 'utf8'));
  return Number(BigInt(state.btcPrice) / 10n ** 18n);
};

// ---------------------------------------------------------------- the keeper's side

type KeeperStatus = {
  mode: string;
  address?: string;
  executions: number;
  tickets: Record<string, number>;
  last_execution?: { ticket_id: string; kind: string; digest: string };
};
const keeperStatus = async () => (await (await fetch(`${KEEPER}/status`)).json()) as KeeperStatus;

/** What the keeper takes: the details' fields with integers as decimal strings, salt as hex. */
const decimal = (v: bigint | undefined) => (v === undefined ? undefined : v.toString());
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const stopLossTakeProfitJson = (d: StopLossTakeProfitDetails) => ({
  clearingHouse: d.clearingHouse,
  expireTimestampMs: decimal(d.expireTimestampMs),
  isLimitOrder: d.isLimitOrder,
  triggerPriceType: d.triggerPriceType,
  stopLossPrice: decimal(d.stopLossPrice),
  takeProfitPrice: decimal(d.takeProfitPrice),
  positionIsAsk: d.positionIsAsk,
  size: d.size.toString(),
  price: d.price.toString(),
  orderType: d.orderType.toString(),
  salt: hex(d.salt),
});
const standaloneStopJson = (d: StandaloneStopDetails) => ({
  clearingHouse: d.clearingHouse,
  expireTimestampMs: decimal(d.expireTimestampMs),
  isLimitOrder: d.isLimitOrder,
  triggerPriceType: d.triggerPriceType,
  stopIndexPrice: d.stopIndexPrice.toString(),
  triggerAtOrAbove: d.triggerAtOrAbove,
  side: d.side,
  size: d.size.toString(),
  price: d.price.toString(),
  orderType: d.orderType.toString(),
  reduceOnly: d.reduceOnly,
  salt: hex(d.salt),
});
const handIn = async (kind: string, details: object) => {
  const response = await fetch(`${KEEPER}/v1/details`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind, details }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`the keeper refused the details: ${JSON.stringify(body)}`);
  return body as { commitment: string; known: boolean };
};

// ---------------------------------------------------------------- the indexer's view

type ApiTicket = { id: string; type: string; status: string };
const apiTickets = async () => {
  const url = new URL(`${API}/v4/orderTickets/parentSubaccountNumber`);
  url.searchParams.set('address', me);
  url.searchParams.set('parentSubaccountNumber', '0');
  return ((await (await fetch(url)).json()) as { tickets: ApiTicket[] }).tickets;
};
const apiTicket = async (id: string) => (await apiTickets()).find((t) => sameId(t.id, id));
const openOrders = async () => {
  const url = new URL(`${API}/v4/orders/parentSubaccountNumber`);
  url.searchParams.set('address', me);
  url.searchParams.set('parentSubaccountNumber', '0');
  url.searchParams.set('status', 'OPEN');
  url.searchParams.set('ticker', MARKET);
  return (await (await fetch(url)).json()) as Array<{ id: string; price: string; side: string }>;
};

// ---------------------------------------------------------------- the check

const status = await keeperStatus();
check('the keeper executes live', status.mode === 'live', status.mode);
const keeper = status.address!;
check('under its own key, not the dev wallet', !!keeper && !sameId(keeper, me), keeper);
const price0 = signedPrice();
console.log(`dev wallet ${me}, keeper ${keeper}, BTC at $${price0.toLocaleString()}`);

// The dev wallet's account, long 0.1 BTC.
let acct = await findPerpAccount(client, deployment, me);
if (!acct) {
  const coins = await listCollateralCoins(client, deployment, me);
  await run(
    b.createAccount({
      sender: me,
      coins: coins.map((c) => c.objectId),
      amount: collateralToUnits(100_000, D),
    })
  );
  acct = await findPerpAccount(client, deployment, me);
}
check('account', acct != null, `account #${acct!.accountId}`);
const ref = { account: acct!.account, cap: acct!.cap };
const hadPosition = await hasMarketPosition(client, deployment, MARKET, acct!.accountId, me);
const before = await readPosition(client, deployment, MARKET, acct!.accountId);
check('no position left by an earlier run', !before || before.base === 0n, `${before?.base}`);
await run(
  b.session({
    ref,
    marketId: MARKET,
    orders: [{ kind: 'market', isAsk: SIDE.BID, size: SIZE, reduceOnly: false }],
    options: hadPosition
      ? undefined
      : {
          createPosition: true,
          initialMarginRatio: leverageToImr(10),
          allocate: collateralToUnits(20_000, D),
        },
  })
);
const long = await readPosition(client, deployment, MARKET, acct!.accountId);
check('long 0.1', long?.base === SIZE * 10n ** 9n, `${long?.base}`);

try {
  // 1. stop loss / take profit on the index price
  const stopLoss = Math.round(price0 * 0.99);
  const takeProfit = Math.round(price0 * 1.05);
  const sltp = b.stopLossTakeProfitTicket({
    ref,
    executors: [keeper],
    details: {
      clearingHouse: market.clearingHouse,
      isLimitOrder: false,
      triggerPriceType: 0,
      stopLossPrice: priceToIfixed(stopLoss),
      takeProfitPrice: priceToIfixed(takeProfit),
      positionIsAsk: false,
      size: SIZE,
      price: 0n,
      orderType: ORDER_TYPE.GTC,
    },
  });
  const ours = hex(stopLossTakeProfitCommitment(sltp.details));
  const answer = await handIn('stopLossTakeProfit', stopLossTakeProfitJson(sltp.details));
  check("the keeper's commitment is the front end's", answer.commitment === ours, ours);
  let r = await run(sltp.tx);
  const ticketA = String(eventsOf(r.events, '::events::CreatedStopOrderTicket')[0]!.ticket_id);
  check(`ticket for a stop loss at $${stopLoss.toLocaleString()}`, !!ticketA, ticketA);
  const listed = await waitFor('the ticket in the API', async () =>
    (await apiTicket(ticketA))?.status === 'OPEN' ? true : undefined
  );
  check('the API lists it open, where the Stop Orders tab reads it', listed);
  await waitFor('the keeper to see it', async () =>
    (await keeperStatus()).tickets.waiting ? true : undefined
  );
  await sleep(3_000);
  check(
    'the keeper sees it waiting and leaves it at the price',
    (await apiTicket(ticketA))?.status === 'OPEN' && (await keeperStatus()).tickets.waiting === 1,
    JSON.stringify((await keeperStatus()).tickets)
  );
  if (PAUSE_FILE) {
    console.log(`  paused: touch ${PAUSE_FILE} to move the price`);
    // eslint-disable-next-line no-await-in-loop -- waits for the file
    while (!existsSync(PAUSE_FILE)) await sleep(1_000);
  }

  // 1.5% down, inside the signed source's step limit for a round of the price service.
  const fallen = Math.round(price0 * 0.985);
  fixture('price', String(fallen));
  const executed = await waitFor('the keeper to execute the stop loss', async () => {
    const s = await keeperStatus();
    return s.last_execution && sameId(s.last_execution.ticket_id, ticketA) ? s : undefined;
  });
  check(
    `at $${fallen.toLocaleString()} the keeper executes it`,
    executed.last_execution!.kind === 'stop_loss_take_profit',
    executed.last_execution!.digest
  );
  const closed = await readPosition(client, deployment, MARKET, acct!.accountId);
  check('the long is closed', closed?.base === 0n, `${closed?.base}`);
  const gone = await waitFor('the API to see it executed', async () =>
    (await apiTicket(ticketA))?.status === 'EXECUTED' ? true : undefined
  );
  check('the API lists it executed', gone);
  fixture('price', String(price0));
  await sleep(4_000);

  // 2. standalone stop on the book price, resting far below the market
  const restAt = Math.round(price0 * 0.9);
  const ordersBefore = (await openOrders()).length;
  const standalone = b.standaloneStopTicket({
    ref,
    executors: [keeper],
    details: {
      clearingHouse: market.clearingHouse,
      isLimitOrder: true,
      triggerPriceType: 1,
      stopIndexPrice: priceToIfixed(1),
      triggerAtOrAbove: true,
      side: SIDE.BID,
      size: SIZE,
      price: priceToUnits(restAt),
      orderType: ORDER_TYPE.GTC,
      reduceOnly: false,
    },
  });
  const ours2 = hex(standaloneStopCommitment(standalone.details));
  const answer2 = await handIn('standaloneStop', standaloneStopJson(standalone.details));
  check("the keeper's commitment is the front end's again", answer2.commitment === ours2, ours2);
  r = await run(standalone.tx);
  const ticketB = String(eventsOf(r.events, '::events::CreatedStopOrderTicket')[0]!.ticket_id);
  await waitFor('the keeper to execute the standalone stop', async () => {
    const s = await keeperStatus();
    return s.last_execution && sameId(s.last_execution.ticket_id, ticketB) ? s : undefined;
  });
  check('the keeper executes the standalone stop on the book price', true, ticketB);
  const resting = await waitFor('its bid in the API', async () => {
    const orders = await openOrders();
    return orders.length > ordersBefore ? orders : undefined;
  });
  const bid = resting.find((o) => Number(o.price) === restAt);
  check(
    `its bid rests at $${restAt.toLocaleString()}`,
    !!bid,
    JSON.stringify(resting).slice(0, 200)
  );
  await run(b.cancelOrders({ ref, marketId: MARKET, orderIds: [BigInt(bid!.id)] }));
  check('canceled', true);
} finally {
  if (signedPrice() !== price0) fixture('price', String(price0));
}

console.log(`\n${passed} checks passed`);

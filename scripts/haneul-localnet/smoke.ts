/* eslint-disable no-console */

/**
 * Exercises the perpetuals transaction builders against a running localnet with the dev
 * wallet. Run the fixture first (`fixture.mjs setup`, then `fixture.mjs push` in another shell).
 *
 *   pnpm exec tsx scripts/haneul-localnet/smoke.ts
 */
import { HaneulGrpcClient } from '@haneullabs/haneul/grpc';
import { Ed25519Keypair } from '@haneullabs/haneul/keypairs/ed25519';
import { readFileSync } from 'node:fs';
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
  readAccount,
  signAndExecuteWith,
  sizeToUnits,
  type PerpDeployment,
} from '../../src/haneul/perp';

const ROOT = join(import.meta.dirname, '..', '..');
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
const D = deployment.collateral.decimals;

let passed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) throw new Error(`FAIL ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}${detail ? ` (${detail})` : ''}`);
};
const run = (tx: ReturnType<typeof b.session>) => signAndExecuteWith(signer, tx, client);

console.log(`dev wallet ${me}`);

// 1. account
let acct = await findPerpAccount(client, deployment, me);
if (!acct) {
  const coins = await listCollateralCoins(client, deployment, me);
  check('collateral coins funded', coins.length > 0, `${coins.length} coins`);
  const r = await run(
    b.createAccount({
      sender: me,
      coins: coins.map((c) => c.objectId),
      amount: collateralToUnits(100_000, D),
    })
  );
  const created = eventsOf(r.events, '::events::CreatedAccount');
  check('CreatedAccount event', created.length === 1);
  acct = await findPerpAccount(client, deployment, me);
}
check('account discovered from the cap', acct != null, `account #${acct!.accountId}`);
check('account holds collateral', acct!.collateral > 0n, `${acct!.collateral}`);
const ref = { account: acct!.account, cap: acct!.cap };
const hadPosition = await hasMarketPosition(client, deployment, MARKET, acct!.accountId, me);
check(
  'position existence readable through simulation',
  typeof hadPosition === 'boolean',
  `exists=${hadPosition}`
);

// 2. resting limit bid with position setup and 10x leverage
let r = await run(
  b.session({
    ref,
    marketId: MARKET,
    orders: [
      {
        kind: 'limit',
        isAsk: SIDE.BID,
        size: sizeToUnits('0.1'),
        price: priceToUnits(99_900),
        orderType: ORDER_TYPE.GTC,
        reduceOnly: false,
        clientOrderId: 42n,
      },
    ],
    options: {
      createPosition: !hadPosition,
      initialMarginRatio: leverageToImr(10),
      allocate: hadPosition ? undefined : collateralToUnits(20_000, D),
    },
  })
);
const posted = eventsOf(r.events, '::events::PostedOrder');
check('limit bid rests', posted.length === 1, `order ${posted[0]?.order_id}`);
check(
  'client order id carried',
  String((posted[0]?.client_order_id as string | null) ?? '') === '42'
);
const restingId = BigInt(posted[0]!.order_id as string);

// 3. cancel it
r = await run(b.cancelOrders({ ref, marketId: MARKET, orderIds: [restingId] }));
check('cancel emits CanceledOrder', eventsOf(r.events, '::events::CanceledOrder').length === 1);

// 4. market buy fills against the maker ladder
r = await run(
  b.session({
    ref,
    marketId: MARKET,
    orders: [{ kind: 'market', isAsk: SIDE.BID, size: sizeToUnits('0.1'), reduceOnly: false }],
  })
);
const taker = eventsOf(r.events, '::events::FilledTakerOrder');
check('market buy filled', taker.length === 1, `fees ${taker[0]?.taker_fees}`);
const volumeAfterBuy = BigInt(String(eventsOf(r.events, '::fees::TierApplied')[0]?.volume ?? 0));
if (deployment.fees) {
  // Ending through the fee-tier extension records the volume and caches the multipliers.
  const tier = eventsOf(r.events, '::fees::TierApplied');
  check(
    'session ended through the fee tiers',
    tier.length === 1 && BigInt(String(tier[0]!.volume)) > 0n,
    `volume ${tier[0]?.volume}, taker x${tier[0]?.taker_multiplier}`
  );
}

// 5. close with a reduce-only market sell
r = await run(
  b.session({
    ref,
    marketId: MARKET,
    orders: [{ kind: 'market', isAsk: SIDE.ASK, size: sizeToUnits('0.1'), reduceOnly: true }],
  })
);
check('position closed', eventsOf(r.events, '::events::FilledTakerOrder').length === 1);
if (deployment.fees) {
  const volumeAfterClose = BigInt(
    String(eventsOf(r.events, '::fees::TierApplied')[0]?.volume ?? 0)
  );
  check(
    'the account volume window accumulates across sessions',
    volumeAfterClose > volumeAfterBuy,
    `${volumeAfterBuy} -> ${volumeAfterClose}`
  );
}

// 6. rejection surfaces as a named abort
let aborted = '';
try {
  await run(
    b.session({
      ref,
      marketId: MARKET,
      orders: [
        {
          kind: 'limit',
          isAsk: SIDE.BID,
          size: sizeToUnits('0.1'),
          price: priceToUnits(99_900.5),
          orderType: ORDER_TYPE.GTC,
          reduceOnly: false,
        },
      ],
    })
  );
} catch (e) {
  aborted = (e as Error).message;
}
check('tick violation mapped', aborted === 'Price is not a multiple of the tick size', aborted);

// 7. withdraw
const before = (await readAccount(client, ref.account)).collateral;
r = await run(b.withdraw({ ref, amount: collateralToUnits(1_000, D), recipient: me }));
check('withdraw event', eventsOf(r.events, '::events::WithdrewCollateral').length === 1);
const after = (await readAccount(client, ref.account)).collateral;
check('account balance dropped by 1,000', before - after === collateralToUnits(1_000, D));

// 8. standalone stop ticket: create, then execute it ourselves to prove the commitment encoding
const stop = b.standaloneStopTicket({
  ref,
  executors: [me],
  details: {
    clearingHouse: deployment.markets[MARKET]!.clearingHouse,
    isLimitOrder: true,
    triggerPriceType: 0,
    stopIndexPrice: priceToIfixed(200_000),
    triggerAtOrAbove: false,
    side: SIDE.BID,
    size: sizeToUnits('0.1'),
    price: priceToUnits(99_800),
    orderType: ORDER_TYPE.GTC,
    reduceOnly: false,
  },
});
r = await run(stop.tx);
const ticket = eventsOf(r.events, '::events::CreatedStopOrderTicket')[0];
check('stop ticket created', ticket != null, JSON.stringify(ticket).slice(0, 80));
const ticketId = String(ticket!.ticket_id ?? ticket!.id ?? ticket!.stop_order_ticket_id);
r = await run(
  b.executeStandaloneStop({ ref, marketId: MARKET, ticketId, details: stop.details, recipient: me })
);
check(
  'stop ticket executed: commitment matches Move encoding',
  eventsOf(r.events, '::events::PostedOrder').length === 1
);
const stopOrderId = BigInt(eventsOf(r.events, '::events::PostedOrder')[0]!.order_id as string);
await run(b.cancelOrders({ ref, marketId: MARKET, orderIds: [stopOrderId] }));

// 9. TWAP ticket create + cancel
const twap = b.twapTicket({
  ref,
  marketId: MARKET,
  executors: [me],
  details: {
    executionGapMs: 60_000n,
    executionTimeUncertaintyMs: 5_000n,
    chunksAmount: 4n,
    smallTailMergeThresholdBps: 500n,
    timeForRetryMs: 30_000n,
    amountUncertaintyBps: 100n,
    maxOneExecutionAmountBps: 3_000n,
    side: SIDE.BID,
    size: sizeToUnits('0.4'),
    maxSlippageBps: 50n,
    reduceOnly: false,
  },
});
r = await run(twap.tx);
const twapTicket = eventsOf(r.events, '::events::CreatedTWAPOrderTicket')[0];
check('twap ticket created', twapTicket != null, JSON.stringify(twapTicket).slice(0, 80));
const twapId = String(twapTicket!.ticket_id ?? twapTicket!.id ?? twapTicket!.twap_order_ticket_id);
r = await run(b.cancelTwapTicket({ ref, marketId: MARKET, ticketId: twapId, recipient: me }));
check('twap ticket canceled', r.events.length > 0);

console.log(`\nall ${passed} checks passed`);

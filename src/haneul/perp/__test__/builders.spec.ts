import { bcs } from '@haneullabs/haneul/bcs';
import type { Transaction } from '@haneullabs/haneul/transactions';
import { fromBase64 } from '@haneullabs/haneul/utils';
import { describe, expect, it } from 'vitest';

import { returnableCollateral, type PerpPositionState } from '../accounts';
import { PerpTransactionBuilder } from '../builders';
import type { PerpDeployment } from '../config';
import { IFIXED_ONE } from '../units';

const id = (byte: string) => `0x${byte.repeat(32)}`;

const deployment = {
  network: 'localnet',
  packages: {
    perpetuals: id('01'),
    perpetualsOrders: id('02'),
    perpetualsFees: id('03'),
    stakingTiers: id('04'),
    marketMakingVault: id('05'),
    oracleAggregator: id('06'),
    authorityCap: id('07'),
  },
  registry: id('0e'),
  collateral: { coinType: `${id('08')}::tusd::TUSD`, decimals: 6, priceFeedStorage: id('c0') },
  fees: { schedule: id('f0'), tierRegistry: id('f1') },
  ticketExecutors: [],
  ticketGas: '1000000',
  markets: {
    'BTC-USD': {
      marketId: 'BTC-USD',
      symbol: 'BTC',
      clearingHouse: id('11'),
      basePriceFeedStorage: id('b0'),
      lotSize: '1000000',
      tickSize: '1000000000',
      initialMarginRatio: '100000000000000000',
    },
  },
} as unknown as PerpDeployment;

const ref = { account: id('aa'), cap: id('ab') };
const RESTORE = 333_333_333_333_333_334n;

const moveCalls = (tx: Transaction) =>
  tx
    .getData()
    .commands.map((command, index) => ({ command, index }))
    .filter(({ command }) => command.$kind === 'MoveCall')
    .map(({ command, index }) => ({ index, call: command.MoveCall! }));

const pureU256 = (tx: Transaction, argument: { $kind: string; Input?: number }) => {
  const input = tx.getData().inputs[argument.Input!]!;
  return BigInt(bcs.u256().parse(fromBase64(input.Pure!.bytes)));
};

const closeSession = (returnCollateralIfFlat?: { restoreImr: bigint }) =>
  new PerpTransactionBuilder(deployment).session({
    ref,
    marketId: 'BTC-USD',
    orders: [
      { kind: 'limit', isAsk: true, size: 1_000_000n, price: 1n, orderType: 3n, reduceOnly: true },
    ],
    options: { returnCollateralIfFlat },
  });

describe('session with returnCollateralIfFlat', () => {
  it('returns idle collateral at a ratio of 1 after the session, then restores the ratio', () => {
    const tx = closeSession({ restoreImr: RESTORE });
    const calls = moveCalls(tx);
    const names = calls.map(({ call }) => `${call.module}::${call.function}`);
    const end = names.indexOf('fees::end_session');
    expect(names.slice(end)).toEqual([
      'fees::end_session',
      'clearing_house::set_position_initial_margin_ratio',
      'clearing_house::deallocate_free_collateral',
      'clearing_house::set_position_initial_margin_ratio',
      'clearing_house::share',
    ]);

    // Each step works on the clearing house the session handed back, before it is shared.
    const endIndex = calls[end]!.index;
    calls.slice(end + 1).forEach(({ call }) => {
      expect(call.arguments[0]).toMatchObject({
        $kind: 'NestedResult',
        NestedResult: [endIndex, 0],
      });
    });

    const [, raise, , restore] = calls.slice(end).map(({ call }) => call);
    expect(pureU256(tx, raise!.arguments[3]!)).toBe(IFIXED_ONE);
    expect(pureU256(tx, restore!.arguments[3]!)).toBe(RESTORE);
  });

  it('leaves the market alone without the option', () => {
    const names = moveCalls(closeSession()).map(({ call }) => call.function);
    expect(names).not.toContain('deallocate_free_collateral');
    expect(names).not.toContain('set_position_initial_margin_ratio');
    expect(names.at(-1)).toBe('share');
  });
});

describe('withdraw with returns', () => {
  it('returns idle market collateral to the balance before withdrawing', () => {
    const builder = new PerpTransactionBuilder(deployment);
    const tx = builder.withdraw({
      ref,
      amount: 5_000_000n,
      recipient: id('cc'),
      returns: [{ marketId: 'BTC-USD', restoreImr: RESTORE }],
    });
    const names = moveCalls(tx).map(({ call }) => call.function);
    expect(names).toEqual([
      'set_position_initial_margin_ratio',
      'deallocate_free_collateral',
      'set_position_initial_margin_ratio',
      'withdraw_collateral',
    ]);
  });

  it('is a plain withdrawal without returns', () => {
    const tx = new PerpTransactionBuilder(deployment).withdraw({
      ref,
      amount: 5_000_000n,
      recipient: id('cc'),
    });
    expect(moveCalls(tx).map(({ call }) => call.function)).toEqual(['withdraw_collateral']);
  });
});

describe('cancel with returns', () => {
  it('returns the collateral of the market it empties, after the cancel', () => {
    const tx = new PerpTransactionBuilder(deployment).cancelOrdersAcrossMarkets({
      ref,
      byMarket: { 'BTC-USD': [7n] },
      returns: [{ marketId: 'BTC-USD', restoreImr: RESTORE }],
    });
    const calls = moveCalls(tx).map(({ call }) => call);
    expect(calls.map((call) => call.function)).toEqual([
      'cancel_orders',
      'set_position_initial_margin_ratio',
      'deallocate_free_collateral',
      'set_position_initial_margin_ratio',
    ]);
    expect(pureU256(tx, calls[1]!.arguments[3]!)).toBe(IFIXED_ONE);
    expect(pureU256(tx, calls[3]!.arguments[3]!)).toBe(RESTORE);
  });

  it('is the cancel alone without returns', () => {
    const tx = new PerpTransactionBuilder(deployment).cancelOrdersAcrossMarkets({
      ref,
      byMarket: { 'BTC-USD': [7n] },
    });
    expect(moveCalls(tx).map(({ call }) => call.function)).toEqual(['cancel_orders']);
  });
});

describe('returnableCollateral', () => {
  const position = (over: Partial<PerpPositionState>): PerpPositionState => ({
    initialMarginRatio: 100_000_000_000_000_000n,
    pendingOrders: 0n,
    base: 0n,
    // 12.345678 TUSD as the engine's ifixed of coin units.
    collateral: 12_345_678n * 10n ** 12n + 999n,
    ...over,
  });

  it('is all of the collateral, rounded down to coin units, for an empty position', () => {
    expect(returnableCollateral(position({}), 6)).toBe(12_345_678n);
  });

  it('is nothing while the position has size or resting orders', () => {
    expect(returnableCollateral(position({ base: 10n ** 15n }), 6)).toBe(0n);
    expect(returnableCollateral(position({ pendingOrders: 1n }), 6)).toBe(0n);
  });

  it('is nothing for negative collateral', () => {
    expect(returnableCollateral(position({ collateral: 2n ** 256n - 5n }), 6)).toBe(0n);
  });
});

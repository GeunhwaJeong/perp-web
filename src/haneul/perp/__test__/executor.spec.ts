import type { Transaction } from '@haneullabs/haneul/transactions';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { inWalletTurn, signAndExecute } from '../executor';

/** What the wallet was asked to sign, in the order it was asked. */
const signed: string[] = [];
/** Orders resting on a made-up chain; every transaction that is final takes one off. */
const chain = { resting: 0 };

vi.mock('../../dAppKit', () => ({
  dAppKit: {
    stores: {
      $currentNetwork: { get: () => 'localnet' },
      $connection: { get: () => ({ account: { address: '0xabc' } }) },
    },
    getClient: () => ({}),
    signAndExecuteTransaction: async ({ transaction }: { transaction: unknown }) => {
      signed.push(String(transaction));
      // Final some moments later, as on a chain.
      await new Promise((resolve) => {
        setTimeout(resolve, 5);
      });
      chain.resting -= 1;
      return { digest: String(transaction) };
    },
  },
}));

vi.mock('../execution', async (original) => ({
  ...(await original<typeof import('../execution')>()),
  settleTransaction: async (_client: unknown, result: unknown) => result,
}));

const tx = (name: string) => name as unknown as Transaction;

describe("an operation in the wallet's turn", () => {
  beforeEach(() => {
    signed.length = 0;
    chain.resting = 3;
  });

  it('reads the chain as the operations before it left it', async () => {
    // A cancel that says how many orders it found resting when it was its turn.
    const cancel = (name: string) =>
      inWalletTurn(async (send) => {
        const found = chain.resting;
        await send(tx(name));
        return found;
      });
    // Asked for at the same moment, as the X of three rows pressed in a row.
    expect(await Promise.all([cancel('a'), cancel('b'), cancel('c')])).toEqual([3, 2, 1]);
    expect(signed).toEqual(['a', 'b', 'c']);
  });

  it('reads the same for all of them when it reads before its turn', async () => {
    // What the cancel did before: it looked first and waited for its turn only to send.
    const cancel = async (name: string) => {
      const found = chain.resting;
      await signAndExecute(tx(name));
      return found;
    };
    expect(await Promise.all([cancel('a'), cancel('b'), cancel('c')])).toEqual([3, 3, 3]);
  });

  it('sends more than once within its turn, and the next operation waits for all of it', async () => {
    const twice = inWalletTurn(async (send) => {
      await send(tx('first try'));
      await send(tx('second try'));
    });
    const after = signAndExecute(tx('after'));
    await Promise.all([twice, after]);
    expect(signed).toEqual(['first try', 'second try', 'after']);
  });

  it('gives its failure to its caller and lets the next operation go', async () => {
    const failing = inWalletTurn(async () => {
      throw new Error('nothing to cancel');
    });
    const after = signAndExecute(tx('after'));
    await expect(failing).rejects.toThrow('nothing to cancel');
    await after;
    expect(signed).toEqual(['after']);
  });
});

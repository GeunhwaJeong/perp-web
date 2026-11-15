import { afterEach, describe, expect, it, vi } from 'vitest';

import { createExclusive, transactionTurn, type LockManagerLike } from '../exclusive';

const KEY = transactionTurn('mainnet', '0xabc');

/** A promise the test settles by hand, as a transaction that is still under way. */
const pending = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

/** Lets the promise callbacks that are ready run. */
const settle = async () => {
  for (let i = 0; i < 10; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();
  }
};

/** The browser's lock manager as the queue uses it: one holder per name, first come first served. */
const fakeLocks = () => {
  const tails = new Map<string, Promise<unknown>>();
  const requested: string[] = [];
  const locks: LockManagerLike = {
    request: (name, callback) => {
      requested.push(name);
      const run = (tails.get(name) ?? Promise.resolve()).then(callback);
      tails.set(
        name,
        run.catch(() => undefined)
      );
      return run;
    },
  };
  return { locks, requested };
};

describe('one transaction at a time', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('names the turn after the network and the wallet', () => {
    expect(transactionTurn('mainnet', '0xabc')).toBe('haneul:tx:mainnet:0xabc');
    expect(transactionTurn('localnet', undefined)).toBe('haneul:tx:localnet:wallet');
  });

  it.each([
    ['in this tab', () => createExclusive()],
    ['with the browser locks', () => createExclusive({ locks: fakeLocks().locks })],
  ])('starts the second when the first is final (%s)', async (_, make) => {
    const exclusive = make();
    const first = pending<string>();
    const started: string[] = [];
    const a = exclusive(KEY, () => {
      started.push('a');
      return first.promise;
    });
    const b = exclusive(KEY, async () => {
      started.push('b');
      return 'second';
    });
    await settle();
    expect(started).toEqual(['a']);

    first.resolve('first');
    expect(await a).toBe('first');
    expect(await b).toBe('second');
    expect(started).toEqual(['a', 'b']);
  });

  it('gives a failure to its caller and the turn to the next', async () => {
    const exclusive = createExclusive();
    const a = exclusive(KEY, async () => {
      throw new Error('rejected by the chain');
    });
    const b = exclusive(KEY, async () => 'second');
    await expect(a).rejects.toThrow('rejected by the chain');
    expect(await b).toBe('second');
  });

  it('asks the browser for the lock of that wallet', async () => {
    const { locks, requested } = fakeLocks();
    const exclusive = createExclusive({ locks });
    await exclusive(KEY, async () => 'done');
    await exclusive(transactionTurn('mainnet', '0xdef'), async () => 'done');
    expect(requested).toEqual(['haneul:tx:mainnet:0xabc', 'haneul:tx:mainnet:0xdef']);
  });

  it('queues in this tab when the browser refuses the lock', async () => {
    const refusing: LockManagerLike = {
      request: () => Promise.reject(new Error('SecurityError')),
    };
    const exclusive = createExclusive({ locks: refusing });
    const first = pending<string>();
    const started: string[] = [];
    const a = exclusive(KEY, () => {
      started.push('a');
      return first.promise;
    });
    const b = exclusive(KEY, async () => {
      started.push('b');
      return 'second';
    });
    await settle();
    expect(started).toEqual(['a']);
    first.resolve('first');
    expect(await a).toBe('first');
    expect(await b).toBe('second');
  });

  it('ends a turn that takes too long, and still answers its caller', async () => {
    vi.useFakeTimers();
    const exclusive = createExclusive({ turnLimitMs: 1000 });
    const stuck = pending<string>();
    const started: string[] = [];
    const a = exclusive(KEY, () => {
      started.push('a');
      return stuck.promise;
    });
    const b = exclusive(KEY, async () => {
      started.push('b');
      return 'second';
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(started).toEqual(['a']);
    await vi.advanceTimersByTimeAsync(1);
    expect(await b).toBe('second');

    stuck.resolve('late');
    expect(await a).toBe('late');
  });
});

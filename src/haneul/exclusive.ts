/**
 * One transaction at a time for a wallet.
 *
 * Two transactions built at the same moment name the same versions of the wallet's owned
 * objects: its gas coin, and the capability of its trading account. The chain takes one and
 * rejects the other ("already locked by a different transaction"). A transaction therefore
 * waits here for the one before it to be final, and is built from the objects that one left.
 *
 * The turn is a Web Lock where the browser has them, so the tabs of the site share it, and a
 * queue in this tab otherwise.
 */

/** The part of the browser's `LockManager` used here. */
export type LockManagerLike = {
  request: (name: string, callback: () => Promise<unknown>) => Promise<unknown>;
};

/**
 * A turn ends after this long whether or not its transaction has settled: a request that never
 * returns, or a wallet prompt left open, does not keep the wallet from its next transaction.
 */
export const TURN_LIMIT_MS = 90_000;

export const createExclusive = ({
  locks,
  turnLimitMs = TURN_LIMIT_MS,
}: {
  locks?: LockManagerLike;
  turnLimitMs?: number;
} = {}) => {
  let tail: Promise<unknown> = Promise.resolve();
  const inThisTab = (turn: () => Promise<void>) => {
    tail = tail.then(turn);
  };

  /** Runs `work` once every earlier call with the same `key` has had its turn. */
  return <T>(key: string, work: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      let started = false;
      // Never rejects: the outcome of `work` goes to the caller, not to the queue.
      const turn = async () => {
        started = true;
        let result: Promise<T>;
        try {
          result = Promise.resolve(work());
        } catch (error) {
          result = Promise.reject(error);
        }
        result.then(resolve, reject);
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          result.then(
            () => undefined,
            () => undefined
          ),
          new Promise<void>((done) => {
            timer = setTimeout(done, turnLimitMs);
          }),
        ]);
        clearTimeout(timer);
      };
      if (locks == null) {
        inThisTab(turn);
        return;
      }
      // A browser that refuses the lock (a storage partition, a policy) still gets the queue.
      locks.request(key, turn).catch(() => {
        if (!started) inThisTab(turn);
      });
    });
};

const browserLocks = () => (globalThis.navigator as { locks?: LockManagerLike } | undefined)?.locks;

/** The wallet's turn to build, sign and send a transaction, and to see it final. */
export const exclusive = createExclusive({ locks: browserLocks() });

/** The name of a wallet's turn on a network. */
export const transactionTurn = (network: string, address: string | undefined) =>
  `haneul:tx:${network}:${address ?? 'wallet'}`;

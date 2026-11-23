import type { Transaction } from '@haneullabs/haneul/transactions';

import { dAppKit } from '../dAppKit';
import { exclusive, transactionTurn } from '../exclusive';
import {
  normalizeTransactionError,
  settleTransaction,
  type ExecutedTransaction,
} from './execution';

export * from './execution';

const walletTurn = () =>
  transactionTurn(
    dAppKit.stores.$currentNetwork.get(),
    dAppKit.stores.$connection.get().account?.address
  );

/** Signs with the connected wallet and waits for finality, without asking for the turn. */
const send = async (tx: Transaction): Promise<ExecutedTransaction> => {
  let result;
  try {
    result = await dAppKit.signAndExecuteTransaction({ transaction: tx });
  } catch (cause) {
    throw normalizeTransactionError(cause);
  }
  return settleTransaction(dAppKit.getClient(), result);
};

/**
 * Signs with the connected wallet, waits for finality and returns the parsed events. Every
 * failure becomes a `HaneulTransactionError` carrying the Move abort when there is one.
 *
 * The wallet has one transaction under way at a time (see `exclusive`): the wallet resolves
 * the gas coin and the object versions when it signs, so a transaction that waits its turn is
 * built from what the one before it left.
 */
export const signAndExecute = (tx: Transaction): Promise<ExecutedTransaction> =>
  exclusive(walletTurn(), () => send(tx));

/**
 * Runs `work` in the wallet's turn and gives it a `send` that signs and sends within that turn.
 *
 * For an operation whose transaction depends on what the ones before it left on chain. Read
 * inside the turn, the chain is as they left it. Read before the turn, it is as it was when
 * the operation was asked for, and several operations asked for in a row all read the same.
 */
export const inWalletTurn = <T>(
  work: (sendInTurn: (tx: Transaction) => Promise<ExecutedTransaction>) => Promise<T>
): Promise<T> => exclusive(walletTurn(), () => work(send));

/** Read-only simulation through the app's current client. */
export const simulateWithApp = async (tx: Transaction) => {
  const { simulateReturnValues } = await import('./execution');
  return simulateReturnValues(tx, dAppKit.getClient());
};

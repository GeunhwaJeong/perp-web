import type { Transaction } from '@haneullabs/haneul/transactions';

import { dAppKit } from '../dAppKit';
import {
  normalizeTransactionError,
  settleTransaction,
  type ExecutedTransaction,
} from './execution';

export * from './execution';

/**
 * Signs with the connected wallet, waits for finality and returns the parsed events. Every
 * failure becomes a `HaneulTransactionError` carrying the Move abort when there is one.
 */
export const signAndExecute = async (tx: Transaction): Promise<ExecutedTransaction> => {
  let result;
  try {
    result = await dAppKit.signAndExecuteTransaction({ transaction: tx });
  } catch (cause) {
    throw normalizeTransactionError(cause);
  }
  return settleTransaction(dAppKit.getClient(), result);
};

/** Read-only simulation through the app's current client. */
export const simulateWithApp = async (tx: Transaction) => {
  const { simulateReturnValues } = await import('./execution');
  return simulateReturnValues(tx, dAppKit.getClient());
};

import type { Transaction } from '@haneullabs/haneul/transactions';

import { dAppKit } from '../dAppKit';
import { exclusive, transactionTurn } from '../exclusive';
import {
  normalizeTransactionError,
  settleTransaction,
  type ExecutedTransaction,
} from './execution';

export * from './execution';

/**
 * Signs with the connected wallet, waits for finality and returns the parsed events. Every
 * failure becomes a `HaneulTransactionError` carrying the Move abort when there is one.
 *
 * The wallet has one transaction under way at a time (see `exclusive`): the wallet resolves
 * the gas coin and the object versions when it signs, so a transaction that waits its turn is
 * built from what the one before it left.
 */
export const signAndExecute = (tx: Transaction): Promise<ExecutedTransaction> =>
  exclusive(
    transactionTurn(
      dAppKit.stores.$currentNetwork.get(),
      dAppKit.stores.$connection.get().account?.address
    ),
    async () => {
      let result;
      try {
        result = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      } catch (cause) {
        throw normalizeTransactionError(cause);
      }
      return settleTransaction(dAppKit.getClient(), result);
    }
  );

/** Read-only simulation through the app's current client. */
export const simulateWithApp = async (tx: Transaction) => {
  const { simulateReturnValues } = await import('./execution');
  return simulateReturnValues(tx, dAppKit.getClient());
};

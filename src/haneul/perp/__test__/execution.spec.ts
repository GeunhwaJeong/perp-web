import { describe, expect, it } from 'vitest';

import { normalizeTransactionError, WALLET_BUSY } from '../execution';

// The node's answer to the second of two transactions sent at once from one wallet, as a
// localnet gave it.
const LOCKED =
  'Transaction is rejected as invalid by more than 1/3 of validators by stake (non-retriable). ' +
  'Non-retriable errors: [Object (0xe117, SequenceNumber(2669), o#AcKk) already locked by a ' +
  'different transaction: TransactionDigest(B2ZS) { k#99f25ef6.. } with 10000 stake].';

describe('errors raised before execution', () => {
  it('says in plain words that another transaction of the wallet was under way', () => {
    expect(normalizeTransactionError(new Error(LOCKED)).message).toBe(WALLET_BUSY);
  });

  it('finds that answer under what a wallet wraps around it', () => {
    const wrapped = new Error('Transaction failed', { cause: new Error(LOCKED) });
    expect(normalizeTransactionError(wrapped).message).toBe(WALLET_BUSY);
  });

  it('still names a Move abort carried in the message', () => {
    const error = new Error(
      "MoveAbort, abort code: 58, in '0x7be0::clearing_house::cancel_orders'"
    );
    const normalized = normalizeTransactionError(error);
    expect(normalized.abort).toEqual({
      code: 58,
      module: 'clearing_house',
      function: 'cancel_orders',
    });
    expect(normalized.message).toBe('Order not found');
  });

  it('keeps any other message as it is', () => {
    expect(normalizeTransactionError(new Error('Failed to fetch')).message).toBe('Failed to fetch');
  });
});

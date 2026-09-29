import type { ClientWithCoreApi, HaneulClientTypes } from '@haneullabs/haneul/client';
import type { Signer } from '@haneullabs/haneul/cryptography';
import type { Transaction } from '@haneullabs/haneul/transactions';

import { describeAbort, HaneulTransactionError, type HaneulAbort } from './errors';

export type ChainEvent = { type: string; json: Record<string, unknown> };

export type ExecutedTransaction = {
  digest: string;
  events: ChainEvent[];
};

/** Events whose type ends with `::module::Name` (type parameters ignored). */
export const eventsOf = (events: ChainEvent[], suffix: string) =>
  events.filter((e) => e.type.split('<')[0]!.endsWith(suffix)).map((e) => e.json);

export const extractAbort = (error: unknown): HaneulAbort | undefined => {
  const err = error as {
    MoveAbort?: { abortCode?: string; location?: { module?: string; functionName?: string } };
  };
  const abort = err.MoveAbort;
  if (!abort?.abortCode) return undefined;
  return {
    module: abort.location?.module ?? 'unknown',
    code: Number(abort.abortCode),
    function: abort.location?.functionName,
  };
};

/**
 * Waits for a submitted transaction and turns it into digest + parsed events, raising a
 * `HaneulTransactionError` that names the Move abort when execution failed.
 */
export const settleTransaction = async (
  client: ClientWithCoreApi,
  result: HaneulClientTypes.TransactionResult<any>
): Promise<ExecutedTransaction> => {
  const digest = (result.Transaction ?? result.FailedTransaction).digest;
  const settled = await client.core.waitForTransaction({
    result,
    include: { effects: true, events: true },
  });
  const transaction = settled.Transaction ?? settled.FailedTransaction;
  const status = transaction.effects.status;
  if (!transaction || !status || !status.success) {
    const abort = status && !status.success ? extractAbort(status.error) : undefined;
    const message = abort
      ? describeAbort(abort)
      : (status && !status.success && status.error.message) || 'Transaction failed';
    throw new HaneulTransactionError(message, { abort, digest });
  }
  const events: ChainEvent[] = (transaction.events ?? []).map((e) => ({
    type: e.eventType,
    json: (e.json ?? {}) as Record<string, unknown>,
  }));
  return { digest: transaction.digest, events };
};

const ABORT_IN_MESSAGE = /abort code: (\d+), in '0x[0-9a-f]+::(\w+)::(\w+)'/;

/**
 * Errors raised before execution (the SDK simulates while resolving gas and inputs) carry
 * the abort only in their message. Normalize them so callers see the same
 * `HaneulTransactionError` as for an on-chain failure.
 */
export const normalizeTransactionError = (error: unknown): HaneulTransactionError => {
  if (error instanceof HaneulTransactionError) return error;
  const structured = extractAbort((error as { reason?: unknown }).reason);
  if (structured) {
    return new HaneulTransactionError(describeAbort(structured), {
      abort: structured,
      cause: error,
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  const m = ABORT_IN_MESSAGE.exec(message);
  if (m) {
    const abort: HaneulAbort = { code: Number(m[1]), module: m[2]!, function: m[3] };
    return new HaneulTransactionError(describeAbort(abort), { abort, cause: error });
  }
  return new HaneulTransactionError(message, { cause: error });
};

/** Signs and executes with a local signer (scripts and tests); the app signs through the wallet. */
export const signAndExecuteWith = async (
  signer: Signer,
  tx: Transaction,
  client: ClientWithCoreApi
) => {
  let result;
  try {
    result = await signer.signAndExecuteTransaction({ transaction: tx, client });
  } catch (error) {
    throw normalizeTransactionError(error);
  }
  return settleTransaction(client, result);
};

/** Runs a read-only transaction and returns each command's return values as BCS bytes. */
export const simulateReturnValues = async (tx: Transaction, client: ClientWithCoreApi) => {
  const result = await client.core.simulateTransaction({
    transaction: tx,
    include: { commandResults: true, effects: true },
  });
  const transaction = result.Transaction ?? result.FailedTransaction;
  const status = transaction.effects.status;
  if (!transaction || !status.success) {
    const abort = status && !status.success ? extractAbort(status.error) : undefined;
    throw new HaneulTransactionError(abort ? describeAbort(abort) : 'Simulation failed', { abort });
  }
  return result.commandResults.map((c) => c.returnValues.map((v) => v.bcs));
};

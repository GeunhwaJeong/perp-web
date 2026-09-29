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
  } | null;
  const abort = err?.MoveAbort;
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
  const { status } = transaction.effects;
  if (!status.success) {
    const abort = extractAbort(status.error);
    const message = abort ? describeAbort(abort) : status.error.message;
    throw new HaneulTransactionError(message, { abort, digest });
  }
  const events: ChainEvent[] = transaction.events.map((e) => ({
    type: e.eventType,
    json: e.json as Record<string, unknown>,
  }));
  return { digest: transaction.digest, events };
};

const ABORT_IN_MESSAGE = /abort code: (\d+), in '0x[0-9a-f]+::(\w+)::(\w+)'/;

/**
 * Errors raised before execution (the SDK simulates while resolving gas and inputs) carry
 * the abort only in their message. Normalize them so callers see the same
 * `HaneulTransactionError` as for an on-chain failure.
 */
/** Wallets wrap SDK errors, so the abort may sit anywhere along the `cause` chain. */
const causeChain = (error: unknown) => {
  const chain: unknown[] = [];
  let current = error;
  while (current != null && chain.length < 8 && !chain.includes(current)) {
    chain.push(current);
    current = (current as { cause?: unknown }).cause;
  }
  return chain;
};

export const normalizeTransactionError = (error: unknown): HaneulTransactionError => {
  if (error instanceof HaneulTransactionError) return error;
  const chain = causeChain(error);
  const structured = chain
    .map((e) => extractAbort((e as { reason?: unknown } | null)?.reason))
    .find((a) => a != null);
  if (structured) {
    return new HaneulTransactionError(describeAbort(structured), {
      abort: structured,
      cause: error,
    });
  }
  const messages = chain.map((e) => (e instanceof Error ? e.message : String(e)));
  const m = messages.map((msg) => ABORT_IN_MESSAGE.exec(msg)).find((x) => x != null);
  if (m) {
    const abort: HaneulAbort = { code: Number(m[1]), module: m[2]!, function: m[3] };
    return new HaneulTransactionError(describeAbort(abort), { abort, cause: error });
  }
  return new HaneulTransactionError(messages[0] ?? 'Transaction failed', { cause: error });
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
  const { status } = transaction.effects;
  if (!status.success) {
    const abort = extractAbort(status.error);
    throw new HaneulTransactionError(abort ? describeAbort(abort) : status.error.message, {
      abort,
    });
  }
  return result.commandResults.map((c) => c.returnValues.map((v) => v.bcs));
};

import type { ClientWithCoreApi } from '@haneullabs/haneul/client';
import type { Signer } from '@haneullabs/haneul/cryptography';
import { Transaction } from '@haneullabs/haneul/transactions';

import { exclusive, transactionTurn } from '../exclusive';
import type { NameServiceConfig } from './config';
import { fullName } from './format';

/**
 * Points the signer's address back at `name.haneul` (`controller::set_reverse_lookup`),
 * which is what explorers and other apps read to show a name for an address. The chain
 * requires the name's target to be the sender, which the issuer set when it wrote the
 * name, and the sender pays gas from the HANEUL the issuer sent along.
 */
export const setReverseLookup = async ({
  client,
  config,
  signer,
  name,
  afterDigest,
}: {
  client: ClientWithCoreApi;
  config: NameServiceConfig;
  signer: Signer;
  name: string;
  /** The issuing transaction; waited for so the name and the gas are visible first. */
  afterDigest?: string;
}): Promise<{ digest: string }> => {
  if (afterDigest) await client.core.waitForTransaction({ digest: afterDigest });

  const sender = signer.getPublicKey().toHaneulAddress();
  const tx = new Transaction();
  tx.setSender(sender);
  tx.moveCall({
    target: `${config.packageId}::controller::set_reverse_lookup`,
    arguments: [tx.object(config.haneulNs), tx.pure.string(fullName(name))],
  });

  // This runs behind the screen right after the account is made, when its owner may be making
  // the first deposit: it takes the wallet's turn like every other transaction, and keeps it
  // until the node shows the result, so the next one is built from the gas coin this one left.
  return exclusive(transactionTurn(client.network, sender), async () => {
    const result = await signer.signAndExecuteTransaction({ transaction: tx, client });
    if (result.FailedTransaction) {
      throw new Error(`Reverse lookup failed on chain: ${result.FailedTransaction.digest}`);
    }
    const { digest } = result.Transaction!;
    await client.core.waitForTransaction({ digest });
    return { digest };
  });
};

import type { ClientWithCoreApi } from '@haneullabs/haneul/client';
import type { Signer } from '@haneullabs/haneul/cryptography';
import { Transaction } from '@haneullabs/haneul/transactions';

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

  const tx = new Transaction();
  tx.setSender(signer.getPublicKey().toHaneulAddress());
  tx.moveCall({
    target: `${config.packageId}::controller::set_reverse_lookup`,
    arguments: [tx.object(config.haneulNs), tx.pure.string(fullName(name))],
  });

  const result = await signer.signAndExecuteTransaction({ transaction: tx, client });
  if (result.FailedTransaction) {
    throw new Error(`Reverse lookup failed on chain: ${result.FailedTransaction.digest}`);
  }
  return { digest: result.Transaction!.digest };
};

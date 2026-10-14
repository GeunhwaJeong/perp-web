import { localAccountStore, passkeyAccountStore, passkeySigner } from '../account';
import { dAppKit, type HaneulNetwork } from '../dAppKit';
import { NAME_SERVICE_CONFIGS } from './config';
import { setReverseLookup } from './reverse';

export type NameOwner = 'local' | 'passkey';

/**
 * Links a Sigma account's issued name to its address on chain and records the result.
 * The password account signs with its unlocked key; the passkey account prompts the
 * authenticator once. Resolves to undefined on a network without a name service.
 */
export const linkAccountName = async ({
  owner,
  afterDigest,
}: {
  owner: NameOwner;
  afterDigest?: string;
}): Promise<{ digest: string } | undefined> => {
  const client = dAppKit.getClient();
  const config = NAME_SERVICE_CONFIGS[client.network as HaneulNetwork];
  if (!config) return undefined;

  if (owner === 'local') {
    const name = localAccountStore.getSnapshot().account?.username;
    if (!name) throw new Error('The account has no name to link');
    const signer = localAccountStore.requireKeypair();
    const result = await setReverseLookup({ client, config, signer, name, afterDigest });
    localAccountStore.setName({ username: name, status: 'linked' });
    return result;
  }

  const record = passkeyAccountStore.getSnapshot();
  const name = record?.username;
  if (!record || !name) throw new Error('The account has no name to link');
  const result = await setReverseLookup({
    client,
    config,
    signer: passkeySigner(record),
    name,
    afterDigest,
  });
  passkeyAccountStore.setName({ username: name, status: 'linked' });
  return result;
};

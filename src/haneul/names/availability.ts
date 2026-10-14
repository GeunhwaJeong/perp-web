import { bcs } from '@haneullabs/haneul/bcs';
import type { ClientWithCoreApi } from '@haneullabs/haneul/client';

import { NAME_TLD, type NameServiceConfig } from './config';
import { normalizeName } from './format';

export type NameAvailability =
  | 'available'
  | 'taken'
  | 'reserved'
  | 'blocked'
  /** The chain could not be asked; the caller decides whether to proceed optimistically. */
  | 'unknown';

const DomainBcs = bcs.struct('Domain', { labels: bcs.vector(bcs.string()) });

const isNotFound = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  (error as { reason?: string }).reason === 'notFound';

/**
 * The name an address has set as its primary (`reverse_registry`), without the TLD, or
 * undefined when it has none. Used after a restore to put the username back on the account.
 */
export const lookupPrimaryName = async ({
  client,
  config,
  address,
}: {
  client: ClientWithCoreApi;
  config: NameServiceConfig;
  address: string;
}): Promise<string | undefined> => {
  try {
    const { dynamicField } = await client.core.getDynamicField({
      parentId: config.reverseRegistryTable,
      name: { type: 'address', bcs: bcs.Address.serialize(address).toBytes() },
    });
    const { labels } = DomainBcs.parse(dynamicField.value.bcs);
    // labels are TLD first: ["haneul", "name"]
    return labels.length === 2 && labels[0] === NAME_TLD ? labels[1] : undefined;
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
};

const RegistrationBcs = bcs.struct('HaneulnsRegistration', {
  id: bcs.Address,
  domain: DomainBcs,
  domain_name: bcs.string(),
  expiration_timestamp_ms: bcs.u64(),
  image_url: bcs.string(),
});

/**
 * The name whose registration NFT the address holds, without the TLD. The issuer hands the
 * NFT to the address when it writes the name, so this is answered as soon as the name is on
 * chain, before (or without) the address ever signing a reverse lookup. An address holding
 * several names gets the one that expires last.
 */
export const lookupOwnedName = async ({
  client,
  config,
  address,
}: {
  client: ClientWithCoreApi;
  config: NameServiceConfig;
  address: string;
}): Promise<string | undefined> => {
  const { objects } = await client.core.listOwnedObjects({
    owner: address,
    type: `${config.packageId}::haneulns_registration::HaneulnsRegistration`,
    include: { content: true },
    limit: 50,
  });
  const now = BigInt(Date.now());
  const names = objects
    .map((object) => RegistrationBcs.parse(object.content))
    .filter(
      ({ domain, expiration_timestamp_ms: expiry }) =>
        domain.labels.length === 2 && domain.labels[0] === NAME_TLD && BigInt(expiry) > now
    )
    .sort((a, b) => Number(BigInt(b.expiration_timestamp_ms) - BigInt(a.expiration_timestamp_ms)));
  return names[0]?.domain.labels[1];
};

/**
 * The name to put back on a restored account: the primary name the address chose, else the
 * name it holds. Undefined when it has neither; throws when the chain could not be asked.
 */
export const lookupName = async (args: {
  client: ClientWithCoreApi;
  config: NameServiceConfig;
  address: string;
}): Promise<string | undefined> => (await lookupPrimaryName(args)) ?? (await lookupOwnedName(args));

/** True when the table has an entry under `name`, false when it does not; throws otherwise. */
const hasField = async ({
  client,
  parentId,
  type,
  key,
}: {
  client: ClientWithCoreApi;
  parentId: string;
  type: string;
  key: Uint8Array;
}): Promise<boolean> => {
  try {
    await client.core.getDynamicField({ parentId, name: { type, bcs: key } });
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
};

/**
 * Asks HaneulNS whether `name.haneul` can be issued: not registered, not on the operator's
 * reserved list, not on the blocked list. Three dynamic-field reads, no indexer.
 */
export const checkNameAvailability = async ({
  client,
  config,
  name,
}: {
  client: ClientWithCoreApi;
  config: NameServiceConfig;
  name: string;
}): Promise<NameAvailability> => {
  const label = normalizeName(name);
  const stringKey = bcs.string().serialize(label).toBytes();
  // Domain labels are stored TLD first, so "name.haneul" is ["haneul", "name"].
  const domainKey = DomainBcs.serialize({ labels: [NAME_TLD, label] }).toBytes();

  try {
    const [blocked, reserved, taken] = await Promise.all([
      hasField({
        client,
        parentId: config.blockedTable,
        type: '0x1::string::String',
        key: stringKey,
      }),
      hasField({
        client,
        parentId: config.reservedTable,
        type: '0x1::string::String',
        key: stringKey,
      }),
      hasField({
        client,
        parentId: config.registryTable,
        type: `${config.packageId}::domain::Domain`,
        key: domainKey,
      }),
    ]);
    if (blocked) return 'blocked';
    if (reserved) return 'reserved';
    if (taken) return 'taken';
    return 'available';
  } catch {
    return 'unknown';
  }
};

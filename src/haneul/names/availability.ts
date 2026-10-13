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

import { bcs } from '@haneullabs/haneul/bcs';
import type { ClientWithCoreApi } from '@haneullabs/haneul/client';
import { isValidHaneulAddress, normalizeHaneulAddress } from '@haneullabs/haneul/utils';

import { NAME_TLD, type NameServiceConfig } from './config';
import { normalizeName } from './format';

const DomainBcs = bcs.struct('Domain', { labels: bcs.vector(bcs.string()) });

// `name_record::NameRecord`: the registration NFT, the expiry, the address the name points to
// and a key-value map of extra data, in that order.
const NameRecordBcs = bcs.struct('NameRecord', {
  nft_id: bcs.Address,
  expiration_timestamp_ms: bcs.u64(),
  target_address: bcs.option(bcs.Address),
  data: bcs.struct('VecMap', {
    contents: bcs.vector(bcs.struct('Entry', { key: bcs.string(), value: bcs.string() })),
  }),
});

const isNotFound = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  (error as { reason?: string }).reason === 'notFound';

/**
 * The address `name.haneul` points to (its `target_address`), or undefined when the name is not
 * registered, has expired, or has no target set. One dynamic-field read of the registry; no
 * indexer.
 */
export const resolveNameAddress = async ({
  client,
  config,
  name,
}: {
  client: ClientWithCoreApi;
  config: NameServiceConfig;
  name: string;
}): Promise<string | undefined> => {
  const label = normalizeName(name.replace(new RegExp(`\\.${NAME_TLD}$`, 'i'), ''));
  if (!label) return undefined;
  try {
    const { dynamicField } = await client.core.getDynamicField({
      parentId: config.registryTable,
      name: {
        type: `${config.packageId}::domain::Domain`,
        bcs: DomainBcs.serialize({ labels: [NAME_TLD, label] }).toBytes(),
      },
    });
    const record = NameRecordBcs.parse(dynamicField.value.bcs);
    if (BigInt(record.expiration_timestamp_ms) <= BigInt(Date.now())) return undefined;
    return record.target_address ?? undefined;
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
};

/** Whether `input` reads as a name on the name service rather than an address. */
export const looksLikeName = (input: string) =>
  !input.trim().toLowerCase().startsWith('0x') && input.trim().length > 0;

/** `0x…` as the chain stores it, or undefined when `input` is not an address. */
export const normalizeAddressInput = (input: string): string | undefined => {
  const trimmed = input.trim();
  return isValidHaneulAddress(trimmed) ? normalizeHaneulAddress(trimmed) : undefined;
};

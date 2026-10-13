import type { HaneulNetwork } from '../networks';

/**
 * Object ids of one HaneulNS deployment. Availability is answered by reading the
 * registry's dynamic fields directly; nothing here signs anything.
 */
export type NameServiceConfig = {
  /** Core package, which owns the `domain::Domain` key type of the registry table. */
  packageId: string;
  /** The `HaneulNS` shared object. */
  haneulNs: string;
  /** `Table<Domain, NameRecord>`: a field exists for every registered name. */
  registryTable: string;
  /** `Table<address, Domain>`: the primary name an address points back to. */
  reverseRegistryTable: string;
  /** `Table<String, bool>` of names only the operator may issue. */
  reservedTable: string;
  /** `Table<String, bool>` of names nobody may register. */
  blockedTable: string;
};

export const NAME_TLD = 'haneul';

export const NAME_SERVICE_CONFIGS: Partial<Record<HaneulNetwork, NameServiceConfig>> = {
  mainnet: {
    packageId: '0x047dfbd82298ec1c2c70b5743a8c4a00614ff864a580069c635f2dad3a7c76fa',
    haneulNs: '0x186ad0dd1d4d4bc84564b3c039a0d432ab4d4af851e07cc84f083cc5e850f6d0',
    registryTable: '0xf539703ae28a9f324729506626766909f800a7e40ec90c6f2c8e865103d96525',
    reverseRegistryTable: '0x60b38f5be27728c4c2e8861cf4213e9841c2ed0807236ffc583f4980af73f773',
    reservedTable: '0x6da7700c0850043b72792946d35d0a7acc160ce68a61460c3998546a5ed6ef54',
    blockedTable: '0x34894b0ec10de92033cf1fb9217f1d73aac6c026986b681679aafcf40bebe3bd',
  },
};

/**
 * The service that writes a free name to HaneulNS on a new account's behalf (the operator
 * key signs `admin::reserve_domain` and hands the registration to the address). Unset
 * means names are chosen now and written later.
 */
export const NAME_ISSUER_URL: string | undefined = import.meta.env.VITE_NAME_ISSUER_URL;

import { bcs } from '@haneullabs/haneul/bcs';
import type { ClientWithCoreApi } from '@haneullabs/haneul/client';
import { describe, expect, it, vi } from 'vitest';

import { findPerpAccount, hasOrderTickets } from '../accounts';
import type { PerpDeployment } from '../config';

const id = (byte: string) => `0x${byte.repeat(32)}`;

const deployment = {
  network: 'localnet',
  packages: { perpetuals: id('01'), authorityCap: id('07') },
  collateral: { coinType: `${id('08')}::tusd::TUSD`, decimals: 6 },
} as unknown as PerpDeployment;

const OWNER = id('ee');
const TICKET = `${id('01')}::keys::OrderTicketKey`;
// What every account carries: the admin capability's markers and the fee extension's volume.
const PLAIN = [
  '0x2::derived_object::Claimed',
  `${id('07')}::authority::SingletonKey<${id('01')}::authority::ACCOUNT,${id('07')}::authority::ADMIN>`,
  `${id('01')}::keys::ExtensionFieldKey<${id('03')}::extension::FEES,${id('03')}::fees::VolumeKey>`,
];

const CapBcs = bcs.struct('AuthorityCap', { id: bcs.Address, for: bcs.Address });
const AccountBcs = bcs.struct('Account', {
  id: bcs.Address,
  account_id: bcs.u64(),
  collateral: bcs.u64(),
  active_assistants: bcs.vector(bcs.Address),
});

type Held = {
  /** Byte the account object id repeats; its capability repeats the next one. */
  byte: number;
  number: bigint;
  assistants?: number;
  /** Dynamic field name types, one list per page. */
  pages?: string[][];
};

const hex = (byte: number) => byte.toString(16).padStart(2, '0');
const accountOf = (held: Held) => id(hex(held.byte));
const capOf = (held: Held) => id(hex(held.byte + 1));

/** A client holding `wallet`'s capabilities, in the order the node lists them. */
const clientFor = (wallet: Held[]) => {
  const byAccount = new Map(wallet.map((held) => [accountOf(held), held]));
  const listDynamicFields = vi.fn(
    async ({ parentId, cursor }: { parentId: string; cursor?: string | null }) => {
      const pages = byAccount.get(parentId)?.pages ?? [PLAIN];
      const index = cursor == null ? 0 : Number(cursor);
      return {
        dynamicFields: (pages[index] ?? []).map((type) => ({ name: { type } })),
        hasNextPage: index + 1 < pages.length,
        cursor: index + 1 < pages.length ? String(index + 1) : null,
      };
    }
  );
  const core = {
    listOwnedObjects: async () => ({
      objects: wallet.map((held) => ({
        objectId: capOf(held),
        content: CapBcs.serialize({ id: capOf(held), for: accountOf(held) }).toBytes(),
      })),
      hasNextPage: false,
      cursor: null,
    }),
    getObject: async ({ objectId }: { objectId: string }) => {
      const held = byAccount.get(objectId)!;
      return {
        object: {
          content: AccountBcs.serialize({
            id: objectId,
            account_id: held.number,
            collateral: 5_000_000n,
            active_assistants: Array.from({ length: held.assistants ?? 0 }, () => id('a5')),
          }).toBytes(),
        },
      };
    },
    listDynamicFields,
  };
  return { client: { core } as unknown as ClientWithCoreApi, listDynamicFields };
};

const find = (wallet: Held[], known: string[] = []) =>
  findPerpAccount(clientFor(wallet).client, deployment, OWNER, known);

describe('findPerpAccount', () => {
  it('finds nothing for a wallet without a capability', async () => {
    expect(await find([])).toBeUndefined();
  });

  it('returns an account with no assistant and no ticket as it is', async () => {
    const own = { byte: 0x10, number: 3n };
    expect(await find([own])).toEqual({
      account: accountOf(own),
      cap: capOf(own),
      accountId: 3n,
      collateral: 5_000_000n,
      exposure: undefined,
    });
  });

  it('marks an account that still accepts an assistant capability', async () => {
    const sent = { byte: 0x10, number: 4n, assistants: 1 };
    expect((await find([sent]))?.exposure).toBe('assistants');
  });

  it('marks an account that arrived with an order ticket', async () => {
    const sent = { byte: 0x10, number: 6n, pages: [[...PLAIN, TICKET]] };
    expect((await find([sent]))?.exposure).toBe('tickets');
  });

  it('finds a ticket on a later page of the fields', async () => {
    const sent = { byte: 0x10, number: 6n, pages: [PLAIN, [], [TICKET]] };
    expect((await find([sent]))?.exposure).toBe('tickets');
  });

  it('does not count tickets against an account this device knows', async () => {
    const own = { byte: 0x10, number: 3n, pages: [[...PLAIN, TICKET]] };
    const { client, listDynamicFields } = clientFor([own]);
    const found = await findPerpAccount(client, deployment, OWNER, [accountOf(own)]);
    expect(found?.exposure).toBeUndefined();
    expect(listDynamicFields).not.toHaveBeenCalled();
  });

  it('keeps the known account when a lower-numbered one is sent to the wallet', async () => {
    const own = { byte: 0x10, number: 9n };
    const sentWithAssistant = { byte: 0x20, number: 2n, assistants: 1 };
    const sentClean = { byte: 0x30, number: 1n };
    const found = await find([sentClean, sentWithAssistant, own], [accountOf(own)]);
    expect(found?.account).toBe(accountOf(own));
    expect(found?.exposure).toBeUndefined();
  });

  it('prefers an account without exposure, whatever the order the node lists them in', async () => {
    const sentWithAssistant = { byte: 0x20, number: 2n, assistants: 1 };
    const sentWithTicket = { byte: 0x40, number: 1n, pages: [[TICKET]] };
    const clean = { byte: 0x10, number: 9n };
    const found = await find([sentWithAssistant, sentWithTicket, clean]);
    expect(found?.account).toBe(accountOf(clean));
    expect(found?.exposure).toBeUndefined();
  });

  it('takes the lowest account number among equals, as perp-api does', async () => {
    const later = { byte: 0x10, number: 9n };
    const earlier = { byte: 0x20, number: 5n };
    expect((await find([later, earlier]))?.accountId).toBe(5n);

    const exposedLater = { byte: 0x30, number: 8n, assistants: 2 };
    const exposedEarlier = { byte: 0x40, number: 4n, pages: [[TICKET]] };
    const found = await find([exposedLater, exposedEarlier]);
    expect(found?.accountId).toBe(4n);
    expect(found?.exposure).toBe('tickets');
  });
});

describe('hasOrderTickets', () => {
  it('is false for the fields every account has', async () => {
    const { client } = clientFor([{ byte: 0x10, number: 3n }]);
    expect(await hasOrderTickets(client, id('10'))).toBe(false);
  });

  it('stops reading at the first ticket', async () => {
    const held = { byte: 0x10, number: 3n, pages: [[TICKET], [TICKET], [TICKET]] };
    const { client, listDynamicFields } = clientFor([held]);
    expect(await hasOrderTickets(client, accountOf(held))).toBe(true);
    expect(listDynamicFields).toHaveBeenCalledTimes(1);
  });
});

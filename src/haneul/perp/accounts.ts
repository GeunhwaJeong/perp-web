import { bcs } from '@haneullabs/haneul/bcs';
import type { ClientWithCoreApi, HaneulClientTypes } from '@haneullabs/haneul/client';

import { PerpTransactionBuilder } from './builders';
import { type PerpDeployment, perpTypes } from './config';
import { simulateReturnValues } from './execution';

/**
 * The trading account is a shared `Account<T>` object plus an owned `AuthorityCap` that
 * names it. The cap is what the wallet holds, so discovery starts from the wallet's owned
 * objects and follows the cap's `for` field to the account.
 */

const AuthorityCapBcs = bcs.struct('AuthorityCap', {
  id: bcs.Address,
  for: bcs.Address,
});

const AccountBcs = bcs.struct('Account', {
  id: bcs.Address,
  account_id: bcs.u64(),
  collateral: bcs.u64(),
  active_assistants: bcs.vector(bcs.Address),
});

/**
 * What on an account lets an address other than the wallet act on it: an assistant capability,
 * which trades with the account and allocates its balance, or an order ticket, whose executor
 * places the order it commits to and allocates the balance to it.
 */
export type AccountExposure = 'assistants' | 'tickets';

export type PerpAccount = {
  /** Shared account object id. */
  account: string;
  /** Owned admin cap object id. */
  cap: string;
  /** Engine account number (u64) used in events and positions. */
  accountId: bigint;
  /** Unallocated collateral held on the account, in coin units. */
  collateral: bigint;
  /**
   * Set when the account has such exposure and this device has not recorded it as the wallet's
   * own (see `findPerpAccount`). The app then only takes collateral, orders and tickets off it.
   */
  exposure?: AccountExposure;
};

export const listAccountCaps = async (
  client: ClientWithCoreApi,
  deployment: PerpDeployment,
  owner: string
) => {
  const types = perpTypes(deployment);
  const caps: { cap: string; account: string }[] = [];
  let cursor: string | null = null;
  do {
    const page: HaneulClientTypes.ListOwnedObjectsResponse<{ content: true }> =
      // eslint-disable-next-line no-await-in-loop -- pages are sequential by cursor
      await client.core.listOwnedObjects<{ content: true }>({
        owner,
        type: types.accountCap,
        cursor,
        include: { content: true },
      });
    page.objects.forEach((obj) => {
      const parsed = AuthorityCapBcs.parse(obj.content);
      caps.push({ cap: obj.objectId, account: parsed.for });
    });
    cursor = page.hasNextPage ? page.cursor : null;
  } while (cursor);
  return caps;
};

export const readAccount = async (client: ClientWithCoreApi, accountObjectId: string) => {
  const obj = await client.core.getObject<{ content: true }>({
    objectId: accountObjectId,
    include: { content: true },
  });
  const parsed = AccountBcs.parse(obj.object.content);
  return {
    accountId: BigInt(parsed.account_id),
    collateral: BigInt(parsed.collateral),
    /** Assistant capabilities the account accepts. */
    assistants: parsed.active_assistants.length,
  };
};

// The engine keeps stop and TWAP tickets on the account under `perpetuals::keys::OrderTicketKey`.
const ORDER_TICKET_KEY = '::keys::OrderTicketKey';

/** Whether the account holds an order ticket, each a dynamic field of the account object. */
export const hasOrderTickets = async (client: ClientWithCoreApi, accountObjectId: string) => {
  let cursor: string | null = null;
  do {
    const page: HaneulClientTypes.ListDynamicFieldsResponse =
      // eslint-disable-next-line no-await-in-loop -- pages are sequential by cursor
      await client.core.listDynamicFields({ parentId: accountObjectId, cursor });
    if (page.dynamicFields.some((field) => field.name.type.endsWith(ORDER_TICKET_KEY))) {
      return true;
    }
    cursor = page.hasNextPage ? page.cursor : null;
  } while (cursor);
  return false;
};

const preference = (isKnown: boolean, exposure: AccountExposure | undefined) => {
  if (isKnown) return 0;
  return exposure == null ? 1 : 2;
};

/**
 * Finds the signer's trading account for a deployment.
 *
 * The admin capability is an object anyone can send to the wallet, and its sender may still act
 * on the account it names: through an assistant capability minted before the transfer, or
 * through an order ticket created before it, which the ticket's executor runs with no capability
 * at all. Collateral deposited into such an account is the sender's to trade away. `known` are
 * the accounts this device has recorded as the wallet's own; any other account with an assistant
 * capability or a ticket is returned with `exposure` set.
 *
 * Among several capabilities a known account comes first, then one without exposure, then the
 * rest; within each the lowest account number, which is the account perp-api serves.
 */
export const findPerpAccount = async (
  client: ClientWithCoreApi,
  deployment: PerpDeployment,
  owner: string,
  known: readonly string[] = []
): Promise<PerpAccount | undefined> => {
  const caps = await listAccountCaps(client, deployment, owner);
  const candidates = await Promise.all(
    caps.map(async ({ cap, account }) => {
      const { accountId, collateral, assistants } = await readAccount(client, account);
      const isKnown = known.includes(account);
      let exposure: AccountExposure | undefined;
      if (!isKnown) {
        if (assistants > 0) exposure = 'assistants';
        else if (await hasOrderTickets(client, account)) exposure = 'tickets';
      }
      return {
        rank: preference(isKnown, exposure),
        found: { account, cap, accountId, collateral, exposure },
      };
    })
  );
  candidates.sort((a, b) => a.rank - b.rank || (a.found.accountId < b.found.accountId ? -1 : 1));
  return candidates[0]?.found;
};

/** Coin objects of the collateral type owned by `owner`, largest first. */
export const listCollateralCoins = async (
  client: ClientWithCoreApi,
  deployment: PerpDeployment,
  owner: string
) => {
  const coins: { objectId: string; balance: bigint }[] = [];
  let cursor: string | null = null;
  do {
    // eslint-disable-next-line no-await-in-loop -- pages are sequential by cursor
    const page: HaneulClientTypes.ListCoinsResponse = await client.core.listCoins({
      owner,
      coinType: deployment.collateral.coinType,
      cursor,
    });
    page.objects.forEach((c) => coins.push({ objectId: c.objectId, balance: BigInt(c.balance) }));
    cursor = page.hasNextPage ? page.cursor : null;
  } while (cursor);
  return coins.sort((a, b) => (a.balance > b.balance ? -1 : a.balance < b.balance ? 1 : 0));
};

/** Whether the account already has a position object on the market (first sessions must create it). */
export const hasMarketPosition = async (
  client: ClientWithCoreApi,
  deployment: PerpDeployment,
  marketId: string,
  accountId: bigint,
  sender: string
) => {
  const tx = new PerpTransactionBuilder(deployment).positionExists({ marketId, accountId });
  tx.setSender(sender);
  const [first] = await simulateReturnValues(tx, client);
  const bytes = first?.[0];
  return bytes != null && bytes.length > 0 && bytes[0] === 1;
};

const PositionKeyBcs = bcs.struct('PositionKey', { account_id: bcs.u64() });

/** The engine's `position::Position`; amounts are ifixed (1e18, two's complement). */
const PositionBcs = bcs.struct('Position', {
  collateral: bcs.u256(),
  base_asset_amount: bcs.u256(),
  quote_asset_notional_amount: bcs.u256(),
  cum_funding_rate_long: bcs.u256(),
  cum_funding_rate_short: bcs.u256(),
  asks_quantity: bcs.u256(),
  bids_quantity: bcs.u256(),
  pending_orders: bcs.u64(),
  initial_margin_ratio: bcs.u256(),
});

export type PerpPositionState = {
  /** The position's own initial margin ratio (ifixed), i.e. 1 / the leverage it trades at. */
  initialMarginRatio: bigint;
  pendingOrders: bigint;
  /** Signed base size as the raw ifixed two's complement `u256`; zero when flat. */
  base: bigint;
  /** Collateral allocated to the market, as the raw ifixed two's complement `u256`. */
  collateral: bigint;
};

const IFIXED_SIGN_BIT = 2n ** 255n;

/**
 * The collateral, in coin units rounded down, that `deallocate_free_collateral` releases from a
 * position with no size and no resting orders: all of it. Any other position, and a negative
 * (bad debt) collateral, gives zero here; such collateral stays where it is.
 */
export const returnableCollateral = (position: PerpPositionState, collateralDecimals: number) => {
  if (position.base !== 0n || position.pendingOrders !== 0n) return 0n;
  if (position.collateral >= IFIXED_SIGN_BIT) return 0n;
  // The engine keeps collateral as an ifixed of coin units, scaled by 10^(18 - decimals).
  return position.collateral / 10n ** BigInt(18 - collateralDecimals);
};

/**
 * Reads the account's position object on a market, a dynamic field of the clearing house keyed
 * by the account number. Undefined when the account has no position there yet.
 */
export const readPosition = async (
  client: ClientWithCoreApi,
  deployment: PerpDeployment,
  marketId: string,
  accountId: bigint
): Promise<PerpPositionState | undefined> => {
  const market = deployment.markets[marketId];
  if (!market) return undefined;
  try {
    const { dynamicField } = await client.core.getDynamicField({
      parentId: market.clearingHouse,
      name: {
        type: `${deployment.packages.perpetuals}::keys::PositionKey`,
        bcs: PositionKeyBcs.serialize({ account_id: accountId }).toBytes(),
      },
    });
    const position = PositionBcs.parse(dynamicField.value.bcs);
    return {
      initialMarginRatio: BigInt(position.initial_margin_ratio),
      pendingOrders: BigInt(position.pending_orders),
      base: BigInt(position.base_asset_amount),
      collateral: BigInt(position.collateral),
    };
  } catch {
    return undefined;
  }
};

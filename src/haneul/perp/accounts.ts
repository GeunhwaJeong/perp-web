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

export type PerpAccount = {
  /** Shared account object id. */
  account: string;
  /** Owned admin cap object id. */
  cap: string;
  /** Engine account number (u64) used in events and positions. */
  accountId: bigint;
  /** Unallocated collateral held on the account, in coin units. */
  collateral: bigint;
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
  return { accountId: BigInt(parsed.account_id), collateral: BigInt(parsed.collateral) };
};

/**
 * Finds the signer's trading account for a deployment. The first cap wins; the app keeps
 * one account per wallet and the engine allows more only for assistants.
 */
export const findPerpAccount = async (
  client: ClientWithCoreApi,
  deployment: PerpDeployment,
  owner: string
): Promise<PerpAccount | undefined> => {
  const caps = await listAccountCaps(client, deployment, owner);
  const first = caps[0];
  if (!first) return undefined;
  const { accountId, collateral } = await readAccount(client, first.account);
  return { account: first.account, cap: first.cap, accountId, collateral };
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
    };
  } catch {
    return undefined;
  }
};

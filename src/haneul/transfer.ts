import type { ClientWithCoreApi, HaneulClientTypes } from '@haneullabs/haneul/client';
import { Transaction } from '@haneullabs/haneul/transactions';
import { HANEUL_TYPE_ARG, normalizeStructTag } from '@haneullabs/haneul/utils';

/** Whether `coinType` is the coin transactions pay gas in. */
export const isGasCoinType = (coinType: string) =>
  normalizeStructTag(coinType) === normalizeStructTag(HANEUL_TYPE_ARG);

/** Every coin object of `coinType` the owner holds, largest first. */
export const listCoins = async (client: ClientWithCoreApi, owner: string, coinType: string) => {
  const coins: { objectId: string; balance: bigint }[] = [];
  let cursor: string | null = null;
  do {
    // eslint-disable-next-line no-await-in-loop -- pages are sequential by cursor
    const page: HaneulClientTypes.ListCoinsResponse = await client.core.listCoins({
      owner,
      coinType,
      cursor,
    });
    page.objects.forEach((c) => coins.push({ objectId: c.objectId, balance: BigInt(c.balance) }));
    cursor = page.hasNextPage ? page.cursor : null;
  } while (cursor);
  return coins.sort((a, b) => (a.balance > b.balance ? -1 : a.balance < b.balance ? 1 : 0));
};

/**
 * A transaction that sends `amount` units of a coin to `recipient`. The gas coin is split from
 * the gas object itself; any other coin is merged from the owner's coin objects first, so the
 * amount may span several of them.
 */
export const buildCoinSend = ({
  coinType,
  coins,
  amount,
  recipient,
}: {
  coinType: string;
  /** Object IDs to draw from; ignored for the gas coin. */
  coins: string[];
  amount: bigint;
  recipient: string;
}) => {
  const tx = new Transaction();
  let source;
  if (isGasCoinType(coinType)) {
    source = tx.gas;
  } else {
    if (coins.length === 0) throw new Error('No coins to send');
    const [first, ...rest] = coins;
    source = tx.object(first!);
    if (rest.length > 0) {
      tx.mergeCoins(
        source,
        rest.map((c) => tx.object(c))
      );
    }
  }
  const [coin] = tx.splitCoins(source, [tx.pure.u64(amount)]);
  tx.transferObjects([coin!], recipient);
  return tx;
};

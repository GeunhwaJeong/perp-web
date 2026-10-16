import { OrderStatus, SubaccountOrder, SubaccountPosition } from '@/bonsai/types/summaryTypes';
import BigNumber from 'bignumber.js';

import { IndexerOrderSide } from '@/types/indexer/indexerApiGen';

import { BIG_NUMBERS } from '@/lib/numbers';

/**
 * An isolated position's margin as the engine reckons it. The engine holds the position to its
 * initial margin ratio on the larger size it would have if all its resting bids, or all its
 * resting asks, filled (`position::abs_net_base`), so the collateral a resting order brought in
 * belongs to the position's margin; and of that margin it lets out only collateral less any
 * loss, never unrealized profit (`position::compute_free_collateral`).
 */
export type PositionMargin = {
  /** The initial margin the position and its resting orders need. */
  required: BigNumber;
  /** The margin the engine counts toward a withdrawal: without unrealized profit. */
  withdrawable: BigNumber;
  /** The larger size's notional over the position's margin. */
  leverage: BigNumber | null;
};

export function calculatePositionMargin(
  position: SubaccountPosition,
  openOrders: SubaccountOrder[]
): PositionMargin {
  // Stop orders wait off the book as tickets; every other open order rests on it.
  const resting = (side: IndexerOrderSide) =>
    openOrders
      .filter(
        (o) =>
          o.marketId === position.market &&
          o.subaccountNumber === position.subaccountNumber &&
          o.side === side &&
          o.status !== OrderStatus.Untriggered
      )
      .reduce((sum, o) => sum.plus(o.remainingSize ?? o.size), BIG_NUMBERS.ZERO);
  const size = position.signedSize;
  const netSize = BigNumber.max(
    size.plus(resting(IndexerOrderSide.BUY)).abs(),
    size.minus(resting(IndexerOrderSide.SELL)).abs()
  );
  // The position's notional is its size at the mark, the price the indexer reports as oracle.
  const mark = position.unsignedSize.isZero()
    ? BIG_NUMBERS.ZERO
    : position.notional.div(position.unsignedSize);
  const netNotional = netSize.times(mark);
  const margin = position.marginValueInitial;
  return {
    required: netNotional.times(position.adjustedImfFromSelectedLeverage),
    withdrawable: margin.minus(BigNumber.max(position.updatedUnrealizedPnl, 0)),
    leverage: margin.gt(0) ? netNotional.div(margin) : null,
  };
}

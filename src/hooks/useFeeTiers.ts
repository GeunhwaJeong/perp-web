import { useMemo } from 'react';

import { BonsaiCore } from '@/bonsai/ontology';
import { accountFeeRates } from '@/haneul/perp';

import { useAppSelector } from '@/state/appTypes';

/**
 * The fee schedule and where the connected account sits in it. Without an account the rates are
 * those of a new one: the first volume tier, no staking discount.
 */
export const useFeeTiers = () => {
  const schedule = useAppSelector(BonsaiCore.configs.feeSchedule);
  const account = useAppSelector(BonsaiCore.account.fees.data);
  const rates = useMemo(
    () =>
      schedule != null
        ? accountFeeRates(schedule, account?.volume ?? 0, account?.stake ?? 0)
        : undefined,
    [schedule, account]
  );
  return { schedule, account, rates };
};

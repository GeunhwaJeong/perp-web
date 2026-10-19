import { BonsaiCore } from '@/bonsai/ontology';

import { useAppSelector } from '@/state/appTypes';

import { MustBigNumber } from '@/lib/numbers';

/** The connected Haneul wallet's HANEUL and collateral coin balances, read over gRPC. */
export const useAccountBalance = () => {
  const { chainTokenAmount, usdcAmount } = useAppSelector(BonsaiCore.account.balances.data);

  return {
    nativeTokenBalance: MustBigNumber(chainTokenAmount),
    usdcBalance: MustBigNumber(usdcAmount).toNumber(),
  };
};

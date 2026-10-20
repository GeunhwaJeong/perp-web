import BigNumber from 'bignumber.js';
import { keyBy } from 'lodash';

import { TokenConfigsResult } from '@/hooks/useTokenConfigs';

import { AccountBalances, Coin } from '../types/summaryTypes';

// An integer amount of base units as a plain decimal string: 1500000 with 6 decimals is "1.5".
const fromBaseUnits = (amount: string, decimals: number) =>
  new BigNumber(amount).shiftedBy(-decimals).toFixed();

export function processCoinAmount(
  tokenConfig: TokenConfigsResult,
  denom: string | undefined,
  amount: string | undefined
): string | undefined {
  if (amount == null || denom == null) {
    return undefined;
  }

  const decimals = Object.values(tokenConfig.tokensConfigs).find(
    (t) => t.denom === denom
  )?.decimals;
  if (decimals == null) {
    return undefined;
  }

  return fromBaseUnits(amount, decimals);
}

export function convertAmount(amount: string | undefined, decimals: number): string | undefined {
  if (amount == null) {
    return undefined;
  }
  return fromBaseUnits(amount, decimals);
}

export function calculateBalances(
  tokenConfig: TokenConfigsResult,
  balances: Coin[] | undefined
): AccountBalances {
  if (balances == null) {
    return {};
  }
  const byId = keyBy(balances, (b) => b.denom);
  const usdcBase = byId[tokenConfig.usdcDenom];
  const chainTokenBase = byId[tokenConfig.chainTokenDenom];

  return {
    usdcAmount: convertAmount(usdcBase?.amount, tokenConfig.usdcDecimals),
    chainTokenAmount: convertAmount(chainTokenBase?.amount, tokenConfig.chainTokenDecimals),
  };
}

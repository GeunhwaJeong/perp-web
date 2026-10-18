import { dAppKit } from '@/haneul/dAppKit';
import { QueryObserver } from '@tanstack/react-query';

import { TOKEN_CONFIG_MAP } from '@/constants/networks';
import { timeUnits } from '@/constants/time';

import { type RootStore } from '@/state/_store';
import { appQueryClient } from '@/state/appQueryClient';
import { getSelectedDydxChainId } from '@/state/appSelectors';
import { createAppSelector } from '@/state/appTypes';
import { setAccountBalancesRaw } from '@/state/raw';

import { createStoreEffect } from '../lib/createStoreEffect';
import { loadableIdle } from '../lib/loadable';
import { wrapAndLogBonsaiError } from '../logs';
import { selectParentSubaccountInfo } from '../socketSelectors';
import { createValidatorQueryStoreEffect } from './lib/indexerQueryStoreEffect';
import { queryResultToLoadable } from './lib/queryResultToLoadable';
import { safeSubscribeObserver } from './lib/safeSubscribe';

const selectBalancesQueryInput = createAppSelector(
  [getSelectedDydxChainId, selectParentSubaccountInfo],
  (chainId, { wallet }) => ({ chainId, wallet })
);

/**
 * The wallet's coin balances, read from the Haneul node rather than the dYdX validator the
 * rest of this file still talks to. The result keeps the `Coin[]` shape (denom, amount in
 * base units) keyed by the coin types in env.json, so the balance calculator and every
 * consumer are unchanged. The query key keeps the `validator`/`accountBalances` prefix the
 * existing invalidations use.
 */
export function setUpAccountBalancesQuery(store: RootStore) {
  const cleanupEffect = createStoreEffect(
    store,
    selectBalancesQueryInput,
    ({ chainId, wallet }) => {
      if (wallet == null) {
        store.dispatch(setAccountBalancesRaw(loadableIdle()));
        return undefined;
      }
      const coinTypes = [...new Set(Object.values(TOKEN_CONFIG_MAP[chainId]).map((t) => t.denom))];
      const observer = new QueryObserver(appQueryClient, {
        queryKey: ['validator', 'accountBalances', chainId, wallet],
        queryFn: wrapAndLogBonsaiError(async () => {
          const client = dAppKit.getClient();
          return Promise.all(
            coinTypes.map(async (denom) => {
              try {
                const { balance } = await client.core.getBalance({
                  owner: wallet,
                  coinType: denom,
                });
                return { denom, amount: balance.balance };
              } catch {
                // A coin type the address has never held is reported as absent by some nodes.
                return { denom, amount: '0' };
              }
            })
          );
        }, 'accountBalances'),
        refetchInterval: timeUnits.second * 15,
        staleTime: timeUnits.second * 15,
        refetchOnWindowFocus: true,
      });
      return safeSubscribeObserver(observer, (result) => {
        store.dispatch(setAccountBalancesRaw(queryResultToLoadable(result)));
      });
    }
  );
  return () => {
    cleanupEffect();
    store.dispatch(setAccountBalancesRaw(loadableIdle()));
  };
}

export function setUpCompositeClientAccountCacheQuery(store: RootStore) {
  return createValidatorQueryStoreEffect(store, {
    name: 'compositeClientAccountCache',
    selector: selectParentSubaccountInfo,
    getQueryKey: (data) => ['compositeClientAccountCache', data.wallet],
    getQueryFn: (compositeClient, data) => {
      if (data.wallet == null) {
        return null;
      }
      return async () => {
        await compositeClient.populateAccountNumberCache(data.wallet!);
        return true;
      };
    },
    onResult: () => {},
    onNoQuery: () => {},
    refetchInterval: timeUnits.hour,
    staleTime: timeUnits.hour,
  });
}

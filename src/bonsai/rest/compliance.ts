import { timeUnits } from '@/constants/time';

import { type RootStore } from '@/state/_store';
import { getUserSourceWalletAddress } from '@/state/accountInfoSelectors';
import { setSourceAddressScreenV2Raw } from '@/state/raw';

import { loadableIdle } from '../lib/loadable';
import { createIndexerQueryStoreEffect } from './lib/indexerQueryStoreEffect';
import { queryResultToLoadable } from './lib/queryResultToLoadable';

// fetch successfully exactly once then never again
const pollingOptions = {
  refetchInterval: false,
  refetchIntervalInBackground: false,
  refetchOnMount: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  staleTime: Number.POSITIVE_INFINITY,
  retry: 3,
  retryDelay: timeUnits.second * 15,
} as const;

export function setUpIndexerSourceAddressScreenV2Query(store: RootStore) {
  const cleanupEffect = createIndexerQueryStoreEffect(store, {
    name: 'sourceAddressScreenV2',
    selector: getUserSourceWalletAddress,
    getQueryKey: (address) => ['screenSourceWalletV2', address],
    getQueryFn: (indexerClient, address) => {
      if (address == null) {
        return null;
      }
      return () => indexerClient.utility.complianceScreen(address);
    },
    onResult: (screen) => {
      store.dispatch(setSourceAddressScreenV2Raw(queryResultToLoadable(screen)));
    },
    onNoQuery: () => store.dispatch(setSourceAddressScreenV2Raw(loadableIdle())),
    ...pollingOptions,
  });
  return () => {
    cleanupEffect();
    store.dispatch(setSourceAddressScreenV2Raw(loadableIdle()));
  };
}

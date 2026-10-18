import { timeUnits } from '@/constants/time';

import { type RootStore } from '@/state/_store';
import { setConfigTiers } from '@/state/raw';

import { parseToPrimitives } from '@/lib/parseToPrimitives';

import { loadableIdle } from '../lib/loadable';
import { mapLoadableData } from '../lib/mapLoadable';
import { createValidatorQueryStoreEffect } from './lib/indexerQueryStoreEffect';
import { queryResultToLoadable } from './lib/queryResultToLoadable';

export function setUpConfigTiersQuery(store: RootStore) {
  const cleanupEffect = createValidatorQueryStoreEffect(store, {
    name: 'configTiers',
    selector: () => true,
    getQueryKey: () => ['configTiers'],
    getQueryFn: (compositeClient) => {
      return () => compositeClient.validatorClient.get.getEquityTierLimitConfiguration();
    },
    onResult: (result) => {
      store.dispatch(
        setConfigTiers(
          mapLoadableData(queryResultToLoadable(result), (data) => ({
            equityTiers: parseToPrimitives(data).equityTierLimitConfig,
          }))
        )
      );
    },
    onNoQuery: () => store.dispatch(setConfigTiers(loadableIdle())),
    refetchInterval: timeUnits.hour,
    staleTime: timeUnits.hour,
  });
  return () => {
    cleanupEffect();
    store.dispatch(setConfigTiers(loadableIdle()));
  };
}

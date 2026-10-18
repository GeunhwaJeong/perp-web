import { accountTransactionManager } from '@/bonsai/AccountTransactionSupervisor';
import { QueryObserver } from '@tanstack/react-query';

import { timeUnits } from '@/constants/time';

import { type RootStore } from '@/state/_store';
import { appQueryClient } from '@/state/appQueryClient';
import { getSelectedDydxChainId } from '@/state/appSelectors';
import { createAppSelector } from '@/state/appTypes';
import { setAccountFeesRaw, setFeeScheduleRaw } from '@/state/raw';

import { createStoreEffect } from '../lib/createStoreEffect';
import { loadableIdle } from '../lib/loadable';
import { mapLoadableData } from '../lib/mapLoadable';
import { wrapAndLogBonsaiError } from '../logs';
import { selectParentSubaccountInfo } from '../socketSelectors';
import { queryResultToLoadable } from './lib/queryResultToLoadable';
import { safeSubscribeObserver } from './lib/safeSubscribe';

/** The fee schedule object of the current network's deployment. */
export function setUpFeeScheduleQuery(store: RootStore) {
  const cleanupEffect = createStoreEffect(store, getSelectedDydxChainId, (chainId) => {
    const observer = new QueryObserver(appQueryClient, {
      queryKey: ['haneul', 'feeSchedule', chainId],
      // Query data cannot be undefined; a deployment without fee tiers reads as null.
      queryFn: wrapAndLogBonsaiError(
        async () => (await accountTransactionManager.readFeeSchedule()) ?? null,
        'feeSchedule'
      ),
      refetchInterval: timeUnits.hour,
      staleTime: timeUnits.hour,
    });
    return safeSubscribeObserver(observer, (result) => {
      store.dispatch(
        setFeeScheduleRaw(mapLoadableData(queryResultToLoadable(result), (s) => s ?? undefined))
      );
    });
  });
  return () => {
    cleanupEffect();
    store.dispatch(setFeeScheduleRaw(loadableIdle()));
  };
}

const selectAccountFeesQueryInput = createAppSelector(
  [getSelectedDydxChainId, selectParentSubaccountInfo],
  (chainId, { wallet }) => ({ chainId, wallet })
);

/**
 * The connected wallet's fee inputs: its window volume, its stake and the multipliers cached on
 * each market. Sessions refresh it when they end; the interval picks up a stake moved elsewhere.
 */
export function setUpAccountFeesQuery(store: RootStore) {
  const cleanupEffect = createStoreEffect(
    store,
    selectAccountFeesQueryInput,
    ({ chainId, wallet }) => {
      if (wallet == null) {
        store.dispatch(setAccountFeesRaw(loadableIdle()));
        return undefined;
      }
      const observer = new QueryObserver(appQueryClient, {
        queryKey: ['haneul', 'accountFees', chainId, wallet],
        queryFn: wrapAndLogBonsaiError(
          async () => (await accountTransactionManager.readAccountFees()) ?? null,
          'accountFees'
        ),
        refetchInterval: timeUnits.minute,
        staleTime: timeUnits.minute,
        refetchOnWindowFocus: true,
      });
      return safeSubscribeObserver(observer, (result) => {
        store.dispatch(
          setAccountFeesRaw(mapLoadableData(queryResultToLoadable(result), (f) => f ?? undefined))
        );
      });
    }
  );
  return () => {
    cleanupEffect();
    store.dispatch(setAccountFeesRaw(loadableIdle()));
  };
}

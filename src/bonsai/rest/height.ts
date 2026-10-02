import { dAppKit } from '@/haneul/dAppKit';
import { IndexerClient } from '@dydxprotocol/v4-client-js';
import { QueryObserver } from '@tanstack/react-query';
import { omit } from 'lodash';

import { timeUnits } from '@/constants/time';

import { type RootStore } from '@/state/_store';
import { appQueryClient } from '@/state/appQueryClient';
import { getSelectedNetwork } from '@/state/appSelectors';
import {
  GeoHeaders,
  HeightEntry,
  setComplianceGeoHeadersRaw,
  setIndexerHeightRaw,
  setValidatorHeightRaw,
} from '@/state/raw';

import { assertNever } from '@/lib/assertNever';
import { promiseWithTimeout, withRetry } from '@/lib/asyncUtils';
import { MustBigNumber } from '@/lib/numbers';

import { createStoreEffect } from '../lib/createStoreEffect';
import {
  Loadable,
  loadableError,
  loadableIdle,
  loadableLoaded,
  loadablePending,
} from '../lib/loadable';
import { SharedLogIds } from '../logIds';
import { wrapAndLogBonsaiError } from '../logs';
import { createIndexerQueryStoreEffect } from './lib/indexerQueryStoreEffect';
import { queryResultToLoadable } from './lib/queryResultToLoadable';
import { safeSubscribeObserver } from './lib/safeSubscribe';

const requestFrequency = timeUnits.second * 10;
// fail request if it takes longer than this
const requestTimeout = requestFrequency - timeUnits.second;

const heightPollingOptions = {
  refetchInterval: timeUnits.second * 10,
  refetchIntervalInBackground: false,
  networkMode: 'online' as const,
  staleTime: 0,
  retry: 0,
  gcTime: timeUnits.second * 10,
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
  refetchOnMount: false,
};

const manualHeightRetryConfig = { initialDelay: 500, maxRetries: 1 };

// Internal type that includes geo data before it's extracted and stored separately
type IndexerHeightEntry = HeightEntry & {
  geo?: Omit<GeoHeaders, 'lastUpdated'>;
};

const doIndexerHeightQuery = async (
  indexerClient: IndexerClient
): Promise<Loadable<IndexerHeightEntry>> => {
  const requestTime = new Date().toISOString();
  try {
    const result = await promiseWithTimeout(
      withRetry(
        () =>
          wrapAndLogBonsaiError(
            () => indexerClient.utility.getHeightWithHeaders(),
            SharedLogIds.INDEXER_HEIGHT_INNER
          )(),
        manualHeightRetryConfig
      ),
      requestTimeout
    );

    return loadableLoaded({
      requestTime,
      receivedTime: new Date().toISOString(),
      response: { time: result.data.time, height: MustBigNumber(result.data.height).toNumber() },
      geo: {
        status: result.headers['geo-origin-status'],
        region: result.headers['geo-origin-region'],
        country: result.headers['geo-origin-country'],
      },
    });
  } catch (e) {
    return loadableError(
      {
        requestTime,
        receivedTime: new Date().toISOString(),
        response: undefined,
        geo: undefined,
      },
      e
    );
  }
};

const collapseLoadables = <T extends { requestTime: string; receivedTime: string }>(
  obj: Loadable<Loadable<T>>
): Loadable<T> => {
  if (obj.status === 'error') {
    return loadableError(obj.data?.data, obj.error);
  }
  if (obj.status === 'idle') {
    return loadableIdle();
  }
  if (obj.status === 'pending') {
    return loadablePending();
  }
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (obj.status === 'success') {
    return obj.data;
  }
  assertNever(obj);
  return loadableIdle();
};

export function setUpIndexerHeightQuery(store: RootStore) {
  const cleanupEffect = createIndexerQueryStoreEffect(store, {
    name: SharedLogIds.INDEXER_HEIGHT,
    selector: () => true,
    getQueryFn: (indexerClient) => {
      return () => doIndexerHeightQuery(indexerClient);
    },
    onNoQuery: () => store.dispatch(setIndexerHeightRaw(loadableIdle())),
    onResult: (result) => {
      const collapsed = collapseLoadables(queryResultToLoadable(result));

      if (collapsed.status === 'success' && collapsed.data.geo) {
        store.dispatch(setComplianceGeoHeadersRaw(loadableLoaded(collapsed.data.geo)));

        // Remove geo from the height entry before storing
        const heightWithoutGeo = omit(collapsed.data, ['geo']);
        store.dispatch(
          setIndexerHeightRaw({
            ...collapsed,
            data: heightWithoutGeo,
          })
        );
      } else {
        // Dispatch as-is if no geo data (error case)
        store.dispatch(setIndexerHeightRaw(collapsed));
      }
    },
    getQueryKey: () => ['indexerHeight'],
    ...heightPollingOptions,
  });

  return () => {
    cleanupEffect();
    store.dispatch(setIndexerHeightRaw(loadableIdle()));
  };
}

/**
 * The chain's own height, read from the Haneul node the app transacts with. It is what the
 * indexer's height is held against: a node that answers while the indexer trails or has
 * stopped is an indexer problem, and a node that does not answer is a chain problem.
 */
const doNodeHeightQuery = async (): Promise<Loadable<HeightEntry>> => {
  const requestTime = new Date().toISOString();
  try {
    const { response } = await promiseWithTimeout(
      withRetry(
        () =>
          wrapAndLogBonsaiError(
            () => dAppKit.getClient().ledgerService.getServiceInfo({}),
            SharedLogIds.VALIDATOR_HEIGHT_INNER
          )(),
        manualHeightRetryConfig
      ),
      requestTimeout
    );
    if (response.checkpointHeight == null || response.timestamp == null) {
      throw new Error('The node reported no checkpoint');
    }
    const { seconds, nanos } = response.timestamp;
    return loadableLoaded({
      requestTime,
      receivedTime: new Date().toISOString(),
      response: {
        time: new Date(Number(seconds) * 1000 + Math.floor(nanos / 1_000_000)).toISOString(),
        height: Number(response.checkpointHeight),
      },
    });
  } catch (e) {
    return loadableError(
      { requestTime, receivedTime: new Date().toISOString(), response: undefined },
      e
    );
  }
};

export function setUpValidatorHeightQuery(store: RootStore) {
  // Keyed by the selected network only: unlike the queries that go through the dYdX client,
  // this one needs nothing but the node.
  const cleanupEffect = createStoreEffect(store, getSelectedNetwork, (network) => {
    const observer = new QueryObserver(appQueryClient, {
      queryKey: ['haneulNode', 'height', network],
      queryFn: wrapAndLogBonsaiError(doNodeHeightQuery, SharedLogIds.VALIDATOR_HEIGHT),
      ...heightPollingOptions,
    });
    return safeSubscribeObserver(observer, (res) =>
      store.dispatch(setValidatorHeightRaw(collapseLoadables(queryResultToLoadable(res))))
    );
  });

  return () => {
    cleanupEffect();
    store.dispatch(setValidatorHeightRaw(loadableIdle()));
  };
}

import { isOrderTicketsResponse } from '@/types/indexer/indexerChecks';

import { type RootStore } from '@/state/_store';
import { createAppSelector } from '@/state/appTypes';
import { setAccountOrderTicketsRaw } from '@/state/raw';

import { isTruthy } from '@/lib/isTruthy';

import { refreshIndexerQueryOnAccountSocketRefresh } from '../accountRefreshSignal';
import { loadableIdle } from '../lib/loadable';
import { mapLoadableData } from '../lib/mapLoadable';
import { selectIndexerUrl, selectParentSubaccountInfo } from '../socketSelectors';
import { createIndexerQueryStoreEffect } from './lib/indexerQueryStoreEffect';
import { queryResultToLoadable } from './lib/queryResultToLoadable';

const selectOrderTicketsQuery = createAppSelector(
  [selectParentSubaccountInfo, selectIndexerUrl],
  (info, indexerUrl) => ({ ...info, indexerUrl })
);

// The Sigma indexer serves stop and TWAP tickets at an endpoint the dYdX client does not know,
// so this fetches it directly. Tickets change when the account or a keeper acts on them, so the
// account channel's refresh signal and a short refetch keep the list current enough.
export function setUpOrderTicketsQuery(store: RootStore) {
  const cleanupListener = refreshIndexerQueryOnAccountSocketRefresh(['account', 'orderTickets']);
  const cleanupEffect = createIndexerQueryStoreEffect(store, {
    name: 'orderTickets',
    selector: selectOrderTicketsQuery,
    getQueryKey: (data) => ['account', 'orderTickets', data.wallet, data.subaccount],
    getQueryFn: (_indexerClient, data) => {
      if (!isTruthy(data.wallet) || data.isPerpsGeoRestricted) {
        return null;
      }
      const url = new URL(`${data.indexerUrl}/v4/orderTickets/parentSubaccountNumber`);
      url.searchParams.set('address', data.wallet);
      url.searchParams.set('parentSubaccountNumber', String(data.subaccount));
      return async () => {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`orderTickets ${response.status}`);
        }
        return isOrderTicketsResponse(await response.json()).tickets;
      };
    },
    refetchInterval: 15_000,
    onResult: (tickets) => {
      store.dispatch(
        setAccountOrderTicketsRaw(mapLoadableData(queryResultToLoadable(tickets), (t) => t))
      );
    },
    onNoQuery: () => store.dispatch(setAccountOrderTicketsRaw(loadableIdle())),
  });
  return () => {
    cleanupListener();
    cleanupEffect();
    store.dispatch(setAccountOrderTicketsRaw(loadableIdle()));
  };
}

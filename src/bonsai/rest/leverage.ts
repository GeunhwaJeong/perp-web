import { accountTransactionManager } from '@/bonsai/AccountTransactionSupervisor';

import { type RootStore } from '@/state/_store';
import { setSelectedMarketLeverages } from '@/state/raw';

import { createStoreEffect } from '../lib/createStoreEffect';
import { loadableIdle, loadableLoaded } from '../lib/loadable';
import { logBonsaiError } from '../logs';
import { selectParentSubaccountAndMarkets } from '../selectors/account';

/**
 * The leverage the account has chosen per market.
 *
 * On dYdX this is read from the validator. On the engine it is each position's own initial
 * margin ratio, read from the position objects on chain; a market without a position opens at
 * its market's ratio, which is what a missing entry means to the calculators. The selection is
 * reported as loaded and empty at once, so the account summary and the positions are computed
 * while the positions are read, and replaced by what the chain holds when the read lands. The
 * leverage dialog updates its market's entry itself after a successful change.
 */
export function setUpUserLeverageParamsQuery(store: RootStore) {
  const cleanupEffect = createStoreEffect(store, selectParentSubaccountAndMarkets, (data) => {
    const wallet = data.parentSubaccount.wallet;
    if (wallet == null) {
      store.dispatch(setSelectedMarketLeverages(loadableIdle()));
      return undefined;
    }
    store.dispatch(setSelectedMarketLeverages(loadableLoaded({})));
    let cancelled = false;
    accountTransactionManager
      .readMarketLeverages()
      .then((leverages) => {
        if (!cancelled) store.dispatch(setSelectedMarketLeverages(loadableLoaded(leverages)));
      })
      .catch((error) => {
        logBonsaiError('leverage', 'reading position leverages failed', { error });
      });
    return () => {
      cancelled = true;
    };
  });
  return () => {
    cleanupEffect();
    store.dispatch(setSelectedMarketLeverages(loadableIdle()));
  };
}

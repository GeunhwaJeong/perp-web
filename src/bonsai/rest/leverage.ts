import { type RootStore } from '@/state/_store';
import { setSelectedMarketLeverages } from '@/state/raw';

import { createStoreEffect } from '../lib/createStoreEffect';
import { loadableIdle, loadableLoaded } from '../lib/loadable';
import { selectParentSubaccountAndMarkets } from '../selectors/account';

/**
 * The leverage the account has chosen per market.
 *
 * On dYdX this is read from the validator. On the engine it is each position's own initial
 * margin ratio, and the app opens every position at its market's ratio, which is what an empty
 * selection means to the calculators. Until the leverage selector writes
 * `set_position_initial_margin_ratio`, the selection is therefore known to be empty; reporting
 * it as loaded lets the account summary and the positions be computed.
 */
export function setUpUserLeverageParamsQuery(store: RootStore) {
  const cleanupEffect = createStoreEffect(store, selectParentSubaccountAndMarkets, (data) => {
    store.dispatch(
      setSelectedMarketLeverages(
        data.parentSubaccount.wallet == null ? loadableIdle() : loadableLoaded({})
      )
    );
    return undefined;
  });
  return () => {
    cleanupEffect();
    store.dispatch(setSelectedMarketLeverages(loadableIdle()));
  };
}

import { useSyncExternalStore } from 'react';

import { localAccountStore, type AccountSnapshot } from '@/haneul/account';

/** The device's local account (if any), its lock state, and the store's actions. */
export const useLocalAccount = (): AccountSnapshot & { store: typeof localAccountStore } => {
  const snapshot = useSyncExternalStore(
    localAccountStore.subscribe,
    localAccountStore.getSnapshot,
    localAccountStore.getSnapshot
  );
  return { ...snapshot, store: localAccountStore };
};

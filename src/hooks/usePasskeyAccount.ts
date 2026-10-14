import { useSyncExternalStore } from 'react';

import { passkeyAccountStore, type PasskeyAccountRecord } from '@/haneul/account';

/** The device's chain-native passkey account record, if one has been created or recovered. */
export const usePasskeyAccount = (): PasskeyAccountRecord | null =>
  useSyncExternalStore(
    passkeyAccountStore.subscribe,
    passkeyAccountStore.getSnapshot,
    passkeyAccountStore.getSnapshot
  );

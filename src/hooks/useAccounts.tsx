import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { type LocalWallet, type Subaccount } from '@dydxprotocol/v4-client-js';

import { OnboardingGuard, OnboardingState } from '@/constants/account';
import { LocalStorageKey } from '@/constants/localStorage';
import { DydxAddress, PrivateInformation } from '@/constants/wallets';

import { setOnboardingGuard, setOnboardingState } from '@/state/account';
import { useAppDispatch, useAppSelector } from '@/state/appTypes';
import { setLocalWallet } from '@/state/wallet';
import { getSourceAccount } from '@/state/walletSelectors';

import { useLocalStorage } from './useLocalStorage';
import { useWalletConnection } from './useWalletConnection';

const AccountsContext = createContext<ReturnType<typeof useAccountsContext> | undefined>(undefined);

AccountsContext.displayName = 'Accounts';

export const AccountsProvider = ({ ...props }) => (
  <AccountsContext.Provider value={useAccountsContext()} {...props} />
);

export const useAccounts = () => useContext(AccountsContext)!;

/**
 * Account state derived from the connected Haneul wallet.
 *
 * The connected account is the trading account: there is no derived key, no secondary
 * chain wallets and no signature-based onboarding step. Fields that other screens still
 * read from the previous account model are kept in the return shape as `undefined` so
 * the write path can be swapped out separately.
 */
const useAccountsContext = () => {
  const dispatch = useAppDispatch();

  const {
    selectWallet,
    selectedWallet,
    selectedWalletError,
    connectionStatus,
    currentAccount,
    availableWallets,
  } = useWalletConnection();

  const sourceAccount = useAppSelector(getSourceAccount);

  const [dydxSubaccounts, setDydxSubaccounts] = useState<Subaccount[] | undefined>();

  const dydxAddress = useMemo(
    () => (connectionStatus === 'connected' ? (currentAccount?.address as DydxAddress) : undefined),
    [connectionStatus, currentAccount?.address]
  );

  useEffect(() => {
    dispatch(setLocalWallet({ address: dydxAddress, subaccountNumber: 0 }));
  }, [dispatch, dydxAddress]);

  // Onboarding state machine: a connected Wallet Standard account is a fully connected
  // account. `WalletConnected` (wallet present, key not yet derived) no longer occurs.
  useEffect(() => {
    if (connectionStatus === 'connected' && dydxAddress) {
      dispatch(setOnboardingState(OnboardingState.AccountConnected));
    } else if (connectionStatus === 'disconnected') {
      dispatch(setOnboardingState(OnboardingState.Disconnected));
    }
  }, [connectionStatus, dydxAddress, dispatch]);

  useEffect(() => {
    if (!dydxAddress) {
      setDydxSubaccounts(undefined);
    }
  }, [dydxAddress]);

  // Onboarding conditions
  const [hasAcknowledgedTerms, saveHasAcknowledgedTerms] = useLocalStorage({
    key: LocalStorageKey.OnboardingHasAcknowledgedTerms,
    defaultValue: false,
  });

  useEffect(() => {
    dispatch(
      setOnboardingGuard({
        guard: OnboardingGuard.hasAcknowledgedTerms,
        value: hasAcknowledgedTerms,
      })
    );
  }, [dispatch, hasAcknowledgedTerms]);

  useEffect(() => {
    dispatch(
      setOnboardingGuard({
        guard: OnboardingGuard.hasPreviousTransactions,
        value: Boolean(dydxSubaccounts?.length),
      })
    );
  }, [dispatch, dydxSubaccounts]);

  const disconnect = useCallback(async () => {
    await selectWallet(undefined);
  }, [selectWallet]);

  // Kept for call sites that still read the previous account model.
  const hdKey = undefined as PrivateInformation | undefined;
  const localNobleWallet = undefined as LocalWallet | undefined;
  const nobleAddress = undefined as string | undefined;
  const osmosisAddress = undefined as string | undefined;
  const neutronAddress = undefined as string | undefined;
  const setWalletFromSignature = useCallback(
    async (_signature: string) => dydxAddress,
    [dydxAddress]
  );
  const dydxAccountGraz = undefined as
    | Record<string, { bech32Address?: string } | undefined>
    | undefined;

  return {
    // Wallet connection
    sourceAccount,
    localNobleWallet,

    // Wallet selection
    selectWallet,
    selectedWallet,
    selectedWalletError,
    availableWallets,

    setWalletFromSignature,

    // Trading account
    hdKey,
    dydxAddress,
    currentAccount,

    nobleAddress,
    osmosisAddress,
    neutronAddress,

    // Onboarding state
    saveHasAcknowledgedTerms,

    // Disconnect wallet / accounts
    disconnect,

    // cosmos account
    dydxAccountGraz,
  };
};

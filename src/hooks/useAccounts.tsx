import { createContext, useCallback, useContext, useEffect, useMemo } from 'react';

import { OnboardingGuard, OnboardingState } from '@/constants/account';
import { LocalStorageKey } from '@/constants/localStorage';
import { DydxAddress } from '@/constants/wallets';

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
 * chain wallets and no signature-based onboarding step.
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

  // This guard came from the dYdX subaccount list; a connected Haneul account has no such
  // lookup to wait for.
  useEffect(() => {
    dispatch(
      setOnboardingGuard({
        guard: OnboardingGuard.hasPreviousTransactions,
        value: false,
      })
    );
  }, [dispatch]);

  const disconnect = useCallback(async () => {
    await selectWallet(undefined);
  }, [selectWallet]);

  return {
    // Wallet connection
    sourceAccount,

    // Wallet selection
    selectWallet,
    selectedWallet,
    selectedWalletError,
    availableWallets,

    // Trading account
    dydxAddress,
    currentAccount,

    // Onboarding state
    saveHasAcknowledgedTerms,

    // Disconnect wallet / accounts
    disconnect,
  };
};

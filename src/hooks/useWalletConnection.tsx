import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { dAppKit } from '@/haneul/dAppKit';
import { getWalletUniqueIdentifier, type UiWallet } from '@haneullabs/dapp-kit-core';
import {
  useWalletConnection as useDAppKitConnection,
  useWallets,
} from '@haneullabs/dapp-kit-react';

import { ConnectorType, WalletInfo, WalletNetworkType } from '@/constants/wallets';

import { useAppDispatch, useAppSelector } from '@/state/appTypes';
import { clearSourceAccount, setSourceAddress, setWalletInfo } from '@/state/wallet';
import { getSourceAccount } from '@/state/walletSelectors';

import { log } from '@/lib/telemetry';

const WalletConnectionContext = createContext<
  ReturnType<typeof useWalletConnectionContext> | undefined
>(undefined);
WalletConnectionContext.displayName = 'WalletConnection';

export const WalletConnectionProvider = ({ ...props }) => (
  <WalletConnectionContext.Provider value={useWalletConnectionContext()} {...props} />
);

export const useWalletConnection = () => useContext(WalletConnectionContext)!;

type WalletStandardInfo = Extract<WalletInfo, { connectorType: ConnectorType.WalletStandard }>;

const isWalletStandardInfo = (info: WalletInfo | undefined): info is WalletStandardInfo =>
  info?.connectorType === ConnectorType.WalletStandard;

export const walletInfoFromUiWallet = (wallet: UiWallet): WalletStandardInfo => ({
  connectorType: ConnectorType.WalletStandard,
  walletId: getWalletUniqueIdentifier(wallet),
  name: wallet.name,
  icon: wallet.icon,
});

/**
 * Bridges the dapp-kit connection store into the app's persisted `wallet` slice. Every
 * consumer keeps reading `sourceAccount`; only the source of truth changed.
 */
export const useWalletConnectionContext = () => {
  const dispatch = useAppDispatch();
  const sourceAccount = useAppSelector(getSourceAccount);

  const wallets = useWallets();
  const connection = useDAppKitConnection();

  const [selectedWallet, setSelectedWallet] = useState<WalletInfo | undefined>(
    sourceAccount.walletInfo
  );
  const [selectedWalletError, setSelectedWalletError] = useState<string>();

  const findUiWallet = useCallback(
    (walletInfo: WalletInfo | undefined) => {
      if (!isWalletStandardInfo(walletInfo)) return undefined;
      return wallets.find((w) => getWalletUniqueIdentifier(w) === walletInfo.walletId);
    },
    [wallets]
  );

  const connectWallet = useCallback(
    async ({ wallet }: { wallet: WalletInfo | undefined; forceConnect?: boolean }) => {
      const uiWallet = findUiWallet(wallet);
      if (!uiWallet) {
        throw new Error('Wallet is not available in this browser');
      }
      await dAppKit.connectWallet({ wallet: uiWallet });
    },
    [findUiWallet]
  );

  const selectWallet = useCallback(
    async (wallet: WalletInfo | undefined) => {
      setSelectedWalletError(undefined);

      if (wallet == null) {
        setSelectedWallet(undefined);
        try {
          await dAppKit.disconnectWallet();
        } catch (error) {
          log('useWalletConnection/disconnect', error);
        }
        dispatch(clearSourceAccount());
        return;
      }

      setSelectedWallet(wallet);
      try {
        await connectWallet({ wallet });
      } catch (error) {
        log('useWalletConnection/connect', error);
        setSelectedWalletError(error instanceof Error ? error.message : String(error));
      }
    },
    [connectWallet, dispatch]
  );

  // Mirror the live connection into the persisted slice so selectors and the
  // onboarding state machine keep working unchanged.
  useEffect(() => {
    if (connection.status !== 'connected') return;

    const { account, wallet } = connection;
    const walletInfo = walletInfoFromUiWallet(wallet);

    if (sourceAccount.address !== account.address) {
      dispatch(setSourceAddress({ address: account.address, chain: WalletNetworkType.Haneul }));
    }
    const savedWalletInfo = sourceAccount.walletInfo;
    const savedWalletId = isWalletStandardInfo(savedWalletInfo)
      ? savedWalletInfo.walletId
      : undefined;
    if (savedWalletId !== walletInfo.walletId) {
      dispatch(setWalletInfo(walletInfo));
    }
    setSelectedWallet(walletInfo);
  }, [connection, dispatch, sourceAccount.address, sourceAccount.walletInfo]);

  useEffect(() => {
    if (connection.status === 'disconnected' && sourceAccount.address != null) {
      dispatch(clearSourceAccount());
      setSelectedWallet(undefined);
    }
  }, [connection.status, dispatch, sourceAccount.address]);

  const availableWallets = useMemo(() => wallets.map(walletInfoFromUiWallet), [wallets]);

  return {
    // Wallet selection
    selectWallet,
    selectedWallet,
    selectedWalletError,
    availableWallets,

    // Live connection
    connectWallet,
    connectionStatus: connection.status,
    currentAccount: connection.status === 'connected' ? connection.account : undefined,
  };
};

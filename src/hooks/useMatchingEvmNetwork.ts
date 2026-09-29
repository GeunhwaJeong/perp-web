import { useCallback, useEffect, useMemo } from 'react';

import { useAccount, useSwitchChain } from 'wagmi';

import { ConnectorType } from '@/constants/wallets';

import { useAccounts } from './useAccounts';

export const useMatchingEvmNetwork = ({
  chainId,
  switchAutomatically = false,
  onError,
  onSuccess,
}: {
  chainId?: string | number;
  switchAutomatically?: boolean;
  onError?: (error: Error) => void;
  onSuccess?: () => void;
}) => {
  const { chain } = useAccount();
  const { sourceAccount } = useAccounts();
  const { isPending, switchChainAsync } = useSwitchChain();

  const isMatchingNetwork = useMemo(() => {
    // In the Keplr wallet, the network will always match
    if (sourceAccount.walletInfo?.connectorType === ConnectorType.Cosmos) {
      return true;
    }
    // If chainId is not a number, we can assume it is a non EVM compatible chain
    return Boolean(chain && chainId && typeof chainId === 'number' && chain.id === chainId);
  }, [sourceAccount.walletInfo, chain, chainId]);

  const matchNetwork = useCallback(async () => {
    if (!isMatchingNetwork) {
      await switchChainAsync({ chainId: Number(chainId) }, { onError, onSuccess });
    }
  }, [chainId, chain]);

  useEffect(() => {
    if (switchAutomatically) {
      matchNetwork();
    }
  }, [chainId, chain]);

  return {
    isMatchingNetwork,
    matchNetwork,
    isSwitchingNetwork: isPending,
  };
};

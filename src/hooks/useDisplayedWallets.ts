import { WalletInfo } from '@/constants/wallets';

import { useWalletConnection } from './useWalletConnection';

/**
 * Wallets the sign-in dialog offers: everything registered through the Wallet Standard
 * in this browser (extension wallets, the dev burner wallet, and later the zkLogin session).
 */
export const useDisplayedWallets = (): WalletInfo[] => {
  const { availableWallets } = useWalletConnection();
  return availableWallets;
};

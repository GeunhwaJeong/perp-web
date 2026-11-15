import { SIGMA_ACCOUNT_WALLET_NAME } from '@/haneul/account';

import { useAccounts } from './useAccounts';
import { useLocalAccount } from './useLocalAccount';

/**
 * Whether the connected wallet is the account this browser keeps and its recovery phrase has
 * never been shown. Until then the phrase exists only in this browser's storage: the wallet
 * is lost if that storage is cleared or the password is forgotten.
 */
export const useNeedsBackup = () => {
  const {
    sourceAccount: { walletInfo },
  } = useAccounts();
  const { account } = useLocalAccount();
  return walletInfo?.name === SIGMA_ACCOUNT_WALLET_NAME && account !== null && !account.backedUpAt;
};

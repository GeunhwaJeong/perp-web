import { ConnectorType } from '@/constants/wallets';

import type { RootState } from './_store';
import { createAppSelector } from './appTypes';

/**
 * @returns saved wallet and account information
 */
export const getSourceAccount = (state: RootState) => state.wallet.sourceAccount;

export const selectWalletInfo = createAppSelector(
  [getSourceAccount],
  (sourceAccount) => sourceAccount.walletInfo
);

export const selectIsWalletStandardConnected = createAppSelector(
  [selectWalletInfo],
  (walletInfo) => walletInfo?.connectorType === ConnectorType.WalletStandard
);

export const getLocalWalletNonce = (state: RootState) => state.walletEphemeral.localWalletNonce;
export const getHdKeyNonce = (state: RootState) => state.walletEphemeral.hdKeyNonce;

// Cosmos and embedded-wallet connectors no longer exist; call sites that branch on them
// keep compiling and take the default path.
export const selectIsKeplrConnected = (_state: RootState) => false;
export const selectIsTurnkeyConnected = (_state: RootState) => false;

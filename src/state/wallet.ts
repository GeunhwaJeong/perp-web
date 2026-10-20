import type { PayloadAction } from '@reduxjs/toolkit';
import { createSlice } from '@reduxjs/toolkit';

import { WalletInfo, WalletNetworkType } from '@/constants/wallets';

export type SourceAccount = {
  address?: string;
  chain?: WalletNetworkType;
  walletInfo?: WalletInfo;
};

// NOTE: This app slice is persisted via redux-persist. Changes to this type may require migrations.
export interface WalletState {
  sourceAccount: SourceAccount;
  localWallet?: {
    address?: string;
    subaccountNumber?: number;
  };
}

const initialState: WalletState = {
  sourceAccount: {
    address: undefined,
    chain: undefined,
    walletInfo: undefined,
  },
  localWallet: {
    address: undefined,
    subaccountNumber: 0,
  },
};

export const walletSlice = createSlice({
  name: 'wallet',
  initialState,
  reducers: {
    setSourceAddress: (
      state,
      action: PayloadAction<{ address: string; chain: WalletNetworkType }>
    ) => {
      const { address, chain } = action.payload;
      if (!state.sourceAccount) {
        throw new Error('cannot set source address if source account is not defined');
      }

      state.sourceAccount.address = address;
      state.sourceAccount.chain = chain;
    },
    setWalletInfo: (state, action: PayloadAction<WalletInfo>) => {
      state.sourceAccount.walletInfo = action.payload;
    },
    setLocalWallet: (
      state,
      { payload }: PayloadAction<{ address?: string; subaccountNumber?: number }>
    ) => {
      state.localWallet = payload;
    },
    clearSourceAccount: (state) => {
      state.sourceAccount = {
        address: undefined,
        chain: undefined,
        walletInfo: undefined,
      };
    },
  },
});

export const { setSourceAddress, setWalletInfo, clearSourceAccount, setLocalWallet } =
  walletSlice.actions;

import { type EIP6963ProviderInfo } from 'mipd';

import { STRING_KEYS } from '@/constants/localization';

import {
  CoinbaseIcon,
  EmailIcon,
  GenericWalletIcon,
  KeplrIcon,
  MetaMaskIcon,
  OkxWalletIcon,
  PhantomIcon,
  PrivyIcon,
  WalletConnectIcon,
} from '@/icons';

import { DydxChainId, WALLETS_CONFIG_MAP } from './networks';

export enum WalletType {
  CoinbaseWallet = 'COINBASE_WALLET',
  Keplr = 'keplr',
  OkxWallet = 'OKX_WALLET',
  WalletConnect2 = 'WALLETCONNECT_2',
  TestWallet = 'TEST_WALLET',
  OtherWallet = 'OTHER_WALLET',
  Privy = 'PRIVY',
  Phantom = 'PHANTOM',
  MetaMask = 'METAMASK',
  Turnkey = 'TURNKEY',
}

export enum ConnectorType {
  // A wallet discovered through the Wallet Standard; the only connector the app signs with.
  WalletStandard = 'walletStandard',
  Injected = 'injected',
  // Not a real connector type, but a link to download the wallet for those who don't have it installed
  DownloadWallet = 'downloadWallet',
  Coinbase = 'coinbase',
  WalletConnect = 'walletConnect',
  Cosmos = 'cosmos',
  Test = 'test',
  PhantomSolana = 'phantomSolana',
}

export enum WalletNetworkType {
  Haneul = 'haneul',
  Evm = 'evm',
  Cosmos = 'cosmos',
  Solana = 'solana',
}

// This is the type stored in localstorage, so it must consist of only serializable fields
export type WalletInfo =
  | {
      connectorType: ConnectorType.WalletStandard;
      // Stable identifier from the Wallet Standard registration, used to reconnect.
      walletId: string;
      name: string;
      icon?: string;
    }
  | ({
      connectorType: ConnectorType.Injected;
    } & Pick<EIP6963ProviderInfo<string>, 'icon' | 'name' | 'rdns'>)
  | {
      connectorType:
        | ConnectorType.Coinbase
        | ConnectorType.WalletConnect
        | ConnectorType.PhantomSolana;
      name: WalletType;
    }
  | {
      connectorType: ConnectorType.Cosmos;
      name: string;
    }
  | { connectorType: ConnectorType.Test; name: WalletType.TestWallet }
  | { connectorType: ConnectorType.DownloadWallet; name: string; downloadLink: string };

type WalletConfig = {
  type: WalletType;
  stringKey: string;
  icon: string;
};

export const wallets = {
  [WalletType.OtherWallet]: {
    type: WalletType.OtherWallet,
    stringKey: STRING_KEYS.OTHER_WALLET,
    icon: GenericWalletIcon,
  },
  [WalletType.CoinbaseWallet]: {
    type: WalletType.CoinbaseWallet,
    stringKey: STRING_KEYS.COINBASE_WALLET,
    icon: CoinbaseIcon,
  },
  [WalletType.OkxWallet]: {
    type: WalletType.OkxWallet,
    stringKey: STRING_KEYS.OKX_WALLET,
    icon: OkxWalletIcon,
  },
  [WalletType.Keplr]: {
    type: WalletType.Keplr,
    stringKey: STRING_KEYS.KEPLR,
    icon: KeplrIcon,
  },
  [WalletType.TestWallet]: {
    type: WalletType.TestWallet,
    stringKey: STRING_KEYS.TEST_WALLET,
    icon: GenericWalletIcon,
  },
  [WalletType.Privy]: {
    type: WalletType.Privy,
    stringKey: STRING_KEYS.PRIVY,
    icon: PrivyIcon,
  },
  [WalletType.Phantom]: {
    type: WalletType.Phantom,
    stringKey: STRING_KEYS.PHANTOM_SOL,
    icon: PhantomIcon,
  },
  [WalletType.WalletConnect2]: {
    type: WalletType.WalletConnect2,
    stringKey: STRING_KEYS.WALLET_CONNECT_2,
    icon: WalletConnectIcon,
  },
  [WalletType.MetaMask]: {
    type: WalletType.MetaMask,
    stringKey: STRING_KEYS.METAMASK,
    icon: MetaMaskIcon,
  },
  [WalletType.Turnkey]: {
    type: WalletType.Turnkey,
    stringKey: STRING_KEYS.EMAIL_OR_SOCIAL,
    icon: EmailIcon,
  },
} satisfies Record<WalletInfo['name'], WalletConfig>;

/**
 * @description typed data to sign for dYdX Chain onboarding
 */
export const getSignTypedData = (selectedDydxChainId: DydxChainId) =>
  ({
    primaryType: 'dYdX',
    domain: {
      name: WALLETS_CONFIG_MAP[selectedDydxChainId].signTypedDataDomainName,
    },
    types: {
      dYdX: [{ name: 'action', type: 'string' }],
    },
    message: {
      action: WALLETS_CONFIG_MAP[selectedDydxChainId].signTypedDataAction,
    },
  }) as const;

export type EvmAddress = `0x${string}`;
export type SolAddress = `${string}`;
// Haneul account addresses are 0x-prefixed 32-byte hex strings.
export type DydxAddress = string;

export enum DydxChainAsset {
  USDC = 'usdc',
  CHAINTOKEN = 'chain',
}

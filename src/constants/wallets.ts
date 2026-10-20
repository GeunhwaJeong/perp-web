export enum ConnectorType {
  // A wallet discovered through the Wallet Standard; the only connector the app signs with.
  WalletStandard = 'walletStandard',
}

export enum WalletNetworkType {
  Haneul = 'haneul',
}

// This is the type stored in localstorage, so it must consist of only serializable fields
export type WalletInfo = {
  connectorType: ConnectorType.WalletStandard;
  // Stable identifier from the Wallet Standard registration, used to reconnect.
  walletId: string;
  name: string;
  icon?: string;
};

// Haneul account addresses are 0x-prefixed 32-byte hex strings.
export type DydxAddress = string;

export enum DydxChainAsset {
  USDC = 'usdc',
  CHAINTOKEN = 'chain',
}

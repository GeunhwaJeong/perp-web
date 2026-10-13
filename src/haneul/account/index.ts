export { isPlatformAuthenticatorAvailable, passwordFromBiometric } from './biometric';
export * from './errors';
export { isValidMnemonic, mnemonicWords, normalizeMnemonic } from './mnemonic';
export { localAccountStore, type AccountSnapshot, type AccountStatus } from './store';
export type { NameStatus, StoredAccount } from './storage';
export {
  SIGMA_ACCOUNT_WALLET_NAME,
  SigmaAccountWallet,
  sigmaAccountWalletInitializer,
} from './SigmaAccountWallet';

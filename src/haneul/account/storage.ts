import type { SecretPayload } from './crypto';

export type NameStatus =
  /** Chosen at sign-up, not yet written to HaneulNS. */
  | 'pending'
  /** The on-chain record exists and points at this address. */
  | 'claimed';

export type BiometricUnlockRecord = {
  credentialId: string;
  transports: AuthenticatorTransport[];
  /** The password, encrypted under the key that lives in the credential's user handle. */
  payload: SecretPayload;
};

/**
 * Everything the device keeps about the local account. The mnemonic only ever exists
 * inside `vault`; the address and public key are cached so the lock screen can show who
 * is being unlocked without opening it.
 */
export type StoredAccount = {
  version: 1;
  address: string;
  publicKey: string;
  username?: string;
  nameStatus?: NameStatus;
  vault: SecretPayload;
  biometric?: BiometricUnlockRecord;
  createdAt: number;
  backedUpAt?: number;
};

const ACCOUNT_KEY = 'haneul:account:v1';
const SESSION_KEY = 'haneul:account:session';

const localStorageOrNull = () => {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
};

const sessionStorageOrNull = () => {
  try {
    return globalThis.sessionStorage;
  } catch {
    return null;
  }
};

export const loadStoredAccount = (): StoredAccount | null => {
  const raw = localStorageOrNull()?.getItem(ACCOUNT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredAccount>;
    return parsed.version === 1 && parsed.vault && parsed.address
      ? (parsed as StoredAccount)
      : null;
  } catch {
    return null;
  }
};

export const saveStoredAccount = (account: StoredAccount) => {
  localStorageOrNull()?.setItem(ACCOUNT_KEY, JSON.stringify(account));
};

export const clearStoredAccount = () => {
  localStorageOrNull()?.removeItem(ACCOUNT_KEY);
  clearSessionKey();
};

/**
 * The raw vault key for this tab. sessionStorage is scoped to the tab and cleared when it
 * closes, so a reload keeps the account unlocked while a new tab starts locked. It is not a
 * defence against same-origin script, which could just as well read keystrokes; it is a
 * defence against the password being asked on every reload of a trading screen.
 */
export const loadSessionKey = (): string | null =>
  sessionStorageOrNull()?.getItem(SESSION_KEY) ?? null;

export const saveSessionKey = (encodedKey: string) => {
  sessionStorageOrNull()?.setItem(SESSION_KEY, encodedKey);
};

export const clearSessionKey = () => {
  sessionStorageOrNull()?.removeItem(SESSION_KEY);
};

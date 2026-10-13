import type { Ed25519Keypair } from '@haneullabs/haneul/keypairs/ed25519';

import { passwordFromBiometric, setupBiometricUnlock } from './biometric';
import {
  bytesToUtf8,
  decodeBytes,
  encodeBytes,
  exportRawKey,
  importRawKey,
  openWithKey,
  openWithPassword,
  sealWithPassword,
  utf8ToBytes,
} from './crypto';
import { AccountLockedError, NoAccountError } from './errors';
import {
  createMnemonic,
  isValidMnemonic,
  keypairFromMnemonic,
  normalizeMnemonic,
} from './mnemonic';
import {
  clearSessionKey,
  clearStoredAccount,
  loadSessionKey,
  loadStoredAccount,
  saveSessionKey,
  saveStoredAccount,
  type NameStatus,
  type StoredAccount,
} from './storage';

export type AccountStatus = 'none' | 'locked' | 'unlocked';

export type AccountSnapshot = {
  account: StoredAccount | null;
  status: AccountStatus;
  /** False until the tab session has been checked, so screens do not flash "locked". */
  ready: boolean;
};

type Listener = () => void;

/**
 * The one local account a browser holds: a 12-word phrase sealed under a password, with
 * the derived key kept in memory only while unlocked. React reads it through
 * `useSyncExternalStore`; the Wallet Standard wallet reads the keypair directly.
 */
class LocalAccountStore {
  #snapshot: AccountSnapshot;

  #listeners = new Set<Listener>();

  #keypairListeners = new Set<Listener>();

  #keypair?: Ed25519Keypair;

  readonly ready: Promise<void>;

  constructor() {
    const account = loadStoredAccount();
    this.#snapshot = { account, status: account ? 'locked' : 'none', ready: false };
    this.ready = this.#restoreSession();
  }

  subscribe = (listener: Listener) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getSnapshot = () => this.#snapshot;

  /** Fires whenever the signer appears or disappears; the wallet relays it as `change`. */
  onKeypairChange = (listener: Listener) => {
    this.#keypairListeners.add(listener);
    return () => this.#keypairListeners.delete(listener);
  };

  getKeypair = () => this.#keypair;

  get address() {
    return this.#snapshot.account?.address;
  }

  #emit(next: Partial<AccountSnapshot>) {
    this.#snapshot = { ...this.#snapshot, ...next };
    this.#listeners.forEach((listener) => listener());
  }

  #setKeypair(keypair: Ed25519Keypair | undefined) {
    const changed = this.#keypair !== keypair;
    this.#keypair = keypair;
    if (changed) this.#keypairListeners.forEach((listener) => listener());
  }

  async #restoreSession() {
    const { account } = this.#snapshot;
    const encodedKey = loadSessionKey();
    if (account && encodedKey) {
      try {
        const key = await importRawKey(decodeBytes(encodedKey));
        const mnemonic = bytesToUtf8(await openWithKey({ key, payload: account.vault }));
        this.#setKeypair(keypairFromMnemonic(mnemonic));
        this.#emit({ status: 'unlocked', ready: true });
        return;
      } catch {
        clearSessionKey();
      }
    }
    this.#emit({ ready: true });
  }

  async #unlockWith(mnemonic: string, key: CryptoKey) {
    this.#setKeypair(keypairFromMnemonic(mnemonic));
    saveSessionKey(encodeBytes(await exportRawKey(key)));
    this.#emit({ status: 'unlocked' });
  }

  #requireAccount(): StoredAccount {
    const { account } = this.#snapshot;
    if (!account) throw new NoAccountError();
    return account;
  }

  #save(account: StoredAccount) {
    saveStoredAccount(account);
    this.#emit({ account });
  }

  /** Creates a fresh phrase, seals it, and leaves the account unlocked. */
  async create({ username, password }: { username?: string; password: string }) {
    const mnemonic = createMnemonic();
    await this.#install({
      mnemonic,
      password,
      username,
      nameStatus: username ? 'pending' : undefined,
    });
    return { mnemonic };
  }

  /** Restores an account from its phrase; replaces whatever this device held before. */
  async import({ mnemonic, password }: { mnemonic: string; password: string }) {
    if (!isValidMnemonic(mnemonic)) throw new Error('That is not a valid recovery phrase');
    await this.#install({ mnemonic: normalizeMnemonic(mnemonic), password, backedUp: true });
  }

  async #install({
    mnemonic,
    password,
    username,
    nameStatus,
    backedUp,
  }: {
    mnemonic: string;
    password: string;
    username?: string;
    nameStatus?: NameStatus;
    backedUp?: boolean;
  }) {
    const keypair = keypairFromMnemonic(mnemonic);
    const { payload, key } = await sealWithPassword({ password, plaintext: utf8ToBytes(mnemonic) });
    const account: StoredAccount = {
      version: 1,
      address: keypair.getPublicKey().toHaneulAddress(),
      publicKey: keypair.getPublicKey().toBase64(),
      username,
      nameStatus,
      vault: payload,
      createdAt: Date.now(),
      backedUpAt: backedUp ? Date.now() : undefined,
    };
    this.#save(account);
    await this.#unlockWith(mnemonic, key);
  }

  async unlockWithPassword(password: string) {
    const account = this.#requireAccount();
    const { plaintext, key } = await openWithPassword({ password, payload: account.vault });
    await this.#unlockWith(bytesToUtf8(plaintext), key);
  }

  async unlockWithBiometric() {
    const account = this.#requireAccount();
    if (!account.biometric) throw new Error('Face ID unlock is not set up');
    const password = await passwordFromBiometric(account.biometric);
    await this.unlockWithPassword(password);
  }

  /** Confirms the password without changing lock state (used before showing the phrase). */
  async verifyPassword(password: string) {
    const account = this.#requireAccount();
    await openWithPassword({ password, payload: account.vault });
  }

  async revealMnemonic(password: string): Promise<string> {
    const account = this.#requireAccount();
    const { plaintext } = await openWithPassword({ password, payload: account.vault });
    return bytesToUtf8(plaintext);
  }

  async enableBiometric(password: string) {
    const account = this.#requireAccount();
    await this.verifyPassword(password);
    const biometric = await setupBiometricUnlock({ password, username: account.username });
    this.#save({ ...account, biometric });
  }

  disableBiometric() {
    const account = { ...this.#requireAccount() };
    delete account.biometric;
    this.#save(account);
  }

  lock() {
    if (!this.#snapshot.account) return;
    this.#setKeypair(undefined);
    clearSessionKey();
    this.#emit({ status: 'locked' });
  }

  /** Forgets the account entirely. Only a recovery phrase brings it back. */
  reset() {
    this.#setKeypair(undefined);
    clearStoredAccount();
    this.#emit({ account: null, status: 'none' });
  }

  setName({ username, status }: { username: string; status: NameStatus }) {
    const account = this.#requireAccount();
    this.#save({ ...account, username, nameStatus: status });
  }

  markBackedUp() {
    const account = this.#requireAccount();
    if (account.backedUpAt) return;
    this.#save({ ...account, backedUpAt: Date.now() });
  }

  requireKeypair(): Ed25519Keypair {
    if (!this.#keypair) throw new AccountLockedError();
    return this.#keypair;
  }
}

export const localAccountStore = new LocalAccountStore();

import {
  BrowserPasskeyProvider,
  findCommonPublicKey,
  PasskeyKeypair,
  PasskeyPublicKey,
  type PasskeyProvider,
} from '@haneullabs/haneul/keypairs/passkey';
import { fromBase64, toBase64 } from '@haneullabs/haneul/utils';

import { BiometricCancelledError } from './errors';

/**
 * The chain-native passkey account (SIP-9): the WebAuthn credential *is* the signing key,
 * and validators verify its secp256r1 assertion directly. No vault, no password, no
 * server; the authenticator prompts for every signature, which is the trade-off against
 * the password-sealed local account.
 */
export type PasskeyAccountRecord = {
  version: 1;
  address: string;
  /** Raw secp256r1 public key, base64. */
  publicKey: string;
  /** Credential id, base64; constrains which passkey the browser offers when signing. */
  credentialId?: string;
  username?: string;
  nameStatus?: 'pending' | 'claimed';
  createdAt: number;
};

const STORAGE_KEY = 'haneul:passkey-account:v1';
const RP_NAME = 'Sigma';

const storage = () => {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
};

export const loadPasskeyAccount = (): PasskeyAccountRecord | null => {
  const raw = storage()?.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PasskeyAccountRecord>;
    return parsed.version === 1 && parsed.publicKey && parsed.address
      ? (parsed as PasskeyAccountRecord)
      : null;
  } catch {
    return null;
  }
};

export const savePasskeyAccount = (record: PasskeyAccountRecord) => {
  storage()?.setItem(STORAGE_KEY, JSON.stringify(record));
};

export const clearPasskeyAccount = () => {
  storage()?.removeItem(STORAGE_KEY);
};

export const passkeyProvider = (): PasskeyProvider =>
  new BrowserPasskeyProvider(RP_NAME, {
    rp: { name: RP_NAME, id: globalThis.location.hostname },
    // The SDK defaults to 'cross-platform' (security keys, phones over QR); the screen
    // promises Face ID or a fingerprint, which is the platform authenticator.
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      residentKey: 'required',
      userVerification: 'required',
    },
  });

const asCancelled = (error: unknown): never => {
  if (
    error instanceof DOMException &&
    (error.name === 'NotAllowedError' || error.name === 'AbortError')
  ) {
    throw new BiometricCancelledError();
  }
  throw error;
};

const toRecord = (keypair: PasskeyKeypair, username?: string): PasskeyAccountRecord => {
  const publicKey = keypair.getPublicKey();
  const credentialId = keypair.getCredentialId();
  return {
    version: 1,
    address: publicKey.toHaneulAddress(),
    publicKey: toBase64(publicKey.toRawBytes()),
    credentialId: credentialId ? toBase64(credentialId) : undefined,
    username,
    nameStatus: username ? 'pending' : undefined,
    createdAt: Date.now(),
  };
};

/** Registers a fresh passkey with the authenticator; the address derives from its key. */
export const createPasskeyAccount = async (username?: string): Promise<PasskeyAccountRecord> => {
  const keypair = await PasskeyKeypair.getPasskeyInstance(passkeyProvider()).catch(asCancelled);
  const record = toRecord(keypair, username);
  savePasskeyAccount(record);
  return record;
};

/**
 * Finds the account behind a passkey this browser already has. WebAuthn only hands the
 * public key out at registration, so two signatures over different messages are asked
 * for and the one key both could have produced is the account's.
 */
export const recoverPasskeyAccount = async (): Promise<PasskeyAccountRecord> => {
  const provider = passkeyProvider();
  const first = await PasskeyKeypair.signAndRecover(
    provider,
    new TextEncoder().encode('Sigma passkey recovery, step 1')
  ).catch(asCancelled);
  const second = await PasskeyKeypair.signAndRecover(
    provider,
    new TextEncoder().encode('Sigma passkey recovery, step 2')
  ).catch(asCancelled);
  const common = findCommonPublicKey(first, second);
  const keypair = new PasskeyKeypair(common.toRawBytes(), provider);
  const record = toRecord(keypair);
  savePasskeyAccount(record);
  return record;
};

/** A signer for a stored record; every call to it prompts the authenticator. */
export const passkeySigner = (record: PasskeyAccountRecord): PasskeyKeypair =>
  new PasskeyKeypair(
    fromBase64(record.publicKey),
    passkeyProvider(),
    record.credentialId ? fromBase64(record.credentialId) : undefined
  );

export const passkeyPublicKey = (record: PasskeyAccountRecord): PasskeyPublicKey =>
  new PasskeyPublicKey(fromBase64(record.publicKey));

type Listener = () => void;

/** The passkey account's record, observable so the dialog and the wallet agree. */
class PasskeyAccountStore {
  #record: PasskeyAccountRecord | null = loadPasskeyAccount();

  #listeners = new Set<Listener>();

  subscribe = (listener: Listener) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getSnapshot = () => this.#record;

  set(record: PasskeyAccountRecord | null) {
    this.#record = record;
    if (record) savePasskeyAccount(record);
    else clearPasskeyAccount();
    this.#listeners.forEach((listener) => listener());
  }

  setName({ username, status }: { username: string; status: 'pending' | 'claimed' }) {
    if (this.#record) this.set({ ...this.#record, username, nameStatus: status });
  }
}

export const passkeyAccountStore = new PasskeyAccountStore();

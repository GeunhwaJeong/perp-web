import {
  asBuffer,
  decodeBytes,
  decryptWithKey,
  encodeBytes,
  encryptWithKey,
  generateRawKey,
  importRawKey,
  randomBytes,
  utf8ToBytes,
  bytesToUtf8,
} from './crypto';
import { BiometricCancelledError, BiometricUnavailableError } from './errors';
import type { BiometricUnlockRecord } from './storage';

/**
 * Face ID / Touch ID unlock without a server, the way the Uniswap extension does it: a
 * WebAuthn credential is created whose user handle *is* a random AES key. The password is
 * encrypted under that key and stored. Unlocking asks the platform authenticator for an
 * assertion, which hands the user handle back, which decrypts the password, which opens
 * the vault. The authenticator never learns the password and the page never stores the key.
 */

const RP_NAME = 'Sigma';
const PROMPT_TIMEOUT_MS = 60_000;

const rpId = () => globalThis.location.hostname;

export const isPlatformAuthenticatorAvailable = async (): Promise<boolean> => {
  const credentials = globalThis.PublicKeyCredential;
  if (!credentials.isUserVerifyingPlatformAuthenticatorAvailable) return false;
  try {
    return await credentials.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
};

const asCancelled = (error: unknown): never => {
  if (
    error instanceof DOMException &&
    (error.name === 'NotAllowedError' || error.name === 'AbortError')
  ) {
    throw new BiometricCancelledError();
  }
  throw error;
};

export const setupBiometricUnlock = async ({
  password,
  username,
}: {
  password: string;
  username?: string;
}): Promise<BiometricUnlockRecord> => {
  if (!(await isPlatformAuthenticatorAvailable())) {
    throw new BiometricUnavailableError();
  }

  const rawKey = generateRawKey();
  const credential = (await navigator.credentials
    .create({
      publicKey: {
        challenge: randomBytes(32),
        rp: { name: RP_NAME, id: rpId() },
        user: {
          // The user handle is returned on every assertion for a discoverable credential,
          // which is what makes it a key store the page does not have to hold.
          id: asBuffer(rawKey),
          // Labelled as the unlock, so the system's credential picker tells it apart from a
          // chain-native passkey account registered under the same site.
          name: `${username ? `${username}.haneul` : 'Sigma account'} · Face ID unlock`,
          displayName: `${username ? `${username}.haneul` : 'Sigma account'} · Face ID unlock`,
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
          { type: 'public-key', alg: -8 },
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          residentKey: 'required',
          userVerification: 'required',
        },
        timeout: PROMPT_TIMEOUT_MS,
        attestation: 'none',
      },
    })
    .catch(asCancelled)) as PublicKeyCredential | null;

  if (!credential) throw new BiometricCancelledError();

  const response = credential.response as AuthenticatorAttestationResponse;
  const transports =
    typeof response.getTransports === 'function'
      ? (response.getTransports() as AuthenticatorTransport[])
      : [];
  const credentialId = encodeBytes(new Uint8Array(credential.rawId));

  const key = await importRawKey(rawKey);
  const { ciphertext, iv } = await encryptWithKey({
    key,
    plaintext: utf8ToBytes(password),
    additionalData: credentialId,
  });

  return {
    credentialId,
    transports,
    payload: {
      ciphertext: encodeBytes(ciphertext),
      iv: encodeBytes(iv),
      // The key is random, not derived, so the KDF fields are informational only.
      salt: '',
      iterations: 0,
      hash: 'SHA-256',
    },
  };
};

/** Prompts for Face ID / Touch ID and returns the password the record protects. */
export const passwordFromBiometric = async (record: BiometricUnlockRecord): Promise<string> => {
  const credential = (await navigator.credentials
    .get({
      publicKey: {
        challenge: randomBytes(32),
        rpId: rpId(),
        allowCredentials: [
          {
            type: 'public-key',
            id: asBuffer(decodeBytes(record.credentialId)),
            transports: record.transports,
          },
        ],
        userVerification: 'required',
        timeout: PROMPT_TIMEOUT_MS,
      },
    })
    .catch(asCancelled)) as PublicKeyCredential | null;

  if (!credential) throw new BiometricCancelledError();

  const response = credential.response as AuthenticatorAssertionResponse;
  if (!response.userHandle) {
    throw new Error('The authenticator returned no user handle');
  }

  const key = await importRawKey(new Uint8Array(response.userHandle));
  const password = await decryptWithKey({
    key,
    ciphertext: decodeBytes(record.payload.ciphertext),
    iv: decodeBytes(record.payload.iv),
    additionalData: record.credentialId,
  });
  return bytesToUtf8(password);
};

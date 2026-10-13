import { fromBase64, toBase64 } from '@haneullabs/haneul/utils';

import { InvalidPasswordError } from './errors';

/**
 * Password-derived encryption for the account vault. The shape mirrors what the Uniswap
 * extension keyring stores: PBKDF2 over the password, AES-GCM over the secret, with every
 * parameter kept next to the ciphertext so the KDF cost can be raised later without a
 * migration.
 */
export type SecretPayload = {
  ciphertext: string;
  iv: string;
  salt: string;
  iterations: number;
  hash: 'SHA-256';
};

// OWASP's 2023 floor for PBKDF2-HMAC-SHA256. Around 300 ms on a laptop, which is paid once
// per unlock, never per transaction.
const PBKDF2_ITERATIONS = 600_000;
const AES_KEY_BITS = 256;
const IV_BYTES = 12;
const SALT_BYTES = 16;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export const randomBytes = (length: number): Uint8Array<ArrayBuffer> =>
  globalThis.crypto.getRandomValues(new Uint8Array(length));

/**
 * WebCrypto and WebAuthn want views over a plain ArrayBuffer; bytes that came out of a
 * base64 decode or a library may sit on a SharedArrayBuffer-typed view, so copy them.
 */
export const asBuffer = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(bytes);

export const utf8ToBytes = (text: string): Uint8Array => textEncoder.encode(text);
export const bytesToUtf8 = (bytes: Uint8Array): string => textDecoder.decode(bytes);

export const encodeBytes = (bytes: Uint8Array): string => toBase64(bytes);
export const decodeBytes = (encoded: string): Uint8Array => fromBase64(encoded);

const subtle = () => globalThis.crypto.subtle;

export const deriveKeyFromPassword = async ({
  password,
  salt,
  iterations,
  hash,
}: {
  password: string;
  salt: Uint8Array;
  iterations: number;
  hash: 'SHA-256';
}): Promise<CryptoKey> => {
  const baseKey = await subtle().importKey(
    'raw',
    asBuffer(utf8ToBytes(password)),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return subtle().deriveKey(
    { name: 'PBKDF2', salt: asBuffer(salt), iterations, hash },
    baseKey,
    { name: 'AES-GCM', length: AES_KEY_BITS },
    true,
    ['encrypt', 'decrypt']
  );
};

export const importRawKey = (raw: Uint8Array): Promise<CryptoKey> =>
  subtle().importKey('raw', asBuffer(raw), { name: 'AES-GCM', length: AES_KEY_BITS }, true, [
    'encrypt',
    'decrypt',
  ]);

export const exportRawKey = async (key: CryptoKey): Promise<Uint8Array> =>
  new Uint8Array(await subtle().exportKey('raw', key));

export const generateRawKey = (): Uint8Array => randomBytes(AES_KEY_BITS / 8);

export const encryptWithKey = async ({
  key,
  plaintext,
  additionalData,
}: {
  key: CryptoKey;
  plaintext: Uint8Array;
  additionalData?: string;
}): Promise<{ ciphertext: Uint8Array; iv: Uint8Array }> => {
  const iv = randomBytes(IV_BYTES);
  const ciphertext = await subtle().encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: additionalData ? asBuffer(utf8ToBytes(additionalData)) : undefined,
    },
    key,
    asBuffer(plaintext)
  );
  return { ciphertext: new Uint8Array(ciphertext), iv };
};

export const decryptWithKey = async ({
  key,
  ciphertext,
  iv,
  additionalData,
}: {
  key: CryptoKey;
  ciphertext: Uint8Array;
  iv: Uint8Array;
  additionalData?: string;
}): Promise<Uint8Array> => {
  try {
    const plaintext = await subtle().decrypt(
      {
        name: 'AES-GCM',
        iv: asBuffer(iv),
        additionalData: additionalData ? asBuffer(utf8ToBytes(additionalData)) : undefined,
      },
      key,
      asBuffer(ciphertext)
    );
    return new Uint8Array(plaintext);
  } catch {
    // AES-GCM fails authentication as an opaque OperationError; a wrong key is the only
    // way that happens for a payload we wrote ourselves.
    throw new InvalidPasswordError();
  }
};

/** Encrypts `plaintext` under a fresh salt with the given password. */
export const sealWithPassword = async ({
  password,
  plaintext,
}: {
  password: string;
  plaintext: Uint8Array;
}): Promise<{ payload: SecretPayload; key: CryptoKey }> => {
  const salt = randomBytes(SALT_BYTES);
  const key = await deriveKeyFromPassword({
    password,
    salt,
    iterations: PBKDF2_ITERATIONS,
    hash: 'SHA-256',
  });
  const { ciphertext, iv } = await encryptWithKey({ key, plaintext });
  return {
    key,
    payload: {
      ciphertext: encodeBytes(ciphertext),
      iv: encodeBytes(iv),
      salt: encodeBytes(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
  };
};

/** Re-derives the vault key from the password and opens the payload. */
export const openWithPassword = async ({
  password,
  payload,
}: {
  password: string;
  payload: SecretPayload;
}): Promise<{ plaintext: Uint8Array; key: CryptoKey }> => {
  const key = await deriveKeyFromPassword({
    password,
    salt: decodeBytes(payload.salt),
    iterations: payload.iterations,
    hash: payload.hash,
  });
  const plaintext = await openWithKey({ key, payload });
  return { plaintext, key };
};

/** Opens the payload with an already derived vault key (tab session, Face ID). */
export const openWithKey = ({
  key,
  payload,
}: {
  key: CryptoKey;
  payload: SecretPayload;
}): Promise<Uint8Array> =>
  decryptWithKey({
    key,
    ciphertext: decodeBytes(payload.ciphertext),
    iv: decodeBytes(payload.iv),
  });

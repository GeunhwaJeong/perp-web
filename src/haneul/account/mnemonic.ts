import { Ed25519Keypair } from '@haneullabs/haneul/keypairs/ed25519';
import { generateMnemonic, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

/** 128 bits of entropy: the 12-word phrase every wallet's import screen accepts. */
const MNEMONIC_STRENGTH_BITS = 128;

export const createMnemonic = (): string => generateMnemonic(wordlist, MNEMONIC_STRENGTH_BITS);

export const normalizeMnemonic = (input: string): string =>
  input.trim().toLowerCase().split(/\s+/).join(' ');

export const isValidMnemonic = (input: string): boolean =>
  validateMnemonic(normalizeMnemonic(input), wordlist);

/**
 * The account key is the first address of the standard derivation path, the same one the
 * CLI and hardware wallets use, so a phrase exported from here restores the same address
 * anywhere else.
 */
export const keypairFromMnemonic = (mnemonic: string): Ed25519Keypair =>
  Ed25519Keypair.deriveKeypair(normalizeMnemonic(mnemonic));

export const mnemonicWords = (mnemonic: string): string[] => normalizeMnemonic(mnemonic).split(' ');

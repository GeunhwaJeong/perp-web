// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountExistsError } from '../errors';
import { createMnemonic, keypairFromMnemonic } from '../mnemonic';
import { loadStoredAccount } from '../storage';
import { LocalAccountStore } from '../store';

/** What a browser's storage does, kept in memory. */
const memoryStorage = () => {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
    removeItem: (key: string) => {
      items.delete(key);
    },
  };
};

const PASSWORD = 'a password of the test';
// Sealing a phrase derives a key over 600,000 rounds, which takes a moment each time.
const SLOW = 30_000;

const addressOf = (mnemonic: string) =>
  keypairFromMnemonic(mnemonic).getPublicKey().toHaneulAddress();

describe('the local account store', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
    vi.stubGlobal('sessionStorage', memoryStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it(
    'makes the first account of a browser and leaves it unlocked',
    async () => {
      const store = new LocalAccountStore();
      await store.ready;

      const { mnemonic } = await store.create({ username: 'first', password: PASSWORD });

      expect(mnemonic.split(' ')).toHaveLength(12);
      expect(store.getSnapshot().status).toBe('unlocked');
      expect(store.address).toBe(addressOf(mnemonic));
      expect(loadStoredAccount()?.address).toBe(addressOf(mnemonic));
      // A phrase the account made itself has not been written down by anyone yet.
      expect(loadStoredAccount()?.backedUpAt).toBeUndefined();
    },
    SLOW
  );

  it(
    'refuses to make an account in the place of the one that is stored',
    async () => {
      const store = new LocalAccountStore();
      const { mnemonic } = await store.create({ password: PASSWORD });

      await expect(store.create({ password: PASSWORD })).rejects.toBeInstanceOf(AccountExistsError);

      expect(store.address).toBe(addressOf(mnemonic));
      expect(loadStoredAccount()?.address).toBe(addressOf(mnemonic));
    },
    SLOW
  );

  it(
    'refuses to restore a phrase in the place of the account that is stored',
    async () => {
      const store = new LocalAccountStore();
      const { mnemonic } = await store.create({ password: PASSWORD });

      await expect(
        store.import({ mnemonic: createMnemonic(), password: PASSWORD })
      ).rejects.toBeInstanceOf(AccountExistsError);

      expect(loadStoredAccount()?.address).toBe(addressOf(mnemonic));
    },
    SLOW
  );

  it(
    'refuses while the account is locked as well',
    async () => {
      const store = new LocalAccountStore();
      const { mnemonic } = await store.create({ password: PASSWORD });
      store.lock();

      await expect(store.create({ password: PASSWORD })).rejects.toBeInstanceOf(AccountExistsError);

      expect(loadStoredAccount()?.address).toBe(addressOf(mnemonic));
    },
    SLOW
  );

  it(
    'sees an account that another tab saved after this one loaded',
    async () => {
      const thisTab = new LocalAccountStore();
      const otherTab = new LocalAccountStore();
      const { mnemonic } = await otherTab.create({ password: PASSWORD });
      // This tab loaded before the account was saved, so its own snapshot has none.
      expect(thisTab.getSnapshot().account).toBeNull();

      await expect(thisTab.create({ password: PASSWORD })).rejects.toBeInstanceOf(
        AccountExistsError
      );

      expect(loadStoredAccount()?.address).toBe(addressOf(mnemonic));
    },
    SLOW
  );

  it(
    'replaces the stored account for a caller that says the user was told',
    async () => {
      const store = new LocalAccountStore();
      const first = await store.create({ username: 'first', password: PASSWORD });

      const second = await store.create({ username: 'second', password: PASSWORD, replace: true });

      expect(second.mnemonic).not.toBe(first.mnemonic);
      expect(store.address).toBe(addressOf(second.mnemonic));
      expect(loadStoredAccount()?.username).toBe('second');
    },
    SLOW
  );

  it(
    'restores a phrase once the stored account has been removed',
    async () => {
      const store = new LocalAccountStore();
      await store.create({ password: PASSWORD });
      const phrase = createMnemonic();

      store.reset();
      await store.import({ mnemonic: phrase, password: PASSWORD });

      expect(store.address).toBe(addressOf(phrase));
      // A phrase the user typed is one the user holds.
      expect(loadStoredAccount()?.backedUpAt).toBeDefined();
    },
    SLOW
  );
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const id = (byte: string) => `0x${byte.repeat(32)}`;
const OWNER = id('ee');
const ACCOUNT = id('10');
const KEY = 'haneul:perp:known-accounts:v1';

describe('known accounts', () => {
  // The module keeps what it recorded for the session, so each test loads it anew: a page load.
  let known: typeof import('../knownAccounts');
  const reload = async () => {
    vi.resetModules();
    known = await import('../knownAccounts');
  };

  beforeEach(async () => {
    localStorage.clear();
    await reload();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('knows nothing at first', () => {
    expect(known.loadKnownAccounts('mainnet', OWNER)).toEqual([]);
  });

  it('remembers an account for its wallet and network only', () => {
    known.rememberAccount('mainnet', OWNER, ACCOUNT);
    expect(known.loadKnownAccounts('mainnet', OWNER)).toEqual([ACCOUNT]);
    expect(known.loadKnownAccounts('localnet', OWNER)).toEqual([]);
    expect(known.loadKnownAccounts('mainnet', id('ef'))).toEqual([]);
  });

  it('still knows the account after the page is loaded again', async () => {
    known.rememberAccount('mainnet', OWNER, ACCOUNT);
    await reload();
    expect(known.loadKnownAccounts('mainnet', OWNER)).toEqual([ACCOUNT]);
  });

  it('keeps one record of an account however its id is written', () => {
    known.rememberAccount('mainnet', OWNER, '0x10');
    known.rememberAccount('mainnet', OWNER, `0x${'0'.repeat(62)}10`);
    expect(known.loadKnownAccounts('mainnet', OWNER)).toEqual([`0x${'0'.repeat(62)}10`]);
  });

  it('adds a second account next to the first', () => {
    known.rememberAccount('mainnet', OWNER, ACCOUNT);
    known.rememberAccount('mainnet', OWNER, id('20'));
    expect(known.loadKnownAccounts('mainnet', OWNER)).toEqual([ACCOUNT, id('20')]);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({
      [`mainnet:${OWNER}`]: [ACCOUNT, id('20')],
    });
  });

  it('reads a damaged record as empty and writes over it', async () => {
    localStorage.setItem(KEY, '{not json');
    expect(known.loadKnownAccounts('mainnet', OWNER)).toEqual([]);
    known.rememberAccount('mainnet', OWNER, ACCOUNT);
    await reload();
    expect(known.loadKnownAccounts('mainnet', OWNER)).toEqual([ACCOUNT]);
  });

  it('holds the record for the session when the storage refuses it', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    known.rememberAccount('mainnet', OWNER, ACCOUNT);
    expect(known.loadKnownAccounts('mainnet', OWNER)).toEqual([ACCOUNT]);
    await reload();
    expect(known.loadKnownAccounts('mainnet', OWNER)).toEqual([]);
  });

  it('holds the record for the session without any storage, as in the scripts', () => {
    vi.stubGlobal('localStorage', undefined);
    known.rememberAccount('mainnet', OWNER, ACCOUNT);
    expect(known.loadKnownAccounts('mainnet', OWNER)).toEqual([ACCOUNT]);
  });
});

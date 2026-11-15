import { normalizeHaneulAddress } from '@haneullabs/haneul/utils';

/**
 * The trading accounts this device has recorded as a wallet's own: the ones the app opened here,
 * and the ones `findPerpAccount` found with nothing on them that lets another address act. The
 * record is what tells the tickets a wallet places later from the tickets an account arrived
 * with.
 */

const KEY = 'haneul:perp:known-accounts:v1';

/** `network:owner` -> account object ids. */
type Stored = Record<string, string[]>;

// What was recorded since the page loaded. A record the storage refuses (it is full, or absent
// as in the scripts) still holds until the page is left, so the tickets a wallet places in the
// meantime do not turn its own account away.
const session: Stored = {};

const storageOrNull = () => {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
};

const read = (): Stored => {
  try {
    const parsed: unknown = JSON.parse(storageOrNull()?.getItem(KEY) ?? '{}');
    return parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Stored)
      : {};
  } catch {
    return {};
  }
};

const walletKey = (network: string, owner: string) => `${network}:${normalizeHaneulAddress(owner)}`;

export const loadKnownAccounts = (network: string, owner: string): string[] => {
  const key = walletKey(network, owner);
  const stored = read()[key];
  const kept = Array.isArray(stored)
    ? stored.filter((id): id is string => typeof id === 'string')
    : [];
  return [...new Set([...kept, ...(session[key] ?? [])])];
};

export const rememberAccount = (network: string, owner: string, account: string) => {
  const key = walletKey(network, owner);
  const id = normalizeHaneulAddress(account);
  const known = loadKnownAccounts(network, owner);
  if (known.includes(id)) return;
  session[key] = [...(session[key] ?? []), id];
  try {
    storageOrNull()?.setItem(KEY, JSON.stringify({ ...read(), [key]: [...known, id] }));
  } catch {
    // The session's record stands in.
  }
};

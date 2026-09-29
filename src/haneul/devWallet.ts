import type { WalletInitializer } from '@haneullabs/dapp-kit-core';
import type { ClientWithCoreApi } from '@haneullabs/haneul/client';
import { Ed25519Keypair } from '@haneullabs/haneul/keypairs/ed25519';
import { Transaction } from '@haneullabs/haneul/transactions';
import { toBase64 } from '@haneullabs/haneul/utils';
import type {
  HaneulFeatures,
  HaneulSignAndExecuteTransactionMethod,
  HaneulSignPersonalMessageMethod,
  HaneulSignTransactionMethod,
  IdentifierArray,
  IdentifierString,
  StandardConnectFeature,
  StandardConnectMethod,
  StandardEventsFeature,
  StandardEventsOnMethod,
  Wallet,
} from '@haneullabs/wallet-standard';
import {
  getWallets,
  HaneulSignAndExecuteTransaction,
  HaneulSignPersonalMessage,
  HaneulSignTransaction,
  ReadonlyWalletAccount,
  StandardConnect,
  StandardEvents,
} from '@haneullabs/wallet-standard';

const DEV_WALLET_STORAGE_KEY = 'haneul:dev-wallet:secret';
const DEV_WALLET_NAME = 'Haneul Dev Wallet';

// A plain wallet glyph so the sign-in dialog has something to render.
const DEV_WALLET_ICON =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+PHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iMTQiIGZpbGw9IiMyODI4M2MiLz48cmVjdCB4PSIxNCIgeT0iMjAiIHdpZHRoPSIzNiIgaGVpZ2h0PSIyNCIgcng9IjYiIGZpbGw9IiM1OTczZmUiLz48Y2lyY2xlIGN4PSI0MiIgY3k9IjMyIiByPSI0IiBmaWxsPSIjMjgyODNjIi8+PC9zdmc+' as const;

const loadOrCreateKeypair = () => {
  try {
    const stored = globalThis.localStorage.getItem(DEV_WALLET_STORAGE_KEY);
    if (stored) return Ed25519Keypair.fromSecretKey(stored);
  } catch {
    // fall through to a fresh key
  }
  const keypair = Ed25519Keypair.generate();
  try {
    globalThis.localStorage.setItem(DEV_WALLET_STORAGE_KEY, keypair.getSecretKey());
  } catch {
    // storage unavailable: the key lives for this page load only
  }
  return keypair;
};

/**
 * Development-only Wallet Standard wallet backed by an Ed25519 key kept in localStorage.
 * Unlike dapp-kit's burner wallet it keeps the same address across reloads, so
 * reconnection and per-account state can be exercised without a browser extension.
 */
export class HaneulDevWallet implements Wallet {
  #chainConfig: Record<IdentifierString, ClientWithCoreApi>;

  #keypair: Ed25519Keypair;

  #account: ReadonlyWalletAccount;

  constructor({ clients }: { clients: ClientWithCoreApi[] }) {
    this.#chainConfig = clients.reduce<Record<IdentifierString, ClientWithCoreApi>>(
      (accumulator, client) => {
        accumulator[`haneul:${client.network}`] = client;
        return accumulator;
      },
      {}
    );
    this.#keypair = loadOrCreateKeypair();
    this.#account = new ReadonlyWalletAccount({
      address: this.#keypair.getPublicKey().toHaneulAddress(),
      publicKey: this.#keypair.getPublicKey().toHaneulBytes(),
      chains: this.chains,
      features: [HaneulSignTransaction, HaneulSignAndExecuteTransaction, HaneulSignPersonalMessage],
    });
  }

  get version() {
    return '1.0.0' as const;
  }

  get name() {
    return DEV_WALLET_NAME;
  }

  get icon() {
    return DEV_WALLET_ICON;
  }

  get chains() {
    return Object.keys(this.#chainConfig) as IdentifierArray;
  }

  get accounts() {
    return [this.#account];
  }

  get features(): StandardConnectFeature & StandardEventsFeature & HaneulFeatures {
    return {
      [StandardConnect]: { version: '1.0.0', connect: this.#connect },
      [StandardEvents]: { version: '1.0.0', on: this.#on },
      [HaneulSignPersonalMessage]: {
        version: '1.1.0',
        signPersonalMessage: this.#signPersonalMessage,
      },
      [HaneulSignTransaction]: { version: '2.0.0', signTransaction: this.#signTransaction },
      [HaneulSignAndExecuteTransaction]: {
        version: '2.0.0',
        signAndExecuteTransaction: this.#signAndExecuteTransaction,
      },
    };
  }

  #on: StandardEventsOnMethod = () => () => {};

  #connect: StandardConnectMethod = async () => ({ accounts: this.accounts });

  #signPersonalMessage: HaneulSignPersonalMessageMethod = async (messageInput) =>
    this.#keypair.signPersonalMessage(messageInput.message);

  #signTransaction: HaneulSignTransactionMethod = async ({ transaction, signal, chain }) => {
    signal?.throwIfAborted();
    const client = this.#chainConfig[chain];
    if (!client) throw new Error(`Invalid chain "${chain}" specified.`);
    const parsedTransaction = Transaction.from(await transaction.toJSON());
    const builtTransaction = await parsedTransaction.build({ client });
    return this.#keypair.signTransaction(builtTransaction);
  };

  #signAndExecuteTransaction: HaneulSignAndExecuteTransactionMethod = async ({
    transaction,
    signal,
    chain,
  }) => {
    signal?.throwIfAborted();
    const client = this.#chainConfig[chain];
    if (!client) throw new Error(`Invalid chain "${chain}" specified.`);
    const parsedTransaction = Transaction.from(await transaction.toJSON());
    const bytes = await parsedTransaction.build({ client });
    const result = await this.#keypair.signAndExecuteTransaction({
      transaction: parsedTransaction,
      client,
    });
    const tx = result.Transaction ?? result.FailedTransaction;
    return {
      bytes: toBase64(bytes),
      signature: tx.signatures[0]!,
      digest: tx.digest,
      effects: toBase64(tx.effects.bcs!),
    };
  };
}

export const devWalletInitializer = (): WalletInitializer => ({
  id: 'haneul-dev-wallet',
  async initialize({ networks, getClient }) {
    const wallet = new HaneulDevWallet({ clients: networks.map(getClient) });
    const unregister = getWallets().register(wallet);
    return { unregister };
  },
});

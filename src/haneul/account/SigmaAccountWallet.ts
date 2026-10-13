import type { WalletInitializer } from '@haneullabs/dapp-kit-core';
import type { ClientWithCoreApi } from '@haneullabs/haneul/client';
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
  WalletAccount,
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

import { localAccountStore } from './store';

export const SIGMA_ACCOUNT_WALLET_NAME = 'Sigma Account';
export const SIGMA_ACCOUNT_WALLET_ID = 'sigma-account';

// A purple tile with the Σ mark, inlined because the Wallet Standard wants a data URL.
const SIGMA_ACCOUNT_WALLET_ICON = `data:image/svg+xml;base64,${btoa(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#7774FF"/><path fill="#fff" d="M20 16h25v7H30.4l9.3 9-9.3 9H45v7H20v-6l10.6-10L20 22z"/></svg>'
)}` as const;

/**
 * The local account as a Wallet Standard wallet, so the rest of the app connects to it the
 * way it connects to any extension. Accounts appear when the store is unlocked and vanish
 * when it locks; dapp-kit sees that through the standard `change` event.
 */
export class SigmaAccountWallet implements Wallet {
  #chainConfig: Record<IdentifierString, ClientWithCoreApi>;

  #listeners = new Set<(accounts: readonly WalletAccount[]) => void>();

  constructor({ clients }: { clients: ClientWithCoreApi[] }) {
    this.#chainConfig = clients.reduce<Record<IdentifierString, ClientWithCoreApi>>(
      (accumulator, client) => {
        accumulator[`haneul:${client.network}`] = client;
        return accumulator;
      },
      {}
    );
    localAccountStore.onKeypairChange(() => {
      const accounts = this.accounts;
      this.#listeners.forEach((listener) => listener(accounts));
    });
  }

  get version() {
    return '1.0.0' as const;
  }

  get name() {
    return SIGMA_ACCOUNT_WALLET_NAME;
  }

  get icon() {
    return SIGMA_ACCOUNT_WALLET_ICON;
  }

  get chains() {
    return Object.keys(this.#chainConfig) as IdentifierArray;
  }

  get accounts(): readonly WalletAccount[] {
    const keypair = localAccountStore.getKeypair();
    if (!keypair) return [];
    return [
      new ReadonlyWalletAccount({
        address: keypair.getPublicKey().toHaneulAddress(),
        publicKey: keypair.getPublicKey().toHaneulBytes(),
        chains: this.chains,
        features: [
          HaneulSignTransaction,
          HaneulSignAndExecuteTransaction,
          HaneulSignPersonalMessage,
        ],
        label: localAccountStore.getSnapshot().account?.username
          ? `${localAccountStore.getSnapshot().account?.username}.haneul`
          : undefined,
      }),
    ];
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

  #on: StandardEventsOnMethod = (event, listener) => {
    if (event !== 'change') return () => {};
    const wrapped = (accounts: readonly WalletAccount[]) => listener({ accounts });
    this.#listeners.add(wrapped);
    return () => this.#listeners.delete(wrapped);
  };

  // dapp-kit auto-connects on load before the tab session has been checked; waiting on
  // `ready` lets a reload reconnect without a password prompt.
  #connect: StandardConnectMethod = async () => {
    await localAccountStore.ready;
    return { accounts: this.accounts };
  };

  #signPersonalMessage: HaneulSignPersonalMessageMethod = async (messageInput) =>
    localAccountStore.requireKeypair().signPersonalMessage(messageInput.message);

  #signTransaction: HaneulSignTransactionMethod = async ({ transaction, signal, chain }) => {
    signal?.throwIfAborted();
    const client = this.#chainConfig[chain];
    if (!client) throw new Error(`Invalid chain "${chain}" specified.`);
    const parsedTransaction = Transaction.from(await transaction.toJSON());
    const builtTransaction = await parsedTransaction.build({ client });
    return localAccountStore.requireKeypair().signTransaction(builtTransaction);
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
    const result = await localAccountStore.requireKeypair().signAndExecuteTransaction({
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

export const sigmaAccountWalletInitializer = (): WalletInitializer => ({
  id: SIGMA_ACCOUNT_WALLET_ID,
  async initialize({ networks, getClient }) {
    const wallet = new SigmaAccountWallet({ clients: networks.map(getClient) });
    const unregister = getWallets().register(wallet);
    return { unregister };
  },
});

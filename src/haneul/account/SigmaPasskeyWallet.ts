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

import { passkeyAccountStore, passkeyPublicKey, passkeySigner } from './passkey';

export const SIGMA_PASSKEY_WALLET_NAME = 'Sigma Passkey';
export const SIGMA_PASSKEY_WALLET_ID = 'sigma-passkey';

const SIGMA_PASSKEY_WALLET_ICON = `data:image/svg+xml;base64,${btoa(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#131313"/><circle cx="26" cy="22" r="9" fill="#7774FF"/><path fill="#7774FF" d="M10 50c0-8.8 7.2-16 16-16 3.4 0 6.6 1.1 9.2 2.9A12 12 0 0 0 38 50v2H10v-2Z"/><circle cx="45" cy="36" r="6" fill="none" stroke="#7774FF" stroke-width="4"/><path d="M45 42v12l4-3-2-2 2-2" fill="none" stroke="#7774FF" stroke-width="4" stroke-linejoin="round"/></svg>'
)}` as const;

/**
 * The passkey account through the Wallet Standard. Signing builds a `PasskeyKeypair`
 * from the stored public key and asks the authenticator; the chain verifies the
 * WebAuthn assertion itself (protocol flag `passkey_auth`, on since version 90).
 */
export class SigmaPasskeyWallet implements Wallet {
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
    passkeyAccountStore.subscribe(() => {
      const accounts = this.accounts;
      this.#listeners.forEach((listener) => listener(accounts));
    });
  }

  get version() {
    return '1.0.0' as const;
  }

  get name() {
    return SIGMA_PASSKEY_WALLET_NAME;
  }

  get icon() {
    return SIGMA_PASSKEY_WALLET_ICON;
  }

  get chains() {
    return Object.keys(this.#chainConfig) as IdentifierArray;
  }

  get accounts(): readonly WalletAccount[] {
    const record = passkeyAccountStore.getSnapshot();
    if (!record) return [];
    return [
      new ReadonlyWalletAccount({
        address: record.address,
        publicKey: passkeyPublicKey(record).toHaneulBytes(),
        chains: this.chains,
        features: [
          HaneulSignTransaction,
          HaneulSignAndExecuteTransaction,
          HaneulSignPersonalMessage,
        ],
        label: record.username ? `${record.username}.haneul` : undefined,
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

  #signer() {
    const record = passkeyAccountStore.getSnapshot();
    if (!record) throw new Error('No passkey account on this device');
    return passkeySigner(record);
  }

  #on: StandardEventsOnMethod = (event, listener) => {
    if (event !== 'change') return () => {};
    const wrapped = (accounts: readonly WalletAccount[]) => listener({ accounts });
    this.#listeners.add(wrapped);
    return () => this.#listeners.delete(wrapped);
  };

  #connect: StandardConnectMethod = async () => ({ accounts: this.accounts });

  #signPersonalMessage: HaneulSignPersonalMessageMethod = async (messageInput) =>
    this.#signer().signPersonalMessage(messageInput.message);

  #signTransaction: HaneulSignTransactionMethod = async ({ transaction, signal, chain }) => {
    signal?.throwIfAborted();
    const client = this.#chainConfig[chain];
    if (!client) throw new Error(`Invalid chain "${chain}" specified.`);
    const parsedTransaction = Transaction.from(await transaction.toJSON());
    const builtTransaction = await parsedTransaction.build({ client });
    return this.#signer().signTransaction(builtTransaction);
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
    const result = await this.#signer().signAndExecuteTransaction({
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

export const sigmaPasskeyWalletInitializer = (): WalletInitializer => ({
  id: SIGMA_PASSKEY_WALLET_ID,
  async initialize({ networks, getClient }) {
    const wallet = new SigmaPasskeyWallet({ clients: networks.map(getClient) });
    const unregister = getWallets().register(wallet);
    return { unregister };
  },
});

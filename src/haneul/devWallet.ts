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
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCIgdmlld0JveD0iMCAwIDY0IDY0Ij48cmVjdCB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHJ4PSIxNCIgZmlsbD0iIzY5NjZGRiIvPjxwYXRoIGZpbGw9IiNGRkZGRkYiIGQ9Ik0zOS43NCAxMi4xOFE0MS4zMSAxMi42NCA0Mi4xMyAxMy41NlE0Mi45NSAxNC40NyA0Mi45NSAxNS40NlE0Mi45NSAxNi41MSA0Mi4wMyAxNy40MlE0MS4xMSAxOC4zNCAzOS40MSAxOC42N1EzNy4zMSAxOC42NyAzNS4yMSAxOC44M1EzMy4xMSAxOS4wMCAzMS4wOCAxOS4xOVEzMC43NSAxOS4yNiAzMC42NiAxOS4yOVEzMC41NiAxOS4zMiAzMC40OSAxOS4zMlEzMC40MyAxOS4zMiAzMC4zMCAxOS4zNlEzMC4xNiAxOS4zOSAyOS43NyAxOS4zOUwzMi4yMCAyMi4wMVEzMy43MCAyMy43MiAzNS4zOCAyNS41NVEzNy4wNSAyNy4zOSAzOC42OSAyOS4wM1EzOS4zNCAyOS44OCAzOS40MSAzMC43MFEzOS40NyAzMS41MiAzOS4wMSAzMi42M1EzNy43MCAzNC4zNCAzNi41MiAzNS44MVEzNS4zNCAzNy4yOSAzNC4yMyAzOC43NlEzMy4xMSA0MC4yNCAzMS45MyA0MS43NFEzMC43NSA0My4yNSAyOS41MSA0NC45NkwzNi4yMCA0NC41MFEzOC42MiA0NC40MyA0MS4yNCA0NC4xMFE0My40NyA0My45NyA0NC42MiA0NC45OVE0NS43NyA0Ni4wMSA0NS43NyA0Ny4zMlE0NS43NyA0OC4zMCA0NC45OCA0OS4yNVE0NC4xOSA1MC4yMCA0Mi41NSA1MC41OVE0MS4yNCA1MC43MyAzOS43MCA1MC44NlEzOC4xNiA1MC45OSAzNi44NSA1MS4wNVEzNS40NyA1MS4wNSAzNC4wNyA1MS4xNVEzMi42NiA1MS4yNSAzMS4xNSA1MS4zOFEyOC45OCA1MS41OCAyNi43NiA1MS43MVEyNC41MyA1MS44NCAyMi4xNyA1MS44NFExOS43NCA1MS41MSAxOC44OSA1MC4wMFExOC4wNCA0OC41MCAxOS4wOSA0Ni42MEwzMC44MiAzMS4xOVEyNy44NyAyOC4xMSAyNS4wOCAyNS4wNlEyMi4zMCAyMi4wMSAxOS40MSAxOC44MEgxOS40OFExOC4yMyAxNy41NSAxOC4yMyAxNi41MVExOC4yMyAxNS4xOSAxOS40MSAxNC4yNFEyMC41OSAxMy4yOSAyMi4zNiAxMy4xNlEyNC40NiAxMy4xNiAyNi41NiAxMy4wMFEyOC42NiAxMi44MyAzMC43NSAxMi42NFEzMi45MiAxMi40NCAzNS4wNSAxMi4yOFEzNy4xOCAxMi4xMSAzOS43NCAxMi4xOFoiLz48L3N2Zz4=' as const;

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

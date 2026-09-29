import { createDAppKit } from '@haneullabs/dapp-kit-core';
import { HaneulJsonRpcClient, getJsonRpcFullnodeUrl } from '@haneullabs/haneul/jsonRpc';

import { isDev } from '@/constants/networks';

import { devWalletInitializer } from './devWallet';

export type HaneulNetwork = 'mainnet' | 'localnet';

// Mainnet is the only network the app targets. Localnet is exposed in dev builds so the
// burner wallet can sign against a local node without touching the live network.
const networks: HaneulNetwork[] = isDev ? ['mainnet', 'localnet'] : ['mainnet'];

/**
 * Single dapp-kit instance for the whole app. Wallet discovery goes through the Wallet
 * Standard, so any Haneul wallet that registers itself in the page shows up automatically.
 *
 * - The Slush web wallet is disabled: it belongs to another network.
 * - Dev builds register a persistent local dev wallet as the test signer.
 */
export const dAppKit = createDAppKit({
  networks,
  defaultNetwork: 'mainnet',
  createClient: (network) =>
    new HaneulJsonRpcClient({ network, url: getJsonRpcFullnodeUrl(network as HaneulNetwork) }),
  slushWalletConfig: null,
  walletInitializers: isDev ? [devWalletInitializer()] : [],
  storageKey: 'haneul:dapp-kit',
});

export type HaneulDAppKit = typeof dAppKit;

declare module '@haneullabs/dapp-kit-core' {
  interface Register {
    dAppKit: HaneulDAppKit;
  }
}

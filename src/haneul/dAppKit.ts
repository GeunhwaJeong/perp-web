import { createDAppKit } from '@haneullabs/dapp-kit-core';
import { HaneulGrpcClient } from '@haneullabs/haneul/grpc';

import { isDev } from '@/constants/networks';

import { devWalletInitializer } from './devWallet';
import { HANEUL_GRPC_URLS, type HaneulNetwork } from './networks';

export type { HaneulNetwork } from './networks';

// Mainnet is the only network the app targets. Localnet is exposed in dev builds so the
// dev wallet can sign against a local node without touching the live network.
const networks: HaneulNetwork[] = isDev ? ['mainnet', 'localnet'] : ['mainnet'];

/**
 * Single dapp-kit instance for the whole app. Wallet discovery goes through the Wallet
 * Standard, so any Haneul wallet that registers itself in the page shows up automatically.
 *
 * - All chain access goes through the gRPC client's core API; there is no JSON-RPC path.
 * - The Slush web wallet is disabled: it belongs to another network.
 * - Dev builds register a persistent local dev wallet as the test signer.
 */
export const dAppKit = createDAppKit({
  networks,
  defaultNetwork: isDev ? 'localnet' : 'mainnet',
  createClient: (network) =>
    new HaneulGrpcClient({ network, baseUrl: HANEUL_GRPC_URLS[network as HaneulNetwork] }),
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

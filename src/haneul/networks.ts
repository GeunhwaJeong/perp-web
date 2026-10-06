export type HaneulNetwork = 'mainnet' | 'localnet';

/**
 * gRPC-web endpoints per network. The node serves gRPC on its RPC port (158.69.54.239:9000,
 * plaintext); rpc.haneul.io is the TLS proxy in front of it, which a page served over https
 * needs.
 */
export const HANEUL_GRPC_URLS: Record<HaneulNetwork, string> = {
  mainnet: 'https://rpc.haneul.io',
  localnet: 'http://127.0.0.1:9000',
};

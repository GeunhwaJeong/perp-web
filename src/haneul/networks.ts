export type HaneulNetwork = 'mainnet' | 'localnet';

/**
 * gRPC-web endpoints per network. The node serves gRPC on its RPC port; a TLS proxy in
 * front of the public node is a deployment concern and only changes the string here.
 */
export const HANEUL_GRPC_URLS: Record<HaneulNetwork, string> = {
  mainnet: 'http://158.69.54.239:9000',
  localnet: 'http://127.0.0.1:9000',
};

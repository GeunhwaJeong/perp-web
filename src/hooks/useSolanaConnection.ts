import { useEndpointsConfig } from '@/hooks/useEndpointsConfig';

import { getSolanaConnection } from '@/lib/solanaConnection';

/**
 * React hook that returns a singleton Solana connection instance, or null when the environment
 * has no Solana RPC (the Connection constructor throws on an empty URL).
 */
export const useSolanaConnection = () => {
  const { solanaRpcUrl } = useEndpointsConfig();
  return solanaRpcUrl ? getSolanaConnection(solanaRpcUrl) : null;
};

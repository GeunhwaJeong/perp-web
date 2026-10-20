import { ENVIRONMENT_CONFIG_MAP, type EndpointsConfig } from '@/constants/networks';

import { getSelectedNetwork } from '@/state/appSelectors';
import { useAppSelector } from '@/state/appTypes';

export type { EndpointsConfig };

export const useEndpointsConfig = () => {
  const selectedNetwork = useAppSelector(getSelectedNetwork);
  const endpointsConfig: EndpointsConfig = ENVIRONMENT_CONFIG_MAP[selectedNetwork].endpoints;

  return {
    indexer: endpointsConfig.indexers[0]!, // assume there's only one option for indexer endpoints
    pnlImageApi: endpointsConfig.pnlImageApi,
  };
};

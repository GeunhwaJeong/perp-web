import { ENVIRONMENT_CONFIG_MAP, type EnvironmentFeatures } from '@/constants/networks';

import { getSelectedNetwork } from '@/state/appSelectors';
import { useAppSelector } from '@/state/appTypes';

export type { EnvironmentFeatures };

export const useEnvFeatures = (): EnvironmentFeatures => {
  const selectedNetwork = useAppSelector(getSelectedNetwork);
  return ENVIRONMENT_CONFIG_MAP[selectedNetwork].featureFlags;
};

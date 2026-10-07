import { ENVIRONMENT_CONFIG_MAP, type EnvironmentConfig } from '@/constants/networks';

import { getSelectedNetwork } from '@/state/appSelectors';
import { useAppSelector } from '@/state/appTypes';

type StringEnvironmentConfigKey = {
  [K in keyof EnvironmentConfig]: EnvironmentConfig[K] extends string ? K : never;
}[keyof EnvironmentConfig];

export type EnvironmentConfigKey = StringEnvironmentConfigKey;

export const useEnvConfig = (configKey: EnvironmentConfigKey): string => {
  const selectedNetwork = useAppSelector(getSelectedNetwork);
  return ENVIRONMENT_CONFIG_MAP[selectedNetwork][configKey];
};

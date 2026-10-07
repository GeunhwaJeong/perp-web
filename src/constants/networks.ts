import type { LinksConfigs } from '@/hooks/useURLConfigs';

import environments from '../../public/configs/v1/env.json';

export const CURRENT_MODE = ({
  production: 'MAINNET',
  testnet: 'TESTNET',
  staging: 'DEV',
  development: 'DEV',
}[import.meta.env.MODE] ?? 'MAINNET') as 'MAINNET' | 'TESTNET' | 'DEV';

export const isMainnet = CURRENT_MODE === 'MAINNET';
export const isTestnet = CURRENT_MODE === 'TESTNET';
export const isDev = CURRENT_MODE === 'DEV';

export type DydxNetwork = keyof typeof environments.environments;
export type DydxChainId = keyof typeof environments.tokens;

export interface EndpointsConfig {
  indexers: {
    api: string;
    socket: string;
  }[];
  // Everything below belongs to the dYdX/Cosmos stack and is unset on Haneul; the code that
  // reads it is slated for removal with that stack.
  validators?: string[];
  skip?: string;
  nobleValidator?: string;
  osmosisValidator?: string;
  neutronValidator?: string;
  faucet?: string;
  stakingAPR?: string;
  solanaRpcUrl?: string;
  affiliates?: string;
  spotApi?: string;
  geoV2?: string;
  pnlImageApi?: string;
  metadataService?: string;
}

export interface EnvironmentFeatures {
  checkForGeo: boolean;
  withdrawalSafetyEnabled: boolean;
  CCTPWithdrawalOnly: boolean;
  CCTPDepositOnly: boolean;
  debugCompliance: boolean;
  isSlTpEnabled: boolean;
  isSlTpLimitOrdersEnabled: boolean;
  // Hidden during the shadow run: both pages still show dYdX data.
  isVaultEnabled: boolean;
  isChainTokenPageEnabled: boolean;
}

export interface EnvironmentConfig {
  name: string;
  ethereumChainId: string;
  dydxChainId: DydxChainId;
  chainName: string;
  chainLogo: string;
  deployerName: string;
  megavaultOperatorName: string;
  rewardsHistoryStartDateMs: string;
  megavaultHistoryStartDateMs: string;
  isMainNet: boolean;
  endpoints: EndpointsConfig;
  stakingValidators: string[];
  featureFlags: EnvironmentFeatures;
}

export const AVAILABLE_ENVIRONMENTS = environments.deployments[CURRENT_MODE];
export const ENVIRONMENT_CONFIG_MAP = environments.environments as Record<
  DydxNetwork,
  EnvironmentConfig
>;
export const TOKEN_CONFIG_MAP = environments.tokens;
export const LINKS_CONFIG_MAP = environments.links as Record<DydxChainId, LinksConfigs>;
export const WALLETS_CONFIG_MAP = environments.wallets;
export const DEFAULT_APP_ENVIRONMENT = AVAILABLE_ENVIRONMENTS.default as DydxNetwork;

export const STATSIG_ENVIRONMENT_TIER = ({
  production: 'production',
  testnet: 'staging',
  staging: 'development',
  development: 'development',
}[import.meta.env.MODE] ?? 'production') as 'production' | 'staging' | 'development';

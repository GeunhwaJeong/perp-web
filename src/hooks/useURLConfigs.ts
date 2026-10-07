import { LINKS_CONFIG_MAP } from '@/constants/networks';

import { getSelectedDydxChainId } from '@/state/appSelectors';
import { useAppSelector } from '@/state/appTypes';

export interface LinksConfigs {
  accountExportLearnMore?: string;
  blogs?: string;
  community?: string;
  vipsChannel?: string;
  documentation?: string;
  equityTiersLearnMore?: string;
  feedback?: string;
  foundation?: string;
  fundingComparison?: string;
  governanceLearnMore?: string;
  help?: string;
  initialMarginFractionLearnMore?: string;
  isolatedMarginLearnMore?: string;
  keplrDashboard?: string;
  launchIncentive?: string;
  mintscan?: string;
  mintscanBase?: string;
  newMarketProposalLearnMore?: string;
  adjustTargetLeverageLearnMore?: string;
  privacy?: string;
  reduceOnlyLearnMore?: string;
  statusPage?: string;
  stakingLearnMore?: string;
  strideZoneApp?: string;
  tos?: string;
  tradingRewardsLearnMore?: string;
  walletLearnMore?: string;
  withdrawalGateLearnMore?: string;
  exchangeStats?: string;
  contractLossMechanismLearnMore?: string;
  mintscanValidatorsLearnMore?: string;
  protocolStaking?: string;
  stakingAndClaimingRewardsLearnMore?: string;
  vaultTos?: string;
  vaultLearnMore?: string;
  vaultMetrics?: string;
  vaultOperatorLearnMore?: string;
  predictionMarketLearnMore?: string;
  discoveryProgram?: string;
  getInTouch?: string;
  deployerTermsAndConditions?: string;
  dydxLearnMore?: string;
  affiliateProgram?: string;
  affiliateProgramFaq?: string;
  affiliateProgramSupportEmail?: string;
  launchMarketTos?: string;
  launchMarketLearnMore?: string;
}

// A link that is not configured stays undefined so the UI can hide it instead of sending
// people somewhere wrong.
export const useURLConfigs = (): LinksConfigs => {
  const selectedDydxChainId = useAppSelector(getSelectedDydxChainId);
  return LINKS_CONFIG_MAP[selectedDydxChainId];
};

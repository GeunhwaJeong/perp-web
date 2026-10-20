import { ComplianceState } from '@/state/raw';

import { Compliance, ComplianceStatus } from '../types/summaryTypes';

export function calculateCompliance({
  geoHeaders,
  geo: geoBase,
  sourceAddressScreenV2,
}: ComplianceState): Compliance {
  const geo = {
    isPerpetualsGeoBlocked: geoBase.data?.whitelisted
      ? false
      : geoHeaders.data?.status === 'restricted',
    currentCountry: geoHeaders.data?.country,
  };

  if (sourceAddressScreenV2.data?.status === ComplianceStatus.BLOCKED) {
    return {
      geo,
      status: ComplianceStatus.BLOCKED,
      updatedAt: sourceAddressScreenV2.data.updatedAt,
    };
  }

  // Only a blocked connected address changes access; UNKNOWN reads as full access.
  return {
    geo,
    status: ComplianceStatus.UNKNOWN,
  };
}

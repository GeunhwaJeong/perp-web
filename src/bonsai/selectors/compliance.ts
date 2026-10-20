import { createAppSelector } from '@/state/appTypes';

import { calculateCompliance } from '../calculators/compliance';
import { mergeLoadableStatus } from '../lib/mapLoadable';
import { selectRawGeo, selectRawGeoHeaders, selectRawSourceAddressScreenV2 } from './base';

export const selectCompliance = createAppSelector(
  [selectRawGeo, selectRawGeoHeaders, selectRawSourceAddressScreenV2],
  (geo, geoHeaders, sourceAddressScreenV2) =>
    calculateCompliance({
      geoHeaders,
      geo,
      sourceAddressScreenV2,
    })
);

export const selectComplianceLoading = createAppSelector(
  [selectRawGeo, selectRawGeoHeaders, selectRawSourceAddressScreenV2],
  (geo, geoHeaders, sourceAddressScreenV2) =>
    mergeLoadableStatus(geo, geoHeaders, sourceAddressScreenV2)
);

export const selectIsPerpsGeoRestricted = createAppSelector(
  [selectRawGeoHeaders],
  (geoHeaders) => geoHeaders.data?.status === 'restricted'
);

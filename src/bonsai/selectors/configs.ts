import { createAppSelector } from '@/state/appTypes';

import { calculateEquityTiers } from '../calculators/configs';
import { selectRawConfigEquityTiers } from './base';

export const selectEquityTiers = createAppSelector([selectRawConfigEquityTiers], (equity) =>
  calculateEquityTiers(equity)
);

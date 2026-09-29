import { useCallback } from 'react';

import { STRING_KEYS } from '@/constants/localization';

import { useStringGetter } from '@/hooks/useStringGetter';
import { useURLConfigs } from '@/hooks/useURLConfigs';

import { RewardsNavPanel } from './RewardsNavPanel';

export const GovernancePanel = ({ className }: { className?: string }) => {
  const stringGetter = useStringGetter();

  const { governanceLearnMore } = useURLConfigs();

  const openGovernance = useCallback(() => {
    if (governanceLearnMore) {
      globalThis.open(governanceLearnMore, '_blank');
    }
  }, [governanceLearnMore]);

  return (
    <RewardsNavPanel
      title={stringGetter({ key: STRING_KEYS.GOVERNANCE })}
      description={stringGetter({
        key: STRING_KEYS.GOVERNANCE_DETAILS,
      })}
      learnMore={governanceLearnMore}
      onNav={openGovernance}
      className={className}
    />
  );
};

import { useCallback, useState } from 'react';

import { useInterval } from '@/hooks/useInterval';

import { Output, OutputType } from '@/components/Output';

import { formatSeconds, getTimeTillNextUnit } from '@/lib/timeUtils';

// Counts down to the engine's next funding update, which the indexer reports as
// `nextFundingAt`; without it, to the top of the hour, which is the update schedule of every
// market so far.
export const NextFundingTimer = ({ nextFundingAt }: { nextFundingAt?: string | null }) => {
  const [secondsLeft, setSecondsLeft] = useState<number | undefined>();

  const updateSecondsLeft = useCallback(() => {
    const target = nextFundingAt != null ? Date.parse(nextFundingAt) : NaN;
    setSecondsLeft(
      Number.isNaN(target)
        ? getTimeTillNextUnit('hour')
        : Math.max(0, Math.floor((target - Date.now()) / 1000))
    );
  }, [nextFundingAt]);

  useInterval({ callback: updateSecondsLeft });

  return (
    <Output
      type={OutputType.Text}
      value={secondsLeft !== undefined ? formatSeconds(secondsLeft) : undefined}
    />
  );
};

import { useCallback } from 'react';

import { RESOLUTION_MAP, RESOLUTION_STRING_TO_LABEL, ResolutionString } from '@/constants/candles';

import { useStringGetter } from '@/hooks/useStringGetter';

import { objectKeys } from '@/lib/objectHelpers';

export const ResolutionSelector = ({
  onResolutionChange,
  currentResolution,
}: {
  onResolutionChange: (resolution: ResolutionString) => void;
  currentResolution: ResolutionString;
}) => {
  const stringGetter = useStringGetter();

  const getLabel = useCallback(
    (resolution: ResolutionString) => {
      const resolutionLabelInfo = RESOLUTION_STRING_TO_LABEL[resolution]!;
      if (resolutionLabelInfo.unitStringKey) {
        return `${resolutionLabelInfo.value}${stringGetter({ key: resolutionLabelInfo.unitStringKey })}`;
      }

      return resolutionLabelInfo.value;
    },
    [stringGetter]
  );

  return (
    <div tw="row gap-0.25">
      {objectKeys(RESOLUTION_MAP).map((resolution) => (
        <button
          tw="h-full min-w-2.25 border-b-0 border-l-0 border-r-0 border-t-2 border-solid px-0.5 font-small-book"
          type="button"
          css={{
            borderColor: currentResolution !== resolution ? 'transparent' : 'var(--color-accent)',
            color: currentResolution !== resolution ? 'var(--color-text-0)' : 'var(--color-text-2)',
          }}
          key={resolution}
          onClick={() => onResolutionChange(resolution)}
        >
          {getLabel(resolution)}
        </button>
      ))}
    </div>
  );
};

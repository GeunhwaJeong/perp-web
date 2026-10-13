import { useEffect, useState } from 'react';

import { useNameAvailability } from '@/hooks/useNameAvailability';
import type { SuggestedName } from '@/hooks/useSuggestedName';

import { FaceIdIcon, FingerprintIcon } from '../icons';
import { BrandedButton, Column, IconPairHeader, ScreenFrame, Subtext } from '../primitives';
import { spacing } from '../tokens';
import { SuggestedNameInput } from './SuggestedNameInput';

type NameSource = 'prefilled' | 'shuffled' | 'edited';

/**
 * Pick a name. The field arrives filled with a vetted suggestion, so the usual path is
 * one glance and Continue; typing replaces the suggestion and is checked behind a
 * debounce before the button re-enables.
 */
export const CreateScreen = ({
  suggested,
  initialName,
  onContinue,
  isPending,
  goBack,
  onClose,
}: {
  suggested: SuggestedName;
  initialName?: string;
  onContinue: (name: string) => void;
  isPending?: boolean;
  goBack: () => void;
  onClose: () => void;
}) => {
  const [value, setValue] = useState(initialName ?? '');
  const [source, setSource] = useState<NameSource>(initialName ? 'edited' : 'prefilled');

  // Adopt each suggestion (first fill and every shuffle) unless the user has typed: a late
  // suggestion must never overwrite their input.
  useEffect(() => {
    if (suggested.suggestion && source !== 'edited') setValue(suggested.suggestion);
  }, [suggested.suggestion, source]);

  const { error, isDebouncing, isChecking, isAvailable } = useNameAvailability(value);
  const isChecked = !isDebouncing && !isChecking;
  const checkedError = isChecked ? error : undefined;
  // Suggestions were verified before they were offered, so trust them at once instead of
  // blinking the button off while the debounced check confirms; typed input waits.
  const canContinue =
    Boolean(value) && (source === 'edited' ? isChecked && isAvailable : !checkedError);

  return (
    <ScreenFrame
      title="Your wallet. Your name."
      subtext={
        <Subtext $maxWidth={386}>
          {value ? `${value}.haneul` : 'Your name'} is your address. People can send to it, and it
          is what the leaderboard shows.
        </Subtext>
      }
      header={
        <IconPairHeader left={<FingerprintIcon size={24} />} right={<FaceIdIcon size={24} />} />
      }
      goBack={goBack}
      onClose={onClose}
      gap={spacing.s24}
    >
      <Column $gap={spacing.s24}>
        <SuggestedNameInput
          value={value}
          isShuffling={suggested.isShuffling}
          error={checkedError}
          autoFocus
          onChange={(next) => {
            setValue(next);
            setSource('edited');
          }}
          onShuffle={() => {
            setSource('shuffled');
            suggested.shuffle();
          }}
        />
        <BrandedButton
          size="large"
          disabled={!canContinue || suggested.isInitializing}
          loading={isPending}
          onClick={() => onContinue(value)}
        >
          Continue
        </BrandedButton>
      </Column>
    </ScreenFrame>
  );
};

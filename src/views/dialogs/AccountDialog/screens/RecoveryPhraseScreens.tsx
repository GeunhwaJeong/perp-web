import { useState } from 'react';

import styled from 'styled-components';

import { Icon, IconName } from '@/components/Icon';

import { CheckIcon, KeyIcon } from '../icons';
import { BrandedButton, BrandTile, Column, ScreenFrame, Subtext, TextButton } from '../primitives';
import { colors, motion, radii, spacing, type } from '../tokens';

const $Warnings = styled.ul`
  display: flex;
  flex-direction: column;
  gap: ${spacing.s12};
  width: 100%;
  margin: 0;
  padding: ${spacing.s16};
  list-style: none;
  border-radius: ${radii.r16};
  background: ${colors.surface2};

  li {
    display: flex;
    gap: ${spacing.s12};
    ${type.body3}
    color: ${colors.neutral1};
  }

  li::before {
    content: '';
    flex: none;
    width: 6px;
    height: 6px;
    margin-top: 6px;
    border-radius: ${radii.full};
    background: ${colors.accent1};
  }
`;

/** The three things to know before the phrase is shown, as on the Uniswap export screen. */
export const PhraseWarningScreen = ({
  onView,
  onClose,
}: {
  onView: () => void;
  onClose?: () => void;
}) => (
  <ScreenFrame
    title="Before you view it"
    subtext={
      <Subtext $maxWidth={386}>Your recovery phrase is the only way back into this wallet.</Subtext>
    }
    header={
      <BrandTile>
        <KeyIcon size={28} />
      </BrandTile>
    }
    onClose={onClose}
    gap={spacing.s24}
  >
    <Column $gap={spacing.s24}>
      <$Warnings>
        <li>This phrase gives full access to your wallet and funds.</li>
        <li>Write it down and keep it somewhere safe.</li>
        <li>View it in private and do not share it with anyone.</li>
      </$Warnings>
      <BrandedButton size="large" onClick={onView} autoFocus>
        View phrase
      </BrandedButton>
    </Column>
  </ScreenFrame>
);

const $Grid = styled.ol<{ $hidden: boolean }>`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: ${spacing.s8};
  width: 100%;
  margin: 0;
  padding: 0;
  list-style: none;
  counter-reset: word;

  li {
    display: flex;
    align-items: center;
    gap: ${spacing.s8};
    min-height: 40px;
    padding: 0 ${spacing.s12};
    border-radius: ${radii.r12};
    background: ${colors.surface2};
    ${type.body3}
    color: ${colors.neutral1};
    counter-increment: word;
    transition: filter ${motion.quick};
    filter: ${({ $hidden }) => ($hidden ? 'blur(6px)' : 'none')};
    user-select: ${({ $hidden }) => ($hidden ? 'none' : 'text')};
  }

  li::before {
    content: counter(word);
    width: 1.25em;
    color: ${colors.neutral3};
    font-variant-numeric: tabular-nums;
  }
`;

const $Actions = styled.div`
  display: flex;
  justify-content: center;
  gap: ${spacing.s24};
  width: 100%;
`;

/** The twelve words, blurred until revealed, with copy; "Done" records the backup. */
export const PhraseScreen = ({
  words,
  onDone,
  onClose,
}: {
  words: string[];
  onDone: () => void;
  onClose?: () => void;
}) => {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(words.join(' '));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the words are on screen to write down.
    }
  };

  return (
    <ScreenFrame
      title="Your recovery phrase"
      subtext={
        <Subtext $maxWidth={386}>
          We suggest writing it on paper and keeping it somewhere secure, like a safe.
        </Subtext>
      }
      header={
        <BrandTile>
          <KeyIcon size={28} />
        </BrandTile>
      }
      onClose={onClose}
      gap={spacing.s24}
    >
      <Column $gap={spacing.s24}>
        <Column $gap={spacing.s12}>
          <$Grid $hidden={!revealed} aria-hidden={!revealed}>
            {words.map((word, index) => (
              // eslint-disable-next-line react/no-array-index-key
              <li key={`${index}-${word}`}>{revealed ? word : '••••'}</li>
            ))}
          </$Grid>
          <$Actions>
            <TextButton type="button" $muted onClick={() => setRevealed((value) => !value)}>
              <Icon iconName={revealed ? IconName.Hide : IconName.Show} />
              {revealed ? 'Hide' : 'Show'}
            </TextButton>
            <TextButton type="button" $muted disabled={!revealed} onClick={copy}>
              {copied ? <CheckIcon size={16} /> : <Icon iconName={IconName.Copy} />}
              {copied ? 'Copied' : 'Copy'}
            </TextButton>
          </$Actions>
        </Column>
        <BrandedButton size="large" onClick={onDone}>
          Done
        </BrandedButton>
      </Column>
    </ScreenFrame>
  );
};

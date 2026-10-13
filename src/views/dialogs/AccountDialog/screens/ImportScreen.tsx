import { useState } from 'react';

import { isValidMnemonic, mnemonicWords, normalizeMnemonic } from '@/haneul/account';
import styled from 'styled-components';

import { KeyIcon } from '../icons';
import { BrandedButton, BrandTile, Column, ErrorText, ScreenFrame, Subtext } from '../primitives';
import { colors, motion, radii, spacing, type } from '../tokens';

const $Phrase = styled.textarea<{ $error: boolean }>`
  width: 100%;
  min-height: 112px;
  padding: ${spacing.s16};
  border: 1px solid ${({ $error }) => ($error ? colors.critical : colors.surface3)};
  border-radius: ${radii.r16};
  background: ${colors.surface1};
  color: ${colors.neutral1};
  ${type.body2}
  resize: vertical;
  outline: none;
  transition: border-color ${motion.fast};

  &:focus {
    border-color: ${({ $error }) => ($error ? colors.critical : colors.accent1)};
  }

  &::placeholder {
    color: ${colors.neutral3};
  }
`;

const $Count = styled.span<{ $done: boolean }>`
  ${type.body3}
  color: ${({ $done }) => ($done ? colors.success : colors.neutral2)};
  text-align: right;
`;

/**
 * Restore an account from its 12 words. One field that accepts a paste; the word count
 * tells the user where they are, the validation runs when all twelve are in.
 */
export const ImportScreen = ({
  onContinue,
  goBack,
  onClose,
}: {
  onContinue: (mnemonic: string) => void;
  goBack: () => void;
  onClose: () => void;
}) => {
  const [input, setInput] = useState('');
  const words = input.trim() ? mnemonicWords(input) : [];
  const complete = words.length === 12;
  const valid = complete && isValidMnemonic(input);
  const showError = complete && !valid;

  return (
    <ScreenFrame
      title="Restore your wallet"
      subtext={<Subtext $maxWidth={386}>Enter your 12-word recovery phrase in order.</Subtext>}
      header={
        <BrandTile>
          <KeyIcon size={28} />
        </BrandTile>
      }
      goBack={goBack}
      onClose={onClose}
      gap={spacing.s24}
    >
      <Column $gap={spacing.s24}>
        <Column $gap={spacing.s8}>
          <$Phrase
            $error={showError}
            placeholder="word word word …"
            value={input}
            autoFocus
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setInput(event.target.value)}
          />
          <$Count $done={valid}>{words.length} / 12 words</$Count>
          {showError && (
            <ErrorText>That is not a valid recovery phrase. Check the words.</ErrorText>
          )}
        </Column>
        <BrandedButton
          size="large"
          disabled={!valid}
          onClick={() => onContinue(normalizeMnemonic(input))}
        >
          Continue
        </BrandedButton>
      </Column>
    </ScreenFrame>
  );
};

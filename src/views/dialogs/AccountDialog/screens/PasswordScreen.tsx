import { useState } from 'react';

import styled from 'styled-components';

import { CheckIcon, KeyIcon } from '../icons';
import { BrandedButton, Column, ErrorText, Label, ScreenFrame, Subtext } from '../primitives';
import { colors, spacing } from '../tokens';
import { MIN_PASSWORD_LENGTH, PasswordField, passwordStrength } from './PasswordField';

const $Strength = styled(Label)<{ $level?: 'weak' | 'fair' | 'strong' }>`
  color: ${({ $level }) =>
    $level === 'strong' ? colors.success : $level === 'weak' ? colors.critical : colors.neutral2};
`;

const $KeyTile = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  border-radius: 16px;
  background: ${colors.accent2};
  color: ${colors.accent1};
`;

/**
 * Set the password that seals the account on this device. Two fields, as on the Uniswap
 * extension: a typo here would lock the user out until they restore from the phrase.
 */
export const PasswordScreen = ({
  title = 'Create password',
  subtitle = 'You will need it to unlock Sigma on this device and to view your recovery phrase.',
  submitLabel = 'Create wallet',
  pendingLabel = 'Creating wallet',
  successLabel = 'Wallet created',
  onSubmit,
  isPending,
  isSuccess,
  error,
  goBack,
  onClose,
}: {
  title?: string;
  subtitle?: string;
  submitLabel?: string;
  pendingLabel?: string;
  successLabel?: string;
  onSubmit: (password: string) => void;
  isPending: boolean;
  isSuccess: boolean;
  error?: string;
  goBack?: () => void;
  onClose?: () => void;
}) => {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);

  const strength = passwordStrength(password);
  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
  const mismatch = touched && confirm.length > 0 && confirm !== password;
  const canSubmit = password.length >= MIN_PASSWORD_LENGTH && confirm === password && !isPending;

  const submit = () => {
    if (canSubmit) onSubmit(password);
  };

  return (
    <ScreenFrame
      title={title}
      subtext={<Subtext $maxWidth={386}>{subtitle}</Subtext>}
      header={
        <$KeyTile>
          <KeyIcon size={28} />
        </$KeyTile>
      }
      goBack={goBack}
      onClose={onClose}
      gap={spacing.s24}
    >
      <Column $gap={spacing.s24}>
        <Column $gap={spacing.s12}>
          <Column $gap={spacing.s8}>
            <PasswordField
              placeholder="New password"
              value={password}
              error={tooShort}
              autoFocus
              onChange={(event) => setPassword(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && submit()}
            />
            {strength && (
              <$Strength $level={strength}>
                {tooShort
                  ? `At least ${MIN_PASSWORD_LENGTH} characters`
                  : `${strength[0]!.toUpperCase()}${strength.slice(1)} password`}
              </$Strength>
            )}
          </Column>
          <PasswordField
            placeholder="Confirm password"
            value={confirm}
            error={mismatch}
            onChange={(event) => setConfirm(event.target.value)}
            onBlur={() => setTouched(true)}
            onKeyDown={(event) => event.key === 'Enter' && submit()}
          />
          {mismatch && <ErrorText>Passwords do not match</ErrorText>}
          {error && <ErrorText>{error}</ErrorText>}
        </Column>
        <BrandedButton
          size="large"
          disabled={!canSubmit && !isSuccess}
          loading={isPending && !isSuccess}
          icon={isSuccess ? <CheckIcon size={24} /> : undefined}
          onClick={submit}
        >
          {isSuccess ? successLabel : isPending ? pendingLabel : submitLabel}
        </BrandedButton>
      </Column>
    </ScreenFrame>
  );
};

import { useState } from 'react';

import styled from 'styled-components';

import { FaceIdIcon, SigmaMarkIcon } from '../icons';
import {
  BrandedButton,
  BrandTile,
  Column,
  ErrorText,
  ScreenFrame,
  Subtext,
  TextButton,
} from '../primitives';
import { colors, spacing, type } from '../tokens';
import { PasswordField } from './PasswordField';

const $Who = styled.div`
  ${type.body3}
  color: ${colors.neutral2};
  text-align: center;
`;

/**
 * "Welcome back": the password that opens the vault on this device, Face ID when it has
 * been set up, and the way out for a forgotten password (reset with the phrase).
 */
export const UnlockScreen = ({
  username,
  canUseBiometric,
  onUnlock,
  onUnlockWithBiometric,
  onForgotPassword,
  onUseAnotherWallet,
  isPending,
  error,
  onClose,
}: {
  username?: string;
  canUseBiometric: boolean;
  onUnlock: (password: string) => void;
  onUnlockWithBiometric: () => void;
  onForgotPassword: () => void;
  onUseAnotherWallet: () => void;
  isPending: boolean;
  error?: string;
  onClose: () => void;
}) => {
  const [password, setPassword] = useState('');
  const submit = () => {
    if (password && !isPending) onUnlock(password);
  };

  return (
    <ScreenFrame
      title="Welcome back"
      subtext={
        <Column $gap={spacing.s4} $center>
          <Subtext>Enter your password to unlock</Subtext>
          {username && <$Who>{username}.haneul</$Who>}
        </Column>
      }
      header={
        <BrandTile>
          <SigmaMarkIcon size={36} />
        </BrandTile>
      }
      onClose={onClose}
      gap={spacing.s24}
    >
      <Column $gap={spacing.s24}>
        <Column $gap={spacing.s8}>
          <PasswordField
            placeholder="Password"
            autoComplete="current-password"
            value={password}
            error={Boolean(error)}
            autoFocus
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && submit()}
          />
          {error && <ErrorText>{error}</ErrorText>}
        </Column>
        <Column $gap={spacing.s12} $center>
          <BrandedButton size="large" disabled={!password} loading={isPending} onClick={submit}>
            Unlock
          </BrandedButton>
          {canUseBiometric && (
            <BrandedButton
              size="medium"
              variant="secondary"
              disabled={isPending}
              icon={<FaceIdIcon size={20} />}
              onClick={onUnlockWithBiometric}
            >
              Unlock with Face ID
            </BrandedButton>
          )}
          <TextButton type="button" onClick={onForgotPassword}>
            Forgot password?
          </TextButton>
          <TextButton type="button" $muted onClick={onUseAnotherWallet}>
            Use a different wallet
          </TextButton>
        </Column>
      </Column>
    </ScreenFrame>
  );
};

/**
 * The speed bump behind "Forgot password?": the password cannot be recovered, only the
 * account can, from its phrase. Resetting forgets the account on this device first.
 */
export const ResetScreen = ({
  onReset,
  goBack,
  onClose,
}: {
  onReset: () => void;
  goBack: () => void;
  onClose: () => void;
}) => (
  <ScreenFrame
    title="Forgot password"
    subtext={
      <Subtext $maxWidth={386}>
        Your password is not stored anywhere, so it cannot be recovered. You can reset it with your
        12-word recovery phrase. This removes the account from this device first; without the
        phrase, it cannot be brought back.
      </Subtext>
    }
    header={
      <BrandTile>
        <SigmaMarkIcon size={36} />
      </BrandTile>
    }
    goBack={goBack}
    onClose={onClose}
    gap={spacing.s24}
  >
    <Column $gap={spacing.s12} $center>
      <BrandedButton size="large" onClick={onReset}>
        Reset wallet
      </BrandedButton>
      <TextButton type="button" $muted onClick={goBack}>
        Cancel
      </TextButton>
    </Column>
  </ScreenFrame>
);

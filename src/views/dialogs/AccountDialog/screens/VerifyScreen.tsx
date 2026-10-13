import { useState } from 'react';

import { FaceIdIcon, KeyIcon } from '../icons';
import { BrandedButton, BrandTile, Column, ErrorText, ScreenFrame, Subtext } from '../primitives';
import { spacing } from '../tokens';
import { PasswordField } from './PasswordField';

/**
 * Re-authentication before something sensitive (showing the phrase, enrolling Face ID).
 * The vault is already open; this proves the person at the keyboard is its owner.
 */
export const VerifyScreen = ({
  title = 'Confirm your password',
  subtitle = 'Enter your password to continue.',
  canUseBiometric,
  onVerify,
  onVerifyWithBiometric,
  isPending,
  error,
  goBack,
  onClose,
}: {
  title?: string;
  subtitle?: string;
  canUseBiometric: boolean;
  onVerify: (password: string) => void;
  onVerifyWithBiometric: () => void;
  isPending: boolean;
  error?: string;
  goBack?: () => void;
  onClose?: () => void;
}) => {
  const [password, setPassword] = useState('');
  const submit = () => {
    if (password && !isPending) onVerify(password);
  };

  return (
    <ScreenFrame
      title={title}
      subtext={<Subtext $maxWidth={386}>{subtitle}</Subtext>}
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
          <PasswordField
            placeholder="Password"
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
            Continue
          </BrandedButton>
          {canUseBiometric && (
            <BrandedButton
              size="medium"
              variant="secondary"
              disabled={isPending}
              icon={<FaceIdIcon size={20} />}
              onClick={onVerifyWithBiometric}
            >
              Use Face ID
            </BrandedButton>
          )}
        </Column>
      </Column>
    </ScreenFrame>
  );
};

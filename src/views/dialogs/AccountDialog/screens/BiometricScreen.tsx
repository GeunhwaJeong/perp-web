import { FaceIdIcon, FingerprintIcon } from '../icons';
import {
  BrandedButton,
  Column,
  ErrorText,
  IconPairHeader,
  ScreenFrame,
  Subtext,
  TextButton,
} from '../primitives';
import { spacing } from '../tokens';

/**
 * Offer Face ID / Touch ID for this device, right after the password is set. Nothing
 * leaves the device: the platform authenticator keeps a key that opens the password,
 * which opens the vault. Skippable; the password keeps working either way.
 */
export const BiometricScreen = ({
  onEnable,
  onSkip,
  isPending,
  error,
  goBack,
  onClose,
}: {
  onEnable: () => void;
  onSkip: () => void;
  isPending: boolean;
  error?: string;
  goBack?: () => void;
  onClose?: () => void;
}) => (
  <ScreenFrame
    title="Unlock with Face ID"
    subtext={
      <Subtext $maxWidth={386}>
        Skip the password on this device. Your face or fingerprint stays with your device and is
        only used to unlock Sigma here.
      </Subtext>
    }
    header={
      <IconPairHeader left={<FingerprintIcon size={24} />} right={<FaceIdIcon size={24} />} />
    }
    goBack={goBack}
    onClose={onClose}
    gap={spacing.s24}
  >
    <Column $gap={spacing.s12} $center>
      {error && <ErrorText>{error}</ErrorText>}
      <BrandedButton size="large" loading={isPending} onClick={onEnable} autoFocus>
        Enable Face ID
      </BrandedButton>
      <TextButton type="button" $muted disabled={isPending} onClick={onSkip}>
        Not now
      </TextButton>
    </Column>
  </ScreenFrame>
);

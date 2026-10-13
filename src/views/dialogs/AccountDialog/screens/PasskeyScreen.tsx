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
 * The chain-native passkey account. The credential signs on chain directly, so there is
 * no password and no phrase; the authenticator is asked on every order instead. Both
 * doors are offered: a fresh passkey, or one this device already holds.
 */
export const PasskeyScreen = ({
  onCreate,
  onRecover,
  isPending,
  error,
  goBack,
  onClose,
}: {
  onCreate: () => void;
  onRecover: () => void;
  isPending: boolean;
  error?: string;
  goBack: () => void;
  onClose: () => void;
}) => (
  <ScreenFrame
    title="Sign in with a passkey"
    subtext={
      <Subtext $maxWidth={386}>
        Your face or fingerprint is the key. It syncs through your device&apos;s password manager
        and confirms every order. Nothing to write down, nothing to remember.
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
      <BrandedButton size="large" loading={isPending} onClick={onCreate} autoFocus>
        Create passkey
      </BrandedButton>
      <TextButton type="button" disabled={isPending} onClick={onRecover}>
        I already have one
      </TextButton>
    </Column>
  </ScreenFrame>
);

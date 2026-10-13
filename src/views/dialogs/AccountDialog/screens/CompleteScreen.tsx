import styled from 'styled-components';

import { CopyButton } from '@/components/CopyButton';

import { truncateAddress } from '@/lib/wallet';

import { CheckIcon } from '../icons';
import { BrandedButton, Column, Fine, ScreenFrame, Subtext, TextButton } from '../primitives';
import { colors, radii, spacing, type } from '../tokens';

const $CheckTile = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  border-radius: ${radii.r16};
  background: ${colors.accent2};
  color: ${colors.accent1};
`;

const $Identity = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: ${spacing.s4};
  width: 100%;
  padding: ${spacing.s16};
  border-radius: ${radii.r16};
  background: ${colors.surface2};

  > strong {
    ${type.subheading1}
    color: ${colors.neutral1};
    font-weight: 535;
  }
`;

const $Address = styled(CopyButton)`
  ${type.body3}
  color: ${colors.neutral2};
  font-family: var(--fontFamily-monospace);
`;

/**
 * The account exists and is connected. Says what it is called, where it lives, and whether
 * the name has reached the chain yet.
 */
export const CompleteScreen = ({
  username,
  address,
  nameStatus,
  onDone,
  onBackUp,
}: {
  username?: string;
  address: string;
  nameStatus?: 'pending' | 'claimed';
  onDone: () => void;
  onBackUp: () => void;
}) => (
  <ScreenFrame
    title="You're all set"
    subtext={
      <Subtext $maxWidth={386}>
        Deposit to start trading. Your recovery phrase is in Settings whenever you want it.
      </Subtext>
    }
    header={
      <$CheckTile>
        <CheckIcon size={32} />
      </$CheckTile>
    }
    gap={spacing.s24}
  >
    <Column $gap={spacing.s24}>
      <$Identity>
        {username && <strong>{username}.haneul</strong>}
        <$Address value={address} buttonType="text" copyIconPosition="end">
          {truncateAddress(address)}
        </$Address>
        {username && nameStatus === 'pending' && (
          <Fine>Your name is being written to HaneulNS. Until then, use the address.</Fine>
        )}
      </$Identity>
      <Column $gap={spacing.s12} $center>
        <BrandedButton size="large" onClick={onDone} autoFocus>
          Start trading
        </BrandedButton>
        <TextButton type="button" $muted onClick={onBackUp}>
          Back up recovery phrase now
        </TextButton>
      </Column>
    </Column>
  </ScreenFrame>
);

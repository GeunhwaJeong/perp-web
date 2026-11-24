import styled from 'styled-components';

import { truncateAddress } from '@/lib/wallet';

import { SigmaMarkIcon } from '../icons';
import { BrandedButton, BrandTile, Column, ScreenFrame, Subtext, TextButton } from '../primitives';
import { colors, spacing, type } from '../tokens';

const $Warning = styled.p`
  ${type.body3}
  color: ${colors.critical};
  margin: 0;
  max-width: 386px;
  text-align: center;
`;

/**
 * What "Create account" shows in a browser that already holds a wallet. A browser holds one
 * wallet, so a new one takes the place of this one, and a wallet whose phrase was never written
 * down cannot be brought back. The screen names the wallet and says so first. Nothing is removed
 * here: the wallet stays until the new one is made.
 */
export const ReplaceScreen = ({
  username,
  address,
  backedUp,
  onLogIn,
  onReplace,
  goBack,
  onClose,
}: {
  username?: string;
  address?: string;
  backedUp: boolean;
  onLogIn: () => void;
  onReplace: () => void;
  goBack: () => void;
  onClose: () => void;
}) => {
  const who = username ? `${username}.haneul` : truncateAddress(address);

  return (
    <ScreenFrame
      title="This browser already has a wallet"
      subtext={
        <Column $gap={spacing.s8} $center>
          <Subtext $maxWidth={386}>
            {who} is saved in this browser. A new account takes its place here. After that, only its
            12-word recovery phrase brings it back.
          </Subtext>
          {!backedUp && (
            <$Warning>
              Its recovery phrase has not been backed up. Without the phrase, the wallet and the
              funds in it are lost for good.
            </$Warning>
          )}
        </Column>
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
        <BrandedButton size="large" onClick={onLogIn}>
          Log in to this wallet
        </BrandedButton>
        <BrandedButton size="medium" variant="surface" onClick={onReplace}>
          Remove it and create a new one
        </BrandedButton>
        <TextButton type="button" $muted onClick={goBack}>
          Cancel
        </TextButton>
      </Column>
    </ScreenFrame>
  );
};

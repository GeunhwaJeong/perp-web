import { useState } from 'react';

import styled from 'styled-components';

import { AppRoute } from '@/constants/routes';
import { ConnectorType, type WalletInfo } from '@/constants/wallets';

import { ChevronRightIcon, PasskeyIcon, WalletGlyphIcon } from '../icons';
import {
  BrandedButton,
  Column,
  ErrorText,
  Fine,
  OptionDetail,
  OptionGroup,
  OptionIcon,
  OptionLabel,
  OptionRow,
  OrDivider,
  TextButton,
} from '../primitives';
import { colors, spacing, type } from '../tokens';

/** Wallets shown before the "Other wallets" row folds the rest away. */
const VISIBLE_WALLETS = 3;

const walletKey = (wallet: WalletInfo) =>
  wallet.connectorType === ConnectorType.WalletStandard ? wallet.walletId : wallet.name;

const WalletRow = ({
  wallet,
  onSelect,
  disabled,
}: {
  wallet: WalletInfo;
  onSelect: () => void;
  disabled?: boolean;
}) => {
  const icon =
    wallet.connectorType === ConnectorType.WalletStandard ||
    wallet.connectorType === ConnectorType.Injected
      ? wallet.icon
      : undefined;
  return (
    <OptionRow type="button" onClick={onSelect} disabled={disabled}>
      <OptionIcon $tint={!icon}>
        {icon ? <img src={icon} alt="" /> : <WalletGlyphIcon size={24} />}
      </OptionIcon>
      <OptionLabel>
        <span>{wallet.name}</span>
      </OptionLabel>
    </OptionRow>
  );
};

const $Title = styled.h2`
  ${type.subheading2}
  color: ${colors.neutral1};
  margin: 0;
  text-align: center;
`;

const $Empty = styled.div`
  ${type.body3}
  color: ${colors.neutral2};
  padding: ${spacing.s16};
  text-align: center;
  background: ${colors.surface2};
`;

/**
 * The first panel: detected wallets in a rounded group, then "or", then the account the
 * site itself can make. The order is Uniswap's (external wallets first, never forced),
 * the copy is ours.
 */
export const ConnectScreen = ({
  wallets,
  onSelectWallet,
  connectingWallet,
  error,
  onCreateAccount,
  onLogIn,
  onPasskey,
  hasLocalAccount,
}: {
  wallets: WalletInfo[];
  onSelectWallet: (wallet: WalletInfo) => void;
  connectingWallet?: WalletInfo;
  error?: string;
  onCreateAccount: () => void;
  onLogIn: () => void;
  onPasskey: () => void;
  hasLocalAccount: boolean;
}) => {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? wallets : wallets.slice(0, VISIBLE_WALLETS);
  const hidden = wallets.length - visible.length;

  return (
    <Column $gap={spacing.s16}>
      <$Title>Connect a wallet</$Title>

      <Column $gap={spacing.s12}>
        <OptionGroup>
          <OptionRow type="button" onClick={onPasskey} disabled={connectingWallet !== undefined}>
            <OptionIcon $tint>
              <PasskeyIcon size={24} />
            </OptionIcon>
            <OptionLabel>
              <span>Passkey</span>
              <span>Face ID or fingerprint, on chain</span>
            </OptionLabel>
          </OptionRow>
          {wallets.length === 0 ? (
            <$Empty>No wallet extension detected in this browser.</$Empty>
          ) : (
            visible.map((wallet) => (
              <WalletRow
                key={walletKey(wallet)}
                wallet={wallet}
                onSelect={() => onSelectWallet(wallet)}
                disabled={connectingWallet !== undefined}
              />
            ))
          )}
          {hidden > 0 && (
            <OptionRow type="button" onClick={() => setShowAll(true)}>
              <OptionIcon $tint>
                <WalletGlyphIcon size={24} />
              </OptionIcon>
              <OptionLabel>
                <span>Other wallets</span>
                <span>{hidden} more</span>
              </OptionLabel>
              <OptionDetail>
                <ChevronRightIcon size={24} />
              </OptionDetail>
            </OptionRow>
          )}
        </OptionGroup>
        {error && <ErrorText>{error}</ErrorText>}

        <OrDivider />

        <Column $gap={spacing.s12} $center>
          <BrandedButton size="medium" onClick={onCreateAccount}>
            Create account
          </BrandedButton>
          <TextButton type="button" onClick={onLogIn}>
            <PasskeyIcon size={20} />
            {hasLocalAccount ? 'Log in' : 'Log in with recovery phrase'}
          </TextButton>
        </Column>

        <Fine>
          By connecting a wallet you agree to Sigma&apos;s{' '}
          <a href={AppRoute.Terms} target="_blank" rel="noreferrer">
            Terms of Service
          </a>{' '}
          and{' '}
          <a href={AppRoute.Privacy} target="_blank" rel="noreferrer">
            Privacy Policy
          </a>
          .
        </Fine>
      </Column>
    </Column>
  );
};

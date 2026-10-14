import { SIGMA_ACCOUNT_WALLET_NAME, SIGMA_PASSKEY_WALLET_NAME } from '@/haneul/account';
import styled from 'styled-components';

import { OnboardingState } from '@/constants/account';
import { ButtonSize } from '@/constants/buttons';

import { useAccounts } from '@/hooks/useAccounts';
import { useBreakpoints } from '@/hooks/useBreakpoints';
import { useLocalAccount } from '@/hooks/useLocalAccount';
import { usePasskeyAccount } from '@/hooks/usePasskeyAccount';

import { colors, icons, motion, spacing, type } from '@/views/dialogs/AccountDialog/tokens';
import { OnboardingTriggerButton } from '@/views/dialogs/OnboardingTriggerButton';
import { AccountDrawer } from '@/views/menus/AccountDrawer/AccountDrawer';
import { Avatar } from '@/views/menus/AccountDrawer/Avatar';
import { SigmaBadgeIcon } from '@/views/menus/AccountDrawer/icons';

import { getOnboardingState } from '@/state/accountSelectors';
import { useAppSelector } from '@/state/appTypes';

import { truncateAddress } from '@/lib/wallet';

/**
 * The header's account pill (Uniswap's `Web3Status`): a 24 avatar, the name in body2 and
 * the badge, opening the account drawer. Before a wallet is connected it is the sign-up
 * button.
 */
const $Trigger = styled.button`
  display: inline-flex;
  align-items: center;
  gap: ${spacing.s8};
  height: 2.25rem;
  padding: 0 ${spacing.s12} 0 ${spacing.s8};
  border-radius: 0.5em;
  background: ${colors.surface2};
  color: ${colors.neutral1};
  ${type.body2}
  transition: background-color ${motion.fast};

  &:hover,
  &[data-state='open'] {
    background: ${colors.surface2Hovered};
  }

  > span {
    max-width: 12em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  > svg {
    flex: none;
  }
`;

export const AccountMenu = () => {
  const { isTablet } = useBreakpoints();
  const onboardingState = useAppSelector(getOnboardingState);
  const {
    sourceAccount: { walletInfo },
    dydxAddress,
  } = useAccounts();
  const { account: localAccount } = useLocalAccount();
  const passkeyAccount = usePasskeyAccount();

  if (onboardingState === OnboardingState.Disconnected || !dydxAddress) {
    return <OnboardingTriggerButton size={ButtonSize.XSmall} />;
  }

  const name =
    walletInfo?.name === SIGMA_ACCOUNT_WALLET_NAME
      ? localAccount?.username
      : walletInfo?.name === SIGMA_PASSKEY_WALLET_NAME
        ? passkeyAccount?.username
        : undefined;

  return (
    <AccountDrawer
      trigger={
        <$Trigger type="button">
          <Avatar address={dydxAddress} size={icons.i24} badge={false} />
          {!isTablet && <span>{name ? `${name}.haneul` : truncateAddress(dydxAddress)}</span>}
          {!isTablet && name && <SigmaBadgeIcon size={18} />}
        </$Trigger>
      }
    />
  );
};

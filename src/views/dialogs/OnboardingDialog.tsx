import { useCallback, useEffect, useMemo } from 'react';

import { debounce } from 'lodash';
import styled from 'styled-components';
import tw from 'twin.macro';

import { DialogProps, OnboardingDialogProps } from '@/constants/dialogs';
import { STRING_KEYS } from '@/constants/localization';
import { timeUnits } from '@/constants/time';
import { ConnectorType, WalletInfo } from '@/constants/wallets';

import { useAccounts } from '@/hooks/useAccounts';
import { useBreakpoints } from '@/hooks/useBreakpoints';
import { useSimpleUiEnabled } from '@/hooks/useSimpleUiEnabled';
import { useStringGetter } from '@/hooks/useStringGetter';
import { useURLConfigs } from '@/hooks/useURLConfigs';

import breakpoints from '@/styles/breakpoints';
import { formMixins } from '@/styles/formMixins';
import { layoutMixins } from '@/styles/layoutMixins';

import { Dialog, DialogPlacement } from '@/components/Dialog';
import { Icon, IconName } from '@/components/Icon';
import { Link } from '@/components/Link';
import { WithTooltip } from '@/components/WithTooltip';

import { setDisplayChooseWallet, setOnboardedThisSession } from '@/state/account';
import { calculateOnboardingStep } from '@/state/accountCalculators';
import { useAppDispatch, useAppSelector } from '@/state/appTypes';

import { LanguageSelector } from '../menus/LanguageSelector';
import { ChooseWallet } from './OnboardingDialog/ChooseWallet';

/**
 * Sign-in dialog. Connecting a Wallet Standard wallet is the whole flow: the connected
 * account is the trading account, so there is no key derivation step after this.
 */
export const OnboardingDialog = ({
  setIsOpen: setIsOpenRaw,
}: DialogProps<OnboardingDialogProps>) => {
  const dispatch = useAppDispatch();
  const stringGetter = useStringGetter();
  const { isMobile } = useBreakpoints();
  const { walletLearnMore } = useURLConfigs();
  const { selectWallet, dydxAddress } = useAccounts();
  const currentOnboardingStep = useAppSelector(calculateOnboardingStep);
  const isSimpleUi = useSimpleUiEnabled();

  const setIsOpen = useCallback(
    (open: boolean) => {
      if (!open) {
        dispatch(setOnboardedThisSession(true));
      }
      setIsOpenRaw(open);
    },
    [dispatch, setIsOpenRaw]
  );

  useEffect(() => {
    return () => {
      dispatch(setDisplayChooseWallet(false));
    };
  }, [dispatch]);

  useEffect(() => {
    if (!currentOnboardingStep || dydxAddress) {
      setIsOpen(false);
    }
  }, [currentOnboardingStep, setIsOpen, dydxAddress]);

  const onChooseWallet = useMemo(
    () =>
      debounce((wallet: WalletInfo) => {
        if (wallet.connectorType === ConnectorType.DownloadWallet) {
          window.open(wallet.downloadLink, '_blank');
          return;
        }
        selectWallet(wallet);
      }, timeUnits.second),
    [selectWallet]
  );

  return (
    <$Dialog
      isOpen={Boolean(currentOnboardingStep)}
      setIsOpen={setIsOpen}
      title={
        <div tw="flex items-center gap-0.5">
          {stringGetter({ key: STRING_KEYS.CONNECT_YOUR_WALLET })}
          <$WithTooltip
            tw="text-color-text-0"
            tooltipString={stringGetter({
              key: STRING_KEYS.WALLET_DEFINITION,
              params: {
                ABOUT_WALLETS_LINK: (
                  <Link href={walletLearnMore} withIcon isInline>
                    {stringGetter({ key: STRING_KEYS.ABOUT_WALLETS })}
                  </Link>
                ),
              },
            })}
          >
            <$QuestionIcon iconName={IconName.QuestionMark} />
          </$WithTooltip>
        </div>
      }
      description={stringGetter({ key: STRING_KEYS.SELECT_WALLET_FROM_OPTIONS })}
      hasFooterBorder
      slotFooter={
        !isSimpleUi && (
          <$Footer>
            <div tw="flex flex-col gap-0.5 text-color-text-0 font-small-medium">
              <h3 tw="text-color-text-2 font-medium-book">
                {stringGetter({ key: STRING_KEYS.SELECT_LANGUAGE })}
              </h3>
              {stringGetter({ key: STRING_KEYS.CHOOSE_PREFERRED_LANGUAGE })}
            </div>
            <$LanguageSelector />
          </$Footer>
        )
      }
      placement={isMobile ? DialogPlacement.FullScreen : DialogPlacement.Default}
    >
      <$Content>
        <ChooseWallet onChooseWallet={onChooseWallet} />
      </$Content>
    </$Dialog>
  );
};
const $Content = tw.div`flexColumn gap-1`;

const $Dialog = styled(Dialog)`
  @media ${breakpoints.notTablet} {
    --dialog-header-backgroundColor: var(--color-layer-3);
  }

  --dialog-icon-size: 1.25rem;
`;

const $WithTooltip = styled(WithTooltip)`
  a {
    text-decoration: none;
  }
`;

const $QuestionIcon = styled(Icon)`
  border: var(--border);
  border-radius: 50%;
  padding: 0.25rem;
  background-color: var(--color-layer-5);
  color: var(--color-text-1);
`;

const $Footer = styled.footer`
  ${layoutMixins.spacedRow}
  margin-top: auto;

  a {
    color: var(--color-text-0);
    font: var(--font-base-book);

    &:hover {
      color: var(--color-text-1);
    }
  }
`;

const $LanguageSelector = styled(LanguageSelector)`
  ${formMixins.inputInnerSelectMenu}
  --trigger-height: 2.75rem;
  --trigger-padding: 1rem 0.75rem;

  font: var(--font-base-book);
  width: 7rem;
`;

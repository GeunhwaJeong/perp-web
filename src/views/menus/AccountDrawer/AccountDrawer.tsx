import { useEffect, useState, type ReactNode } from 'react';

import {
  localAccountStore,
  SIGMA_ACCOUNT_WALLET_NAME,
  SIGMA_PASSKEY_WALLET_NAME,
} from '@/haneul/account';
import { Content, Portal, Root, Trigger } from '@radix-ui/react-popover';
import styled, { keyframes } from 'styled-components';

import { DialogTypes } from '@/constants/dialogs';
import { DydxChainAsset } from '@/constants/wallets';

import { useAccountBalance } from '@/hooks/useAccountBalance';
import { useAccounts } from '@/hooks/useAccounts';
import { useCopyValue } from '@/hooks/useCopyValue';
import { useLocalAccount } from '@/hooks/useLocalAccount';
import { usePasskeyAccount } from '@/hooks/usePasskeyAccount';
import { useTokenConfigs } from '@/hooks/useTokenConfigs';

import { Pager } from '@/views/dialogs/AccountDialog/AccountModal';
import { colors, motion, radii, shadowMedium } from '@/views/dialogs/AccountDialog/tokens';

import { useAppDispatch, useAppSelector } from '@/state/appTypes';
import { setAppThemeSetting, type AppThemeSetting } from '@/state/appUiConfigs';
import { getAppThemeSetting } from '@/state/appUiConfigsSelectors';
import { openDialog } from '@/state/dialogs';

import { MainPanel } from './MainPanel';
import { ReceivePanel } from './ReceivePanel';
import { SettingsPanel } from './SettingsPanel';

/**
 * `AccountDrawer`: Uniswap's 368-wide panel under the header's account pill, rounded 20
 * with a hairline border and the medium shadow, holding the main panel and the settings
 * and receive slide-outs. Same geometry, Sigma's colours.
 */
const DRAWER_WIDTH = 368;
const PANELS = ['main', 'settings', 'receive'] as const;
type Panel = (typeof PANELS)[number];

const enter = keyframes`
  from { opacity: 0; transform: translateY(-6px); }
  to { opacity: 1; transform: translateY(0); }
`;

const $Content = styled(Content)`
  z-index: 3;
  width: ${DRAWER_WIDTH}px;
  max-height: calc(100vh - var(--page-header-height, 56px) - 16px);
  overflow: auto;
  border: 1px solid ${colors.surface3};
  border-radius: ${radii.r20};
  background: ${colors.surface1};
  color: ${colors.neutral1};
  ${shadowMedium}
  animation: ${enter} ${motion.fast};
  transform-origin: var(--radix-popover-content-transform-origin);

  @media (max-width: 480px) {
    width: calc(100vw - 24px);
  }
`;

export const AccountDrawer = ({ trigger }: { trigger: ReactNode }) => {
  const dispatch = useAppDispatch();
  const {
    sourceAccount: { walletInfo },
    dydxAddress,
  } = useAccounts();
  const { account: localAccount, store } = useLocalAccount();
  const passkeyAccount = usePasskeyAccount();
  const { nativeTokenBalance, usdcBalance } = useAccountBalance();
  const { usdcLabel } = useTokenConfigs();
  const themeSetting = useAppSelector(getAppThemeSetting);
  const { copy } = useCopyValue({ value: dydxAddress });

  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>('main');

  // Back to the main panel once the drawer has closed, after its exit, as Uniswap does.
  useEffect(() => {
    if (open || panel === 'main') return undefined;
    const timer = setTimeout(() => setPanel('main'), 250);
    return () => clearTimeout(timer);
  }, [open, panel]);

  const isLocalAccount = walletInfo?.name === SIGMA_ACCOUNT_WALLET_NAME && localAccount !== null;
  const isPasskeyAccount =
    walletInfo?.name === SIGMA_PASSKEY_WALLET_NAME && passkeyAccount !== null;
  const record = isLocalAccount ? localAccount : isPasskeyAccount ? passkeyAccount : null;

  const close = () => setOpen(false);
  const show = (dialog: Parameters<typeof openDialog>[0]) => {
    close();
    dispatch(openDialog(dialog));
  };

  if (!dydxAddress) return null;

  return (
    <Root open={open} onOpenChange={setOpen} modal={false}>
      <Trigger asChild>{trigger}</Trigger>
      <Portal>
        <$Content
          align="end"
          sideOffset={16}
          collisionPadding={12}
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <Pager index={PANELS.indexOf(panel)}>
            <MainPanel
              address={dydxAddress}
              name={record?.username}
              nameStatus={record?.nameStatus}
              isSigmaAccount={isLocalAccount || isPasskeyAccount}
              needsBackup={isLocalAccount && !localAccount.backedUpAt}
              walletHaneul={nativeTokenBalance.toNumber()}
              walletCollateral={usdcBalance}
              collateralLabel={usdcLabel}
              onCopyAddress={copy}
              onSettings={() => setPanel('settings')}
              onDisconnect={() => show(DialogTypes.DisconnectWallet())}
              onDeposit={() => show(DialogTypes.Deposit2({}))}
              onWithdraw={() => show(DialogTypes.Withdraw2({}))}
              onReceive={() => setPanel('receive')}
              onBackup={() => show(DialogTypes.AccountSecurity({ intent: 'recoveryPhrase' }))}
              onClose={close}
            />
            <SettingsPanel
              isSigmaAccount={isLocalAccount}
              biometricEnabled={Boolean(localAccount?.biometric)}
              themeSetting={themeSetting}
              onThemeChange={(next: AppThemeSetting) => dispatch(setAppThemeSetting(next))}
              onDisplaySettings={() => show(DialogTypes.DisplaySettings())}
              onPreferences={() => show(DialogTypes.Preferences())}
              onRecoveryPhrase={() =>
                show(DialogTypes.AccountSecurity({ intent: 'recoveryPhrase' }))
              }
              onBiometric={(enable) =>
                enable
                  ? show(DialogTypes.AccountSecurity({ intent: 'enableBiometric' }))
                  : store.disableBiometric()
              }
              onLock={() => {
                localAccountStore.lock();
                show(DialogTypes.DisconnectWallet());
              }}
              onSend={() =>
                show(DialogTypes.Transfer({ selectedAsset: DydxChainAsset.CHAINTOKEN }))
              }
              onDisconnect={() => show(DialogTypes.DisconnectWallet())}
              onBack={() => setPanel('main')}
            />
            <ReceivePanel
              address={dydxAddress}
              name={record?.username}
              onCopy={copy}
              onBack={() => setPanel('main')}
            />
          </Pager>
        </$Content>
      </Portal>
    </Root>
  );
};

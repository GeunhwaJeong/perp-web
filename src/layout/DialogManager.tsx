/* eslint-disable react/no-unstable-nested-components */
import React from 'react';

import { DialogTypes } from '@/constants/dialogs';

import { CriteriaDialog } from '@/views/Affiliates/CriteriaDialog';
import { AcknowledgeTermsDialog } from '@/views/dialogs/AcknowledgeTermsDialog';
import { AdjustIsolatedMarginDialog } from '@/views/dialogs/AdjustIsolatedMarginDialog';
import { CancelAllOrdersConfirmationDialog } from '@/views/dialogs/CancelAllOrdersConfirmationDialog';
import { CancelOrphanedTriggerOrdersDialog } from '@/views/dialogs/CancelOrphanedTriggerOrdersDialog';
import { CancelPendingOrdersDialog } from '@/views/dialogs/CancelPendingOrdersDialog';
import { CloseAllPositionsConfirmationDialog } from '@/views/dialogs/CloseAllPositionsConfirmationDialog';
import { ClosePositionDialog } from '@/views/dialogs/ClosePositionDialog';
import { CoinbaseDepositDialog } from '@/views/dialogs/CoinbaseDepositDialog';
import {
  CollateralDepositDialog,
  CollateralWithdrawDialog,
} from '@/views/dialogs/CollateralDialog';
import { ComplianceConfigDialog } from '@/views/dialogs/ComplianceConfigDialog';
import { ConfirmPendingDepositDialog } from '@/views/dialogs/ConfirmPendingDepositDialog';
import { FillDetailsDialog } from '@/views/dialogs/DetailsDialog/FillDetailsDialog';
import { OrderDetailsDialog } from '@/views/dialogs/DetailsDialog/OrderDetailsDialog';
import { DisconnectDialog } from '@/views/dialogs/DisconnectDialog';
import { DisplaySettingsDialog } from '@/views/dialogs/DisplaySettingsDialog';
import { ExchangeOfflineDialog } from '@/views/dialogs/ExchangeOfflineDialog';
import { ExternalLinkDialog } from '@/views/dialogs/ExternalLinkDialog';
import { GlobalCommandDialog } from '@/views/dialogs/GlobalCommandDialog';
import { HelpDialog } from '@/views/dialogs/HelpDialog';
import { MobileDownloadDialog } from '@/views/dialogs/MobileDownloadDialog';
import { OnboardingDialog } from '@/views/dialogs/OnboardingDialog';
import { PredictionMarketIntroDialog } from '@/views/dialogs/PredictionMarketIntroDialog';
import { PreferencesDialog } from '@/views/dialogs/PreferencesDialog';
import { RateLimitDialog } from '@/views/dialogs/RateLimitDialog';
import { ReclaimChildSubaccountFundsDialog } from '@/views/dialogs/ReclaimChildSubaccountFundsDialog';
import { ReferralDialog } from '@/views/dialogs/ReferralDialog';
import { RestrictedGeoDialog } from '@/views/dialogs/RestrictedGeoDialog';
import { RestrictedWalletDialog } from '@/views/dialogs/RestrictedWalletDialog';
import { SetMarketLeverageDialog } from '@/views/dialogs/SetMarketLeverageDialog';
import { SetupPasskeyDialog } from '@/views/dialogs/SetupPasskeyDialog';
import { ShareAffiliateDialog } from '@/views/dialogs/ShareAffiliateDialog';
import { SharePNLAnalyticsDialog } from '@/views/dialogs/SharePNLAnalyticsDialog';
import { SimpleUiTradeDialog } from '@/views/dialogs/SimpleUiTradeDialog/SimpleUiTradeDialog';
import { StakeDialog } from '@/views/dialogs/StakeDialog';
import { StakingRewardDialog } from '@/views/dialogs/StakingRewardDialog';
import { TradeDialog } from '@/views/dialogs/TradeDialog';
import { TradingKeysDialog } from '@/views/dialogs/TradingKeysDialog';
import { TransferDialog } from '@/views/dialogs/TransferDialog';
import { DepositAddressDialog } from '@/views/dialogs/TransferDialogs/DepositAddressDialog';
import { TransferStatusDialog } from '@/views/dialogs/TransferDialogs/TransferStatusDialog';
import { TriggersDialog } from '@/views/dialogs/TriggersDialog';
import { UnstakeDialog } from '@/views/dialogs/UnstakeDialog';
import { VaultDepositWithdrawDialog } from '@/views/dialogs/VaultDepositWithdrawDialog';
import { WithdrawFromSubaccountDialog } from '@/views/dialogs/WithdrawFromSubaccountDialog';
import { WithdrawalGateDialog } from '@/views/dialogs/WithdrawalGateDialog';

import { useAppDispatch, useAppSelector } from '@/state/appTypes';
import { closeDialog, openDialog } from '@/state/dialogs';
import { getActiveDialog } from '@/state/dialogsSelectors';

export const DialogManager = React.memo(() => {
  const dispatch = useAppDispatch();
  const activeDialog = useAppSelector(getActiveDialog);

  if (!activeDialog) return null;

  const modalProps = {
    setIsOpen: (isOpen: boolean) => {
      dispatch(isOpen ? openDialog(activeDialog) : closeDialog());
    },
  };

  return DialogTypes.match(activeDialog, {
    AcknowledgeTerms: (args) => <AcknowledgeTermsDialog {...args} {...modalProps} />,
    AdjustIsolatedMargin: (args) => <AdjustIsolatedMarginDialog {...args} {...modalProps} />,
    ClosePosition: (args) => <ClosePositionDialog {...args} {...modalProps} />,
    CloseAllPositionsConfirmation: (args) => (
      <CloseAllPositionsConfirmationDialog {...args} {...modalProps} />
    ),
    CancelAllOrdersConfirmation: (args) => (
      <CancelAllOrdersConfirmationDialog {...args} {...modalProps} />
    ),
    CancelOrphanedTriggers: (args) => (
      <CancelOrphanedTriggerOrdersDialog {...args} {...modalProps} />
    ),
    CancelPendingOrders: (args) => <CancelPendingOrdersDialog {...args} {...modalProps} />,
    CoinbaseDepositDialog: (args) => <CoinbaseDepositDialog {...args} {...modalProps} />,
    ComplianceConfig: (args) => <ComplianceConfigDialog {...args} {...modalProps} />,
    ConfirmPendingDeposit: (args) => <ConfirmPendingDepositDialog {...args} {...modalProps} />,
    DepositAddresses: (args) => <DepositAddressDialog {...args} {...modalProps} />,
    // Collateral moves straight between the wallet and the trading account on the engine.
    Deposit2: (args) => <CollateralDepositDialog {...args} {...modalProps} />,
    DisconnectWallet: (args) => <DisconnectDialog {...args} {...modalProps} />,
    DisplaySettings: (args) => <DisplaySettingsDialog {...args} {...modalProps} />,
    ExchangeOffline: (args) => <ExchangeOfflineDialog {...args} {...modalProps} />,
    ExternalLink: (args) => <ExternalLinkDialog {...args} {...modalProps} />,
    FillDetails: (args) => <FillDetailsDialog {...args} {...modalProps} />,
    GlobalCommand: (args) => <GlobalCommandDialog {...args} {...modalProps} />,
    Help: (args) => <HelpDialog {...args} {...modalProps} />,
    MobileDownload: (args) => <MobileDownloadDialog {...args} {...modalProps} />,
    Onboarding: (args) => <OnboardingDialog {...args} {...modalProps} />,
    OrderDetails: (args) => <OrderDetailsDialog {...args} {...modalProps} />,
    PredictionMarketIntro: (args) => <PredictionMarketIntroDialog {...args} {...modalProps} />,
    Preferences: (args) => <PreferencesDialog {...args} {...modalProps} />,
    RateLimit: (args) => <RateLimitDialog {...args} {...modalProps} />,
    ReclaimChildSubaccountFunds: (args) => (
      <ReclaimChildSubaccountFundsDialog {...args} {...modalProps} />
    ),
    Referral: (args) => <ReferralDialog {...args} {...modalProps} />,
    RestrictedGeo: (args) => <RestrictedGeoDialog {...args} {...modalProps} />,
    RestrictedWallet: (args) => <RestrictedWalletDialog {...args} {...modalProps} />,
    SetMarketLeverage: (args) => <SetMarketLeverageDialog {...args} {...modalProps} />,
    SetupPasskey: (args) => <SetupPasskeyDialog {...args} {...modalProps} />,
    ShareAffiliate: (args) => <ShareAffiliateDialog {...args} {...modalProps} />,
    SharePNLAnalytics: (args) => <SharePNLAnalyticsDialog {...args} {...modalProps} />,
    SimpleUiTrade: (args) => <SimpleUiTradeDialog {...args} {...modalProps} />,
    Stake: (args) => <StakeDialog {...args} {...modalProps} />,
    StakingReward: (args) => <StakingRewardDialog {...args} {...modalProps} />,
    Trade: (args) => <TradeDialog {...args} {...modalProps} />,
    Triggers: (args) => <TriggersDialog {...args} {...modalProps} />,
    Transfer: (args) => <TransferDialog {...args} {...modalProps} />,
    TradingKeys: (args) => <TradingKeysDialog {...args} {...modalProps} />,
    TransferStatus: (args) => <TransferStatusDialog {...args} {...modalProps} />,
    Unstake: (args) => <UnstakeDialog {...args} {...modalProps} />,
    VaultDepositWithdraw: (args) => <VaultDepositWithdrawDialog {...args} {...modalProps} />,
    Withdraw2: (args) => <CollateralWithdrawDialog {...args} {...modalProps} />,
    WithdrawalGated: (args) => <WithdrawalGateDialog {...args} {...modalProps} />,
    WithdrawFromSubaccount: (args) => <WithdrawFromSubaccountDialog {...args} {...modalProps} />,
    Criteria: (args) => <CriteriaDialog {...args} {...modalProps} />,
  });
});

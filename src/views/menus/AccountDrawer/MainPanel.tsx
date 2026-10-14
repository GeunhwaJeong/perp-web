import { BonsaiCore } from '@/bonsai/ontology';
import { Link } from 'react-router-dom';
import styled from 'styled-components';

import { AppRoute, HistoryRoute, PortfolioRoute } from '@/constants/routes';

import { colors, icons, motion, spacing, type } from '@/views/dialogs/AccountDialog/tokens';

import { useAppSelector } from '@/state/appTypes';

import { orEmptyObj } from '@/lib/typeUtils';
import { truncateAddress } from '@/lib/wallet';

import { ActivityRow } from './ActivityRow';
import { Avatar } from './Avatar';
import { BackupCard } from './BackupCard';
import { BalanceNumber } from './BalanceNumber';
import {
  ArrowDownCircleIcon,
  ArrowUpCircleIcon,
  CheckCircleIcon,
  CopyIcon,
  GearIcon,
  PowerIcon,
  QrIcon,
  SigmaBadgeIcon,
} from './icons';
import { ActionTile, RoundIconButton, ViewAllButton } from './primitives';
import { useRecentActivity } from './useRecentActivity';

/**
 * `AuthenticatedHeader` + `MiniPortfolio`: padding 16/20; avatar row with the settings and
 * disconnect buttons; name and address; the portfolio value in heading2 with 16 below;
 * two action tiles 8 apart; the backup card; "View portfolio"; three activity rows under a
 * subheading2 title; "View all activity".
 */
const $Panel = styled.div`
  display: flex;
  flex-direction: column;
  padding: ${spacing.s20} ${spacing.s16};
`;

const $TopRow = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: ${spacing.s8};
`;

const $Buttons = styled.div`
  display: flex;
  gap: ${spacing.s4};

  svg {
    width: ${icons.i24}px;
    height: ${icons.i24}px;
  }
`;

const $Identity = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${spacing.s4};
`;

const $Name = styled.div`
  display: flex;
  align-items: center;
  gap: ${spacing.s2};
  ${type.subheading1}
  color: ${colors.neutral1};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  > svg {
    flex: none;
    margin-top: ${spacing.s2};
  }
`;

const $Address = styled.button`
  display: inline-flex;
  align-items: center;
  gap: ${spacing.s4};
  width: max-content;
  background: transparent;
  ${type.body3}
  color: ${colors.neutral3};
  font-variant-numeric: tabular-nums;
  transition: opacity ${motion.fast};

  &:hover {
    opacity: 0.8;
  }
  > svg {
    width: ${icons.i12}px;
    height: ${icons.i12}px;
  }
  > svg.copied {
    color: ${colors.success};
  }
`;

const $Status = styled.div`
  ${type.body4}
  color: ${colors.neutral2};
`;

const $Body = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  margin-top: ${spacing.s16};
`;

const $Balance = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${spacing.s4};
  margin-bottom: ${spacing.s16};
`;

const $Wallet = styled.div`
  ${type.body3}
  color: ${colors.neutral2};
  font-variant-numeric: tabular-nums;
`;

const $Tiles = styled.div`
  display: flex;
  gap: ${spacing.s8};
`;

const $Mini = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${spacing.s4};
  margin-top: ${spacing.s12};
`;

const $Recent = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${spacing.s8};
  padding-top: ${spacing.s16};

  > h4 {
    margin: 0;
    padding: ${spacing.s8};
    ${type.subheading2}
    color: ${colors.neutral1};
  }
`;

const $Empty = styled.div`
  padding: ${spacing.s8};
  ${type.body3}
  color: ${colors.neutral2};
`;

const $Link = styled(Link)`
  text-decoration: none;
  color: inherit;
`;

const $Divider = styled.hr`
  margin: ${spacing.s20} 0 0;
  border: 0;
  border-top: 1px solid ${colors.surface3};
`;

const $Welcome = styled.div`
  display: flex;
  flex-direction: column;
  padding-top: ${spacing.s20};

  > strong {
    ${type.subheading2}
    font-weight: inherit;
    color: ${colors.neutral1};
  }
  > span {
    ${type.body3}
    color: ${colors.neutral2};
  }
`;

const STATUS_LABEL = {
  pending: 'Name saved on this device only',
  claimed: 'Name issued, not yet linked to this address',
  linked: 'Name linked on chain',
} as const;

export type MainPanelProps = {
  address: string;
  name?: string;
  nameStatus?: keyof typeof STATUS_LABEL;
  isSigmaAccount: boolean;
  needsBackup: boolean;
  walletHaneul: number;
  walletCollateral: number;
  collateralLabel: string;
  onCopyAddress: () => void;
  /** True for a moment after a copy; the copy glyph becomes a green check, as Uniswap's. */
  addressCopied: boolean;
  onSettings: () => void;
  onDisconnect: () => void;
  onDeposit: () => void;
  onWithdraw: () => void;
  onReceive: () => void;
  onBackup: () => void;
  onClose: () => void;
};

export const MainPanel = ({
  address,
  name,
  nameStatus,
  isSigmaAccount,
  needsBackup,
  walletHaneul,
  walletCollateral,
  collateralLabel,
  onCopyAddress,
  addressCopied,
  onSettings,
  onDisconnect,
  onDeposit,
  onWithdraw,
  onReceive,
  onBackup,
  onClose,
}: MainPanelProps) => {
  const summary = orEmptyObj(useAppSelector(BonsaiCore.account.parentSubaccountSummary.data));
  const loading = useAppSelector(BonsaiCore.account.parentSubaccountSummary.loading) === 'pending';
  const equity = summary.equity?.toNumber() ?? 0;
  const activity = useRecentActivity(3);
  // Uniswap swaps the tiles for a welcome block while the wallet is empty; here the
  // withdraw tile makes no sense yet, so Receive (the address) takes its place.
  const isEmpty =
    equity === 0 && walletHaneul === 0 && walletCollateral === 0 && activity.length === 0;

  return (
    <$Panel>
      <$TopRow>
        <Avatar address={address} size={48} badge={isSigmaAccount} />
        <$Buttons>
          <RoundIconButton type="button" aria-label="Settings" onClick={onSettings}>
            <GearIcon />
          </RoundIconButton>
          <RoundIconButton type="button" aria-label="Disconnect" onClick={onDisconnect}>
            <PowerIcon />
          </RoundIconButton>
        </$Buttons>
      </$TopRow>

      <$Identity>
        <$Name>
          {name ? `${name}.haneul` : truncateAddress(address)}
          {name && <SigmaBadgeIcon size={18} />}
        </$Name>
        <$Address type="button" onClick={onCopyAddress}>
          {truncateAddress(address)}
          {addressCopied ? <CheckCircleIcon className="copied" /> : <CopyIcon />}
        </$Address>
        {name && nameStatus && <$Status>{STATUS_LABEL[nameStatus]}</$Status>}
      </$Identity>

      <$Body>
        <$Balance>
          <BalanceNumber value={equity} loading={loading} />
          <$Wallet>
            {walletHaneul.toLocaleString('en-US', { maximumFractionDigits: 4 })} HANEUL ·{' '}
            {walletCollateral.toLocaleString('en-US', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}{' '}
            {collateralLabel} in wallet
          </$Wallet>
        </$Balance>

        <$Tiles>
          <ActionTile type="button" onClick={onDeposit}>
            <ArrowDownCircleIcon />
            Deposit
          </ActionTile>
          {isEmpty ? (
            <ActionTile type="button" onClick={onReceive}>
              <QrIcon />
              Receive
            </ActionTile>
          ) : (
            <ActionTile type="button" onClick={onWithdraw}>
              <ArrowUpCircleIcon />
              Withdraw
            </ActionTile>
          )}
        </$Tiles>

        {needsBackup && <BackupCard onClick={onBackup} />}

        <$Mini>
          <$Link to={`${AppRoute.Portfolio}/${PortfolioRoute.Overview}`} onClick={onClose}>
            <ViewAllButton fullWidth>View portfolio</ViewAllButton>
          </$Link>

          {isEmpty ? (
            <>
              <$Divider />
              <$Welcome>
                <strong>Welcome to Sigma</strong>
                <span>
                  Send HANEUL or {collateralLabel} to your address, deposit it, and your first trade
                  is a tap away.
                </span>
              </$Welcome>
            </>
          ) : (
            <>
              <$Recent>
                <h4>Recent activity</h4>
                <div>
                  {activity.length === 0 && <$Empty>No activity yet.</$Empty>}
                  {activity.map((item) => (
                    <ActivityRow key={item.id} item={item} />
                  ))}
                </div>
              </$Recent>
              <$Link
                to={`${AppRoute.Portfolio}/${PortfolioRoute.History}/${HistoryRoute.Transfers}`}
                onClick={onClose}
              >
                <ViewAllButton>View all activity</ViewAllButton>
              </$Link>
            </>
          )}
        </$Mini>
      </$Body>
    </$Panel>
  );
};

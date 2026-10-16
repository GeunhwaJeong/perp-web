import { useMemo } from 'react';

import { BonsaiCore } from '@/bonsai/ontology';

import { IndexerTransferType } from '@/types/indexer/indexerApiGen';

import { useTokenConfigs } from '@/hooks/useTokenConfigs';

import { useAppSelector } from '@/state/appTypes';

export type ActivityItem = {
  id: string;
  /** What happened, in Uniswap's past tense: "Deposited", "Bought". */
  title: string;
  /** The amounts, e.g. "100.00 TUSD" or "0.010 BTC at $83,400". */
  caption: string;
  at: number;
  kind: 'deposit' | 'withdrawal' | 'transfer' | 'buy' | 'sell';
  symbol: string;
};

const amount = (size: string | undefined, digits: number) =>
  Number(size ?? 0).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

/**
 * The last few things the account did, transfers and fills together, newest first. The
 * same records the History page lists; this is `MiniPortfolio`'s three-row preview.
 */
export const useRecentActivity = (limit = 3): ActivityItem[] => {
  const transfers = useAppSelector(BonsaiCore.account.transfers.data);
  const fills = useAppSelector(BonsaiCore.account.fills.data);
  // The indexer names the collateral USDC, as dYdX's did; the drawer calls it what the wallet
  // holds, as its balance line does.
  const { usdcLabel } = useTokenConfigs();

  return useMemo(() => {
    const fromTransfers: ActivityItem[] = transfers.map((t) => {
      const kind =
        t.type === IndexerTransferType.DEPOSIT
          ? 'deposit'
          : t.type === IndexerTransferType.WITHDRAWAL
            ? 'withdrawal'
            : 'transfer';
      return {
        id: `transfer-${t.id}`,
        title:
          kind === 'deposit' ? 'Deposited' : kind === 'withdrawal' ? 'Withdrew' : 'Transferred',
        caption: `${amount(t.size, 2)} ${usdcLabel}`,
        at: Date.parse(t.createdAt),
        kind,
        symbol: usdcLabel,
      };
    });
    const fromFills: ActivityItem[] = fills
      .filter((f) => f.id && f.market)
      .map((f) => {
        const base = f.market!.split('-')[0] ?? f.market!;
        const isBuy = f.side === 'BUY';
        return {
          id: `fill-${f.id}`,
          title: isBuy ? 'Bought' : 'Sold',
          caption: `${amount(f.size, 3)} ${base} at ${usd(f.price)}`,
          at: f.createdAt ? Date.parse(f.createdAt) : 0,
          kind: isBuy ? 'buy' : 'sell',
          symbol: base,
        };
      });
    return [...fromTransfers, ...fromFills].sort((a, b) => b.at - a.at).slice(0, limit);
  }, [transfers, fills, limit, usdcLabel]);
};

const usd = (price: string | undefined) =>
  `$${Number(price ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

import { useCallback, useMemo, useState } from 'react';

import { accountTransactionManager } from '@/bonsai/AccountTransactionSupervisor';
import { isOperationFailure } from '@/bonsai/lib/operationResult';
import { BonsaiCore } from '@/bonsai/ontology';
import BigNumber from 'bignumber.js';
import styled from 'styled-components';

import { ButtonShape, ButtonStyle } from '@/constants/buttons';
import { STRING_KEYS } from '@/constants/localization';
import { TOKEN_DECIMALS } from '@/constants/numbers';
import type { IndexerOrderTicket, IndexerOrderTicketType } from '@/types/indexer/indexerManual';

import { useStringGetter } from '@/hooks/useStringGetter';

import { defaultTableMixins } from '@/styles/tableMixins';

import { Icon, IconName } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { Output, OutputType } from '@/components/Output';
import { type ColumnDef, Table } from '@/components/Table';
import { ActionsTableCell } from '@/components/Table/ActionsTableCell';
import { TableCell } from '@/components/Table/TableCell';
import { PageSize } from '@/components/Table/TablePaginationRow';
import { Tag } from '@/components/Tag';
import { WithTooltip } from '@/components/WithTooltip';

import { useAppSelector } from '@/state/appTypes';
import {
  normalizeCommitment,
  type OrderTicketRow as Row,
  type StoredTicketDetails,
} from '@/state/ticketDetails';

import { getDisplayableTickerFromMarket } from '@/lib/assetUtils';
import { MustNumber } from '@/lib/numbers';

type ElementProps = {
  /** Which tickets to list. */
  ticketType: IndexerOrderTicketType;
  /** Only tickets on this market; a stop ticket names none until it executes, so it always shows. */
  currentMarket?: string;
  initialPageSize?: PageSize;
};

const STATUS_LABEL: Record<IndexerOrderTicket['status'], string> = {
  OPEN: 'Open',
  EXECUTED: 'Executed',
  FINALIZED: 'Finalized',
  CANCELED: 'Canceled',
  DELETED: 'Deleted',
};

// The engine's stop order types: 0 closes with a stop loss / take profit on the position, 1 and
// up place a standalone order (see `perpetuals_orders::stop_orders`).
const stopTypeLabel = (stopOrderType: string | null | undefined) =>
  stopOrderType == null ? '—' : stopOrderType === '0' ? 'SL / TP' : 'Standalone';

// Tickets hold a thousandth of a HANEUL or so: four decimals, trailing zeros dropped.
const gasLabel = (gas: string) => `${new BigNumber(MustNumber(gas).toFixed(4)).toFixed()} HANEUL`;

const usd = (ifixed: unknown) =>
  `$${new BigNumber(String(ifixed)).div('1e18').toNumber().toLocaleString()}`;

const baseSize = (units: unknown) => new BigNumber(String(units)).div('1e9').toFixed();

/**
 * What a ticket does, from the details this browser kept when it made the ticket; the chain
 * holds only their commitment.
 */
const describeTicket = (entry: StoredTicketDetails | undefined) => {
  if (entry == null) return undefined;
  const d = entry.details;
  if (entry.kind === 'stopLossTakeProfit') {
    return [
      d.stopLossPrice != null ? `SL ${usd(d.stopLossPrice)}` : undefined,
      d.takeProfitPrice != null ? `TP ${usd(d.takeProfitPrice)}` : undefined,
    ]
      .filter((part) => part != null)
      .join(' · ');
  }
  if (entry.kind === 'standaloneStop') {
    const side = d.side === true ? 'Sell' : 'Buy';
    const when = d.triggerAtOrAbove === true ? '≥' : '≤';
    const limit =
      d.isLimitOrder === true ? ` @ ${usd(BigInt(String(d.price)) * 1_000_000_000n)}` : '';
    return `${side} ${baseSize(d.size)} when ${when} ${usd(d.stopIndexPrice)}${limit}`;
  }
  return `${d.side === true ? 'Sell' : 'Buy'} ${baseSize(d.size)}`;
};

const TicketActionsCell = ({
  ticket,
  marketId,
}: {
  ticket: IndexerOrderTicket;
  marketId: string | undefined;
}) => {
  const stringGetter = useStringGetter();
  const [isCanceling, setIsCanceling] = useState(false);
  const onCancel = useCallback(async () => {
    setIsCanceling(true);
    const result = await accountTransactionManager.cancelOrderTicket({
      ticketId: ticket.id,
      type: ticket.type,
      marketId,
    });
    if (isOperationFailure(result)) setIsCanceling(false);
  }, [ticket.id, ticket.type, marketId]);
  if (ticket.status !== 'OPEN') return <ActionsTableCell>{null}</ActionsTableCell>;
  return (
    <ActionsTableCell>
      <WithTooltip
        side="left"
        sideOffset={0}
        tw="[--tooltip-backgroundColor:--color-layer-5]"
        tooltipString={stringGetter({ key: STRING_KEYS.CANCEL_ORDER })}
      >
        <$CancelButton
          iconName={IconName.Close}
          iconSize="0.875em"
          shape={ButtonShape.Square}
          buttonStyle={ButtonStyle.WithoutBackground}
          onClick={onCancel}
          state={{ isLoading: isCanceling, isDisabled: isCanceling }}
        />
      </WithTooltip>
    </ActionsTableCell>
  );
};

/**
 * The account's stop or TWAP tickets, read from the indexer. The chain holds a ticket's order
 * details only as a commitment; the tickets this browser made also show their market, trigger
 * and size from the details it kept. Open tickets can be canceled, which returns their gas.
 */
export const OrderTicketsTable = ({ ticketType, currentMarket, initialPageSize }: ElementProps) => {
  const stringGetter = useStringGetter();
  const tickets = useAppSelector(BonsaiCore.account.orderTickets.data);
  const byCommitment = useAppSelector((s) => s.ticketDetails.byCommitment);

  const rows = useMemo(
    (): Row[] =>
      tickets
        .filter((ticket) => ticket.type === ticketType)
        .map((ticket) => {
          const stored = byCommitment[normalizeCommitment(ticket.encryptedDetails)];
          return { ...ticket, stored, marketId: ticket.ticker ?? stored?.marketId };
        })
        .filter(
          (row) => currentMarket == null || row.marketId == null || row.marketId === currentMarket
        ),
    [tickets, byCommitment, ticketType, currentMarket]
  );

  const columns = useMemo(
    (): ColumnDef<Row>[] => [
      {
        columnKey: 'createdAt',
        getCellValue: (row) => row.createdAt,
        label: stringGetter({ key: STRING_KEYS.TIME }),
        renderCell: ({ createdAt }) => (
          <TableCell>
            <Output type={OutputType.DateTime} value={new Date(createdAt).getTime()} />
          </TableCell>
        ),
      },
      {
        columnKey: 'market',
        getCellValue: (row) => row.marketId ?? '',
        label: stringGetter({ key: STRING_KEYS.MARKET }),
        renderCell: ({ marketId }) => (
          <TableCell>{marketId != null ? getDisplayableTickerFromMarket(marketId) : '—'}</TableCell>
        ),
      },
      {
        columnKey: 'order',
        getCellValue: (row) => describeTicket(row.stored) ?? '',
        label: 'Order',
        renderCell: ({ stored }) => <TableCell>{describeTicket(stored) ?? '—'}</TableCell>,
      },
      {
        columnKey: 'status',
        getCellValue: (row) => row.status,
        label: stringGetter({ key: STRING_KEYS.STATUS }),
        renderCell: ({ status }) => (
          <TableCell>
            <Tag>{STATUS_LABEL[status]}</Tag>
          </TableCell>
        ),
      },
      ticketType === 'TWAP'
        ? {
            columnKey: 'progress',
            getCellValue: (row) => MustNumber(row.twapProgress?.processedAmount ?? 0),
            label: 'Filled / Scheduled',
            renderCell: ({ twapProgress }) => (
              <TableCell>
                {twapProgress == null ? (
                  '—'
                ) : (
                  <>
                    <Output
                      type={OutputType.Number}
                      value={twapProgress.processedAmount}
                      fractionDigits={TOKEN_DECIMALS}
                    />
                    <span tw="text-color-text-0"> / </span>
                    <Output
                      type={OutputType.Number}
                      value={twapProgress.scheduledAmount}
                      fractionDigits={TOKEN_DECIMALS}
                    />
                  </>
                )}
              </TableCell>
            ),
          }
        : {
            columnKey: 'stopType',
            getCellValue: (row) => row.stopOrderType ?? '',
            label: stringGetter({ key: STRING_KEYS.TYPE }),
            renderCell: ({ stopOrderType }) => (
              <TableCell>{stopTypeLabel(stopOrderType)}</TableCell>
            ),
          },
      ...(ticketType === 'TWAP'
        ? [
            {
              columnKey: 'twapSize',
              getCellValue: (row: Row) => MustNumber(String(row.stored?.details.size ?? 0)),
              label: stringGetter({ key: STRING_KEYS.SIZE }),
              renderCell: ({ stored }: Row) => (
                <TableCell>
                  {stored?.details.size != null ? (
                    <Output
                      type={OutputType.Number}
                      value={baseSize(stored.details.size)}
                      fractionDigits={TOKEN_DECIMALS}
                    />
                  ) : (
                    '—'
                  )}
                </TableCell>
              ),
            },
          ]
        : []),
      {
        columnKey: 'executors',
        getCellValue: (row) => row.executors.length,
        label: 'Executors',
        renderCell: ({ executors }) => <TableCell>{executors.length}</TableCell>,
      },
      {
        columnKey: 'gas',
        getCellValue: (row) => MustNumber(row.gas),
        label: 'Gas',
        renderCell: ({ gas }) => <TableCell>{gasLabel(gas)}</TableCell>,
      },
      {
        columnKey: 'updatedAt',
        getCellValue: (row) => row.updatedAt,
        label: stringGetter({ key: STRING_KEYS.UPDATED }),
        renderCell: ({ updatedAt }) => (
          <TableCell>
            <Output type={OutputType.RelativeTime} value={new Date(updatedAt).getTime()} />
          </TableCell>
        ),
      },
      {
        columnKey: 'actions',
        label: stringGetter({ key: STRING_KEYS.ACTIONS }),
        allowsSorting: false,
        renderCell: (row: Row) => <TicketActionsCell ticket={row} marketId={row.marketId} />,
      },
    ],
    [stringGetter, ticketType]
  );

  return (
    <$Table
      key={ticketType}
      label={ticketType === 'TWAP' ? 'TWAP Orders' : 'Stop Orders'}
      tableId={`order-tickets-${ticketType}`}
      data={rows}
      getRowKey={(row: Row) => row.id}
      columns={columns}
      defaultSortDescriptor={{ column: 'createdAt', direction: 'descending' }}
      slotEmpty={
        <>
          <Icon iconName={IconName.OrderPending} tw="text-[3em]" />
          <h4>{ticketType === 'TWAP' ? 'No TWAP orders' : 'No stop orders'}</h4>
        </>
      }
      initialPageSize={initialPageSize}
      withInnerBorders
    />
  );
};

const $Table = styled(Table)`
  ${defaultTableMixins}
` as typeof Table;

const $CancelButton = styled(IconButton)`
  --button-hover-textColor: var(--color-red);
  --button-textColor: var(--color-text-0);
  min-width: var(--button-width);
`;

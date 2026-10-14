import { useMemo } from 'react';

import { BonsaiCore } from '@/bonsai/ontology';
import styled from 'styled-components';

import { STRING_KEYS } from '@/constants/localization';
import { TOKEN_DECIMALS } from '@/constants/numbers';
import type { IndexerOrderTicket, IndexerOrderTicketType } from '@/types/indexer/indexerManual';

import { useStringGetter } from '@/hooks/useStringGetter';

import { defaultTableMixins } from '@/styles/tableMixins';

import { Icon, IconName } from '@/components/Icon';
import { Output, OutputType } from '@/components/Output';
import { type ColumnDef, Table } from '@/components/Table';
import { TableCell } from '@/components/Table/TableCell';
import { PageSize } from '@/components/Table/TablePaginationRow';
import { Tag } from '@/components/Tag';

import { useAppSelector } from '@/state/appTypes';

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

const gasLabel = (gas: string) => `${MustNumber(gas).toFixed(2)} HANEUL`;

/**
 * The account's stop or TWAP tickets, read from the indexer. The engine holds a ticket's order
 * details encrypted, so the table shows what the chain knows: state, market, progress and gas.
 * Placing and canceling tickets wait for the keeper that executes them.
 */
export const OrderTicketsTable = ({ ticketType, currentMarket, initialPageSize }: ElementProps) => {
  const stringGetter = useStringGetter();
  const tickets = useAppSelector(BonsaiCore.account.orderTickets.data);

  const rows = useMemo(
    () =>
      tickets.filter(
        (ticket) =>
          ticket.type === ticketType &&
          (currentMarket == null || ticket.ticker == null || ticket.ticker === currentMarket)
      ),
    [tickets, ticketType, currentMarket]
  );

  const columns = useMemo(
    (): ColumnDef<IndexerOrderTicket>[] => [
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
        getCellValue: (row) => row.ticker ?? '',
        label: stringGetter({ key: STRING_KEYS.MARKET }),
        renderCell: ({ ticker }) => (
          <TableCell>{ticker != null ? getDisplayableTickerFromMarket(ticker) : '—'}</TableCell>
        ),
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
    ],
    [stringGetter, ticketType]
  );

  return (
    <$Table
      key={ticketType}
      label={ticketType === 'TWAP' ? 'TWAP Orders' : 'Stop Orders'}
      tableId={`order-tickets-${ticketType}`}
      data={rows}
      getRowKey={(row: IndexerOrderTicket) => row.id}
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

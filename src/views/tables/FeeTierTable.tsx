import { useMemo } from 'react';

import type { PerpFeeSchedule } from '@/haneul/perp';
import styled from 'styled-components';
import tw from 'twin.macro';

import { STRING_KEYS } from '@/constants/localization';

import { useFeeTiers } from '@/hooks/useFeeTiers';
import { useStringGetter } from '@/hooks/useStringGetter';

import breakpoints from '@/styles/breakpoints';
import { layoutMixins } from '@/styles/layoutMixins';

import { Output, OutputType } from '@/components/Output';
import { ColumnDef, Table } from '@/components/Table';
import { Tag, TagSize } from '@/components/Tag';
import { FeeRate } from '@/views/FeeRate';

type VolumeTierRow = PerpFeeSchedule['volumeTiers'][number] & { tier: number };

export const FeeTierTable = () => {
  const stringGetter = useStringGetter();
  const { schedule, account, rates } = useFeeTiers();
  const rows: VolumeTierRow[] = useMemo(
    () => schedule?.volumeTiers.map((t, i) => ({ ...t, tier: i + 1 })) ?? [],
    [schedule]
  );
  // A visitor's rates are the first tier's; only a connected account has a row of its own.
  const yourTier = account != null && rates != null ? rates.tierIndex + 1 : undefined;

  const columns: ColumnDef<VolumeTierRow>[] = [
    {
      columnKey: 'tier',
      label: stringGetter({ key: STRING_KEYS.TIER }),
      allowsSorting: false,
      renderCell: ({ tier }) => (
        <$TextRow tw="gap-0.5">
          <Output type={OutputType.Text} value={tier} tw="text-color-text-0" />
          {tier === yourTier && (
            <Tag size={TagSize.Medium} tw="text-color-text-1">
              {stringGetter({ key: STRING_KEYS.YOU })}
            </Tag>
          )}
        </$TextRow>
      ),
    },
    {
      columnKey: 'volume',
      label: `${stringGetter({ key: STRING_KEYS.VOLUME })}${schedule != null ? ` (${schedule.windowEpochs}d)` : ''}`,
      allowsSorting: false,
      renderCell: ({ minVolume }) => (
        <div tw="flex flex-row justify-end gap-0.25">
          <span>≥ </span>
          <$HighlightOutput type={OutputType.CompactFiat} value={minVolume} />
        </div>
      ),
    },
    {
      columnKey: 'maker',
      label: stringGetter({ key: STRING_KEYS.MAKER }),
      allowsSorting: false,
      renderCell: ({ tier, makerFee }) =>
        tier === yourTier ? (
          <FeeRate rate={rates?.maker} before={makerFee} />
        ) : (
          <$HighlightOutput type={OutputType.SmallPercent} value={makerFee} />
        ),
    },
    {
      columnKey: 'taker',
      label: stringGetter({ key: STRING_KEYS.TAKER }),
      allowsSorting: false,
      renderCell: ({ tier, takerFee }) =>
        tier === yourTier ? (
          <FeeRate rate={rates?.taker} before={takerFee} />
        ) : (
          <$HighlightOutput type={OutputType.SmallPercent} value={takerFee} />
        ),
    },
  ];

  return (
    <$FeeTable
      label={stringGetter({ key: STRING_KEYS.FEE_TIERS })}
      data={rows}
      tableId="fees"
      getRowKey={(row: VolumeTierRow) => row.tier}
      getRowAttributes={(row: VolumeTierRow) => ({
        'data-yours': row.tier === yourTier,
      })}
      columns={columns}
      selectionBehavior="replace"
      paginationBehavior="showAll"
      withOuterBorder
      withInnerBorders
    />
  );
};

const $FeeTable = styled(Table)`
  --tableCell-padding: 0.5rem 1.5rem;
  --bordered-content-border-radius: 0.625rem;
  --table-cell-align: end;

  font: var(--font-base-book);

  @media ${breakpoints.mobile} {
    --tableCell-padding: 1rem 1.25rem;
    font: var(--font-small-book);
  }

  tbody tr {
    &[data-yours='true'] {
      background-color: var(--color-layer-3);

      td:first-child {
        border-left: 0.125rem solid var(--color-accent);
      }
    }
  }

  @media ${breakpoints.notTablet} {
    --tableStickyRow-backgroundColor: var(--color-layer-2);
  }
` as typeof Table;

const $TextRow = styled.div`
  ${layoutMixins.inlineRow}
  gap: 0.25rem;
`;

const $HighlightOutput = tw(Output)`text-color-text-1`;

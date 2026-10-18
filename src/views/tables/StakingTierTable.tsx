import { useMemo } from 'react';

import type { PerpFeeSchedule } from '@/haneul/perp';
import styled, { css } from 'styled-components';

import { STRING_KEYS } from '@/constants/localization';

import { useFeeTiers } from '@/hooks/useFeeTiers';
import { useStringGetter } from '@/hooks/useStringGetter';
import { useTokenConfigs } from '@/hooks/useTokenConfigs';

import breakpoints from '@/styles/breakpoints';
import { layoutMixins } from '@/styles/layoutMixins';

import { Output, OutputType } from '@/components/Output';
import { ColumnDef, Table } from '@/components/Table';
import { Tag, TagSize } from '@/components/Tag';
import { FeeRate } from '@/views/FeeRate';

type StakingTierRow = PerpFeeSchedule['stakingTiers'][number] & { level: number };

/**
 * The staking levels and what each makes of the account's volume tier rates (the first tier's
 * for a visitor): the discount applies to the taker and the maker rate alike.
 */
export const StakingTierTable = () => {
  const stringGetter = useStringGetter();
  const { chainTokenLabel } = useTokenConfigs();
  const { schedule, account, rates } = useFeeTiers();
  const rows: StakingTierRow[] = useMemo(
    () => schedule?.stakingTiers.map((t, i) => ({ ...t, level: i + 1 })) ?? [],
    [schedule]
  );
  const yourLevel = account != null && rates?.level ? rates.level : undefined;

  const columns: ColumnDef<StakingTierRow>[] = [
    {
      columnKey: 'level',
      label: stringGetter({ key: STRING_KEYS.STAKING_TIER }),
      allowsSorting: false,
      renderCell: ({ level }) => (
        <$TextRow tw="gap-0.5">
          <$LevelLabel isHighlighted={level === yourLevel}>
            {stringGetter({ key: STRING_KEYS.LEVEL_N, params: { LEVEL: level } })}
          </$LevelLabel>
          {level === yourLevel && (
            <Tag size={TagSize.Medium} tw="text-color-accent">
              {stringGetter({ key: STRING_KEYS.YOU })}
            </Tag>
          )}
        </$TextRow>
      ),
    },
    {
      columnKey: 'stake',
      label: stringGetter({ key: STRING_KEYS.STAKE_REQUIREMENTS }),
      allowsSorting: false,
      renderCell: ({ level, minStake }) => (
        <div tw="flex flex-row justify-end gap-0.25">
          <span>≥ </span>
          <$HighlightOutput
            tw="gap-0.25"
            type={OutputType.Asset}
            isHighlighted={level === yourLevel}
            value={minStake}
            slotRight={<span>{chainTokenLabel}</span>}
            fractionDigits={0}
          />
        </div>
      ),
    },
    {
      columnKey: 'discount',
      label: stringGetter({ key: STRING_KEYS.DISCOUNT }),
      allowsSorting: false,
      renderCell: ({ level, discount }) => (
        <$HighlightOutput
          type={OutputType.Percent}
          isHighlighted={level === yourLevel}
          value={discount}
        />
      ),
    },
    {
      columnKey: 'maker',
      label: stringGetter({ key: STRING_KEYS.MAKER }),
      allowsSorting: false,
      renderCell: ({ discount }) => (
        <FeeRate
          rate={rates != null ? rates.tierMaker * (1 - discount) : undefined}
          before={rates?.tierMaker}
        />
      ),
    },
    {
      columnKey: 'taker',
      label: stringGetter({ key: STRING_KEYS.TAKER }),
      allowsSorting: false,
      renderCell: ({ discount }) => (
        <FeeRate
          rate={rates != null ? rates.tierTaker * (1 - discount) : undefined}
          before={rates?.tierTaker}
        />
      ),
    },
  ];

  return (
    <$StakingTierTable
      label={stringGetter({ key: STRING_KEYS.STAKING_TIERS })}
      data={rows}
      tableId="staking-tiers"
      getRowKey={(row: StakingTierRow) => row.level}
      getRowAttributes={(row: StakingTierRow) => ({
        'data-yours': row.level === yourLevel,
      })}
      columns={columns}
      selectionBehavior="replace"
      paginationBehavior="showAll"
      withOuterBorder
      withInnerBorders
    />
  );
};

const $StakingTierTable = styled(Table)`
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

const $HighlightOutput = styled(Output)<{ isHighlighted?: boolean }>`
  color: ${({ isHighlighted }) => (isHighlighted ? 'var(--color-accent)' : 'var(--color-text-1)')};
`;

const $LevelLabel = styled.span<{ isHighlighted: boolean }>`
  ${({ isHighlighted }) => css`
    color: ${isHighlighted ? 'var(--color-accent)' : 'var(--color-text-0)'};
  `}
`;

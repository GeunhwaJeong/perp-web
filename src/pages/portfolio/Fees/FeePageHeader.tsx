import { BonsaiCore } from '@/bonsai/ontology';
import styled from 'styled-components';

import { STRING_KEYS } from '@/constants/localization';

import { useFeeTiers } from '@/hooks/useFeeTiers';
import { useLocaleSeparators } from '@/hooks/useLocaleSeparators';
import { useStringGetter } from '@/hooks/useStringGetter';
import { useTokenConfigs } from '@/hooks/useTokenConfigs';

import { layoutMixins } from '@/styles/layoutMixins';

import { Details } from '@/components/Details';
import { formatNumberOutput, Output, OutputType } from '@/components/Output';
import { FeeRate } from '@/views/FeeRate';

import { useAppSelector } from '@/state/appTypes';
import { getSelectedLocale } from '@/state/localizationSelectors';

import { AttemptNumber } from '@/lib/numbers';

export const FeePageHeader = () => {
  const stringGetter = useStringGetter();
  const { decimal: decimalSeparator, group: groupSeparator } = useLocaleSeparators();
  const selectedLocale = useAppSelector(getSelectedLocale);
  const { chainTokenLabel } = useTokenConfigs();
  const { schedule, account, rates } = useFeeTiers();
  const hasStakingTiers = (schedule?.stakingTiers.length ?? 0) > 0;
  // A deployment without fee tiers charges each market's own rates; the first market's stand in.
  const baseMarket = Object.values(useAppSelector(BonsaiCore.markets.markets.data) ?? {})[0];

  const stakingTierDetails = hasStakingTiers ? (
    <div tw="flex flex-row">
      <$FeesDetails
        layout="rowColumns"
        withSeparators
        tw="rounded-r-0 pr-0"
        items={[
          {
            key: 'staking-tier',
            label: stringGetter({ key: STRING_KEYS.STAKING_TIER }),
            value: rates?.level
              ? stringGetter({ key: STRING_KEYS.LEVEL_N, params: { LEVEL: rates.level } })
              : stringGetter({ key: STRING_KEYS.NONE }),
          },
          {
            key: 'staking-discount',
            label: stringGetter({ key: STRING_KEYS.STAKING_FEE_DISCOUNT }),
            value: stringGetter({
              key: STRING_KEYS.PERCENT_OFF_FEES,
              params: {
                PERCENT: formatNumberOutput(rates?.discount ?? 0, OutputType.Percent, {
                  decimalSeparator,
                  groupSeparator,
                  selectedLocale,
                }),
              },
            }),
          },
          {
            key: 'staked',
            label: `${stringGetter({ key: STRING_KEYS.STAKED })} ${chainTokenLabel}`,
            value: (
              <Output
                tw="row gap-0.25"
                type={OutputType.Asset}
                value={account?.stake}
                fractionDigits={2}
              />
            ),
          },
        ]}
      />
    </div>
  ) : null;

  return (
    <div tw="flex flex-row gap-1">
      <$FeesDetails
        layout="rowColumns"
        withSeparators
        items={[
          {
            key: 'maker',
            label: stringGetter({ key: STRING_KEYS.YOUR_MAKER_FEE }),
            value: (
              <FeeRate
                tw="text-color-accent"
                rate={rates?.maker ?? AttemptNumber(baseMarket?.makerFee)}
                before={rates?.tierMaker}
              />
            ),
          },
          {
            key: 'taker',
            label: stringGetter({ key: STRING_KEYS.YOUR_TAKER_FEE }),
            value: (
              <FeeRate
                tw="text-color-accent"
                rate={rates?.taker ?? AttemptNumber(baseMarket?.takerFee)}
                before={rates?.tierTaker}
              />
            ),
          },
        ]}
      />

      <$FeesDetails
        layout="rowColumns"
        withSeparators
        items={[
          {
            key: 'fee-tier',
            label: <$CardLabel>{stringGetter({ key: STRING_KEYS.FEE_TIER })} </$CardLabel>,
            value:
              rates != null ? (
                stringGetter({ key: STRING_KEYS.FEE_TIER_N, params: { TIER: rates.tierIndex + 1 } })
              ) : (
                <Output type={OutputType.Text} />
              ),
          },
          {
            key: 'volume',
            label: (
              <$CardLabel>
                <span>{stringGetter({ key: STRING_KEYS.TRAILING_VOLUME })}</span>
                {/* A Haneul epoch is a day. */}
                {schedule != null && <span>{`${schedule.windowEpochs}d`}</span>}
              </$CardLabel>
            ),
            value: <Output type={OutputType.Fiat} value={account?.volume} />,
          },
        ]}
      />

      {stakingTierDetails}
    </div>
  );
};

const $FeesDetails = styled(Details)`
  --separatorHeight-padding: 0rem;
  border-radius: 0.625rem;
  padding: 1rem 0.5rem;
  background-color: var(--color-layer-3);
  z-index: 0;

  > div {
    max-width: 16rem;
    align-content: normal;
  }

  dt {
    width: 100%;
    color: var(--color-text-0);
    font: var(--font-small-book);
  }

  dd {
    font: var(--font-base-bold);
  }
`;

const $TextRow = styled.div`
  ${layoutMixins.inlineRow}
  gap: 0.25rem;
`;

const $CardLabel = styled($TextRow)`
  height: 1.5rem;
`;

import { useState } from 'react';

import styled from 'styled-components';

import { ButtonSize } from '@/constants/buttons';

import { Icon, IconName } from '@/components/Icon';
import { Input, InputType } from '@/components/Input';
import { Output, OutputType } from '@/components/Output';
import { Popover } from '@/components/Popover';
import { ToggleGroup } from '@/components/ToggleGroup';

import { useAppDispatch, useAppSelector } from '@/state/appTypes';
import { setMarketOrderMaxSlippage } from '@/state/appUiConfigs';
import { getMarketOrderMaxSlippage } from '@/state/appUiConfigsSelectors';

import { MustBigNumber } from '@/lib/numbers';

const PRESETS = ['0.001', '0.005', '0.01', '0.03'] as const;
const MAX_SLIPPAGE = 0.5;

/**
 * The receipt's "Max slippage" value: the cap a market order carries as its worst price, with a
 * popover of presets and a free field. The value persists with the other UI preferences.
 */
export const MaxSlippageSetting = () => {
  const dispatch = useAppDispatch();
  const maxSlippage = useAppSelector(getMarketOrderMaxSlippage);
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState<string | undefined>(undefined);

  const commit = (fraction: number) => {
    if (!Number.isFinite(fraction) || fraction <= 0) return;
    dispatch(setMarketOrderMaxSlippage(Math.min(fraction, MAX_SLIPPAGE)));
  };

  const preset = PRESETS.find((p) => Number(p) === maxSlippage);

  return (
    <$Wrap>
      <Popover
        open={isOpen}
        onOpenChange={(open) => {
          setIsOpen(open);
          if (!open) setDraft(undefined);
        }}
        align="end"
        sideOffset={6}
        noBlur
        withPortal
        slotTrigger={
          <$Trigger>
            <Output type={OutputType.Percent} value={maxSlippage} fractionDigits={2} />
            <Icon iconName={IconName.Caret} size="0.625em" tw="text-color-text-0" />
          </$Trigger>
        }
      >
        <$Content>
          <ToggleGroup
            size={ButtonSize.XSmall}
            items={PRESETS.map((value) => ({
              value,
              label: `${MustBigNumber(value).times(100).toFixed(1).replace(/\.0$/, '')}%`,
            }))}
            value={preset ?? ''}
            ensureSelected={false}
            onValueChange={(value: string) => {
              if (value) commit(Number(value));
            }}
          />
          <$Custom>
            <Input
              type={InputType.Percent}
              placeholder="Custom"
              value={draft ?? (preset ? '' : MustBigNumber(maxSlippage).times(100).toString())}
              max={MAX_SLIPPAGE * 100}
              onInput={({ formattedValue }: { formattedValue: string }) => {
                setDraft(formattedValue);
                const fraction = MustBigNumber(formattedValue).div(100).toNumber();
                if (fraction > 0) commit(fraction);
              }}
            />
            <span tw="text-color-text-0">%</span>
          </$Custom>
        </$Content>
      </Popover>
    </$Wrap>
  );
};

/* The receipt value is text, so the popover trigger drops its button chrome. */
const $Wrap = styled.span`
  > button {
    --trigger-padding: 0;
    --trigger-backgroundColor: transparent;
    --trigger-open-backgroundColor: transparent;
    --trigger-open-textColor: var(--color-text-2);
    border: none;
  }
`;

const $Trigger = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  color: var(--color-text-2);
  cursor: pointer;
`;

const $Content = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.625rem;
  width: 15rem;
  font: var(--font-mini-book);
  background-color: var(--color-layer-3);
  border: 1px solid var(--color-border);
  border-radius: 0.5rem;
`;

const $Custom = styled.label`
  --input-height: 2rem;
  --input-backgroundColor: var(--color-layer-4);
  --input-radius: 0.375rem;

  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding-right: 0.5rem;
  background-color: var(--input-backgroundColor);
  border-radius: var(--input-radius);
`;

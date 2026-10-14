import { BonsaiHelpers } from '@/bonsai/ontology';
import styled from 'styled-components';

import { ButtonAction, ButtonSize, ButtonStyle } from '@/constants/buttons';
import { DialogTypes } from '@/constants/dialogs';
import { STRING_KEYS } from '@/constants/localization';

import { useStringGetter } from '@/hooks/useStringGetter';

import breakpoints from '@/styles/breakpoints';

import { Button } from '@/components/Button';
import { Icon, IconName } from '@/components/Icon';
import { Output, OutputType, ShowSign } from '@/components/Output';
import { WithTooltip } from '@/components/WithTooltip';

import { useAppDispatch, useAppSelector } from '@/state/appTypes';
import { openDialog } from '@/state/dialogs';

/**
 * The margin mode and leverage row of the order form. The engine allocates collateral to each
 * market on its own, so every position is isolated and there is no mode to choose: the row
 * names the mode and offers the leverage. The trade form's margin mode stays isolated through
 * the market's `marketType`.
 */
export const MarginModeSelector = ({ className }: { className?: string }) => {
  const stringGetter = useStringGetter();
  const dispatch = useAppDispatch();

  const currentMarket = useAppSelector(BonsaiHelpers.currentMarket.stableMarketInfo)?.ticker;
  const effectiveSelectedLeverage = useAppSelector(
    BonsaiHelpers.currentMarket.effectiveSelectedLeverage
  );

  const leverageButton = (
    <Button
      size={ButtonSize.XSmall}
      action={ButtonAction.SimpleSecondary}
      buttonStyle={ButtonStyle.WithoutBackground}
      slotRight={<Icon iconName={IconName.Caret} size="0.75em" tw="text-color-text-0" />}
      onClick={() =>
        currentMarket != null
          ? dispatch(openDialog(DialogTypes.SetMarketLeverage({ marketId: currentMarket })))
          : undefined
      }
    >
      <Output
        type={OutputType.Multiple}
        value={effectiveSelectedLeverage}
        fractionDigits={0}
        showSign={ShowSign.None}
        tw="text-color-text-2 font-base-medium"
      />
    </Button>
  );

  return (
    <div tw="row w-full justify-between gap-0.5" className={className}>
      <$MarginMode>
        <WithTooltip
          side="left"
          tooltipString={stringGetter({ key: STRING_KEYS.ISOLATED_MARGIN_DESCRIPTION })}
        >
          <span tw="text-color-text-0 font-base-book">
            {stringGetter({ key: STRING_KEYS.ISOLATED })}
          </span>
        </WithTooltip>
      </$MarginMode>
      {leverageButton}
    </div>
  );
};

const $MarginMode = styled.div`
  font: var(--font-mini-book);

  @media ${breakpoints.tablet} {
    font: var(--font-small-book);
  }
`;

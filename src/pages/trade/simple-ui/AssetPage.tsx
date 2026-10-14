import { OrderSide } from '@/bonsai/forms/trade/types';

import { ButtonAction, ButtonShape, ButtonSize, ButtonState } from '@/constants/buttons';
import { ComplianceStates } from '@/constants/compliance';
import { DialogTypes } from '@/constants/dialogs';
import { STRING_KEYS } from '@/constants/localization';

import { useComplianceState } from '@/hooks/useComplianceState';
import { useCurrentMarketId } from '@/hooks/useCurrentMarketId';
import { useStringGetter } from '@/hooks/useStringGetter';

import { Button } from '@/components/Button';
import { LoadingSpace } from '@/components/Loading/LoadingSpinner';
import { TvChart } from '@/views/charts/TradingView/TvChart';
import { OnboardingTriggerButton } from '@/views/dialogs/OnboardingTriggerButton';

import { calculateCanAccountTrade } from '@/state/accountCalculators';
import { useAppDispatch, useAppSelector } from '@/state/appTypes';
import { getCurrentMarketId } from '@/state/currentMarketSelectors';
import { openDialog } from '@/state/dialogs';

import { AssetDetails } from './AssetDetails';
import { AssetHeader } from './AssetHeader';
import { AssetPosition } from './AssetPosition';

const AssetPage = () => {
  const dispatch = useAppDispatch();
  const stringGetter = useStringGetter();
  const currentMarketId = useAppSelector(getCurrentMarketId);
  useCurrentMarketId();
  const canAccountTrade = useAppSelector(calculateCanAccountTrade);
  const { complianceState } = useComplianceState();

  if (currentMarketId == null) {
    return <LoadingSpace id="asset-page-loading" />;
  }

  const pageContent = (
    <>
      <div tw="mb-1.5 h-[20rem] font-small-book">
        <TvChart />
      </div>
      <div tw="flexColumn gap-2 px-1.25 pb-[5.25rem]">
        <AssetPosition />
        <AssetDetails />
      </div>
    </>
  );

  const isDisabled = complianceState !== ComplianceStates.FULL_ACCESS;

  const footerContent = isDisabled ? (
    <Button
      tw="flex-1 border border-solid border-color-layer-6"
      shape={ButtonShape.Pill}
      size={ButtonSize.Large}
      state={ButtonState.Disabled}
      action={ButtonAction.SimpleSecondary}
    >
      {stringGetter({ key: STRING_KEYS.UNAVAILABLE })}
    </Button>
  ) : canAccountTrade ? (
    <>
      <Button
        tw="flex-1 bg-color-negative-dark text-color-negative"
        shape={ButtonShape.Pill}
        size={ButtonSize.Large}
        onClick={() =>
          dispatch(
            openDialog(
              DialogTypes.SimpleUiTrade({ side: OrderSide.SELL, isClosingPosition: false })
            )
          )
        }
      >
        {stringGetter({ key: STRING_KEYS.SHORT_POSITION_SHORT })}
      </Button>

      <Button
        tw="flex-1 bg-color-positive-dark text-color-positive"
        shape={ButtonShape.Pill}
        size={ButtonSize.Large}
        onClick={() =>
          dispatch(
            openDialog(DialogTypes.SimpleUiTrade({ side: OrderSide.BUY, isClosingPosition: false }))
          )
        }
      >
        {stringGetter({ key: STRING_KEYS.LONG_POSITION_SHORT })}
      </Button>
    </>
  ) : (
    <OnboardingTriggerButton tw="flex-1" shape={ButtonShape.Pill} size={ButtonSize.Base} />
  );

  return (
    <div tw="flexColumn h-full">
      <AssetHeader />
      <div tw="overflow-auto">{pageContent}</div>
      <div
        tw="row fixed bottom-0 left-0 right-0 gap-1.25 px-1.25 py-1.25"
        css={{
          background: 'linear-gradient(to bottom, rgba(0, 0, 0, 0), var(--color-layer-1))',
        }}
      >
        {footerContent}
      </div>
    </div>
  );
};

export default AssetPage;

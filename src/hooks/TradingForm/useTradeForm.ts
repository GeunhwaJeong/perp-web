import { accountTransactionManager } from '@/bonsai/AccountTransactionSupervisor';
import { TradeFormInputData, TradeFormSummary, TradeFormType } from '@/bonsai/forms/trade/types';
import { PlaceOrderPayload } from '@/bonsai/forms/triggers/types';
import { isOperationSuccess } from '@/bonsai/lib/operationResult';
import { ErrorType, ValidationError } from '@/bonsai/lib/validationErrors';
import { logBonsaiInfo } from '@/bonsai/logs';

import { AnalyticsEvents } from '@/constants/analytics';
import { ComplianceStates } from '@/constants/compliance';

import { useTradeTypeOptions } from '@/views/forms/TradeForm/useTradeTypeOptions';

import { calculateCanAccountTrade } from '@/state/accountCalculators';
import { getSubaccountId } from '@/state/accountInfoSelectors';
import { useAppDispatch, useAppSelector } from '@/state/appTypes';
import { getCurrentMarketIdIfTradeable } from '@/state/currentMarketSelectors';
import { getCurrentMarketOraclePrice } from '@/state/perpetualsSelectors';
import { tradeFormActions } from '@/state/tradeForm';
import { getCurrentTradePageForm } from '@/state/tradeFormSelectors';

import { track } from '@/lib/analytics/analytics';
import { useDisappearingValue } from '@/lib/disappearingValue';
import { operationFailureToErrorParams } from '@/lib/errorHelpers';
import { isTruthy } from '@/lib/isTruthy';
import { purgeBigNumbers } from '@/lib/purgeBigNumber';

import { ConnectionErrorType, useApiState } from '../useApiState';
import { useComplianceState } from '../useComplianceState';
import { useOnOrderIndexed } from '../useOnOrderIndexed';
import { useStringGetter } from '../useStringGetter';

export enum TradeFormSource {
  ClosePositionForm = 'ClosePositionForm',
  SimpleCloseForm = 'SimpleCloseForm',
  SimpleTradeForm = 'SimpleTradeForm',
  TradeForm = 'TradeForm',
}

export const useTradeForm = ({
  source,
  fullFormSummary,
  onLastOrderIndexed,
}: {
  source: TradeFormSource;
  fullFormSummary:
    | {
        errors: ValidationError[];
        summary: TradeFormSummary;
        inputData?: undefined;
      }
    | {
        inputData: TradeFormInputData;
        summary: TradeFormSummary;
        errors: ValidationError[];
      };
  onLastOrderIndexed: () => void;
}) => {
  const [placeOrderError, setPlaceOrderError] = useDisappearingValue<string>();

  const dispatch = useAppDispatch();
  const stringGetter = useStringGetter();

  const { connectionError } = useApiState();
  const { complianceState } = useComplianceState();

  const { setUnIndexedClientId, clientId: unIndexedClientId } =
    useOnOrderIndexed(onLastOrderIndexed);

  const { selectedTradeType } = useTradeTypeOptions({
    showAll: true,
    showAssetIcon: true,
  });

  const currentInput = useAppSelector(getCurrentTradePageForm);
  const oraclePrice = useAppSelector(getCurrentMarketOraclePrice);
  const currentMarketId = useAppSelector(getCurrentMarketIdIfTradeable);
  const subaccountNumber = useAppSelector(getSubaccountId);
  const canAccountTrade = useAppSelector(calculateCanAccountTrade);

  const { errors: tradeErrors, summary } = fullFormSummary;
  const tradeFormInputValues = summary.effectiveTrade;
  const { marketId } = tradeFormInputValues;
  const isClosePosition = source === TradeFormSource.ClosePositionForm;
  const hasValidationErrors =
    !!tradeErrors.some((error) => error.type === ErrorType.error) ||
    (!isClosePosition && currentInput !== 'TRADE');

  const hasMissingData = subaccountNumber === undefined;

  const closeOnlyTradingUnavailable =
    complianceState === ComplianceStates.CLOSE_ONLY &&
    selectedTradeType !== TradeFormType.MARKET &&
    currentInput !== 'CLOSE_POSITION';

  const tradingUnavailable =
    closeOnlyTradingUnavailable ||
    complianceState === ComplianceStates.READ_ONLY ||
    complianceState === ComplianceStates.SPOT_ONLY ||
    connectionError === ConnectionErrorType.CHAIN_DISRUPTION;

  const shouldEnableTrade =
    canAccountTrade && !hasMissingData && !hasValidationErrors && !tradingUnavailable;

  const placeOrder = async ({
    onPlaceOrder,
    onSuccess,
    onFailure,
  }: {
    onPlaceOrder?: (payload: PlaceOrderPayload) => void;
    onSuccess?: () => void;
    onFailure?: () => void;
  } = {}) => {
    setPlaceOrderError(undefined);
    const payload = summary.tradePayload;
    const representativePayload = payload?.orderPayload ?? payload?.scaleOrderPayloads?.[0];
    if (payload == null || representativePayload == null || hasValidationErrors) {
      return;
    }

    // dYdX saved the leverage chosen for a new position here, once the order had picked its
    // subaccount. The leverage dialog writes it to the position on chain and the selection is read
    // back from there, so there is nothing to save; a transaction sent here would take the
    // account's cap at the version the order was built with, and the order would be rejected.
    onPlaceOrder?.(representativePayload);
    const volume =
      payload.scaleOrderPayloads != null && payload.scaleOrderPayloads.length > 0
        ? payload.scaleOrderPayloads.reduce((sum, o) => sum + o.size * o.price, 0)
        : representativePayload.size * representativePayload.price;
    track(
      AnalyticsEvents.TradePlaceOrderClick({
        ...representativePayload,
        isClosePosition: source === TradeFormSource.ClosePositionForm,
        isSimpleUi: source === TradeFormSource.SimpleTradeForm,
        source,
        volume,
      })
    );

    dispatch(tradeFormActions.resetPrimaryInputs());
    logBonsaiInfo(
      source,
      source === TradeFormSource.ClosePositionForm
        ? 'attempting close position'
        : 'attempting place order',
      {
        fullTradeFormState: purgeBigNumbers(fullFormSummary),
      }
    );

    const result = await accountTransactionManager.placeCompoundOrder(payload, source);
    if (isOperationSuccess(result)) {
      setUnIndexedClientId(representativePayload.clientId.toString());
      onSuccess?.();
    } else {
      const errorParams = operationFailureToErrorParams(result);
      setPlaceOrderError(
        stringGetter({
          key: errorParams.errorStringKey,
          fallback: errorParams.errorMessage ?? '',
        })
      );
      onFailure?.();
    }
  };

  return {
    placeOrder,
    unIndexedClientId,
    placeOrderError,
    shouldEnableTrade,
    tradingUnavailable,
    hasValidationErrors,
    hasMarketData: isTruthy(oraclePrice) && currentMarketId === marketId,
  };
};

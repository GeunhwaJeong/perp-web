import { useMemo } from 'react';

import { ErrorType, getHighestPriorityAlert } from '@/bonsai/lib/validationErrors';

import { useAppSelector } from '@/state/appTypes';
import { getClosePositionFormSummary, getTradeFormSummary } from '@/state/tradeFormSelectors';

export const useTradeErrors = ({
  placeOrderError,
  isClosingPosition,
}: {
  placeOrderError?: string;
  isClosingPosition?: boolean;
}) => {
  const { errors: tradeErrors } = useAppSelector(getTradeFormSummary);
  const { errors: closePositionErrors } = useAppSelector(getClosePositionFormSummary);

  return useMemo(() => {
    const primaryAlert = getHighestPriorityAlert(
      isClosingPosition ? closePositionErrors : tradeErrors
    );

    const shouldPromptUserToPlaceLimitOrder =
      primaryAlert?.code === 'MARKET_ORDER_ERROR_ORDERBOOK_SLIPPAGE';

    return {
      shortAlertKey: primaryAlert?.resources.title?.stringKey,
      primaryAlert,
      alertType: placeOrderError != null ? ErrorType.error : primaryAlert?.type,
      shouldPromptUserToPlaceLimitOrder,
    };
  }, [placeOrderError, isClosingPosition, closePositionErrors, tradeErrors]);
};

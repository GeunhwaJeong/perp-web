import { ValidationError } from '@/bonsai/lib/validationErrors';

import { AlertType } from '@/constants/alerts';

import { AlertMessage } from '@/components/AlertMessage';
import { ValidationAlertMessage } from '@/components/ValidationAlert';

// A failed order keeps its inputs, so its reason stays beside them even when its notification
// reports it as well.
export const TradeFormAlertContent = ({
  placeOrderError,
  primaryAlert,
}: {
  placeOrderError?: string;
  primaryAlert?: ValidationError;
}) => {
  return placeOrderError != null ? (
    <AlertMessage type={AlertType.Error}>
      <div tw="inline-block">{placeOrderError}</div>
    </AlertMessage>
  ) : primaryAlert != null && primaryAlert.resources.text?.stringKey != null ? (
    <ValidationAlertMessage error={primaryAlert} />
  ) : null;
};

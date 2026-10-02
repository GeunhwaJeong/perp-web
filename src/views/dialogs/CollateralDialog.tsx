import { FormEvent, useCallback, useEffect, useState } from 'react';

import { accountTransactionManager } from '@/bonsai/AccountTransactionSupervisor';
import { isOperationFailure } from '@/bonsai/lib/operationResult';

import { AlertType } from '@/constants/alerts';
import { ButtonAction, ButtonType } from '@/constants/buttons';
import { DepositDialog2Props, DialogProps, WithdrawDialog2Props } from '@/constants/dialogs';
import { STRING_KEYS } from '@/constants/localization';

import { useCustomNotification } from '@/hooks/useCustomNotification';
import { useStringGetter } from '@/hooks/useStringGetter';

import { AlertMessage } from '@/components/AlertMessage';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { FormInput } from '@/components/FormInput';
import { Icon, IconName } from '@/components/Icon';
import { InputType } from '@/components/Input';
import { Output, OutputType } from '@/components/Output';

type Mode = 'deposit' | 'withdraw';

type Balances = { wallet: number; account: number | undefined; symbol: string };

/**
 * Moves collateral between the wallet and the trading account on the perpetuals engine. A
 * deposit is a coin transfer into the account (opening it on the first deposit); a withdrawal
 * pays the account's unallocated balance back to the wallet. Collateral allocated to a market
 * is moved back with that market's margin controls first.
 */
const CollateralDialog = ({
  mode,
  setIsOpen,
}: {
  mode: Mode;
  setIsOpen: (open: boolean) => void;
}) => {
  const stringGetter = useStringGetter();
  const notify = useCustomNotification();
  const [amount, setAmount] = useState('');
  const [balances, setBalances] = useState<Balances>();
  const [error, setError] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadBalances = useCallback(async () => {
    const result = await accountTransactionManager.collateralBalances();
    if (isOperationFailure(result)) {
      setError(result.errorString);
      return;
    }
    setBalances(result.payload);
  }, []);

  useEffect(() => {
    loadBalances();
  }, [loadBalances]);

  const available = mode === 'deposit' ? balances?.wallet : balances?.account;
  const value = Number(amount);
  const isValid = value > 0 && available != null && value <= available;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isValid) return;
    setError(undefined);
    setIsSubmitting(true);
    const result =
      mode === 'deposit'
        ? await accountTransactionManager.depositCollateral(value)
        : await accountTransactionManager.withdrawCollateral(value);
    setIsSubmitting(false);
    if (isOperationFailure(result)) {
      setError(result.errorString);
      return;
    }
    notify({
      title: stringGetter({
        key: mode === 'deposit' ? STRING_KEYS.TRANSFER_IN : STRING_KEYS.TRANSFER_OUT,
      }),
      body: `${value} ${balances?.symbol ?? ''}`,
      icon: <Icon iconName={IconName.CurrencySign} />,
    });
    setIsOpen(false);
  };

  const balanceRow = (label: string, balance: number | undefined) => (
    <div tw="row justify-between text-color-text-0 font-small-medium">
      <span>{label}</span>
      <Output
        tw="text-color-text-1"
        type={OutputType.Number}
        value={balance}
        tag={balances?.symbol}
        useGrouping
      />
    </div>
  );

  return (
    <Dialog
      isOpen
      hasHeaderBorder
      setIsOpen={setIsOpen}
      title={stringGetter({ key: mode === 'deposit' ? STRING_KEYS.DEPOSIT : STRING_KEYS.WITHDRAW })}
    >
      <form tw="flexColumn mt-1.25 gap-1.25" onSubmit={onSubmit}>
        {balanceRow(stringGetter({ key: STRING_KEYS.WALLET_BALANCE }), balances?.wallet)}
        {balanceRow(stringGetter({ key: STRING_KEYS.AVAILABLE_BALANCE }), balances?.account)}
        <FormInput
          type={InputType.Number}
          label={stringGetter({ key: STRING_KEYS.AMOUNT })}
          value={amount}
          onInput={({ formattedValue }: { formattedValue?: string }) =>
            setAmount(formattedValue ?? '')
          }
          slotRight={
            <Button
              type={ButtonType.Button}
              action={ButtonAction.Base}
              onClick={() => available != null && setAmount(String(available))}
              state={{ isDisabled: available == null || available <= 0 }}
            >
              Max
            </Button>
          }
        />
        {error ? <AlertMessage type={AlertType.Error}>{error}</AlertMessage> : null}
        <Button
          type={ButtonType.Submit}
          action={ButtonAction.Primary}
          state={{ isLoading: isSubmitting, isDisabled: !isValid }}
        >
          {stringGetter({
            key:
              available != null && value > available
                ? STRING_KEYS.INSUFFICIENT_BALANCE
                : mode === 'deposit'
                  ? STRING_KEYS.DEPOSIT
                  : STRING_KEYS.WITHDRAW,
          })}
        </Button>
      </form>
    </Dialog>
  );
};

export const CollateralDepositDialog = ({ setIsOpen }: DialogProps<DepositDialog2Props>) => (
  <CollateralDialog mode="deposit" setIsOpen={setIsOpen} />
);

export const CollateralWithdrawDialog = ({ setIsOpen }: DialogProps<WithdrawDialog2Props>) => (
  <CollateralDialog mode="withdraw" setIsOpen={setIsOpen} />
);

import { type FormEvent, useState } from 'react';

import { accountTransactionManager } from '@/bonsai/AccountTransactionSupervisor';
import { isOperationFailure } from '@/bonsai/lib/operationResult';
import { looksLikeName, normalizeAddressInput } from '@/haneul/names';
import styled from 'styled-components';

import { AlertType } from '@/constants/alerts';
import { ButtonAction, ButtonType } from '@/constants/buttons';
import { STRING_KEYS } from '@/constants/localization';
import { DydxChainAsset } from '@/constants/wallets';

import { useAccountBalance } from '@/hooks/useAccountBalance';
import { useCustomNotification } from '@/hooks/useCustomNotification';
import { useStringGetter } from '@/hooks/useStringGetter';
import { useTokenConfigs } from '@/hooks/useTokenConfigs';

import { layoutMixins } from '@/styles/layoutMixins';

import { AlertMessage } from '@/components/AlertMessage';
import { AssetIcon } from '@/components/AssetIcon';
import { Button } from '@/components/Button';
import { FormInput } from '@/components/FormInput';
import { Icon, IconName } from '@/components/Icon';
import { InputType } from '@/components/Input';
import { Output, OutputType } from '@/components/Output';
import { SelectItem, SelectMenu } from '@/components/SelectMenu';

import { operationFailureToErrorParams } from '@/lib/errorHelpers';
import { truncateAddress } from '@/lib/wallet';

type TransferFormProps = {
  selectedAsset?: DydxChainAsset;
  onDone?: () => void;
  className?: string;
};

// Kept back when sending the gas coin so the wallet can still pay for a few transactions.
const GAS_RESERVE_HANEUL = 0.02;

/**
 * Sends HANEUL or the collateral coin from the wallet to an address or a `name.haneul`. The
 * trading account is not involved: collateral on the account is withdrawn to the wallet first.
 */
export const TransferForm = ({
  selectedAsset = DydxChainAsset.CHAINTOKEN,
  onDone,
  className,
}: TransferFormProps) => {
  const stringGetter = useStringGetter();
  const notify = useCustomNotification();
  const {
    chainTokenLabel,
    chainTokenImage,
    chainTokenDecimals,
    usdcLabel,
    usdcImage,
    usdcDecimals,
  } = useTokenConfigs();
  const { nativeTokenBalance, usdcBalance } = useAccountBalance();

  const [asset, setAsset] = useState<DydxChainAsset>(selectedAsset);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isNative = asset === DydxChainAsset.CHAINTOKEN;
  const symbol = isNative ? chainTokenLabel : usdcLabel;
  const decimals = isNative ? chainTokenDecimals : usdcDecimals;
  const balance = isNative ? nativeTokenBalance.toNumber() : usdcBalance;
  const sendable = Math.max(0, isNative ? balance - GAS_RESERVE_HANEUL : balance);

  const value = Number(amount);
  const recipientAddress = normalizeAddressInput(recipient);
  const recipientIsName = recipientAddress == null && looksLikeName(recipient);
  const isValid = value > 0 && value <= sendable && (recipientAddress != null || recipientIsName);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isValid) return;
    setError(undefined);
    setIsSubmitting(true);
    const result = await accountTransactionManager.sendCoins({ asset, amount: value, recipient });
    setIsSubmitting(false);
    if (isOperationFailure(result)) {
      const { errorStringKey, errorMessage } = operationFailureToErrorParams(result);
      setError(stringGetter({ key: errorStringKey, fallback: errorMessage ?? '' }));
      return;
    }
    notify({
      title: 'Sent',
      body: `${value} ${result.payload.symbol} to ${
        recipientIsName ? recipient.trim() : truncateAddress(result.payload.recipient)
      }`,
      icon: <Icon iconName={IconName.Send} />,
    });
    onDone?.();
  };

  return (
    <$Form className={className} onSubmit={onSubmit}>
      <SelectMenu
        label={stringGetter({ key: STRING_KEYS.ASSET })}
        value={asset}
        onValueChange={(next: DydxChainAsset) => {
          setAsset(next);
          setAmount('');
        }}
      >
        <SelectItem
          value={DydxChainAsset.CHAINTOKEN}
          label={
            <$InlineRow>
              <AssetIcon logoUrl={chainTokenImage} symbol={chainTokenLabel} /> {chainTokenLabel}
            </$InlineRow>
          }
        />
        <SelectItem
          value={DydxChainAsset.USDC}
          label={
            <$InlineRow>
              <AssetIcon logoUrl={usdcImage} symbol={usdcLabel} /> {usdcLabel}
            </$InlineRow>
          }
        />
      </SelectMenu>

      <FormInput
        type={InputType.Text}
        label="To"
        placeholder="0x… or name.haneul"
        value={recipient}
        onInput={(e: { target?: { value?: string } }) => setRecipient(e.target?.value ?? '')}
      />
      {recipientIsName && (
        <span tw="text-color-text-0 font-mini-book">
          Sent to the address{' '}
          {recipient.trim().toLowerCase().endsWith('.haneul')
            ? recipient.trim()
            : `${recipient.trim()}.haneul`}{' '}
          points to.
        </span>
      )}

      <FormInput
        type={InputType.Number}
        label={stringGetter({ key: STRING_KEYS.AMOUNT })}
        decimals={decimals}
        value={amount}
        onInput={({ formattedValue }: { formattedValue?: string }) =>
          setAmount(formattedValue ?? '')
        }
        slotRight={
          <Button
            type={ButtonType.Button}
            action={ButtonAction.Base}
            onClick={() => setAmount(String(sendable))}
            state={{ isDisabled: sendable <= 0 }}
          >
            Max
          </Button>
        }
      />
      <div tw="row justify-between text-color-text-0 font-small-medium">
        <span>{stringGetter({ key: STRING_KEYS.WALLET_BALANCE })}</span>
        <Output
          tw="text-color-text-1"
          type={OutputType.Number}
          value={balance}
          fractionDigits={Math.min(decimals, 6)}
          tag={symbol}
          useGrouping
        />
      </div>

      {error ? <AlertMessage type={AlertType.Error}>{error}</AlertMessage> : null}

      <Button
        type={ButtonType.Submit}
        action={ButtonAction.Primary}
        state={{ isLoading: isSubmitting, isDisabled: !isValid }}
      >
        {value > sendable ? stringGetter({ key: STRING_KEYS.INSUFFICIENT_BALANCE }) : 'Send'}
      </Button>
    </$Form>
  );
};

const $Form = styled.form`
  ${layoutMixins.flexColumn}
  gap: 1.25rem;
  padding: 1.25rem 0 0;
`;

const $InlineRow = styled.span`
  ${layoutMixins.inlineRow}
`;

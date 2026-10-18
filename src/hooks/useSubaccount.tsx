import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { accountTransactionManager } from '@/bonsai/AccountTransactionSupervisor';
import {
  SubaccountTransferPayload,
  SubaccountUpdateLeveragePayload,
} from '@/bonsai/forms/adjustIsolatedMargin';
import { TransferPayload, TransferToken } from '@/bonsai/forms/transfers';
import { TriggerOrdersPayload } from '@/bonsai/forms/triggers/types';
import {
  isOperationFailure,
  wrapOperationFailure,
  wrapOperationSuccess,
} from '@/bonsai/lib/operationResult';
import { logBonsaiError, logBonsaiInfo } from '@/bonsai/logs';
import { Method } from '@cosmjs/tendermint-rpc';
import { SubaccountClient, type LocalWallet } from '@dydxprotocol/v4-client-js';
import Long from 'long';
import { parseUnits } from 'viem';

import { AnalyticsEvents, DEFAULT_TRANSACTION_MEMO, TransactionMemo } from '@/constants/analytics';
import { QUANTUM_MULTIPLIER } from '@/constants/numbers';
import { DydxAddress } from '@/constants/wallets';

import { useAppDispatch } from '@/state/appTypes';
import { clearLocalOrders } from '@/state/localOrders';

import { track } from '@/lib/analytics/analytics';
import { assertNever } from '@/lib/assertNever';
import { stringifyTransactionError } from '@/lib/errors';
import { isTruthy } from '@/lib/isTruthy';
import { parseToPrimitives } from '@/lib/parseToPrimitives';
import { log } from '@/lib/telemetry';

import { useAccounts } from './useAccounts';
import { useDydxClient } from './useDydxClient';
import { useTokenConfigs } from './useTokenConfigs';

type SubaccountContextType = ReturnType<typeof useSubaccountContext>;
const SubaccountContext = createContext<SubaccountContextType>({} as SubaccountContextType);
SubaccountContext.displayName = 'Subaccount';

export const SubaccountProvider = ({ ...props }) => {
  const { localDydxWallet } = useAccounts();

  return (
    <SubaccountContext.Provider value={useSubaccountContext({ localDydxWallet })} {...props} />
  );
};

export const useSubaccount = () => useContext(SubaccountContext);

const useSubaccountContext = ({ localDydxWallet }: { localDydxWallet?: LocalWallet }) => {
  const dispatch = useAppDispatch();
  const { chainTokenDecimals } = useTokenConfigs();
  const { compositeClient, faucetClient } = useDydxClient();

  const { getFaucetFunds, getNativeTokens } = useMemo(
    () => ({
      getFaucetFunds: async ({
        dydxAddress,
        subaccountNumber,
      }: {
        dydxAddress: DydxAddress;
        subaccountNumber: number;
      }) => faucetClient?.fill(dydxAddress, subaccountNumber, 100),

      getNativeTokens: async ({ dydxAddress }: { dydxAddress: DydxAddress }) =>
        faucetClient?.fillNative(dydxAddress),
    }),
    [faucetClient]
  );

  const [subaccountNumber] = useState(0);

  const subaccountClient = useMemo(
    () =>
      localDydxWallet
        ? SubaccountClient.forLocalWallet(localDydxWallet, subaccountNumber)
        : undefined,
    [localDydxWallet, subaccountNumber]
  );

  const dydxAddress = localDydxWallet?.address as DydxAddress | undefined;

  useEffect(() => {
    dispatch(clearLocalOrders());
  }, [dispatch, dydxAddress]);

  // ------ Deposit/Withdraw Methods ------ //
  // Collateral moves through the perpetuals engine: the wallet's coins go into the trading
  // account (its balance is parent subaccount 0) and come back out of it.
  const deposit = useCallback(async (amount: number) => {
    const result = await accountTransactionManager.depositCollateral(amount);
    if (isOperationFailure(result)) throw new Error(result.errorString);
    return result.payload;
  }, []);

  const depositCurrentBalance = useCallback(async () => {}, []);

  const withdraw = useCallback(async (amount: number, fromSubaccountNumber: number) => {
    if (fromSubaccountNumber >= 128) {
      throw new Error('Move the collateral back to the account balance before withdrawing');
    }
    const result = await accountTransactionManager.withdrawCollateral(amount);
    if (isOperationFailure(result)) throw new Error(result.errorString);
    return result.payload;
  }, []);

  // ------ Transfer Methods ------ //

  // ------ Faucet Methods ------ //
  const requestFaucetFunds = useCallback(async () => {
    try {
      if (!dydxAddress) throw new Error('dydxAddress is not connected');

      await Promise.all([
        getFaucetFunds({ dydxAddress, subaccountNumber }),
        getNativeTokens({ dydxAddress }),
      ]);
    } catch (error) {
      log('useSubaccount/getFaucetFunds', error);
      throw error;
    }
  }, [dydxAddress, getFaucetFunds, getNativeTokens, subaccountNumber]);

  // ------ Trigger Orders Methods ------ //
  const placeTriggerOrders = useCallback(async (payload: TriggerOrdersPayload) => {
    return accountTransactionManager.placeCompoundOrder(
      {
        orderPayload: undefined,
        triggersPayloads: payload.payloads,
        scaleOrderPayloads: undefined,
      },
      'TriggersForm'
    );
  }, []);

  // ------ Listing Method ------ //
  const createPermissionlessMarket = useCallback(
    async (ticker: string) => {
      if (!compositeClient) {
        throw new Error('client not initialized');
      } else if (!subaccountClient?.address) {
        throw new Error('wallet not initialized');
      }

      track(AnalyticsEvents.LaunchMarketTransaction({ marketId: ticker }));

      const response = await compositeClient.createMarketPermissionless(
        subaccountClient,
        ticker,
        undefined,
        undefined,
        TransactionMemo.launchMarket
      );

      return response;
    },
    [compositeClient, subaccountClient]
  );

  // ------ Staking Methods ------ //
  const delegate = useCallback(
    async (validator: string, amount: number) => {
      if (!compositeClient) {
        throw new Error('client not initialized');
      }
      if (!subaccountClient || !dydxAddress) {
        throw new Error('wallet not initialized');
      }

      const response = await compositeClient.validatorClient.post.delegate(
        subaccountClient,
        dydxAddress,
        validator,
        parseUnits(amount.toString(), chainTokenDecimals).toString(),
        Method.BroadcastTxCommit
      );

      return response;
    },
    [compositeClient, subaccountClient, dydxAddress, chainTokenDecimals]
  );

  const getDelegateFee = useCallback(
    async (validator: string, amount: number) => {
      if (!compositeClient) {
        throw new Error('client not initialized');
      }
      if (!localDydxWallet?.address || !subaccountClient) {
        throw new Error('wallet not initialized');
      }

      const tx = await compositeClient.simulate(
        subaccountClient,
        () =>
          Promise.resolve([
            compositeClient.validatorClient.post.delegateMsg(
              localDydxWallet.address ?? '',
              validator,
              parseUnits(amount.toString(), chainTokenDecimals).toString()
            ),
          ]),
        compositeClient.validatorClient.post.defaultDydxGasPrice
      );

      return tx;
    },
    [compositeClient, localDydxWallet, subaccountClient, chainTokenDecimals]
  );

  const undelegate = useCallback(
    async (amounts: Record<string, number | undefined>) => {
      if (!compositeClient) {
        throw new Error('client not initialized');
      }
      if (!localDydxWallet || !subaccountClient) {
        throw new Error('wallet not initialized');
      }

      const msgs = Object.keys(amounts)
        .map((validator) => {
          const amount = amounts[validator];
          if (!amount) {
            return undefined;
          }
          return compositeClient.validatorClient.post.undelegateMsg(
            localDydxWallet.address ?? '',
            validator,
            parseUnits(amount.toString(), chainTokenDecimals).toString()
          );
        })
        .filter(isTruthy);

      const tx = await compositeClient.send(
        subaccountClient,
        () => Promise.resolve(msgs),
        false,
        compositeClient.validatorClient.post.defaultDydxGasPrice,
        undefined,
        Method.BroadcastTxCommit
      );

      return tx;
    },
    [compositeClient, localDydxWallet, subaccountClient, chainTokenDecimals]
  );

  const getUndelegateFee = useCallback(
    async (amounts: Record<string, number | undefined>) => {
      if (!compositeClient) {
        throw new Error('client not initialized');
      }
      if (!localDydxWallet || !subaccountClient) {
        throw new Error('wallet not initialized');
      }

      const msgs = Object.keys(amounts)
        .map((validator) => {
          const amount = amounts[validator];
          if (!amount) {
            return undefined;
          }
          return compositeClient.validatorClient.post.undelegateMsg(
            localDydxWallet.address ?? '',
            validator,
            parseUnits(amount.toString(), chainTokenDecimals).toString()
          );
        })
        .filter(isTruthy);

      const tx = await compositeClient.simulate(
        subaccountClient,
        () => Promise.resolve(msgs),
        compositeClient.validatorClient.post.defaultDydxGasPrice
      );

      return tx;
    },
    [compositeClient, localDydxWallet, subaccountClient, chainTokenDecimals]
  );

  const withdrawReward = useCallback(
    async (validators: string[]) => {
      if (!compositeClient) {
        throw new Error('client not initialized');
      }
      if (!localDydxWallet || !subaccountClient) {
        throw new Error('wallet not initialized');
      }

      const msgs = validators
        .map((validator) => {
          return compositeClient.validatorClient.post.withdrawDelegatorRewardMsg(
            localDydxWallet.address ?? '',
            validator
          );
        })
        .filter(isTruthy);

      const tx = await compositeClient.send(
        subaccountClient,
        () => Promise.resolve(msgs),
        false,
        compositeClient.validatorClient.post.defaultGasPrice,
        undefined,
        Method.BroadcastTxCommit
      );

      return tx;
    },
    [compositeClient, localDydxWallet, subaccountClient]
  );

  const getWithdrawRewardFee = useCallback(
    async (validators: string[]) => {
      if (!compositeClient) {
        throw new Error('client not initialized');
      }
      if (!localDydxWallet || !subaccountClient) {
        throw new Error('wallet not initialized');
      }

      const msgs = validators
        .map((validator) => {
          return compositeClient.validatorClient.post.withdrawDelegatorRewardMsg(
            localDydxWallet.address ?? '',
            validator
          );
        })
        .filter(isTruthy);

      const tx = await compositeClient.simulate(
        subaccountClient,
        () => Promise.resolve(msgs),
        compositeClient.validatorClient.post.defaultGasPrice
      );

      return tx;
    },
    [compositeClient, localDydxWallet, subaccountClient]
  );

  const getVaultAccountInfo = useCallback(async () => {
    if (!compositeClient?.validatorClient) {
      throw new Error('client not initialized');
    }
    if (!dydxAddress) throw new Error('dydxAddress is not connected');
    const result = await compositeClient.validatorClient.get.getMegavaultOwnerShares(dydxAddress);
    if (result == null) {
      return result;
    }
    return parseToPrimitives(result);
  }, [compositeClient?.validatorClient, dydxAddress]);

  const depositToMegavault = useCallback(
    async (amount: number) => {
      if (!compositeClient) {
        throw new Error('client not initialized');
      }
      if (subaccountClient == null) {
        throw new Error('local wallet client not initialized');
      }

      return compositeClient.depositToMegavault(subaccountClient, amount, Method.BroadcastTxCommit);
    },
    [compositeClient, subaccountClient]
  );

  const withdrawFromMegavault = useCallback(
    async (shares: number, minAmount: number) => {
      if (!compositeClient) {
        throw new Error('client not initialized');
      }
      if (subaccountClient == null) {
        throw new Error('local wallet client not initialized');
      }
      return compositeClient.withdrawFromMegavault(
        subaccountClient,
        shares,
        minAmount,
        Method.BroadcastTxCommit
      );
    },
    [compositeClient, subaccountClient]
  );

  /**
   * Between the account balance (parent subaccount) and a market (its child subaccount): into
   * a market allocates collateral to the position there, out of it deallocates.
   */
  const transferBetweenSubaccounts = useCallback(
    async (params: SubaccountTransferPayload, _memo?: string) => {
      const toMarket = params.destinationSubaccountNumber >= 128;
      const child = toMarket ? params.destinationSubaccountNumber : params.subaccountNumber;
      const marketId = accountTransactionManager.marketIdForSubaccount(child);
      if (marketId == null) {
        return wrapOperationFailure(`No market for subaccount ${child}`);
      }
      const result = await accountTransactionManager.transferMargin({
        marketId,
        amount: parseFloat(params.amount),
        toMarket,
      });
      if (isOperationFailure(result)) {
        logBonsaiError('useSubaccount/subaccountTransfer', 'Failed subaccount transfer', {
          error: result.errorString,
        });
      }
      return result;
    },
    []
  );

  /** The engine's leverage is each position's initial margin ratio, set per market. */
  const updateLeverage = useCallback(async (params: SubaccountUpdateLeveragePayload) => {
    const marketId = accountTransactionManager.marketIdForClobPair(params.clobPairId);
    if (marketId == null) {
      return wrapOperationFailure(`No market for clob pair ${params.clobPairId}`);
    }
    const result = await accountTransactionManager.setMarketLeverage({
      marketId,
      leverage: params.leverage,
    });
    if (isOperationFailure(result)) {
      logBonsaiError('useSubaccount/updateLeverage', 'Failed update leverage', {
        error: result.errorString,
      });
    }
    return result;
  }, []);

  const createTransferMessage = useCallback(
    (payload: TransferPayload) => {
      if (subaccountClient == null || !localDydxWallet) {
        throw new Error('local wallet client not initialized');
      }

      if (compositeClient == null) {
        throw new Error('Missing compositeClient or localWallet');
      }

      if (payload.type === TransferToken.USDC) {
        return compositeClient.validatorClient.post.composer.composeMsgWithdrawFromSubaccount(
          subaccountClient.address,
          subaccountClient.subaccountNumber,
          0, // assetId default
          Long.fromNumber(payload.amount * QUANTUM_MULTIPLIER),
          payload.recipient
        );
      }
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (payload.type === TransferToken.NATIVE) {
        return compositeClient.sendTokenMessage(
          localDydxWallet,
          payload.amount.toString(),
          payload.recipient
        );
      }
      assertNever(payload);
      return undefined;
    },
    [compositeClient, localDydxWallet, subaccountClient]
  );

  const simulateTransfer = useCallback(
    async (payload: TransferPayload) => {
      try {
        if (subaccountClient == null) {
          throw new Error('local wallet client not initialized');
        }

        if (compositeClient == null) {
          throw new Error('Missing compositeClient or localWallet');
        }

        const gasPrice =
          payload.type === TransferToken.USDC
            ? undefined
            : compositeClient.validatorClient.post.defaultDydxGasPrice;

        const message = createTransferMessage(payload);

        if (message == null) {
          throw new Error('invalid message generated');
        }

        const tx = await compositeClient.simulate(
          subaccountClient,
          () => Promise.resolve([message]),
          gasPrice
        );

        const parsedTx = parseToPrimitives(tx);
        logBonsaiInfo('useSubaccount/simulateTransfer', 'Successful transfer simulation', {
          payload,
          parsedTx,
        });
        return wrapOperationSuccess(parsedTx);
      } catch (error) {
        const parsed = stringifyTransactionError(error);
        logBonsaiError('useSubaccount/simulateTransfer', 'Failed transfer simulation', {
          transferType: payload.type,
          parsed,
        });
        return wrapOperationFailure(parsed);
      }
    },
    [subaccountClient, compositeClient, createTransferMessage]
  );

  const transfer = useCallback(
    async (payload: TransferPayload) => {
      try {
        if (subaccountClient == null) {
          throw new Error('local wallet client not initialized');
        }

        if (compositeClient == null) {
          throw new Error('Missing compositeClient or localWallet');
        }

        const transferMemo =
          payload.type === TransferToken.USDC
            ? `${DEFAULT_TRANSACTION_MEMO} | transfer usdc to ${subaccountClient.address}`
            : payload.memo;

        const gasPrice =
          payload.type === TransferToken.USDC
            ? undefined
            : compositeClient.validatorClient.post.defaultDydxGasPrice;

        const message = createTransferMessage(payload);

        if (message == null) {
          throw new Error('invalid message generated');
        }

        const result = await compositeClient.validatorClient.post.send(
          subaccountClient,
          () => Promise.resolve([message]),
          false,
          gasPrice,
          transferMemo,
          Method.BroadcastTxCommit
        );

        const parsedResult = parseToPrimitives(result);
        logBonsaiInfo('useSubaccount/transfer', 'Successful transfer', {
          transferType: payload.type,
          parsedResult,
        });

        return wrapOperationSuccess(parsedResult);
      } catch (error) {
        const parsed = stringifyTransactionError(error);
        logBonsaiError('useSubaccount/transfer', 'Failed transfer', {
          transferType: payload.type,
          parsed,
        });

        return wrapOperationFailure(parsed);
      }
    },
    [subaccountClient, compositeClient, createTransferMessage]
  );

  return {
    // Deposit/Withdraw/Faucet Methods
    deposit,
    withdraw,
    requestFaucetFunds,

    // Transfer Methods
    transfer,
    simulateTransfer,
    depositCurrentBalance,
    transferBetweenSubaccounts,

    // Trading Methods
    placeTriggerOrders,

    // Listing Methods
    createPermissionlessMarket,

    // Staking methods
    delegate,
    getDelegateFee,
    undelegate,
    getUndelegateFee,
    withdrawReward,
    getWithdrawRewardFee,

    // vaults
    getVaultAccountInfo,
    depositToMegavault,
    withdrawFromMegavault,

    updateLeverage,
    subaccountNumber,
  };
};

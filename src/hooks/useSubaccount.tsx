import { createContext, useCallback, useContext, useEffect, useState } from 'react';

import { accountTransactionManager } from '@/bonsai/AccountTransactionSupervisor';
import {
  SubaccountTransferPayload,
  SubaccountUpdateLeveragePayload,
} from '@/bonsai/forms/adjustIsolatedMargin';
import { TriggerOrdersPayload } from '@/bonsai/forms/triggers/types';
import { isOperationFailure, wrapOperationFailure } from '@/bonsai/lib/operationResult';
import { logBonsaiError } from '@/bonsai/logs';

import { useAppDispatch } from '@/state/appTypes';
import { clearLocalOrders } from '@/state/localOrders';

type SubaccountContextType = ReturnType<typeof useSubaccountContext>;
const SubaccountContext = createContext<SubaccountContextType>({} as SubaccountContextType);
SubaccountContext.displayName = 'Subaccount';

export const SubaccountProvider = ({ ...props }) => (
  <SubaccountContext.Provider value={useSubaccountContext()} {...props} />
);

export const useSubaccount = () => useContext(SubaccountContext);

const useSubaccountContext = () => {
  const dispatch = useAppDispatch();

  const [subaccountNumber] = useState(0);

  useEffect(() => {
    dispatch(clearLocalOrders());
  }, [dispatch]);

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

  // ------ Vault Methods ------ //
  // Vault deposits and withdrawals went through the dYdX validator client, which is never created
  // here, so they fail as they always have until the vault screens reach the engine's vault.
  const depositToMegavault = useCallback(async (_amount: number): Promise<undefined> => {
    throw new Error('client not initialized');
  }, []);

  const withdrawFromMegavault = useCallback(
    async (_shares: number, _minAmount: number): Promise<undefined> => {
      throw new Error('client not initialized');
    },
    []
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

  return {
    transferBetweenSubaccounts,

    // Trading Methods
    placeTriggerOrders,

    // vaults
    depositToMegavault,
    withdrawFromMegavault,

    updateLeverage,
    subaccountNumber,
  };
};

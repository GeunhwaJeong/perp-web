import { RefObject, useCallback, useEffect, useState } from 'react';

import { OrderSide, TradeFormType } from '@/bonsai/forms/trade/types';
import { BonsaiHelpers } from '@/bonsai/ontology';
import BigNumber from 'bignumber.js';

import { STRING_KEYS } from '@/constants/localization';
import { USD_DECIMALS } from '@/constants/numbers';

import { useStringGetter } from '@/hooks/useStringGetter';

import { getIsAccountConnected } from '@/state/accountSelectors';
import { useAppDispatch, useAppSelector } from '@/state/appTypes';
import { tradeFormActions } from '@/state/tradeForm';

import type { ChartHandles } from './useLightweightChart';

type ContextMenu = { x: number; y: number; price: string; side: OrderSide };

/**
 * @description A right click on the chart offers to draft a limit order at that price, on the
 * side of the book the price is on.
 */
export const useChartContextMenu = ({
  handles,
  containerRef,
  tickSizeDecimals,
  enabled,
}: {
  handles?: ChartHandles;
  containerRef: RefObject<HTMLDivElement>;
  tickSizeDecimals?: number | null;
  enabled: boolean;
}) => {
  const dispatch = useAppDispatch();
  const stringGetter = useStringGetter();
  const isAccountConnected = useAppSelector(getIsAccountConnected);
  const midPrice = useAppSelector(BonsaiHelpers.currentMarket.midPrice.data);

  const [menu, setMenu] = useState<ContextMenu>();

  useEffect(() => {
    const container = containerRef.current;
    if (!handles || !container || !enabled) return undefined;

    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      const bookPrice = midPrice?.toNumber();
      if (!isAccountConnected || !bookPrice) {
        setMenu(undefined);
        return;
      }
      const rect = container.getBoundingClientRect();
      const price = handles.candles.coordinateToPrice(event.clientY - rect.top);
      if (price == null || price <= 0) {
        setMenu(undefined);
        return;
      }
      setMenu({
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        price: BigNumber(price).toFixed(tickSizeDecimals ?? USD_DECIMALS),
        side: bookPrice < price ? OrderSide.SELL : OrderSide.BUY,
      });
    };

    container.addEventListener('contextmenu', onContextMenu);
    return () => container.removeEventListener('contextmenu', onContextMenu);
  }, [handles, containerRef, enabled, isAccountConnected, midPrice, tickSizeDecimals]);

  useEffect(() => {
    if (!menu) return undefined;
    const close = () => setMenu(undefined);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('wheel', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('wheel', close);
    };
  }, [menu]);

  const draftLimitOrder = useCallback(() => {
    if (!menu) return;
    // Allow user to keep their previous size input
    dispatch(tradeFormActions.reset(true));
    dispatch(tradeFormActions.setOrderType(TradeFormType.LIMIT));
    dispatch(tradeFormActions.setSide(menu.side));
    dispatch(tradeFormActions.setLimitPrice(menu.price));
    setMenu(undefined);
  }, [dispatch, menu]);

  const label = menu
    ? stringGetter({
        key:
          menu.side === OrderSide.SELL ? STRING_KEYS.DRAFT_LIMIT_SELL : STRING_KEYS.DRAFT_LIMIT_BUY,
        params: { PRICE: menu.price },
      })
    : undefined;

  return { menu, label, draftLimitOrder };
};

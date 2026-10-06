import { useEffect, useMemo, useRef } from 'react';

import type { SubaccountOrder } from '@/bonsai/types/summaryTypes';
import {
  type CreatePriceLineOptions,
  type IPriceLine,
  type ISeriesApi,
  LineStyle,
} from 'lightweight-charts';
import { shallowEqual } from 'react-redux';

import { STRING_KEYS } from '@/constants/localization';
import { ORDER_TYPE_STRINGS } from '@/constants/trade';
import { IndexerOrderSide } from '@/types/indexer/indexerApiGen';

import { useAppThemeAndColorModeContext } from '@/hooks/useAppThemeAndColorMode';
import { useStringGetter } from '@/hooks/useStringGetter';

import {
  getCurrentMarketOrders,
  getCurrentMarketPositionData,
  getIsAccountConnected,
} from '@/state/accountSelectors';
import { useAppSelector } from '@/state/appTypes';

import { isNewOrderStatusOpen } from '@/lib/orders';

import type { ChartHandles } from './useLightweightChart';

export type ChartLine = { key: string; options: CreatePriceLineOptions };

const isOpen = (order: SubaccountOrder) =>
  !order.removalReason && order.status != null && isNewOrderStatusOpen(order.status);

/**
 * @description Draws the current market's position entry and liquidation prices and its open
 * orders as price lines on the candle series.
 */
export const useChartLines = ({
  handles,
  enabled,
}: {
  handles?: ChartHandles;
  enabled: boolean;
}) => {
  const stringGetter = useStringGetter();
  const theme = useAppThemeAndColorModeContext();

  const isAccountConnected = useAppSelector(getIsAccountConnected);
  const position = useAppSelector(getCurrentMarketPositionData);
  const orders: SubaccountOrder[] = useAppSelector(getCurrentMarketOrders, shallowEqual);

  const lines = useMemo((): ChartLine[] => {
    if (!enabled || !isAccountConnected) return [];

    const result: ChartLine[] = [];

    if (position && !position.signedSize.isZero()) {
      const size = position.unsignedSize.toString();
      result.push({
        key: 'entry',
        options: {
          price: position.entryPrice.toNumber(),
          color: theme.textTertiary,
          lineWidth: 1,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: true,
          title: `${stringGetter({ key: STRING_KEYS.ENTRY_PRICE_SHORT })} ${size}`,
        },
      });
      if (position.liquidationPrice && position.liquidationPrice.gt(0)) {
        result.push({
          key: 'liquidation',
          options: {
            price: position.liquidationPrice.toNumber(),
            color: theme.warning,
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: `${stringGetter({ key: STRING_KEYS.LIQUIDATION })} ${size}`,
          },
        });
      }
    }

    orders.filter(isOpen).forEach((order) => {
      const isBuy = order.side === IndexerOrderSide.BUY;
      result.push({
        key: `order-${order.id}`,
        options: {
          price: (order.triggerPrice ?? order.price).toNumber(),
          color: isBuy ? theme.positive : theme.negative,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `${stringGetter({ key: ORDER_TYPE_STRINGS[order.type].orderTypeKey })} ${order.size.toString()}`,
        },
      });
    });

    return result;
  }, [enabled, isAccountConnected, position, orders, theme, stringGetter]);

  const drawnRef = useRef<{ series?: ISeriesApi<'Candlestick'>; lines: Map<string, IPriceLine> }>({
    lines: new Map(),
  });

  useEffect(() => {
    if (!handles) return;
    const drawn = drawnRef.current;
    // Lines of a chart that was removed went with it.
    if (drawn.series !== handles.candles) {
      drawn.series = handles.candles;
      drawn.lines = new Map();
    }

    const keep = new Set<string>();
    lines.forEach(({ key, options }) => {
      keep.add(key);
      const existing = drawn.lines.get(key);
      if (existing) {
        existing.applyOptions(options);
      } else {
        drawn.lines.set(key, handles.candles.createPriceLine(options));
      }
    });
    [...drawn.lines.entries()]
      .filter(([key]) => !keep.has(key))
      .forEach(([key, line]) => {
        handles.candles.removePriceLine(line);
        drawn.lines.delete(key);
      });
  }, [handles, lines]);

  return { lines };
};

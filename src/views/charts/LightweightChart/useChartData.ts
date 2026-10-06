import { useEffect, useRef, useState } from 'react';

// eslint-disable-next-line no-restricted-imports
import { subscribeOnStream, unsubscribeFromStream } from '@/bonsai/websocket/candlesForTradingView';
import type { LogicalRange, UTCTimestamp } from 'lightweight-charts';

import {
  RESOLUTION_CHART_CONFIGS,
  RESOLUTION_TO_INTERVAL_MS,
  ResolutionString,
  TradingViewChartBar,
} from '@/constants/candles';
import type { ThemeColorBase } from '@/constants/styles/colors';

import { useAppThemeAndColorModeContext } from '@/hooks/useAppThemeAndColorMode';
import { useDydxClient } from '@/hooks/useDydxClient';

import { store } from '@/state/_store';

import { mapCandle, mergeBars } from '@/lib/candles';

import { getVolumeColors, RIGHT_OFFSET_BARS } from './theme';
import type { ChartHandles } from './useLightweightChart';

/** Bars fetched when a market or resolution is opened. */
const INITIAL_BARS = 300;
/** Bars fetched when the user scrolls near the oldest loaded bar. */
const PAGE_BARS = 300;
/** Older history is fetched when fewer than this many bars are left to the left of the view. */
const LOAD_MORE_THRESHOLD_BARS = 50;

const toCandle = (bar: TradingViewChartBar) => ({
  time: (bar.time / 1000) as UTCTimestamp,
  open: bar.open,
  high: bar.high,
  low: bar.low,
  close: bar.close,
});

const toVolume = (bar: TradingViewChartBar, colors: ReturnType<typeof getVolumeColors>) => ({
  time: (bar.time / 1000) as UTCTimestamp,
  value: bar.volume,
  color: bar.close >= bar.open ? colors.up : colors.down,
});

/**
 * @description Loads the candles of a market at a resolution into the chart: the latest page
 * on open, older pages as the user scrolls back, and the stream's updates as they arrive.
 */
export const useChartData = ({
  handles,
  marketId,
  resolution,
  tickSizeDecimals,
}: {
  handles?: ChartHandles;
  marketId?: string;
  resolution: ResolutionString;
  tickSizeDecimals?: number | null;
}) => {
  const theme = useAppThemeAndColorModeContext();
  const { getCandlesForDatafeed } = useDydxClient();

  const [isLoading, setIsLoading] = useState(true);
  const barsRef = useRef<TradingViewChartBar[]>([]);

  // The client recreates its functions on every render; the effect reads the latest through refs.
  const getCandlesRef = useRef(getCandlesForDatafeed);
  getCandlesRef.current = getCandlesForDatafeed;
  const themeRef = useRef<ThemeColorBase>(theme);
  themeRef.current = theme;

  useEffect(() => {
    if (!handles) return;
    handles.candles.applyOptions({
      priceFormat: {
        type: 'price',
        precision: tickSizeDecimals ?? 2,
        minMove: 10 ** -(tickSizeDecimals ?? 2),
      },
    });
  }, [handles, tickSizeDecimals]);

  useEffect(() => {
    if (!handles || !marketId) return undefined;

    const intervalMs = RESOLUTION_TO_INTERVAL_MS[resolution]!;
    let dead = false;
    let loadingOlder = false;
    let exhausted = false;

    const apply = (bars: TradingViewChartBar[]) => {
      barsRef.current = bars;
      const colors = getVolumeColors(themeRef.current);
      handles.candles.setData(bars.map(toCandle));
      handles.volume.setData(bars.map((bar) => toVolume(bar, colors)));
    };

    const loadInitial = async () => {
      setIsLoading(true);
      barsRef.current = [];
      const toMs = Date.now();
      const candles = await getCandlesRef
        .current({
          marketId,
          resolution,
          fromMs: toMs - INITIAL_BARS * intervalMs,
          toMs,
          countBack: INITIAL_BARS,
        })
        .catch(() => []);
      if (dead) return;

      exhausted = candles.length < INITIAL_BARS;
      // Bars the stream delivered while the request was in flight are newer than the response.
      const bars = mergeBars(candles.map(mapCandle), barsRef.current);
      apply(bars);
      setIsLoading(false);

      const { defaultRange } = RESOLUTION_CHART_CONFIGS[resolution]!;
      if (defaultRange && bars.length > 0) {
        const last = bars.length - 1;
        handles.chart.timeScale().setVisibleLogicalRange({
          from: Math.max(0, last - Math.ceil(defaultRange / intervalMs)),
          to: last + RIGHT_OFFSET_BARS,
        });
      }
    };

    const loadOlder = async () => {
      const oldest = barsRef.current[0];
      if (loadingOlder || exhausted || !oldest) return;
      loadingOlder = true;

      const toMs = oldest.time - 1;
      const candles = await getCandlesRef
        .current({
          marketId,
          resolution,
          fromMs: toMs - PAGE_BARS * intervalMs,
          toMs,
          countBack: PAGE_BARS,
        })
        .catch(() => []);
      if (dead) return;

      const older = candles.map(mapCandle).filter((bar) => bar.time < oldest.time);
      if (older.length === 0) {
        exhausted = true;
      } else {
        apply(mergeBars(barsRef.current, older));
      }
      loadingOlder = false;
    };

    const onVisibleLogicalRangeChange = (range: LogicalRange | null) => {
      if (range && range.from < LOAD_MORE_THRESHOLD_BARS) {
        loadOlder();
      }
    };
    handles.chart.timeScale().subscribeVisibleLogicalRangeChange(onVisibleLogicalRangeChange);

    const listenerGuid = `${marketId}/${resolution}/${Date.now()}`;
    subscribeOnStream({
      store,
      symbolInfo: { ticker: marketId },
      resolution,
      listenerGuid,
      onRealtimeCallback: (bar) => {
        if (dead) return;
        const last = barsRef.current.at(-1);
        // The series only takes updates at or after its last bar.
        if (last && bar.time < last.time) return;
        barsRef.current = mergeBars(barsRef.current, [bar]);
        handles.candles.update(toCandle(bar));
        handles.volume.update(toVolume(bar, getVolumeColors(themeRef.current)));
      },
      onResetCacheNeededCallback: () => {
        loadInitial();
      },
    });

    loadInitial();

    return () => {
      dead = true;
      unsubscribeFromStream(listenerGuid);
      handles.chart.timeScale().unsubscribeVisibleLogicalRangeChange(onVisibleLogicalRangeChange);
      barsRef.current = [];
    };
  }, [handles, marketId, resolution]);

  useEffect(() => {
    if (!handles || barsRef.current.length === 0) return;
    const colors = getVolumeColors(theme);
    handles.volume.setData(barsRef.current.map((bar) => toVolume(bar, colors)));
  }, [handles, theme]);

  return { isLoading };
};

import { RefObject, useEffect, useState } from 'react';

import {
  CandlestickSeries,
  createChart,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
} from 'lightweight-charts';

import { SUPPORTED_LOCALE_MAP } from '@/constants/localization';

import { useAppThemeAndColorModeContext } from '@/hooks/useAppThemeAndColorMode';

import { useAppSelector } from '@/state/appTypes';
import { getSelectedLocale } from '@/state/localizationSelectors';

import { getCandleOptions, getChartOptions, getVolumeOptions } from './theme';

export type ChartHandles = {
  chart: IChartApi;
  candles: ISeriesApi<'Candlestick'>;
  volume: ISeriesApi<'Histogram'>;
};

/**
 * @description Creates a chart with a candle series and a volume overlay in the container and
 * keeps its colors in step with the app theme.
 */
export const useLightweightChart = ({
  containerRef,
}: {
  containerRef: RefObject<HTMLDivElement>;
}) => {
  const theme = useAppThemeAndColorModeContext();
  const locale = SUPPORTED_LOCALE_MAP[useAppSelector(getSelectedLocale)].baseTag;

  const [handles, setHandles] = useState<ChartHandles>();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const chart = createChart(container, getChartOptions({ theme, locale }));
    const candles = chart.addSeries(CandlestickSeries, getCandleOptions(theme));
    const volume = chart.addSeries(HistogramSeries, getVolumeOptions());
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    setHandles({ chart, candles, volume });

    return () => {
      setHandles(undefined);
      chart.remove();
    };
    // The chart is created once per container; theme and locale are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef]);

  useEffect(() => {
    if (!handles) return;
    handles.chart.applyOptions(getChartOptions({ theme, locale }));
    handles.candles.applyOptions(getCandleOptions(theme));
  }, [handles, theme, locale]);

  return handles;
};

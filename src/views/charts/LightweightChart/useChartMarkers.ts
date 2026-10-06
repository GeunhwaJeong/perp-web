import { useEffect, useRef } from 'react';

import {
  createSeriesMarkers,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';

import { ResolutionString } from '@/constants/candles';
import { IndexerOrderSide } from '@/types/indexer/indexerApiGen';

import { useAppThemeAndColorModeContext } from '@/hooks/useAppThemeAndColorMode';

import { getIsAccountConnected, getMarketFills } from '@/state/accountSelectors';
import { useAppSelector } from '@/state/appTypes';

import { getBarTime } from '@/lib/candles';

import type { ChartHandles } from './useLightweightChart';

/**
 * @description Marks the account's fills in a market on the bars they happened in.
 */
export const useChartMarkers = ({
  handles,
  marketId,
  resolution,
  enabled,
}: {
  handles?: ChartHandles;
  marketId?: string;
  resolution: ResolutionString;
  enabled: boolean;
}) => {
  const theme = useAppThemeAndColorModeContext();
  const isAccountConnected = useAppSelector(getIsAccountConnected);
  const fillsByMarket = useAppSelector(getMarketFills);
  const fills = marketId ? fillsByMarket[marketId] : undefined;

  const markersRef = useRef<ISeriesMarkersPluginApi<Time>>();

  useEffect(() => {
    if (!handles) return undefined;
    const markers = createSeriesMarkers(handles.candles, []);
    markersRef.current = markers;
    return () => {
      markersRef.current = undefined;
      markers.detach();
    };
  }, [handles]);

  useEffect(() => {
    const markers = markersRef.current;
    if (!markers) return;

    const shown: SeriesMarker<Time>[] =
      enabled && isAccountConnected && fills
        ? fills
            .map((fill) => {
              const isBuy = fill.side === IndexerOrderSide.BUY;
              const time = getBarTime(0, new Date(fill.createdAt ?? 0).getTime(), resolution);
              return {
                time: (time ?? 0) as UTCTimestamp,
                position: isBuy ? ('belowBar' as const) : ('aboveBar' as const),
                shape: isBuy ? ('arrowUp' as const) : ('arrowDown' as const),
                color: isBuy ? theme.positive : theme.negative,
                text: isBuy ? 'B' : 'S',
              };
            })
            .sort((a, b) => (a.time as number) - (b.time as number))
        : [];
    markers.setMarkers(shown);
    // handles is read so that markers are set again on a new chart's plugin.
  }, [handles, enabled, isAccountConnected, fills, resolution, theme]);

  return { markers: () => markersRef.current?.markers() ?? [] };
};

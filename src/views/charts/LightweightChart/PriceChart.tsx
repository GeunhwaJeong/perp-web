import { useEffect, useRef, useState } from 'react';

import { BonsaiHelpers } from '@/bonsai/ontology';
import styled from 'styled-components';

import { ButtonShape, ButtonSize } from '@/constants/buttons';
import { DEFAULT_RESOLUTION, RESOLUTION_MAP, ResolutionString } from '@/constants/candles';
import { STRING_KEYS } from '@/constants/localization';
import { DEFAULT_MARKETID } from '@/constants/markets';
import { isDev } from '@/constants/networks';

import { useStringGetter } from '@/hooks/useStringGetter';

import { layoutMixins } from '@/styles/layoutMixins';

import { LoadingSpace } from '@/components/Loading/LoadingSpinner';
import { ToggleButton } from '@/components/ToggleButton';

import { useAppDispatch, useAppSelector } from '@/state/appTypes';
import { getCurrentMarketId } from '@/state/currentMarketSelectors';
import { updateChartResolution } from '@/state/tradingView';
import { getSavedChartResolution } from '@/state/tradingViewSelectors';

import { orEmptyObj } from '@/lib/typeUtils';

import { ResolutionSelector } from './ResolutionSelector';
import { useChartContextMenu } from './useChartContextMenu';
import { useChartData } from './useChartData';
import { useChartLines } from './useChartLines';
import { useChartMarkers } from './useChartMarkers';
import { useLightweightChart } from './useLightweightChart';

const isResolution = (value?: string): value is ResolutionString =>
  value != null && value in RESOLUTION_MAP;

/**
 * @description The price chart of a market: candles and volume from the indexer, the account's
 * orders, position and fills on the current market, and a right click to draft a limit order.
 * Drawn with Lightweight Charts while the charting library is not licensed to this site.
 */
export const PriceChart = ({ marketId: marketIdProp }: { marketId?: string }) => {
  const dispatch = useAppDispatch();
  const stringGetter = useStringGetter();

  const currentMarketId = useAppSelector(getCurrentMarketId);
  const marketId = marketIdProp ?? currentMarketId ?? DEFAULT_MARKETID;
  const isCurrentMarket = marketId === currentMarketId;

  const savedResolution = useAppSelector(getSavedChartResolution);
  const resolution = isResolution(savedResolution) ? savedResolution : DEFAULT_RESOLUTION;

  const { tickSizeDecimals } = orEmptyObj(
    useAppSelector((s) => BonsaiHelpers.markets.selectMarketSummaryById(s, marketId))
  );

  const [orderLinesOn, setOrderLinesOn] = useState(true);
  const [buySellMarksOn, setBuySellMarksOn] = useState(true);

  const containerRef = useRef<HTMLDivElement>(null);
  const handles = useLightweightChart({ containerRef });

  const { isLoading } = useChartData({ handles, marketId, resolution, tickSizeDecimals });
  const { lines } = useChartLines({ handles, enabled: orderLinesOn && isCurrentMarket });
  const { markers } = useChartMarkers({
    handles,
    marketId,
    resolution,
    enabled: buySellMarksOn && isCurrentMarket,
  });
  const contextMenu = useChartContextMenu({
    handles,
    containerRef,
    tickSizeDecimals,
    enabled: isCurrentMarket,
  });

  useEffect(() => {
    if (!isDev || typeof window === 'undefined') return undefined;
    // Lets the localnet browser suite read what the chart holds.
    const dev = (window as unknown as { haneulPerp?: Record<string, unknown> }).haneulPerp;
    if (!dev) return undefined;
    dev.priceChart = { handles, resolution, isLoading, lines, markers };
    return () => {
      delete dev.priceChart;
    };
  }, [handles, resolution, isLoading, lines, markers]);

  return (
    <$Container>
      <$Toolbar>
        <ResolutionSelector
          currentResolution={resolution}
          onResolutionChange={(next) => dispatch(updateChartResolution(next))}
        />
        <div tw="row ml-auto gap-0.5">
          <span title={stringGetter({ key: STRING_KEYS.ORDER_LINES_TOOLTIP })}>
            <$Toggle
              shape={ButtonShape.Pill}
              size={ButtonSize.XSmall}
              isPressed={orderLinesOn}
              onPressedChange={setOrderLinesOn}
            >
              {stringGetter({ key: STRING_KEYS.ORDER_LINES })}
            </$Toggle>
          </span>
          <span title={stringGetter({ key: STRING_KEYS.BUYS_SELLS_TOGGLE_TOOLTIP })}>
            <$Toggle
              shape={ButtonShape.Pill}
              size={ButtonSize.XSmall}
              isPressed={buySellMarksOn}
              onPressedChange={setBuySellMarksOn}
            >
              {stringGetter({ key: STRING_KEYS.BUYS_SELLS_TOGGLE })}
            </$Toggle>
          </span>
        </div>
      </$Toolbar>

      <$ChartArea>
        {isLoading && <LoadingSpace id="price-chart-loading" tw="absolute inset-0" />}
        <div id="price-chart" ref={containerRef} tw="absolute inset-0 isolate" />
        {contextMenu.menu && (
          <$ContextMenu style={{ left: contextMenu.menu.x, top: contextMenu.menu.y }}>
            <button
              type="button"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={contextMenu.draftLimitOrder}
            >
              {contextMenu.label}
            </button>
          </$ContextMenu>
        )}
      </$ChartArea>
    </$Container>
  );
};

const $Container = styled.div`
  ${layoutMixins.flexColumn}
  height: 100%;
  user-select: none;
`;

const $Toolbar = styled.div`
  ${layoutMixins.row}
  flex: 0 0 2.75rem;
  padding: 0 0.5rem;
  border-bottom: var(--border);
`;

const $Toggle = styled(ToggleButton)`
  --button-toggle-off-backgroundColor: transparent;
  --button-toggle-off-textColor: var(--color-text-0);
  --button-toggle-on-backgroundColor: var(--color-layer-3);
  --button-toggle-on-textColor: var(--color-text-2);
`;

const $ChartArea = styled.div`
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  // The chart sizes itself to this box, so the box must not size itself to the chart.
`;

const $ContextMenu = styled.div`
  position: absolute;
  // Above the chart's own layered canvases, which the isolate on the chart box keeps below.
  z-index: 1;
  padding: 0.25rem;
  border: var(--border);
  border-radius: 0.5rem;
  background-color: var(--color-layer-4);
  box-shadow: 0 0 0.5rem var(--color-layer-0);

  button {
    padding: 0.375rem 0.625rem;
    border-radius: 0.375rem;
    color: var(--color-text-2);
    font: var(--font-small-book);
    white-space: nowrap;

    &:hover {
      background-color: var(--color-layer-5);
    }
  }
`;

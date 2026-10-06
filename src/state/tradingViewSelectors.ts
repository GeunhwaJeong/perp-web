import { RootState } from './_store';

/**
 * @returns saved chartConfig for TradingView
 */
export const getTvChartConfig = (
  state: RootState,
  isViewingLaunchableMarket?: boolean,
  isViewingSpotMarket?: boolean
) => {
  if (isViewingSpotMarket) {
    return state.tradingView.spotChartConfig;
  }
  if (isViewingLaunchableMarket) {
    return state.tradingView.launchableMarketsChartConfig;
  }
  return state.tradingView.chartConfig;
};

/**
 * @returns the price chart resolution saved by the user
 */
export const getSavedChartResolution = (state: RootState) => state.tradingView.resolution;

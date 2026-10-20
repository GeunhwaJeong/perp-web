import { OrderSide } from '@/bonsai/types/summaryTypes';
import type { IChartingLibraryWidget } from 'public/tradingview/charting_library';

import type { ChartLineShape } from '@/lib/tradingView/chartLineShape';

export type TvWidget = IChartingLibraryWidget & { _id?: string; _ready?: boolean };

export type PositionLineType = 'entry' | 'liquidation';
export type ChartLineType = OrderSide | PositionLineType;

export type ChartLine = {
  line: ChartLineShape;
  chartLineType: ChartLineType;
};

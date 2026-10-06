import {
  type CandlestickSeriesPartialOptions,
  type ChartOptions,
  ColorType,
  CrosshairMode,
  type DeepPartial,
  type HistogramSeriesPartialOptions,
  TickMarkType,
  type Time,
} from 'lightweight-charts';
import { DateTime } from 'luxon';

import type { ThemeColorBase } from '@/constants/styles/colors';

const FONT_FAMILY = "'Satoshi', system-ui, -apple-system, Helvetica, Arial, sans-serif";

/** Bars the time scale leaves free to the right of the latest bar. */
export const RIGHT_OFFSET_BARS = 5;

// The library lays the time axis out in UTC and only hands the label to format, so a day mark
// sits at UTC midnight and reads the local day as the charting library showed it.
const formatTickMark = (time: Time, tickMarkType: TickMarkType, locale: string) => {
  const dateTime = DateTime.fromSeconds(time as number).setLocale(locale);
  switch (tickMarkType) {
    case TickMarkType.Year:
      return dateTime.toFormat('yyyy');
    case TickMarkType.Month:
      return dateTime.toFormat('LLL');
    case TickMarkType.DayOfMonth:
      return dateTime.toFormat('d');
    case TickMarkType.Time:
      return dateTime.toFormat('HH:mm');
    case TickMarkType.TimeWithSeconds:
      return dateTime.toFormat('HH:mm:ss');
    default:
      return null;
  }
};

export const getChartOptions = ({
  theme,
  locale,
}: {
  theme: ThemeColorBase;
  locale: string;
}): DeepPartial<ChartOptions> => ({
  autoSize: true,
  layout: {
    background: { type: ColorType.Solid, color: theme.layer2 },
    textColor: theme.textPrimary,
    fontSize: 12,
    fontFamily: FONT_FAMILY,
  },
  grid: {
    vertLines: { color: theme.layer3 },
    horzLines: { color: theme.layer3 },
  },
  crosshair: {
    mode: CrosshairMode.Normal,
    vertLine: { color: theme.textTertiary, labelBackgroundColor: theme.layer1 },
    horzLine: { color: theme.textTertiary, labelBackgroundColor: theme.layer1 },
  },
  rightPriceScale: { borderColor: theme.layer3 },
  timeScale: {
    borderColor: theme.layer3,
    timeVisible: true,
    secondsVisible: false,
    rightOffset: RIGHT_OFFSET_BARS,
    tickMarkFormatter: formatTickMark,
  },
  localization: {
    locale,
    timeFormatter: (time: Time) =>
      DateTime.fromSeconds(time as number)
        .setLocale(locale)
        .toFormat('ff'),
  },
});

export const getCandleOptions = (theme: ThemeColorBase): CandlestickSeriesPartialOptions => ({
  upColor: theme.positive,
  downColor: theme.negative,
  borderUpColor: theme.positive,
  borderDownColor: theme.negative,
  wickUpColor: theme.positive,
  wickDownColor: theme.negative,
});

export const getVolumeOptions = (): HistogramSeriesPartialOptions => ({
  priceFormat: { type: 'volume' },
  // An overlay on its own scale under the candles, where the volume study sat.
  priceScaleId: '',
  lastValueVisible: false,
  priceLineVisible: false,
});

export const getVolumeColors = (theme: ThemeColorBase) => ({
  up: theme.positive50,
  down: theme.negative50,
});

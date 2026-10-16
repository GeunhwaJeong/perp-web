import { AppStartupTimer } from '@/bonsai/appStartupTimer';
import { wrapAndLogBonsaiError } from '@/bonsai/logs';
import { BonsaiHelpers } from '@/bonsai/ontology';
// eslint-disable-next-line no-restricted-imports
import { subscribeOnStream, unsubscribeFromStream } from '@/bonsai/websocket/candlesForTradingView';
import { groupBy } from 'lodash';
import type {
  DatafeedConfiguration,
  DatafeedErrorCallback,
  GetMarksCallback,
  HistoryCallback,
  IBasicDataFeed,
  LibrarySymbolInfo,
  Mark,
  OnReadyCallback,
  ResolutionString,
  ResolveCallback,
  SearchSymbolsCallback,
  SubscribeBarsCallback,
} from 'public/tradingview/charting_library';

import { Candle, RESOLUTION_MAP } from '@/constants/candles';
import { StringGetterFunction, SupportedLocales } from '@/constants/localization';
import { DEFAULT_MARKETID } from '@/constants/markets';

import { useDydxClient } from '@/hooks/useDydxClient';

import { Themes } from '@/styles/themes';

import { type RootStore } from '@/state/_store';
import { getMarketFills } from '@/state/accountSelectors';
import { getAppColorMode, getAppTheme } from '@/state/appUiConfigsSelectors';

import { waitForSelector } from '@/lib/asyncUtils';
import { objectKeys } from '@/lib/objectHelpers';
import { orEmptyObj } from '@/lib/typeUtils';

import { log } from '../../telemetry';
import { getSymbol, mapCandle } from '../utils';
import { getBarTime, getMarkForOrderFills } from './utils';

const configurationData: DatafeedConfiguration = {
  supported_resolutions: objectKeys(RESOLUTION_MAP),
  supports_marks: true,
  exchanges: [
    {
      value: 'Sigma', // `exchange` argument for the `searchSymbols` method, if a user selects this exchange
      name: 'Sigma', // filter name
      desc: 'Sigma', // full exchange name displayed in the filter popup
    },
  ],
  symbols_types: [
    {
      name: 'crypto',
      value: 'crypto', // `symbolType` argument for the `searchSymbols` method, if a user selects this symbol type
    },
  ],
};

export const getDydxDatafeed = (
  store: RootStore,
  getCandlesForDatafeed: ReturnType<typeof useDydxClient>['getCandlesForDatafeed'],
  localeSeparators: {
    group?: string;
    decimal?: string;
  },
  selectedLocale: SupportedLocales,
  stringGetter: StringGetterFunction
): IBasicDataFeed => ({
  onReady: (callback: OnReadyCallback) => {
    setTimeout(() => callback(configurationData), 0);
  },

  searchSymbols: (
    userInput: string,
    exchange: string,
    symbolType: string,
    onResultReadyCallback: SearchSymbolsCallback
  ) => {
    onResultReadyCallback([]);
  },

  resolveSymbol: async (symbolName: string, onSymbolResolvedCallback: ResolveCallback) => {
    const symbolItem = getSymbol(symbolName || DEFAULT_MARKETID);
    const { tickSizeDecimals } = orEmptyObj(
      await waitForSelector(store, (s) =>
        BonsaiHelpers.markets.selectMarketSummaryById(s, symbolItem.symbol)
      ).catch(() => undefined)
    );

    const pricescale = tickSizeDecimals != null ? 10 ** tickSizeDecimals : 100;

    const symbolInfo: LibrarySymbolInfo = {
      ticker: symbolItem.symbol,
      name: symbolItem.full_name,
      description: symbolItem.description,
      type: symbolItem.type,
      exchange: 'Sigma',
      listed_exchange: 'Sigma',
      has_intraday: true,
      has_daily: true,

      minmov: 1,
      pricescale,

      session: '24x7',
      intraday_multipliers: ['1', '5', '15', '30', '60', '240'],
      supported_resolutions: configurationData.supported_resolutions!,
      data_status: 'streaming',
      // The exchange's time zone, which sets where bars start: the indexer builds candles on UTC
      // boundaries. The timescale is still shown in the viewer's time zone (the widget's own).
      timezone: 'Etc/UTC',
      format: 'price',
    };

    setTimeout(() => onSymbolResolvedCallback(symbolInfo), 0);
  },

  getMarks: async (
    symbolInfo: LibrarySymbolInfo,
    fromSeconds: number,
    toSeconds: number,
    onDataCallback: GetMarksCallback<Mark>,
    resolution: ResolutionString
  ) => {
    const theme = getAppTheme(store.getState());
    const colorMode = getAppColorMode(store.getState());

    // A range that starts inside its leftmost bar would leave out that bar's earlier fills, which
    // are on screen too, so the range is taken from the bar's UTC start.
    const fromMs = (getBarTime(0, fromSeconds * 1000, resolution) ?? fromSeconds) * 1000;
    const toMs = toSeconds * 1000;
    const market = BonsaiHelpers.markets.selectMarketSummaryById(
      store.getState(),
      symbolInfo.ticker!
    );
    if (!market) return;

    const fills = getMarketFills(store.getState())[symbolInfo.ticker!] ?? [];
    const inRangeFills = fills.filter(
      (fill) =>
        new Date(fill.createdAt ?? 0).getTime() >= fromMs &&
        new Date(fill.createdAt ?? 0).getTime() <= toMs
    );
    const fillsByOrderId = groupBy(inRangeFills, 'orderId');
    const marks = Object.entries(fillsByOrderId).map(([orderId, orderFills]) =>
      getMarkForOrderFills(
        store,
        orderFills,
        market.stepSizeDecimals,
        orderId,
        resolution,
        stringGetter,
        localeSeparators,
        selectedLocale,
        Themes[theme][colorMode]
      )
    );
    onDataCallback(marks);
  },

  getBars: async (
    symbolInfo: LibrarySymbolInfo,
    resolution: ResolutionString,
    periodParams: {
      countBack: number;
      from: number;
      to: number;
      firstDataRequest: boolean;
    },
    onHistoryCallback: HistoryCallback,
    onErrorCallback: DatafeedErrorCallback
  ) => {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!symbolInfo) return;

    const { from, to, countBack } = periodParams;
    // add one to make sure we get current day for 1d view
    const [fromMs, toMs] = [from * 1000, to * 1000 + 1];

    try {
      AppStartupTimer.timeIfFirst('startCandles');
      const fetchedCandles: Candle[] | undefined = await wrapAndLogBonsaiError(
        getCandlesForDatafeed,
        'candles'
      )({
        marketId: symbolInfo.ticker!,
        resolution,
        fromMs,
        toMs,
        countBack,
      });
      AppStartupTimer.timeIfFirst('loadedCandles');

      const bars = fetchedCandles.map(mapCandle).reverse();

      if (bars.length === 0) {
        onHistoryCallback([], {
          noData: true,
        });
      } else {
        onHistoryCallback(bars, {
          noData: false,
        });
      }
    } catch (error) {
      log('tradingView/dydxfeed/getBars', error);
      onErrorCallback(error);
    }
  },

  subscribeBars: (
    symbolInfo: LibrarySymbolInfo,
    resolution: ResolutionString,
    onTick: SubscribeBarsCallback,
    listenerGuid: string,
    onResetCacheNeededCallback: Function
  ) => {
    subscribeOnStream({
      store,
      symbolInfo,
      resolution,
      onRealtimeCallback: onTick,
      listenerGuid,
      onResetCacheNeededCallback,
    });
  },

  unsubscribeBars: (subscriberUID: string) => {
    unsubscribeFromStream(subscriberUID);
  },
});

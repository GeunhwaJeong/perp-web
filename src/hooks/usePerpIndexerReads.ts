// eslint-disable-next-line no-restricted-imports
import { useIndexerClient } from '@/bonsai/rest/lib/useIndexer';
import type { ResolutionString } from 'public/tradingview/charting_library';

import { RawSubaccountFill, RawSubaccountTransfer } from '@/constants/account';
import { RESOLUTION_MAP, RESOLUTION_TO_INTERVAL_MS, type Candle } from '@/constants/candles';

import { log } from '@/lib/telemetry';

const DEFAULT_PAGE_SIZE_TARGET = 1000;
// parallel requests should be limited to prevent hitting 429 errors and failing the whole operation
const DEFAULT_MAX_REQUESTS = 20;

/**
 * The perp-api reads that page through more than one response: the chart's candles and the
 * history export's fills and transfers.
 */
export const usePerpIndexerReads = () => {
  const { indexerClient } = useIndexerClient();

  const requestAllAccountFills = async (address: string, subaccountNumber: number) => {
    try {
      if (indexerClient == null) {
        throw new Error(
          'Attempted to make requestAllAccountFills call while indexerClient is undefined'
        );
      }

      const allFills: RawSubaccountFill[] = [];
      const seenIds = new Set<string>();

      for (let request = 0; request < DEFAULT_MAX_REQUESTS; request += 1) {
        const createdBeforeOrAt = allFills.at(-1)?.createdAt ?? undefined;

        // eslint-disable-next-line no-await-in-loop
        const { fills = [] } = await indexerClient.account.getParentSubaccountNumberFills(
          address,
          subaccountNumber,
          undefined, // ticker
          undefined, // tickerType
          DEFAULT_PAGE_SIZE_TARGET, // limit
          undefined, // createdBeforeOrAtHeight
          createdBeforeOrAt, // createdBeforeOrAt (keyset cursor)
          undefined // page (not used)
        );

        if (fills.length === 0) {
          break;
        }

        const newFills = fills.filter((fill: RawSubaccountFill) => !seenIds.has(fill.id));
        newFills.forEach((fill: RawSubaccountFill) => seenIds.add(fill.id));
        allFills.push(...newFills);

        if (fills.length < DEFAULT_PAGE_SIZE_TARGET) {
          break;
        }
      }

      // sorts the data in descending order
      return allFills.sort((fillA, fillB) => {
        return new Date(fillB.createdAt).getTime() - new Date(fillA.createdAt).getTime();
      });
    } catch (error) {
      log('usePerpIndexerReads/requestAllAccountFills', error);
      return [];
    }
  };

  const requestAllAccountTransfers = async (address: string, subaccountNumber: number) => {
    try {
      if (indexerClient == null) {
        throw new Error(
          'Attempted to make requestAllAccountTransfers call while indexerClient is undefined'
        );
      }
      const {
        transfers = [],
        totalResults,
        pageSize,
      } = await indexerClient.account.getParentSubaccountNumberTransfers(
        address,
        subaccountNumber,
        DEFAULT_PAGE_SIZE_TARGET,
        undefined,
        undefined,
        1
      );

      // We get all the pages but we should exclude the first one, we already have this data
      const pages = Array.from(
        {
          length: Math.ceil(totalResults / pageSize) - 1,
        },
        (_, index) => index + 2
      ).slice(0, DEFAULT_MAX_REQUESTS);

      const results = await Promise.all(
        pages.map((page) =>
          indexerClient.account.getParentSubaccountNumberTransfers(
            address,
            subaccountNumber,
            pageSize,
            undefined,
            undefined,
            page
          )
        )
      );

      const allTransfers: RawSubaccountTransfer[] = [
        ...transfers,
        ...results.map((data) => data.transfers).flat(),
      ];

      // sorts the data in descending order
      return allTransfers.sort((transferA, transferB) => {
        return new Date(transferB.createdAt).getTime() - new Date(transferA.createdAt).getTime();
      });
    } catch (error) {
      log('usePerpIndexerReads/requestAllAccountTransfers', error);
      return [];
    }
  };

  const requestCandles = async ({
    marketId,
    resolution,
    fromIso,
    toIso,
    limit,
  }: {
    marketId: string;
    resolution: ResolutionString;
    fromIso?: string;
    toIso?: string;
    limit?: number;
  }): Promise<Candle[]> => {
    try {
      const { candles } =
        (await indexerClient?.markets.getPerpetualMarketCandles(
          marketId,
          RESOLUTION_MAP[resolution]!,
          fromIso,
          toIso,
          limit
        )) || {};
      return candles || [];
    } catch (error) {
      log('usePerpIndexerReads/getPerpetualMarketCandles', error);
      return [];
    }
  };

  const getCandlesForDatafeed = async ({
    marketId,
    resolution,
    fromMs,
    toMs,
    countBack,
  }: {
    marketId: string;
    resolution: ResolutionString;
    fromMs: number;
    toMs: number;
    countBack: number;
  }) => {
    const fromIso = new Date(fromMs).toISOString();
    let toIso = new Date(toMs).toISOString();
    const candlesInRange: Candle[] = [];

    while (candlesInRange.length < countBack) {
      // eslint-disable-next-line no-await-in-loop
      const candles = await requestCandles({
        marketId,
        resolution,
        fromIso,
        toIso,
      });

      if (!candles || candles.length === 0) {
        break;
      }

      candlesInRange.push(...candles);
      const oldestTime = new Date(candlesInRange.at(-1)!.startedAt).getTime();

      // don't retry if gap is smaller than resolution
      if (oldestTime - fromMs <= RESOLUTION_TO_INTERVAL_MS[resolution]!) {
        break;
      }

      toIso = candlesInRange.at(-1)!.startedAt;
    }

    return candlesInRange;
  };

  return {
    indexerClient,
    requestAllAccountFills,
    requestAllAccountTransfers,
    getCandlesForDatafeed,
  };
};

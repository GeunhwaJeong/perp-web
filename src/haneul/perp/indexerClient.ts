/* eslint-disable max-classes-per-file -- the client and the one error type it throws */
/**
 * REST client for perp-api, which serves the dYdX v4 indexer routes from the Haneul perp indexer.
 * The methods keep the names and argument order of the dYdX `IndexerClient` they replace, so the
 * callers did not change; responses are the indexer's JSON, checked by the callers' own guards.
 */

type QueryValue = string | number | boolean | undefined;

export class IndexerRequestError extends Error {
  constructor(readonly status: number) {
    // Same text as the axios error the dYdX client threw, which some callers match on.
    super(`Request failed with status code ${status}`);
    this.name = 'IndexerRequestError';
  }
}

export class PerpIndexerClient {
  readonly config: { restEndpoint: string; websocketEndpoint: string };

  private readonly host: string;

  constructor(restEndpoint: string, websocketEndpoint: string) {
    this.config = { restEndpoint, websocketEndpoint };
    this.host = restEndpoint.replace(/\/+$/, '');
  }

  readonly account = {
    getParentSubaccountNumberFills: (
      address: string,
      parentSubaccountNumber: number,
      ticker?: string,
      tickerType?: string,
      limit?: number,
      createdBeforeOrAtHeight?: number,
      createdBeforeOrAt?: string,
      page?: number
    ) =>
      this.get('/v4/fills/parentSubaccountNumber', {
        address,
        parentSubaccountNumber,
        ticker,
        // The dYdX client filled this in when left out, and perp-api has always received it.
        tickerType: tickerType ?? 'PERPETUAL',
        limit,
        createdBeforeOrAtHeight,
        createdBeforeOrAt,
        page,
      }),

    getParentSubaccountNumberOrders: (
      address: string,
      parentSubaccountNumber: number,
      ticker?: string,
      side?: string,
      status?: string,
      type?: string,
      limit?: number,
      goodTilBlockBeforeOrAt?: number,
      goodTilBlockTimeBeforeOrAt?: string,
      returnLatestOrders?: boolean
    ) =>
      this.get('/v4/orders/parentSubaccountNumber', {
        address,
        parentSubaccountNumber,
        ticker,
        side,
        status,
        type,
        limit,
        goodTilBlockBeforeOrAt,
        goodTilBlockTimeBeforeOrAt,
        returnLatestOrders,
      }),

    getParentSubaccountNumberTradeHistory: (
      address: string,
      parentSubaccountNumber: number,
      market?: string,
      marketType?: string,
      limit?: number,
      page?: number
    ) =>
      this.get('/v4/tradeHistory/parentSubaccountNumber', {
        address,
        parentSubaccountNumber,
        market,
        marketType,
        limit,
        page,
      }),

    getParentSubaccountNumberTransfers: (
      address: string,
      parentSubaccountNumber: number,
      limit?: number,
      createdBeforeOrAtHeight?: number,
      createdBeforeOrAt?: string,
      page?: number
    ) =>
      this.get('/v4/transfers/parentSubaccountNumber', {
        address,
        parentSubaccountNumber,
        limit,
        createdBeforeOrAtHeight,
        createdBeforeOrAt,
        page,
      }),

    getParentSubaccountNumberFundingPayments: (
      address: string,
      parentSubaccountNumber: number,
      limit?: number,
      ticker?: string,
      afterOrAt?: string,
      page?: number
    ) =>
      this.get('/v4/fundingPayments/parentSubaccount', {
        address,
        parentSubaccountNumber,
        limit,
        ticker,
        afterOrAt,
        page,
      }),

    getParentSubaccountNumberHistoricalPNLsV2: (
      address: string,
      parentSubaccountNumber: number,
      // false or left out is hourly
      daily?: boolean,
      createdBeforeOrAtHeight?: number,
      createdBeforeOrAt?: string,
      createdOnOrAfterHeight?: number,
      createdOnOrAfter?: string
    ) =>
      this.get('/v4/pnl/parentSubaccountNumber', {
        address,
        parentSubaccountNumber,
        createdBeforeOrAtHeight,
        createdBeforeOrAt,
        createdOnOrAfterHeight,
        createdOnOrAfter,
        daily,
      }),

    getHistoricalTradingRewardsAggregations: (
      address: string,
      period: string,
      limit?: number,
      startingBeforeOrAt?: string,
      startingBeforeOrAtHeight?: number
    ) =>
      this.get(`/v4/historicalTradingRewardAggregations/${encodeURIComponent(address)}`, {
        period,
        limit,
        startingBeforeOrAt,
        startingBeforeOrAtHeight,
      }),

    getHistoricalBlockTradingRewards: (
      address: string,
      limit?: number,
      startingBeforeOrAt?: string,
      startingBeforeOrAtHeight?: number
    ) =>
      this.get(`/v4/historicalBlockTradingRewards/${encodeURIComponent(address)}`, {
        limit,
        startingBeforeOrAt,
        startingBeforeOrAtHeight,
      }),
  };

  readonly markets = {
    getPerpetualMarkets: (market?: string) => this.get('/v4/perpetualMarkets', { ticker: market }),

    getPerpetualMarketSparklines: (period = 'ONE_DAY') =>
      this.get('/v4/sparklines', { timePeriod: period }),

    getPerpetualMarketHistoricalFunding: (
      market: string,
      effectiveBeforeOrAt?: string,
      effectiveBeforeOrAtHeight?: number,
      limit?: number
    ) =>
      this.get(`/v4/historicalFunding/${encodeURIComponent(market)}`, {
        effectiveBeforeOrAt,
        effectiveBeforeOrAtHeight,
        limit,
      }),

    getPerpetualMarketCandles: (
      market: string,
      resolution: string,
      fromISO?: string,
      toISO?: string,
      limit?: number
    ) =>
      this.get(`/v4/candles/perpetualMarkets/${encodeURIComponent(market)}`, {
        resolution,
        fromISO,
        toISO,
        limit,
      }),
  };

  readonly utility = {
    getHeightWithHeaders: async () => {
      const response = await this.request('/v4/height');
      const headers: Record<string, string | undefined> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      return { data: await response.json(), headers };
    },

    complianceScreen: (address: string) =>
      this.get(`/v4/compliance/screen/${encodeURIComponent(address)}`),
  };

  private async get(path: string, query: Record<string, QueryValue> = {}): Promise<any> {
    return (await this.request(path, query)).json();
  }

  private async request(path: string, query: Record<string, QueryValue> = {}): Promise<Response> {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined) params.set(key, String(value));
    });
    const search = params.toString();
    const response = await fetch(`${this.host}${path}${search ? `?${search}` : ''}`);
    if (!response.ok) {
      throw new IndexerRequestError(response.status);
    }
    return response;
  }
}

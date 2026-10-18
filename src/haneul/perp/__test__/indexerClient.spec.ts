import { afterEach, describe, expect, it, vi } from 'vitest';

import { IndexerRequestError, PerpIndexerClient } from '../indexerClient';

const ADDRESS = `0x${'ab'.repeat(32)}`;

const stubFetch = (status = 200, body: unknown = {}, headers: Record<string, string> = {}) => {
  const fetchMock = vi.fn(
    async (_url: string) => new Response(JSON.stringify(body), { status, headers })
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const requestedUrl = (fetchMock: ReturnType<typeof stubFetch>) =>
  new URL(fetchMock.mock.calls[0]![0]);

const client = new PerpIndexerClient('https://perp.example/api/', 'wss://perp.example');

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PerpIndexerClient', () => {
  it('drops a trailing slash and sends no query when nothing is set', async () => {
    const fetchMock = stubFetch(200, { markets: {} });
    expect(await client.markets.getPerpetualMarkets()).toEqual({ markets: {} });
    expect(fetchMock.mock.calls[0]![0]).toBe('https://perp.example/api/v4/perpetualMarkets');
  });

  it('leaves out arguments that are not given and keeps the ones that are', async () => {
    const fetchMock = stubFetch();
    await client.account.getParentSubaccountNumberOrders(
      ADDRESS,
      0,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true
    );
    const url = requestedUrl(fetchMock);
    expect(url.pathname).toBe('/api/v4/orders/parentSubaccountNumber');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      address: ADDRESS,
      parentSubaccountNumber: '0',
      returnLatestOrders: 'true',
    });
  });

  it('asks for perpetual fills unless told otherwise, as the dYdX client did', async () => {
    const fetchMock = stubFetch(200, { fills: [] });
    const createdBeforeOrAt = '2026-10-18T10:47:00.000Z';
    await client.account.getParentSubaccountNumberFills(
      ADDRESS,
      0,
      undefined,
      undefined,
      1000,
      undefined,
      createdBeforeOrAt
    );
    const url = requestedUrl(fetchMock);
    expect(url.searchParams.get('tickerType')).toBe('PERPETUAL');
    expect(url.searchParams.get('limit')).toBe('1000');
    expect(url.searchParams.get('createdBeforeOrAt')).toBe(createdBeforeOrAt);
    expect(url.search).toContain('createdBeforeOrAt=2026-10-18T10%3A47%3A00.000Z');
  });

  it('puts the market in the path for candles', async () => {
    const fetchMock = stubFetch(200, { candles: [] });
    await client.markets.getPerpetualMarketCandles(
      'BTC-USD',
      '1HOUR',
      '2026-10-01T00:00:00.000Z',
      '2026-10-02T00:00:00.000Z'
    );
    const url = requestedUrl(fetchMock);
    expect(url.pathname).toBe('/api/v4/candles/perpetualMarkets/BTC-USD');
    expect(url.searchParams.get('resolution')).toBe('1HOUR');
    expect(url.searchParams.has('limit')).toBe(false);
  });

  it('defaults sparklines to one day', async () => {
    const fetchMock = stubFetch();
    await client.markets.getPerpetualMarketSparklines();
    expect(requestedUrl(fetchMock).searchParams.get('timePeriod')).toBe('ONE_DAY');
  });

  it('fails a non-ok response with its status, worded as the axios error was', async () => {
    stubFetch(404, { errors: [{ msg: 'not found' }] });
    const failure = client.utility.complianceScreen(ADDRESS);
    await expect(failure).rejects.toBeInstanceOf(IndexerRequestError);
    await expect(failure).rejects.toMatchObject({
      status: 404,
      message: 'Request failed with status code 404',
    });
  });

  it('returns the height with the response headers keyed in lower case', async () => {
    stubFetch(
      200,
      { height: '17227', time: '2026-10-18T10:47:00.000Z' },
      { 'Geo-Origin-Country': 'KR' }
    );
    const { data, headers } = await client.utility.getHeightWithHeaders();
    expect(data).toEqual({ height: '17227', time: '2026-10-18T10:47:00.000Z' });
    expect(headers['geo-origin-country']).toBe('KR');
    expect(headers['geo-origin-status']).toBeUndefined();
  });
});

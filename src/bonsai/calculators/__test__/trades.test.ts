import { describe, expect, it } from 'vitest';

import { IndexerCompositeTradeHistoryObject } from '@/types/indexer/indexerManual';

import { calculateTrades } from '../trades';

const close = (over: Partial<IndexerCompositeTradeHistoryObject>) =>
  ({
    id: '1',
    marketId: 'BTC-USD',
    side: 'SELL',
    positionSide: 'LONG',
    entryPrice: '64144',
    executionPrice: '64060',
    value: '64.06',
    prevSize: '0.001',
    additionalSize: '0.001',
    netFee: '0.03203',
    time: '2026-11-18T11:44:24.387Z',
    action: 'CLOSE',
    marginMode: 'ISOLATED',
    orderType: 'MARKET',
    netRealizedPnl: '-0.11603',
    netRealizedPnlPercent: '-0.1808898727862309',
    ...over,
  }) as IndexerCompositeTradeHistoryObject;

describe('the closed profit of a trade, as a share of what the closed size cost', () => {
  it('is a fraction, where the API writes percent', () => {
    // 0.11603 lost on the 64.144 the closed 0.001 BTC cost: 0.18%, not 18%.
    const [trade] = calculateTrades([close({})], undefined);
    expect(trade!.closedPnl).toBeCloseTo(-0.11603, 8);
    expect(trade!.netClosedPnlPercent).toBeCloseTo(-0.001808898727862309, 12);
  });

  it('is left out of a trade that closed nothing', () => {
    const [trade] = calculateTrades(
      [close({ action: 'OPEN', netRealizedPnl: null, netRealizedPnlPercent: null })],
      undefined
    );
    expect(trade!.netClosedPnlPercent).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';

import { marketMakerFee, marketTakerFee } from '../tradeInfo';
import { TradeFormInputData } from '../types';

const inputs = (feeMultipliers: TradeFormInputData['feeMultipliers']) =>
  ({
    currentTradeMarketSummary: { takerFee: '0.0005', makerFee: '0.0002' },
    feeMultipliers,
  }) as unknown as TradeFormInputData;

describe('market fee rates', () => {
  it('are the market rates while the account has no tier cached', () => {
    expect(marketTakerFee(inputs(undefined))).toBe(0.0005);
    expect(marketMakerFee(inputs(undefined))).toBe(0.0002);
  });

  it('scale by the multipliers cached on the market', () => {
    const multipliers = { taker: 0.9, maker: 0.9 };
    expect(marketTakerFee(inputs(multipliers))).toBeCloseTo(0.00045, 12);
    expect(marketMakerFee(inputs(multipliers))).toBeCloseTo(0.00018, 12);
  });
});

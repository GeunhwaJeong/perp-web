import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import { LocalStorageKey } from '@/constants/localStorage';
import { DEFAULT_MARKETID, MarketFilters } from '@/constants/markets';

import { getLocalStorage } from '@/lib/localStorage';

export interface PerpetualsState {
  currentMarketId?: string;
  // if user is viewing is a live, tradeable market: its id; otherwise: undefined
  currentMarketIdIfTradeable?: string;
  marketFilter: MarketFilters;
}

const initialState: PerpetualsState = {
  currentMarketId: undefined,
  currentMarketIdIfTradeable: undefined,
  marketFilter: MarketFilters.ALL,
};

export const perpetualsSlice = createSlice({
  name: 'Perpetuals',
  initialState,
  reducers: {
    setMarketFilter: (state: PerpetualsState, action: PayloadAction<MarketFilters>) => {
      state.marketFilter = action.payload;
    },
    setCurrentMarketId: (state: PerpetualsState, action: PayloadAction<string>) => {
      state.currentMarketId = action.payload;
    },
    setCurrentMarketIdIfTradeable: (
      state: PerpetualsState,
      action: PayloadAction<string | undefined>
    ) => {
      state.currentMarketIdIfTradeable = action.payload;
    },
    resetPerpetualsState: () =>
      ({
        ...initialState,
        currentMarketId:
          getLocalStorage({ key: LocalStorageKey.LastViewedMarket }) ?? DEFAULT_MARKETID,
      }) satisfies PerpetualsState,
  },
});

export const {
  setCurrentMarketId,
  setCurrentMarketIdIfTradeable,
  resetPerpetualsState,
  setMarketFilter,
} = perpetualsSlice.actions;

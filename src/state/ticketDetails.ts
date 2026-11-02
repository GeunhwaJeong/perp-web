import type { TicketDetailsJson, TicketKind } from '@/haneul/perp/keeper';
import type { PayloadAction } from '@reduxjs/toolkit';
import { createSlice } from '@reduxjs/toolkit';

import type { IndexerOrderTicket } from '@/types/indexer/indexerManual';

/**
 * The details of the tickets this browser made, kept so the tables can show what the chain
 * keeps only as a commitment: the market of a stop ticket, its trigger prices, a TWAP's size.
 * Keyed by the commitment in hex, which the indexer reports for every ticket, so a ticket is
 * found without its id. Other devices see the tickets without these details.
 */
export type StoredTicketDetails = {
  network: string;
  /** The account's shared object. */
  account: string;
  marketId: string;
  kind: TicketKind;
  /** As handed to the keeper. */
  details: TicketDetailsJson;
  savedAtMs: number;
};

/** A ticket as the tables list it: with its market and the details kept here, when known. */
export type OrderTicketRow = IndexerOrderTicket & {
  marketId?: string;
  stored?: StoredTicketDetails;
};

export interface TicketDetailsState {
  byCommitment: Record<string, StoredTicketDetails>;
}

// Enough for months of tickets; the oldest go first.
const MAX_STORED = 500;

const initialState: TicketDetailsState = { byCommitment: {} };

export const normalizeCommitment = (hex: string) => hex.toLowerCase().replace(/^0x/, '');

export const ticketDetailsSlice = createSlice({
  name: 'TicketDetails',
  initialState,
  reducers: {
    ticketDetailsSaved: (
      state,
      action: PayloadAction<{ commitment: string; entry: StoredTicketDetails }>
    ) => {
      state.byCommitment[normalizeCommitment(action.payload.commitment)] = action.payload.entry;
      const keys = Object.keys(state.byCommitment);
      if (keys.length > MAX_STORED) {
        keys
          .sort((a, b) => state.byCommitment[a]!.savedAtMs - state.byCommitment[b]!.savedAtMs)
          .slice(0, keys.length - MAX_STORED)
          .forEach((key) => {
            delete state.byCommitment[key];
          });
      }
    },
  },
});

export const { ticketDetailsSaved } = ticketDetailsSlice.actions;

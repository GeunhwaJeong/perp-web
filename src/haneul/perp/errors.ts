/**
 * Abort codes of the perpetuals packages, keyed by module. Only the codes a user can hit
 * from the trade form are named; everything else surfaces as `module::code`.
 */
const CLEARING_HOUSE: Record<number, string> = {
  0: 'Amount must be greater than zero',
  1: 'Size must be greater than zero',
  3: 'Order value is below the market minimum',
  9: 'Reduce-only order would increase the position',
  // In this app a session only ends empty when a market order, sent as immediate-or-cancel,
  // found nothing to match inside its worst-price limit.
  11: 'No orders on the book within the price limit',
  14: 'Invalid expiration timestamp',
  15: 'Market open interest cap reached',
  19: 'Size is not a multiple of the lot size',
  20: 'Price is not a multiple of the tick size',
  30: 'Not enough account collateral to allocate for this order',
  32: 'Market is paused',
  35: 'Market is closed',
  37: 'Too many pending orders',
  38: 'Position is above maintenance margin',
  40: 'Insufficient free collateral',
  41: 'Market position already exists',
  42: 'Deallocation would leave the position under-margined',
  44: 'Invalid order type',
  45: 'Not enough liquidity on the book',
  46: 'Fill-or-kill order could not be fully filled',
  47: 'Post-only order would match immediately',
  48: 'Pending orders must be canceled first',
  50: 'Invalid account authority',
  51: 'Taker fills on both sides in one session are not allowed',
  57: 'Position is below maintenance margin; resting orders are not allowed',
  58: 'Order not found',
  3900: 'Invalid order price',
};

const POSITION: Record<number, string> = {
  2001: 'Initial margin requirement not met',
  2002: 'Position would have bad debt',
  2003: 'Leverage exceeds the market maximum',
};

const ACCOUNT: Record<number, string> = {
  4000: 'Wrong authority cap for this account',
  4002: 'Collateral is not registered',
  4004: 'Order belongs to another account',
};

const MARKET: Record<number, string> = {
  1000: 'Index price is stale',
  1003: 'Index diverges from its TWAP',
};

const ORDERBOOK: Record<number, string> = {
  3000: 'Order belongs to another user',
};

const STOP_ORDERS: Record<number, string> = {
  6200: 'Stop order ticket expired',
  6201: 'Stop order conditions not met',
  6202: 'Stop order details do not match the ticket',
  6203: 'Not enough gas escrowed for the stop order',
  6204: 'Executor is not allowed to run this stop order',
  6206: 'No position to attach the stop order to',
};

const TWAP_ORDERS: Record<number, string> = {
  6300: 'TWAP order details do not match the ticket',
  6301: 'TWAP order ticket expired',
  6304: 'TWAP order already fully executed',
  6312: 'TWAP chunk size is not a multiple of the lot size',
};

const BY_MODULE: Record<string, Record<number, string>> = {
  clearing_house: CLEARING_HOUSE,
  position: POSITION,
  account: ACCOUNT,
  market: MARKET,
  orderbook: ORDERBOOK,
  stop_orders: STOP_ORDERS,
  twap_orders: TWAP_ORDERS,
};

export type HaneulAbort = { module: string; code: number; function?: string };

export const describeAbort = ({ module, code }: HaneulAbort) =>
  BY_MODULE[module]?.[code] ?? `Transaction aborted in ${module} with code ${code}`;

export class HaneulTransactionError extends Error {
  readonly abort: HaneulAbort | undefined;

  readonly digest: string | undefined;

  constructor(
    message: string,
    options: { abort?: HaneulAbort; digest?: string; cause?: unknown } = {}
  ) {
    super(message, { cause: options.cause });
    this.name = 'HaneulTransactionError';
    this.abort = options.abort;
    this.digest = options.digest;
  }
}

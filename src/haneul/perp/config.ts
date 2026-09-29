import type { HaneulNetwork } from '../networks';

/**
 * Object and package ids of one perpetuals deployment. Everything a transaction needs to
 * name lives here; nothing is derived from the wallet or from an indexer.
 */
export type PerpMarketConfig = {
  /** UI market id, e.g. "BTC-USD". */
  marketId: string;
  symbol: string;
  clearingHouse: string;
  basePriceFeedStorage: string;
  /** Order size step in base units (9 decimals). */
  lotSize: string;
  /** Order price step in 9-decimal USD units. */
  tickSize: string;
  /** Market initial margin ratio as an ifixed (1e18 scale) string. */
  initialMarginRatio: string;
};

export type PerpDeployment = {
  network: HaneulNetwork;
  packages: {
    perpetuals: string;
    perpetualsOrders: string;
    perpetualsFees: string;
    stakingTiers: string;
    marketMakingVault: string;
    oracleAggregator: string;
    authorityCap: string;
  };
  registry: string;
  collateral: {
    /** Fully qualified coin type of the collateral, e.g. `0x..::tusd::TUSD`. */
    coinType: string;
    decimals: number;
    priceFeedStorage: string;
  };
  /** Present once the fee-tier extension is configured; sessions end through it when set. */
  fees?: {
    schedule: string;
    tierRegistry: string;
  };
  /** Keeper addresses allowed to execute stop and TWAP tickets; empty lets any executor. */
  ticketExecutors: string[];
  /** HANEUL (in its smallest unit) escrowed on each ticket to pay the executor. */
  ticketGas: string;
  markets: Record<string, PerpMarketConfig>;
};

export const CLOCK_OBJECT_ID = '0x6';

const deployments = new Map<HaneulNetwork, Promise<PerpDeployment | undefined>>();

/**
 * Loads the deployment description for a network from the static config folder. A network
 * without a deployment resolves to `undefined` and every write path reports it as
 * unavailable instead of failing deep inside a transaction.
 */
export const loadPerpDeployment = (network: HaneulNetwork) => {
  let pending = deployments.get(network);
  if (!pending) {
    pending = fetch(`/configs/haneul/perp.${network}.json`, { cache: 'no-cache' })
      .then(async (res) => (res.ok ? ((await res.json()) as PerpDeployment) : undefined))
      .catch(() => undefined);
    deployments.set(network, pending);
  }
  return pending;
};

export const resetPerpDeployments = () => deployments.clear();

export const perpTypes = (d: PerpDeployment) => {
  const auth = d.packages.authorityCap;
  const perp = d.packages.perpetuals;
  return {
    admin: `${auth}::authority::ADMIN`,
    accountCap: `${auth}::authority::AuthorityCap<${perp}::authority::ACCOUNT, ${auth}::authority::ADMIN>`,
    account: `${perp}::account::Account<${d.collateral.coinType}>`,
    integratorInfo: `${perp}::account::IntegratorInfo`,
    clearingHouse: `${perp}::clearing_house::ClearingHouse<${d.collateral.coinType}>`,
  };
};

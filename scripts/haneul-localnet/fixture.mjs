#!/usr/bin/env node
/**
 * Localnet fixture for the perpetuals front end.
 *
 *   node scripts/haneul-localnet/fixture.mjs setup   publish the engine, open a BTC/USD market,
 *                                                    fund the dev wallet, seed a maker ladder and
 *                                                    write public/configs/haneul/perp.localnet.json
 *   node scripts/haneul-localnet/fixture.mjs push    keep the mock oracle prices fresh (loop)
 *   node scripts/haneul-localnet/fixture.mjs seed    (re)post the maker ladder
 *
 * Admin operations go through the CLI (`client ptb`), mirroring perp-dex/e2e/localnet_e2e.py,
 * which is the reference for every argument. The dev wallet key is kept in .localnet/ so the
 * browser and the smoke test share one account.
 *
 * Start the network first:  <perp-dex>/deps/bin/haneul start --with-faucet --force-regenesis
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Ed25519Keypair } from '@haneullabs/haneul/keypairs/ed25519';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(HERE, '..', '..');
const PERP_ROOT = process.env.PERP_DEX_ROOT ?? join(homedir(), 'perp-dex');
const CLI = process.env.HANEUL ?? join(PERP_ROOT, 'deps', 'bin', 'haneul');
const LOCAL_DIR = join(WEB_ROOT, '.localnet');
const PUBFILE = join(LOCAL_DIR, 'Pub.localnet.toml');
const STATE_FILE = join(LOCAL_DIR, 'fixture-state.json');
const DEV_KEY_FILE = join(LOCAL_DIR, 'dev-wallet.key');
const CONFIG_FILE = join(WEB_ROOT, 'public', 'configs', 'haneul', 'perp.localnet.json');
const MAINNET_CHAIN_ID = 'a0053d9e';
const GAS_BUDGET = '2000000000';
const CLOCK = '@0x6';

const ONE = 10n ** 18n; // ifixed 1.0
const B9 = 10n ** 9n;
const TUSD_UNIT = 10n ** 6n;
const PACKAGES = [
  'ifixed', 'authority_cap', 'ordered_map', 'af_lp', 'position', 'vendor', 'oracle_aggregator',
  'perpetuals', 'perpetuals_orders', 'staking_tiers', 'perpetuals_fees', 'market_making_vault',
];

// Market parameters, same as the localnet suite.
const IMR = ONE / 10n;
const MMR = ONE / 20n;
const MAKER_FEE = 2n * 10n ** 14n;
const TAKER_FEE = 5n * 10n ** 14n;
const LIQ_FEE = 10n ** 16n;
const IF_FEE = 5n * 10n ** 15n;
const LOT = 1_000_000n; // 0.001 BTC
const TICK = B9; // $1
const PRIORITY_TAKER_FEE = 10n ** 15n;
const BTC0 = 100_000n * ONE;

const log = (...a) => console.log('[fixture]', ...a);
const u64 = (n) => `${n}u64`;
const u16 = (n) => `${n}u16`;
const u128 = (n) => `${n}u128`;
const u256 = (n) => `${n}u256`;
const obj = (id) => `@${id}`;
const call = (target, typeArgs, ...args) => {
  const cmd = ['--move-call', target];
  if (typeArgs?.length) cmd.push(`<${typeArgs.join(',')}>`);
  return [...cmd, ...args];
};
const assign = (name) => ['--assign', name];

const cli = (...args) => {
  const p = spawnSync(CLI, args, { encoding: 'utf8', cwd: PERP_ROOT, maxBuffer: 64 * 1024 * 1024 });
  return { code: p.status, out: (p.stdout ?? '') + (p.stderr ?? ''), stdout: p.stdout ?? '' };
};

const ptb = (label, cmds) => {
  const r = cli('client', 'ptb', ...cmds, '--gas-budget', GAS_BUDGET, '--json');
  if (r.code !== 0) throw new Error(`${label} failed:\n${r.out.slice(-3000)}`);
  const j = JSON.parse(r.stdout);
  if (j.effects?.status?.status !== 'success') throw new Error(`${label} failed on chain: ${JSON.stringify(j.effects?.status)}`);
  return j;
};

const events = (j, suffix) => (j.events ?? []).filter((e) => e.type.split('<')[0].endsWith(suffix)).map((e) => e.parsedJson);
const createdOwned = (j, typeSubstr, suffix = '') =>
  j.objectChanges.find((c) => c.type === 'created' && c.objectType.includes(typeSubstr) && c.objectType.endsWith(suffix) && c.owner?.AddressOwner)?.objectId;
const createdShared = (j, typeSuffix) =>
  j.objectChanges.find((c) => c.type === 'created' && c.objectType.split('<')[0].endsWith(typeSuffix) && c.owner?.Shared)?.objectId;

const safetyCheck = () => {
  const env = cli('client', 'active-env').stdout.trim();
  if (!['local', 'localnet'].includes(env)) throw new Error(`active env is '${env}', expected local/localnet`);
  const chainLine = cli('client', 'chain-identifier').stdout.trim().split('\n').pop() ?? '';
  const chain = chainLine.split(/\s+/).pop();
  if (!chain || chain === MAINNET_CHAIN_ID) throw new Error(`chain '${chain}' is mainnet or unknown`);
  const me = cli('client', 'active-address').stdout.trim();
  log(`localnet chain ${chain}, admin ${me}`);
  return me;
};

const loadDevWallet = () => {
  mkdirSync(LOCAL_DIR, { recursive: true });
  if (existsSync(DEV_KEY_FILE)) {
    return Ed25519Keypair.fromSecretKey(readFileSync(DEV_KEY_FILE, 'utf8').trim());
  }
  const kp = Ed25519Keypair.generate();
  writeFileSync(DEV_KEY_FILE, kp.getSecretKey() + '\n', { mode: 0o600 });
  return kp;
};

const faucet = (address) => {
  const r = cli('client', 'faucet', '--address', address);
  if (r.code !== 0) log(`faucet for ${address.slice(0, 10)} returned ${r.code}: ${r.out.slice(-200)}`);
};

const publishAll = () => {
  if (existsSync(PUBFILE)) unlinkSync(PUBFILE);
  const ids = {};
  for (const name of [...PACKAGES, 'perp_e2e']) {
    const path = join(PERP_ROOT, name === 'perp_e2e' ? 'e2e/perp_e2e' : `packages/${name}`);
    const p = spawnSync(
      CLI,
      ['client', 'test-publish', '--build-env', 'mainnet', '--pubfile-path', PUBFILE, '--gas-budget', GAS_BUDGET, '--json'],
      { encoding: 'utf8', cwd: path, maxBuffer: 64 * 1024 * 1024 }
    );
    if (p.status !== 0) throw new Error(`publish ${name} failed:\n${(p.stdout + p.stderr).slice(-3000)}`);
    const j = JSON.parse(p.stdout);
    if (j.effects.status.status !== 'success') throw new Error(`publish ${name}: ${JSON.stringify(j.effects.status)}`);
    const pkg = j.objectChanges.find((c) => c.type === 'published').packageId;
    ids[name] = { pkg, tx: j };
    log(`published ${name.padEnd(20)} ${pkg}`);
  }
  return ids;
};

const readState = () => JSON.parse(readFileSync(STATE_FILE, 'utf8'));

const refreshPrices = (s, btcPrice) =>
  [
    ...call(`${s.P.perp_e2e}::mock_source::set_price`, [], obj(s.source), obj(s.oracleConfig), obj(s.pfsBtc), u128(btcPrice), CLOCK),
    ...call(`${s.P.perp_e2e}::mock_source::set_price`, [], obj(s.source), obj(s.oracleConfig), obj(s.pfsTusd), u128(ONE), CLOCK),
  ];

const setup = () => {
  const me = safetyCheck();
  faucet(me);
  const dev = loadDevWallet();
  const devAddress = dev.getPublicKey().toHaneulAddress();
  faucet(devAddress);
  faucet(devAddress);

  const ids = publishAll();
  const P = Object.fromEntries(Object.entries(ids).map(([k, v]) => [k, v.pkg]));
  const AUTH = P.authority_cap;
  const VENDOR = P.vendor;
  const ORACLE = P.oracle_aggregator;
  const PERP = P.perpetuals;
  const E2E = P.perp_e2e;
  const ADMIN = `${AUTH}::authority::ADMIN`;
  const TUSD = `${E2E}::tusd::TUSD`;
  const VK = `${E2E}::vendor_key::E2E`;

  const vendorConfig = createdShared(ids.vendor.tx, '::config::Config');
  const vendorPkgAdmin = createdOwned(ids.vendor.tx, '::authority::AuthorityCap<');
  const oracleConfig = createdShared(ids.oracle_aggregator.tx, '::config::Config');
  const oraclePkgAdmin = createdOwned(ids.oracle_aggregator.tx, '::authority::AuthorityCap<');
  const registry = createdShared(ids.perpetuals.tx, '::registry::Registry');
  const perpPkgAdmin = createdOwned(ids.perpetuals.tx, '::authority::AuthorityCap<');
  const tusdTreasury = createdOwned(ids.perp_e2e.tx, '::coin::TreasuryCap<', '::tusd::TUSD>');
  const tusdMetadata = ids.perp_e2e.tx.objectChanges.find(
    (c) => c.type === 'created' && c.objectType.includes('::coin::CoinMetadata<') && c.objectType.endsWith('::tusd::TUSD>')
  ).objectId;

  // Vendor, oracle source, price feeds, extensions.
  let j = ptb('register vendor', call(`${VENDOR}::config::register_vendor`, [VK, ADMIN], obj(vendorConfig), obj(vendorPkgAdmin), obj(me)));
  const vendorVkCap = createdOwned(j, '::authority::AuthorityCap<');

  let cmds = [];
  cmds.push(...call(`${VENDOR}::metadata::new`, [VK, ADMIN], obj(vendorConfig), obj(vendorVkCap), "'Haneul Perps Localnet'", "'front end fixture vendor'"), ...assign('meta'));
  cmds.push(...call(`${VENDOR}::metadata::approve_domain_registration`, [VK, `${ORACLE}::authority::PACKAGE`], 'meta', obj(vendorConfig), obj(oraclePkgAdmin)));
  cmds.push(...call(`${ORACLE}::config::register_vendor`, [VK, ADMIN], obj(oracleConfig), obj(vendorVkCap), obj(vendorConfig), 'meta'), ...assign('oracle_vk'));
  cmds.push(...call(`${PERP}::registry::set_vendor_registration`, [], obj(registry), obj(perpPkgAdmin), 'true'));
  cmds.push(...call(`${PERP}::registry::authorize_extension`, [`${P.perpetuals_orders}::extension::ORDERS`], obj(registry), obj(perpPkgAdmin)));
  cmds.push(...call(`${PERP}::registry::authorize_extension`, [`${P.perpetuals_fees}::extension::FEES`], obj(registry), obj(perpPkgAdmin)));
  cmds.push(...call(`${PERP}::registry::register_vendor`, [VK, ADMIN], obj(registry), obj(vendorVkCap), obj(vendorConfig), 'meta'), ...assign('perp_vk'));
  cmds.push(...call(`${PERP}::registry::create_vendor_treasury_cap`, [VK], obj(registry), 'perp_vk'), ...assign('treasury'));
  cmds.push(...call(`${PERP}::registry::create_vendor_pause_guardian_cap`, [VK], obj(registry), 'perp_vk'), ...assign('pauser'));
  cmds.push(...call(`${E2E}::mock_source::create`, [ADMIN], obj(oracleConfig), obj(oraclePkgAdmin)), ...assign('src'));
  cmds.push(...call(`${E2E}::mock_source::authorize`, [ADMIN], 'src', obj(oracleConfig), obj(oraclePkgAdmin)));
  cmds.push(...call(`${ORACLE}::price_feed_storage::new`, [VK, ADMIN], obj(oracleConfig), 'oracle_vk', "'BTC/USD'"), ...assign('pfs_btc'));
  cmds.push(...call(`${ORACLE}::price_feed_storage::new`, [VK, ADMIN], obj(oracleConfig), 'oracle_vk', "'TUSD/USD'"), ...assign('pfs_tusd'));
  cmds.push(...call(`${E2E}::mock_source::new_price_feed`, [VK, ADMIN], 'src', 'oracle_vk', obj(oracleConfig), 'pfs_btc', u128(BTC0), u64(1), CLOCK));
  cmds.push(...call(`${E2E}::mock_source::new_price_feed`, [VK, ADMIN], 'src', 'oracle_vk', obj(oracleConfig), 'pfs_tusd', u128(ONE), u64(1), CLOCK));
  cmds.push('--make-move-vec', `<${ORACLE}::price_feed_storage::PriceFeedStorage>`, '[pfs_btc, pfs_tusd]', ...assign('pfs_vec'));
  cmds.push(...call(`${ORACLE}::price_feed_storage::share_vec`, [], 'pfs_vec'));
  cmds.push('--transfer-objects', '[meta, oracle_vk, perp_vk, treasury, pauser, src]', obj(me));
  j = ptb('vendor registration, oracle source and price feeds', cmds);

  const sourceId = Number(events(j, '::events::CreatedSource')[0].source_id);
  const storages = Object.fromEntries(events(j, '::events::CreatedPriceFeedStorage').map((e) => [e.symbol, e]));
  const pfsBtc = storages['BTC/USD'].price_feed_storage_obj_id;
  const pfsTusd = storages['TUSD/USD'].price_feed_storage_obj_id;
  const perpVk = createdOwned(j, `AuthorityCap<${PERP}::authority::VENDOR<${VK}>, ${ADMIN}>`);
  const source = createdOwned(j, '::source::Source<');

  // BTC/USD clearing house.
  cmds = [];
  cmds.push(...call(`${PERP}::clearing_house::create_orderbook`, [VK, ADMIN], obj(perpVk), obj(registry), u64(2), u64(4), u64(4), u64(2), u64(3), u64(4)), ...assign('ob'));
  cmds.push(...call(`${PERP}::market::new_creation_params`, [], u256(IMR), u256(MMR), u64(LOT), u64(TICK), u256(0), u256(0)), ...assign('params'));
  cmds.push(...call(`${PERP}::market::set_fees`, [], 'params', u256(MAKER_FEE), u256(TAKER_FEE), u256(LIQ_FEE), u256(IF_FEE)));
  cmds.push(...call(`${PERP}::market::set_funding`, [], 'params', u64(60_000), u64(21_600_000)));
  cmds.push(...call(`${PERP}::market::set_premium_twap`, [], 'params', u64(1_000), u64(60_000)));
  cmds.push(...call(`${PERP}::market::set_spread_twap`, [], 'params', u64(1_000), u64(60_000)));
  cmds.push(...call(`${PERP}::market::set_priority_taker_fee`, [], 'params', `some(${u256(PRIORITY_TAKER_FEE)})`));
  cmds.push(
    ...call(`${PERP}::clearing_house::create_clearing_house`, [TUSD, VK, ADMIN], 'ob', obj(perpVk), obj(registry), obj(tusdMetadata), CLOCK, obj(pfsBtc), obj(pfsTusd), u16(sourceId), u16(sourceId), 'params'),
    ...assign('ch')
  );
  cmds.push(...call(`${PERP}::clearing_house::register_market`, [VK, ADMIN, TUSD], obj(registry), obj(perpVk), 'ch'));
  cmds.push(...call(`${PERP}::clearing_house::share`, [TUSD], 'ch'));
  j = ptb('create BTC/USD clearing house', cmds);
  const clearingHouse = createdShared(j, '::clearing_house::ClearingHouse');
  log(`BTC/USD clearing house ${clearingHouse}`);

  // Collateral for the dev wallet and the admin (maker) account.
  cmds = [];
  cmds.push(...call('0x2::coin::mint', [TUSD], obj(tusdTreasury), u64(1_000_000n * TUSD_UNIT)), ...assign('dev_coin'));
  cmds.push('--transfer-objects', '[dev_coin]', obj(devAddress));
  ptb('mint 1,000,000 TUSD to the dev wallet', cmds);

  const state = {
    me, devAddress, P, registry, oracleConfig, source, pfsBtc, pfsTusd, tusdTreasury, tusdMetadata,
    TUSD, ADMIN, clearingHouse, btcPrice: BTC0.toString(), maker: null,
  };
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

  const config = {
    network: 'localnet',
    packages: {
      perpetuals: PERP,
      perpetualsOrders: P.perpetuals_orders,
      perpetualsFees: P.perpetuals_fees,
      stakingTiers: P.staking_tiers,
      marketMakingVault: P.market_making_vault,
      oracleAggregator: ORACLE,
      authorityCap: AUTH,
    },
    registry,
    collateral: { coinType: TUSD, decimals: 6, priceFeedStorage: pfsTusd },
    ticketExecutors: [],
    ticketGas: '1000000',
    markets: {
      'BTC-USD': {
        marketId: 'BTC-USD',
        symbol: 'BTC',
        clearingHouse,
        basePriceFeedStorage: pfsBtc,
        lotSize: LOT.toString(),
        tickSize: TICK.toString(),
        initialMarginRatio: IMR.toString(),
      },
    },
  };
  mkdirSync(dirname(CONFIG_FILE), { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');
  log(`wrote ${CONFIG_FILE}`);
  seed();
};

/** The admin account posts an ask/bid ladder around the index so takers have liquidity. */
const seed = () => {
  const s = readState();
  const { P, TUSD, ADMIN, registry, clearingHouse: ch, pfsBtc, pfsTusd } = s;
  const PERP = P.perpetuals;
  const E2E = P.perp_e2e;
  let cmds = [];
  if (!s.maker) {
    cmds.push(...call('0x2::coin::mint', [TUSD], obj(s.tusdTreasury), u64(5_000_000n * TUSD_UNIT)), ...assign('coin'));
    cmds.push(...call(`${PERP}::account::create_account`, [TUSD], obj(registry)), ...assign('acc'));
    cmds.push(...call(`${PERP}::account::deposit_collateral`, [TUSD, ADMIN], 'acc.0', 'acc.2', obj(registry), 'coin'));
    cmds.push(...call(`${PERP}::account::consume_policy_and_share_account`, [TUSD], 'acc.0', 'acc.1'));
    cmds.push('--transfer-objects', '[acc.2]', obj(s.me));
    let j = ptb('create the maker account', cmds);
    const ev = events(j, '::events::CreatedAccount')[0];
    const cap = j.objectChanges.find((c) => c.type === 'created' && c.objectType.includes(`AuthorityCap<${PERP}::authority::ACCOUNT, ${ADMIN}>`)).objectId;
    s.maker = { obj: ev.account_obj_id, cap, id: ev.account_id };
    cmds = [];
    cmds.push(...call(`${PERP}::clearing_house::create_market_position`, [TUSD, ADMIN], obj(ch), obj(cap), obj(s.maker.obj)));
    cmds.push(...call(`${PERP}::clearing_house::allocate_collateral`, [TUSD, ADMIN], obj(ch), obj(cap), obj(s.maker.obj), u64(4_000_000n * TUSD_UNIT)));
    ptb('maker position and allocation', cmds);
    writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
  }
  const btc = BigInt(s.btcPrice) / ONE;
  cmds = refreshPrices(s, BigInt(s.btcPrice));
  cmds.push(...call('0x1::option::none', [`${PERP}::account::IntegratorInfo`]), ...assign('no_integrator'));
  cmds.push(...call(`${PERP}::clearing_house::start_session`, [TUSD, ADMIN], obj(ch), obj(s.maker.cap), obj(s.maker.obj), obj(pfsBtc), obj(pfsTusd), 'no_integrator', CLOCK), ...assign('hp'));
  const size = B9 / 2n; // 0.5 BTC per level
  for (let i = 1; i <= 5; i += 1) {
    cmds.push(...call(`${PERP}::clearing_house::place_limit_order`, [TUSD], 'hp', 'true', u64(size), u64((btc + 10n * BigInt(i)) * B9), u64(0), 'none', 'false', 'none'));
    cmds.push(...call(`${PERP}::clearing_house::place_limit_order`, [TUSD], 'hp', 'false', u64(size), u64((btc - 10n * BigInt(i)) * B9), u64(0), 'none', 'false', 'none'));
  }
  cmds.push(...call(`${PERP}::clearing_house::end_session`, [TUSD, ADMIN], 'hp', obj(s.maker.cap), obj(s.maker.obj), 'false', 'false'), ...assign('res'));
  cmds.push(...call(`${PERP}::clearing_house::share`, [TUSD], 'res.0'));
  const j = ptb('maker ladder', cmds);
  log(`maker posted ${events(j, '::events::PostedOrder').length} orders around $${btc}`);
  void E2E;
};

const push = async () => {
  const s = readState();
  const interval = Number(process.env.PUSH_INTERVAL_MS ?? 3000);
  log(`pushing oracle prices every ${interval} ms (ctrl-c to stop)`);
  for (;;) {
    try {
      ptb('refresh prices', refreshPrices(s, BigInt(s.btcPrice)));
    } catch (e) {
      log(`price push failed: ${String(e).slice(0, 200)}`);
    }
    await new Promise((r) => setTimeout(r, interval));
  }
};

const mode = process.argv[2] ?? 'setup';
if (mode === 'setup') setup();
else if (mode === 'seed') seed();
else if (mode === 'push') await push();
else {
  console.error(`unknown mode ${mode}`);
  process.exit(2);
}

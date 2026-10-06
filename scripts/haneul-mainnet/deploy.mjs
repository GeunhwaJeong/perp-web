#!/usr/bin/env node
/**
 * Deploys the Sigma perpetuals engine to a Haneul network, step by step, each step a dry run
 * unless `--execute` is given. The reference for every argument is the localnet fixture
 * (scripts/haneul-localnet/fixture.mjs) and the engine's runbook (perp-dex/docs/market-launch.md).
 *
 *   node scripts/haneul-mainnet/deploy.mjs <step> [options] [--execute]
 *
 *   publish      publish deploy/sigma_support and the thirteen engine packages, in order
 *   configure    vendor registration, extensions, caps, the signed-price source with the
 *                signer registered, and the BTC/USD and TUSD/USD feed storages
 *   feeds        create both price feeds from the price service's signed updates
 *                (`--updates <url>`, the service running without a relayer) and pin TUSD
 *   market       the BTC-USD clearing house with the shadow-run parameters and risk limits
 *   fees         the fee schedule and staking thresholds
 *   insurance    mint TUSD and seed the insurance fund (`--tusd <amount>`)
 *   fund         mint TUSD to a wallet (`--to <address> --tusd <amount>`)
 *   config       write public/configs/haneul/perp.<network>.json and .deploy/oracle-v2.<env>.json
 *   ladder       as the maker (`--admin <maker alias>`): open its account on first use with
 *                `--tusd <deposit>`, then post a bid and ask ladder around the signed price
 *                (`--updates <url>`, `--levels <n>`, `--size <btc per level>`, `--step <usd>`)
 *   signer-seed  write the registered signer's 32-byte seed for ORACLE_SIGNER_SEED to a 600 file
 *
 * Options: --env <cli env> (required; mainnet needs --confirm-mainnet to execute), --admin <alias> (default sigma-admin),
 * --signer <alias> (default sigma-oracle-signer), --updates-url <url> (the service the front
 * end reads), --faucet (non-mainnet only: fund the admin from the faucet first).
 *
 * The CLI is switched to the env and the admin for the run and switched back afterwards.
 * State (package ids, caps, feed ids) is kept in .deploy/<env>.json; publications in
 * .deploy/Pub.<env>.toml. Back both up: the caps in them are the deployment's keys.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(HERE, '..', '..');
const PERP_ROOT = process.env.PERP_DEX_ROOT ?? join(homedir(), 'perp-dex');
const CLI = process.env.HANEUL ?? join(PERP_ROOT, 'deps', 'bin', 'haneul');
const DEPLOY_DIR = join(WEB_ROOT, '.deploy');
const MAINNET_CHAIN_ID = 'a0053d9e';
const MAINNET_ENV = 'haneul-mainnet';
const GAS_BUDGET = '2000000000';
const CLOCK = '@0x6';

const ONE = 10n ** 18n; // ifixed 1.0
const B9 = 10n ** 9n;
const TUSD_UNIT = 10n ** 6n;
const HANEUL_UNIT = 10n ** 9n;

// Engine packages in publish order; oracle_pyth is left out (Pyth is dormant on Haneul).
const PACKAGES = [
  'ifixed', 'authority_cap', 'ordered_map', 'af_lp', 'position', 'vendor', 'oracle_aggregator',
  'oracle_haneul', 'perpetuals', 'perpetuals_orders', 'staking_tiers', 'perpetuals_fees',
  'market_making_vault',
];
const SUPPORT = 'sigma_support';

// ---------------------------------------------------------------- shadow-run parameters
//
// BTC-USD on TUSD. Conservative: 10x at most, a $1M open-interest cap, the engine's default
// tolerances otherwise. Socialization is off (zeros), so the liquidator must run with the ADL
// cap, which configure mints to the admin.
const MARKET = {
  symbol: 'BTC',
  marketId: 'BTC-USD',
  imr: ONE / 10n, // 10% initial margin: 10x
  mmr: ONE / 20n, // 5% maintenance margin
  makerFee: 2n * 10n ** 14n, // 0.02%
  takerFee: 5n * 10n ** 14n, // 0.05%
  liquidationFee: 10n ** 16n, // 1%
  insuranceFundFee: 5n * 10n ** 15n, // 0.5%
  priorityTakerFee: 10n ** 15n, // 0.1% for sessions paying above the reference gas price
  lot: 1_000_000n, // 0.001 BTC
  tick: B9, // $1
  fundingFrequencyMs: 3_600_000n, // funding settles hourly
  fundingPeriodMs: 28_800_000n, // over an eight-hour window
  premiumTwapSampleMs: 1_000n,
  premiumTwapPeriodMs: 60_000n,
  spreadTwapSampleMs: 1_000n,
  spreadTwapPeriodMs: 60_000n,
  maxOpenInterestUsd: 1_000_000n * ONE,
  maxPendingOrders: 100n,
  minOrderUsd: 10n * ONE,
};
// The feed TWAP the markets read (the mark price follows it); a minute as in the oracle-v2
// market check.
const FEED_TWAP_PERIOD_MS = 60_000n;
// Signer registration: one year, renewed by `source::set_signer` again.
const SIGNER_LIFETIME_MS = 365n * 24n * 3_600_000n;
// Fee tiers: one volume tier at the market rates, a 10% staking discount from 10,000 HANEUL,
// multipliers cached for a day, a fourteen-epoch volume window.
const FEES = {
  volumeTierMin: [0n],
  stakingTierMin: [10_000n * HANEUL_UNIT],
  stakingDiscount: [ONE / 10n],
  multiplierLifetimeMs: 86_400_000n,
  windowEpochs: 14n,
};

// ---------------------------------------------------------------- helpers

const log = (...a) => console.log('[deploy]', ...a);
const u64 = (n) => `${n}u64`;
const u16 = (n) => `${n}u16`;
const u32 = (n) => `${n}u32`;
const u128 = (n) => `${n}u128`;
const u256 = (n) => `${n}u256`;
const obj = (id) => `@${id}`;
const some = (v) => `some(${v})`;
const vecU8 = (bytes) => `vector[${Array.from(bytes, (b) => `${b}u8`).join(',')}]`;
const vecU256 = (values) => `[${values.map(u256).join(', ')}]`;
const vecU64 = (values) => `[${values.map(u64).join(', ')}]`;
const call = (target, typeArgs, ...args) => {
  const cmd = ['--move-call', target];
  if (typeArgs?.length) cmd.push(`<${typeArgs.join(',')}>`);
  return [...cmd, ...args];
};
const assign = (name) => ['--assign', name];

const argValue = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
};
const EXECUTE = process.argv.includes('--execute');
const ENV = argValue('--env');
if (!ENV) {
  console.error('deploy.mjs: --env <cli env> is required (haneul-mainnet for the real thing, local for a rehearsal)');
  process.exit(2);
}
const ADMIN_ALIAS = argValue('--admin', 'sigma-admin');
const SIGNER_ALIAS = argValue('--signer', 'sigma-oracle-signer');
const IS_MAINNET = ENV === MAINNET_ENV;
const STATE_FILE = join(DEPLOY_DIR, `${ENV}.json`);
const PUBFILE = join(DEPLOY_DIR, `Pub.${ENV}.toml`);
const NETWORK = IS_MAINNET ? 'mainnet' : 'localnet';
const CONFIG_FILE = join(WEB_ROOT, 'public', 'configs', 'haneul', `perp.${NETWORK}.json`);

const cli = (...args) => {
  const p = spawnSync(CLI, args, { encoding: 'utf8', cwd: PERP_ROOT, maxBuffer: 64 * 1024 * 1024 });
  return { code: p.status, out: (p.stdout ?? '') + (p.stderr ?? ''), stdout: p.stdout ?? '' };
};

const readState = () => (existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : {});
const writeState = (s) => {
  mkdirSync(DEPLOY_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2) + '\n');
};
const need = (s, key, step) => {
  if (s[key] == null) throw new Error(`state has no ${key}: run '${step}' first`);
  return s[key];
};

/** Lines of a dry run or execution worth showing: status and gas. */
const summarize = (out) =>
  out
    .split('\n')
    .filter((l) => /Status:|Storage Cost|Computation Cost|Storage Rebate|Transaction Digest|execution status/.test(l))
    .map((l) => l.replace(/[│╭╰╮╯─]/g, '').trim())
    .filter(Boolean);

/**
 * A programmable transaction: dry-run first and shown; executed only with --execute. Returns
 * the execution's JSON (undefined on a dry run).
 */
const ptb = (label, cmds) => {
  log(`${EXECUTE ? 'executing' : 'dry run'}: ${label}`);
  const dry = cli('client', 'ptb', ...cmds, '--gas-budget', GAS_BUDGET, '--dry-run');
  if (dry.code !== 0 || !/execution status: success/.test(dry.out)) {
    throw new Error(`${label}: dry run failed:\n${dry.out.slice(0, 1500)}\n...\n${dry.out.slice(-1500)}`);
  }
  summarize(dry.out).forEach((l) => console.log('   ', l));
  if (!EXECUTE) return undefined;
  const r = cli('client', 'ptb', ...cmds, '--gas-budget', GAS_BUDGET, '--json');
  if (r.code !== 0) throw new Error(`${label} failed:\n${r.out.slice(-3000)}`);
  const j = JSON.parse(r.stdout);
  if (j.effects?.status?.status !== 'success') throw new Error(`${label} failed on chain: ${JSON.stringify(j.effects?.status)}`);
  log(`   digest ${j.digest}`);
  return j;
};

const events = (j, suffix) => (j.events ?? []).filter((e) => e.type.split('<')[0].endsWith(suffix)).map((e) => e.parsedJson);
const createdOwned = (j, typeSubstr, suffix = '') =>
  j.objectChanges.find((c) => c.type === 'created' && c.objectType.includes(typeSubstr) && c.objectType.endsWith(suffix) && c.owner?.AddressOwner)?.objectId;
const createdShared = (j, typeSuffix) =>
  j.objectChanges.find((c) => c.type === 'created' && c.objectType.split('<')[0].endsWith(typeSuffix) && c.owner?.Shared)?.objectId;
const createdSharedEndingWith = (j, typeSuffix) =>
  j.objectChanges.find((c) => c.type === 'created' && c.objectType.endsWith(typeSuffix) && c.owner?.Shared)?.objectId;

// ---------------------------------------------------------------- CLI environment

const previous = {
  env: cli('client', 'active-env').stdout.trim(),
  address: cli('client', 'active-address').stdout.trim(),
};
const restoreCli = () => {
  cli('client', 'switch', '--env', previous.env);
  cli('client', 'switch', '--address', previous.address);
};
process.on('exit', restoreCli);

const enterCli = () => {
  if (cli('client', 'switch', '--env', ENV).code !== 0) throw new Error(`no CLI env '${ENV}'`);
  if (cli('client', 'switch', '--address', ADMIN_ALIAS).code !== 0) throw new Error(`no address alias '${ADMIN_ALIAS}'`);
  const chainLine = cli('client', 'chain-identifier').stdout.trim().split('\n').pop() ?? '';
  const chain = chainLine.split(/\s+/).pop();
  if (IS_MAINNET && chain !== MAINNET_CHAIN_ID) throw new Error(`env ${ENV} is on chain '${chain}', not mainnet`);
  if (IS_MAINNET && EXECUTE && !process.argv.includes('--confirm-mainnet')) {
    throw new Error('executing on mainnet needs --confirm-mainnet as well as --execute');
  }
  if (!IS_MAINNET && chain === MAINNET_CHAIN_ID) throw new Error(`env ${ENV} is mainnet; use --env ${MAINNET_ENV} on purpose`);
  const me = cli('client', 'active-address').stdout.trim();
  log(`${EXECUTE ? 'EXECUTING on' : 'dry run against'} ${ENV} (chain ${chain}) as ${ADMIN_ALIAS} ${me}`);
  if (process.argv.includes('--faucet')) {
    if (IS_MAINNET) throw new Error('--faucet is for test networks');
    cli('client', 'faucet', '--address', me);
  }
  return me;
};

/** The 32-byte Ed25519 public key of a keystore alias (the listing prefixes a scheme flag). */
const publicKeyOf = (alias) => {
  const r = cli('keytool', 'list', '--json');
  const entry = JSON.parse(r.stdout).find((k) => k.alias === alias);
  if (!entry) throw new Error(`no keystore alias '${alias}'`);
  const bytes = Buffer.from(entry.publicBase64Key, 'base64');
  if (bytes.length !== 33 || bytes[0] !== 0) throw new Error(`${alias} is not an Ed25519 key`);
  return bytes.subarray(1);
};

// ---------------------------------------------------------------- steps

const publishStep = (me) => {
  const s = readState();
  s.me = me;
  s.P = s.P ?? {};
  s.publishTx = s.publishTx ?? {};
  for (const name of [SUPPORT, ...PACKAGES]) {
    if (s.P[name]) {
      log(`${name.padEnd(20)} already published at ${s.P[name]}`);
      continue;
    }
    const path = join(PERP_ROOT, name === SUPPORT ? `deploy/${SUPPORT}` : `packages/${name}`);
    const base = IS_MAINNET
      ? ['client', 'publish', '--pubfile-path', PUBFILE]
      : ['client', 'test-publish', '--build-env', 'mainnet', '--pubfile-path', PUBFILE];
    const run = (extra) =>
      spawnSync(CLI, [...base, '--gas-budget', GAS_BUDGET, ...extra], { encoding: 'utf8', cwd: path, maxBuffer: 64 * 1024 * 1024 });
    log(`${EXECUTE ? 'publishing' : 'dry run'}: ${name}`);
    const dry = run(['--dry-run']);
    const dryOut = (dry.stdout ?? '') + (dry.stderr ?? '');
    if (dry.status !== 0 || !/execution status: success/.test(dryOut)) {
      throw new Error(`publish ${name}: dry run failed:\n${dryOut.slice(-3000)}`);
    }
    summarize(dryOut).forEach((l) => console.log('   ', l));
    if (!EXECUTE) {
      log('stopping after the first package: the next ones need this one published (run with --execute)');
      return;
    }
    const p = run(['--json']);
    if (p.status !== 0) throw new Error(`publish ${name} failed:\n${(p.stdout + p.stderr).slice(-3000)}`);
    const j = JSON.parse(p.stdout);
    if (j.effects.status.status !== 'success') throw new Error(`publish ${name}: ${JSON.stringify(j.effects.status)}`);
    const pkg = j.objectChanges.find((c) => c.type === 'published').packageId;
    s.P[name] = pkg;
    s.publishTx[name] = { digest: j.digest, objectChanges: j.objectChanges };
    writeState(s);
    log(`   ${name.padEnd(20)} ${pkg}  digest ${j.digest}`);
  }
};

const configureStep = (me) => {
  const s = readState();
  const P = need(s, 'P', 'publish');
  for (const name of [SUPPORT, ...PACKAGES]) need(P, name, 'publish');
  const tx = (name) => ({ objectChanges: s.publishTx[name].objectChanges });
  const AUTH = P.authority_cap;
  const VENDOR = P.vendor;
  const ORACLE = P.oracle_aggregator;
  const SIGNED = P.oracle_haneul;
  const PERP = P.perpetuals;
  const ADMIN = `${AUTH}::authority::ADMIN`;
  const VK = `${P[SUPPORT]}::vendor_key::SIGMA`;
  const TUSD = `${P[SUPPORT]}::tusd::TUSD`;

  const vendorConfig = createdShared(tx('vendor'), '::config::Config');
  const vendorPkgAdmin = createdOwned(tx('vendor'), '::authority::AuthorityCap<');
  const oracleConfig = createdShared(tx('oracle_aggregator'), '::config::Config');
  const oraclePkgAdmin = createdOwned(tx('oracle_aggregator'), '::authority::AuthorityCap<');
  const registry = createdShared(tx('perpetuals'), '::registry::Registry');
  const perpPkgAdmin = createdOwned(tx('perpetuals'), '::authority::AuthorityCap<');
  const tierRegistry = createdShared(tx('staking_tiers'), '::registry::TierRegistry');
  const tierAdmin = createdOwned(tx('staking_tiers'), '::registry::AdminCap');
  const feeSchedule = createdShared(tx('perpetuals_fees'), '::config::FeeSchedule');
  const feeScheduleAdmin = createdOwned(tx('perpetuals_fees'), '::config::AdminCap');
  const tusdTreasury = createdOwned(tx(SUPPORT), '::coin::TreasuryCap<', '::tusd::TUSD>');
  const tusdMetadata = tx(SUPPORT).objectChanges.find(
    (c) => c.type === 'created' && c.objectType.includes('::coin::CoinMetadata<') && c.objectType.endsWith('::tusd::TUSD>')
  ).objectId;
  const signerPublicKey = publicKeyOf(SIGNER_ALIAS);
  const expiresAtMs = BigInt(Date.now()) + SIGNER_LIFETIME_MS;
  log(`signer ${SIGNER_ALIAS} public key ${signerPublicKey.toString('hex')} registered until ${new Date(Number(expiresAtMs)).toISOString()}`);

  // 1. The vendor key is registered with the vendor package; its cap is an input of everything after.
  let j;
  let vendorVkCap = s.vendorVkCap;
  if (vendorVkCap) {
    log(`vendor key already registered, cap ${vendorVkCap}`);
  } else {
    j = ptb('register the Sigma vendor key', call(`${VENDOR}::config::register_vendor`, [VK, ADMIN], obj(vendorConfig), obj(vendorPkgAdmin), obj(me)));
    if (!j) return;
    vendorVkCap = createdOwned(j, '::authority::AuthorityCap<');
    Object.assign(s, { me, ADMIN, VK, TUSD, vendorConfig, vendorPkgAdmin, vendorVkCap });
    writeState(s);
  }

  // 2. Oracle and perpetuals registrations, extensions, caps, the signed-price source and its feed storages.
  let cmds = [];
  cmds.push(...call(`${VENDOR}::metadata::new`, [VK, ADMIN], obj(vendorConfig), obj(vendorVkCap), "'Sigma'", "'Sigma perpetuals on Haneul'"), ...assign('meta'));
  cmds.push(...call(`${VENDOR}::metadata::approve_domain_registration`, [VK, `${ORACLE}::authority::PACKAGE`], 'meta', obj(vendorConfig), obj(oraclePkgAdmin)));
  cmds.push(...call(`${ORACLE}::config::register_vendor`, [VK, ADMIN], obj(oracleConfig), obj(vendorVkCap), obj(vendorConfig), 'meta'), ...assign('oracle_vk'));
  cmds.push(...call(`${PERP}::registry::set_vendor_registration`, [], obj(registry), obj(perpPkgAdmin), 'true'));
  cmds.push(...call(`${PERP}::registry::authorize_extension`, [`${P.perpetuals_orders}::extension::ORDERS`], obj(registry), obj(perpPkgAdmin)));
  cmds.push(...call(`${PERP}::registry::authorize_extension`, [`${P.perpetuals_fees}::extension::FEES`], obj(registry), obj(perpPkgAdmin)));
  cmds.push(...call(`${PERP}::registry::register_vendor`, [VK, ADMIN], obj(registry), obj(vendorVkCap), obj(vendorConfig), 'meta'), ...assign('perp_vk'));
  cmds.push(...call(`${PERP}::registry::create_vendor_treasury_cap`, [VK], obj(registry), 'perp_vk'), ...assign('treasury'));
  cmds.push(...call(`${PERP}::registry::create_vendor_pause_guardian_cap`, [VK], obj(registry), 'perp_vk'), ...assign('pauser'));
  cmds.push(...call(`${PERP}::registry::create_package_adl_cap`, [], obj(registry), obj(perpPkgAdmin)), ...assign('adl'));
  cmds.push(...call(`${PERP}::registry::create_package_pause_guardian_cap`, [], obj(registry), obj(perpPkgAdmin)), ...assign('pkg_pauser'));
  // The source keeps its default step limit (0.5% at once plus 0.5% a second, 20% at most).
  cmds.push(...call(`${SIGNED}::source::create`, [ADMIN], obj(oracleConfig), obj(oraclePkgAdmin)), ...assign('src'));
  cmds.push(...call(`${SIGNED}::source::authorize`, [ADMIN], 'src', obj(oracleConfig), obj(oraclePkgAdmin)));
  // oracle_haneul is administered with the aggregator's package admin cap.
  cmds.push(...call(`${SIGNED}::source::set_signer`, [ADMIN], 'src', obj(oracleConfig), obj(oraclePkgAdmin), vecU8(signerPublicKey), u64(expiresAtMs), CLOCK));
  // Shared, so that any transaction can relay a signed update, not only the admin's.
  cmds.push(...call('0x2::transfer::public_share_object', [`${ORACLE}::source::Source<${SIGNED}::source::HANEUL>`], 'src'));
  cmds.push(...call(`${ORACLE}::price_feed_storage::new`, [VK, ADMIN], obj(oracleConfig), 'oracle_vk', "'BTC/USD'"), ...assign('pfs_btc'));
  cmds.push(...call(`${ORACLE}::price_feed_storage::new`, [VK, ADMIN], obj(oracleConfig), 'oracle_vk', "'TUSD/USD'"), ...assign('pfs_tusd'));
  cmds.push('--make-move-vec', `<${ORACLE}::price_feed_storage::PriceFeedStorage>`, '[pfs_btc, pfs_tusd]', ...assign('pfs_vec'));
  cmds.push(...call(`${ORACLE}::price_feed_storage::share_vec`, [], 'pfs_vec'));
  cmds.push('--transfer-objects', '[meta, oracle_vk, perp_vk, treasury, pauser, adl, pkg_pauser]', obj(me));
  j = ptb('registrations, extensions, caps, signed-price source and feed storages', cmds);
  if (!j) return;

  const sourceId = Number(events(j, '::events::CreatedSource')[0].source_id);
  const signedSource = createdSharedEndingWith(j, `::source::Source<${SIGNED}::source::HANEUL>`);
  const storages = Object.fromEntries(events(j, '::events::CreatedPriceFeedStorage').map((e) => [e.symbol, e]));
  const pfsBtc = storages['BTC/USD'].price_feed_storage_obj_id;
  const pfsTusd = storages['TUSD/USD'].price_feed_storage_obj_id;
  const storageIds = { btc: Number(storages['BTC/USD'].storage_id), tusd: Number(storages['TUSD/USD'].storage_id) };
  const perpVk = createdOwned(j, `AuthorityCap<${PERP}::authority::VENDOR<${VK}>, ${ADMIN}>`);
  const oracleVk = createdOwned(j, `AuthorityCap<${ORACLE}::authority::VENDOR<`);
  const adlCap = createdOwned(j, `AuthorityCap<${PERP}::authority::PACKAGE, ${PERP}::authority::ADL>`);
  if (!signedSource) throw new Error('the signed-price source was not shared');

  Object.assign(s, {
    ADMIN, VK, TUSD, vendorConfig, vendorPkgAdmin, vendorVkCap, oracleConfig, oraclePkgAdmin,
    registry, perpPkgAdmin, perpVk, oracleVk, adlCap, tierRegistry, tierAdmin, feeSchedule, feeScheduleAdmin,
    tusdTreasury, tusdMetadata, signedSource, sourceId, pfsBtc, pfsTusd, storageIds,
    signerAlias: SIGNER_ALIAS, signerPublicKey: signerPublicKey.toString('hex'), signerExpiresAtMs: expiresAtMs.toString(),
  });
  writeState(s);
  log(`signed-price source ${signedSource} (source id ${sourceId}); feed storages BTC/USD ${pfsBtc}, TUSD/USD ${pfsTusd}`);
};

const feedsStep = async () => {
  const s = readState();
  need(s, 'signedSource', 'configure');
  const url = argValue('--updates');
  if (!url) throw new Error('feeds needs --updates <url of the price service, run without a relayer>');
  const body = await (await fetch(url)).json();
  if (body.packageId !== s.P.oracle_haneul || body.sourceId !== s.signedSource) {
    throw new Error(`the service signs for package ${body.packageId} source ${body.sourceId}, not this deployment`);
  }
  const byStorage = Object.fromEntries(body.updates.map((u) => [u.priceFeedStorageId, u]));
  const SIGNED = s.P.oracle_haneul;
  let cmds = [];
  for (const pfs of [s.pfsBtc, s.pfsTusd]) {
    const u = byStorage[pfs];
    if (!u) throw new Error(`the service serves no update for feed storage ${pfs}`);
    log(`${u.symbol}: ${u.price} (confidence ${u.confidence}) signed at ${new Date(Number(u.timestampMs)).toISOString()}`);
    cmds.push(
      ...call(
        `${SIGNED}::price_feed_storage::new_price_feed`,
        [s.VK, s.ADMIN],
        obj(s.signedSource), obj(s.oracleVk), obj(s.oracleConfig), obj(pfs),
        u128(u.price), u128(u.confidence), u64(u.timestampMs),
        vecU8(Buffer.from(u.publicKey, 'hex')), vecU8(Buffer.from(u.signature, 'hex')),
        u64(FEED_TWAP_PERIOD_MS), CLOCK
      )
    );
  }
  // TUSD is worth its quote by construction: a zero step limit pins the feed at the price it was created with.
  cmds.push(...call(`${SIGNED}::source::set_step_limit`, [s.ADMIN], obj(s.signedSource), obj(s.oracleConfig), obj(s.oraclePkgAdmin), u32(s.storageIds.tusd), u64(0), u64(0), u64(0)));
  const j = ptb('create the BTC/USD and TUSD/USD feeds from signed prices and pin TUSD', cmds);
  if (!j) return;
  s.feeds = events(j, '::events::CreatedPriceFeed');
  s.btcPriceAtCreation = byStorage[s.pfsBtc].price;
  writeState(s);
  log(`price feeds created: ${s.feeds.length}`);
};

const marketStep = () => {
  const s = readState();
  need(s, 'pfsBtc', 'configure');
  const PERP = s.P.perpetuals;
  const m = MARKET;
  let cmds = [];
  cmds.push(...call(`${PERP}::clearing_house::create_orderbook`, [s.VK, s.ADMIN], obj(s.perpVk), obj(s.registry), u64(2), u64(4), u64(4), u64(2), u64(3), u64(4)), ...assign('ob'));
  cmds.push(...call(`${PERP}::market::new_creation_params`, [], u256(m.imr), u256(m.mmr), u64(m.lot), u64(m.tick), u256(0), u256(0)), ...assign('params'));
  cmds.push(...call(`${PERP}::market::set_fees`, [], 'params', u256(m.makerFee), u256(m.takerFee), u256(m.liquidationFee), u256(m.insuranceFundFee)));
  cmds.push(...call(`${PERP}::market::set_funding`, [], 'params', u64(m.fundingFrequencyMs), u64(m.fundingPeriodMs)));
  cmds.push(...call(`${PERP}::market::set_premium_twap`, [], 'params', u64(m.premiumTwapSampleMs), u64(m.premiumTwapPeriodMs)));
  cmds.push(...call(`${PERP}::market::set_spread_twap`, [], 'params', u64(m.spreadTwapSampleMs), u64(m.spreadTwapPeriodMs)));
  cmds.push(...call(`${PERP}::market::set_priority_taker_fee`, [], 'params', some(u256(m.priorityTakerFee))));
  cmds.push(
    ...call(`${PERP}::clearing_house::create_clearing_house`, [s.TUSD, s.VK, s.ADMIN], 'ob', obj(s.perpVk), obj(s.registry), obj(s.tusdMetadata), CLOCK, obj(s.pfsBtc), obj(s.pfsTusd), u16(s.sourceId), u16(s.sourceId), 'params'),
    ...assign('ch')
  );
  cmds.push(
    ...call(`${PERP}::clearing_house::set_risk_limit_params`, [s.VK, s.ADMIN, s.TUSD], 'ch', obj(s.perpVk), obj(s.registry),
      some(u256(m.minOrderUsd)), some(u64(m.maxPendingOrders)), some(u256(m.maxOpenInterestUsd)), 'none', 'none', 'none', 'none', 'none', 'none', 'none')
  );
  cmds.push(...call(`${PERP}::clearing_house::register_market`, [s.VK, s.ADMIN, s.TUSD], obj(s.registry), obj(s.perpVk), 'ch'));
  cmds.push(...call(`${PERP}::clearing_house::share`, [s.TUSD], 'ch'));
  const j = ptb(`create the ${m.marketId} clearing house (10x, $${m.maxOpenInterestUsd / ONE} OI cap)`, cmds);
  if (!j) return;
  s.clearingHouse = createdShared(j, '::clearing_house::ClearingHouse');
  s.market = { ...Object.fromEntries(Object.entries(m).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v])) };
  writeState(s);
  log(`${m.marketId} clearing house ${s.clearingHouse}`);
};

const feesStep = () => {
  const s = readState();
  need(s, 'feeSchedule', 'configure');
  const m = MARKET;
  let cmds = [];
  cmds.push('--make-move-vec', '<u256>', vecU256(FEES.volumeTierMin), ...assign('vmin'));
  cmds.push('--make-move-vec', '<u256>', vecU256([m.takerFee]), ...assign('vtaker'));
  cmds.push('--make-move-vec', '<u256>', vecU256([m.makerFee]), ...assign('vmaker'));
  cmds.push('--make-move-vec', '<u64>', vecU64(FEES.stakingTierMin), ...assign('smin'));
  cmds.push('--make-move-vec', '<u256>', vecU256(FEES.stakingDiscount), ...assign('sdisc'));
  cmds.push('--make-move-vec', '<u256>', '[]', ...assign('shmin'));
  cmds.push('--make-move-vec', '<u256>', '[]', ...assign('shvol'));
  cmds.push('--make-move-vec', '<u256>', '[]', ...assign('shfee'));
  cmds.push(
    ...call(`${s.P.perpetuals_fees}::config::set_schedule`, [], obj(s.feeSchedule), obj(s.feeScheduleAdmin), u256(m.takerFee), u256(m.makerFee),
      'vmin', 'vtaker', 'vmaker', 'smin', 'sdisc', 'shmin', 'shvol', 'shfee', u64(FEES.multiplierLifetimeMs), u64(FEES.windowEpochs))
  );
  cmds.push('--make-move-vec', '<u64>', vecU64(FEES.stakingTierMin), ...assign('thresholds'));
  cmds.push(...call(`${s.P.staking_tiers}::registry::set_thresholds`, [], obj(s.tierRegistry), obj(s.tierAdmin), 'thresholds'));
  const j = ptb('fee schedule and staking thresholds', cmds);
  if (!j) return;
  s.feesSet = true;
  writeState(s);
};

const mintCommands = (s, amountTusd, assignTo) => [
  ...call('0x2::coin::mint', [s.TUSD], obj(s.tusdTreasury), u64(amountTusd * TUSD_UNIT)),
  ...assign(assignTo),
];

const insuranceStep = () => {
  const s = readState();
  need(s, 'clearingHouse', 'market');
  const amount = BigInt(argValue('--tusd', '100000'));
  const cmds = [
    ...mintCommands(s, amount, 'coin'),
    ...call(`${s.P.perpetuals}::clearing_house::donate_to_insurance_fund`, [s.TUSD], obj(s.clearingHouse), 'coin'),
  ];
  const j = ptb(`mint ${amount} TUSD into the insurance fund`, cmds);
  if (!j) return;
  s.insuranceSeeded = (BigInt(s.insuranceSeeded ?? 0) + amount).toString();
  writeState(s);
};

const fundStep = () => {
  const s = readState();
  need(s, 'tusdTreasury', 'configure');
  const to = argValue('--to');
  const amount = BigInt(argValue('--tusd', '10000'));
  if (!to?.startsWith('0x')) throw new Error('fund needs --to <address>');
  ptb(`mint ${amount} TUSD to ${to}`, [...mintCommands(s, amount, 'coin'), '--transfer-objects', '[coin]', obj(to)]);
};

const configStep = () => {
  const s = readState();
  need(s, 'pfsBtc', 'configure');
  const updatesUrl = argValue('--updates-url', IS_MAINNET ? 'https://oracle.haneul.io/v1/updates' : 'http://127.0.0.1:8787/v1/updates');
  const config = {
    network: NETWORK,
    packages: {
      perpetuals: s.P.perpetuals,
      perpetualsOrders: s.P.perpetuals_orders,
      perpetualsFees: s.P.perpetuals_fees,
      stakingTiers: s.P.staking_tiers,
      marketMakingVault: s.P.market_making_vault,
      oracleAggregator: s.P.oracle_aggregator,
      authorityCap: s.P.authority_cap,
    },
    registry: s.registry,
    collateral: { coinType: s.TUSD, decimals: 6, priceFeedStorage: s.pfsTusd },
    oracle: {
      package: s.P.oracle_haneul,
      source: s.signedSource,
      sourceId: s.sourceId,
      aggregatorConfig: s.oracleConfig,
      updatesUrl,
    },
    fees: { schedule: s.feeSchedule, tierRegistry: s.tierRegistry },
    ticketExecutors: [],
    ticketGas: '1000000',
    markets: {
      [MARKET.marketId]: {
        marketId: MARKET.marketId,
        symbol: MARKET.symbol,
        clearingHouse: s.clearingHouse,
        basePriceFeedStorage: s.pfsBtc,
        lotSize: MARKET.lot.toString(),
        tickSize: MARKET.tick.toString(),
        initialMarginRatio: MARKET.imr.toString(),
        maintenanceMarginRatio: MARKET.mmr.toString(),
      },
    },
  };
  if (s.clearingHouse) {
    mkdirSync(dirname(CONFIG_FILE), { recursive: true });
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');
    log(`wrote ${CONFIG_FILE}`);
  } else {
    log(`no market yet: ${CONFIG_FILE} is written once 'market' has run`);
  }

  const oracle = {
    rpcUrl: IS_MAINNET ? 'http://158.69.54.239:9000' : 'http://127.0.0.1:9000',
    network: NETWORK,
    packageId: s.P.oracle_haneul,
    sourceId: s.signedSource,
    aggregatorConfigId: s.oracleConfig,
    intervalMs: 3000,
    fetchTimeoutMs: 2000,
    httpHost: '127.0.0.1',
    httpPort: 8787,
    batchExchanges: ['kraken'],
    streamExchanges: ['binance', 'okx', 'bybit', 'coinbaseexchange', 'kraken', 'kucoin', 'gate', 'bitstamp'],
    streamMaxAgeMs: 5000,
    quoteRates: {
      USDT: {
        minSources: 2,
        sources: [
          { exchange: 'kraken', market: 'USDT/USD' },
          { exchange: 'coinbaseexchange', market: 'USDT/USD' },
          { exchange: 'bitstamp', market: 'USDT/USD' },
        ],
      },
    },
    feeds: [
      {
        symbol: 'BTC/USD',
        storageId: s.storageIds.btc,
        priceFeedStorageId: s.pfsBtc,
        minSources: 4,
        sources: [
          { exchange: 'binance', market: 'BTC/USDT', weight: 3 },
          { exchange: 'okx', market: 'BTC/USDT', weight: 2 },
          { exchange: 'bybit', market: 'BTC/USDT', weight: 2 },
          { exchange: 'coinbaseexchange', market: 'BTC/USD', weight: 2 },
          { exchange: 'kraken', market: 'BTC/USD' },
          { exchange: 'kucoin', market: 'BTC/USDT' },
          { exchange: 'gate', market: 'BTC/USDT' },
          { exchange: 'bitstamp', market: 'BTC/USD' },
        ],
      },
      { symbol: 'TUSD/USD', storageId: s.storageIds.tusd, priceFeedStorageId: s.pfsTusd, fixedPrice: '1' },
    ],
  };
  const oracleFile = join(DEPLOY_DIR, `oracle-v2.${ENV}.json`);
  writeFileSync(oracleFile, JSON.stringify(oracle, null, 2) + '\n');
  log(`wrote ${oracleFile}`);
};

/** `update_price_feed` calls that relay the served updates in front of a session. */
const relayCommands = (s, updates) =>
  updates.flatMap((u) =>
    call(
      `${s.P.oracle_haneul}::price_feed_storage::update_price_feed`,
      [],
      obj(s.signedSource), obj(s.oracleConfig), obj(u.priceFeedStorageId),
      u128(u.price), u128(u.confidence), u64(u.timestampMs),
      vecU8(Buffer.from(u.publicKey, 'hex')), vecU8(Buffer.from(u.signature, 'hex')),
      CLOCK
    )
  );

/**
 * The maker's ladder. The maker is the active alias; its account is created and funded from
 * the treasury on first use (so the admin's TUSD treasury must be usable by the maker: on
 * mainnet, `fund` the maker from the admin first and pass `--coin <TUSD coin id>`), and every
 * run relays the current prices and posts fresh levels around the signed BTC price.
 */
const ladderStep = async (me) => {
  const s = readState();
  need(s, 'clearingHouse', 'market');
  const url = argValue('--updates');
  if (!url) throw new Error('ladder needs --updates <url of the price service>');
  const levels = Number(argValue('--levels', '5'));
  const sizeBtc = Number(argValue('--size', '0.01'));
  const stepUsd = BigInt(argValue('--step', '20'));
  const PERP = s.P.perpetuals;
  const body = await (await fetch(url)).json();
  const updates = body.updates.filter((u) => [s.pfsBtc, s.pfsTusd].includes(u.priceFeedStorageId));
  const btc = BigInt(updates.find((u) => u.priceFeedStorageId === s.pfsBtc).price) / ONE;
  s.makers = s.makers ?? {};
  let maker = s.makers[me];
  if (!maker) {
    const coin = argValue('--coin');
    const deposit = BigInt(argValue('--tusd', '0'));
    if (!coin && deposit === 0n) throw new Error('first ladder of this maker needs --coin <TUSD coin> or --tusd <amount> (treasury holder)');
    const cmds = [];
    if (coin) {
      cmds.push(...call(`${PERP}::account::create_account`, [s.TUSD], obj(s.registry)), ...assign('acc'));
      cmds.push(...call(`${PERP}::account::deposit_collateral`, [s.TUSD, s.ADMIN], 'acc.0', 'acc.2', obj(s.registry), obj(coin)));
    } else {
      cmds.push(...mintCommands(s, deposit, 'coin'));
      cmds.push(...call(`${PERP}::account::create_account`, [s.TUSD], obj(s.registry)), ...assign('acc'));
      cmds.push(...call(`${PERP}::account::deposit_collateral`, [s.TUSD, s.ADMIN], 'acc.0', 'acc.2', obj(s.registry), 'coin'));
    }
    cmds.push(...call(`${PERP}::account::consume_policy_and_share_account`, [s.TUSD], 'acc.0', 'acc.1'));
    cmds.push('--transfer-objects', '[acc.2]', obj(me));
    const j = ptb(`create the maker account of ${me}`, cmds);
    if (!j) return;
    const ev = events(j, '::events::CreatedAccount')[0];
    const cap = j.objectChanges.find((c) => c.type === 'created' && c.objectType.includes(`AuthorityCap<${PERP}::authority::ACCOUNT, ${s.ADMIN}>`)).objectId;
    maker = { obj: ev.account_obj_id, cap, id: ev.account_id, allocated: false };
    s.makers[me] = maker;
    writeState(s);
  }
  if (!maker.allocated) {
    const allocate = BigInt(argValue('--allocate', '0'));
    if (allocate === 0n) throw new Error('first ladder of this maker needs --allocate <TUSD to the market>');
    const cmds = [
      ...call(`${PERP}::clearing_house::create_market_position`, [s.TUSD, s.ADMIN], obj(s.clearingHouse), obj(maker.cap), obj(maker.obj)),
      ...call(`${PERP}::clearing_house::allocate_collateral`, [s.TUSD, s.ADMIN], obj(s.clearingHouse), obj(maker.cap), obj(maker.obj), u64(allocate * TUSD_UNIT)),
    ];
    const j = ptb(`maker position and ${allocate} TUSD allocation`, cmds);
    if (!j) return;
    maker.allocated = true;
    writeState(s);
  }
  const cmds = relayCommands(s, updates);
  // A later run may top the market up: a new position starts at a margin ratio of 1.0, so
  // the allocation must cover the larger side of the ladder in full.
  const topUp = BigInt(argValue('--allocate', '0'));
  if (maker.allocated && topUp > 0n) {
    cmds.push(...call(`${PERP}::clearing_house::allocate_collateral`, [s.TUSD, s.ADMIN], obj(s.clearingHouse), obj(maker.cap), obj(maker.obj), u64(topUp * TUSD_UNIT)));
  }
  cmds.push(...call('0x1::option::none', [`${PERP}::account::IntegratorInfo`]), ...assign('no_integrator'));
  cmds.push(...call(`${PERP}::clearing_house::start_session`, [s.TUSD, s.ADMIN], obj(s.clearingHouse), obj(maker.cap), obj(maker.obj), obj(s.pfsBtc), obj(s.pfsTusd), 'no_integrator', CLOCK), ...assign('hp'));
  const size = BigInt(Math.round(sizeBtc * 1e9));
  for (let i = 1; i <= levels; i += 1) {
    cmds.push(...call(`${PERP}::clearing_house::place_limit_order`, [s.TUSD], 'hp', 'true', u64(size), u64((btc + stepUsd * BigInt(i)) * B9), u64(0), 'none', 'false', 'none'));
    cmds.push(...call(`${PERP}::clearing_house::place_limit_order`, [s.TUSD], 'hp', 'false', u64(size), u64((btc - stepUsd * BigInt(i)) * B9), u64(0), 'none', 'false', 'none'));
  }
  cmds.push(...call(`${PERP}::clearing_house::end_session`, [s.TUSD, s.ADMIN], 'hp', obj(maker.cap), obj(maker.obj), 'false', 'false'), ...assign('res'));
  cmds.push(...call(`${PERP}::clearing_house::share`, [s.TUSD], 'res.0'));
  const j = ptb(`ladder: ${levels} levels of ${sizeBtc} BTC every $${stepUsd} around $${btc}`, cmds);
  if (!j) return;
  log(`maker posted ${events(j, '::events::PostedOrder').length} orders around $${btc}`);
};

/** Bech32 `haneulprivkey1…` → the 32-byte seed after the scheme flag, for ORACLE_SIGNER_SEED. */
const bech32Decode = (text) => {
  const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  const data = text.slice(text.lastIndexOf('1') + 1).split('').map((c) => CHARSET.indexOf(c));
  const words = data.slice(0, -6);
  const bytes = [];
  let acc = 0;
  let bits = 0;
  for (const w of words) {
    acc = (acc << 5) | w;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
};

const signerSeedStep = () => {
  const r = cli('keytool', 'export', '--key-identity', SIGNER_ALIAS, '--json');
  const key = JSON.parse(r.stdout).exportedPrivateKey;
  const bytes = bech32Decode(key);
  if (bytes.length !== 33 || bytes[0] !== 0) throw new Error('not an Ed25519 key');
  const file = join(DEPLOY_DIR, `oracle-signer.${ENV}.seed`);
  mkdirSync(DEPLOY_DIR, { recursive: true });
  writeFileSync(file, bytes.subarray(1).toString('hex') + '\n', { mode: 0o600 });
  log(`wrote the seed of ${SIGNER_ALIAS} to ${file} (ORACLE_SIGNER_SEED=$(cat ${file}))`);
};

// ---------------------------------------------------------------- main

const step = process.argv[2];
const steps = {
  publish: () => publishStep(enterCli()),
  configure: () => configureStep(enterCli()),
  feeds: () => (enterCli(), feedsStep()),
  market: () => (enterCli(), marketStep()),
  fees: () => (enterCli(), feesStep()),
  insurance: () => (enterCli(), insuranceStep()),
  fund: () => (enterCli(), fundStep()),
  config: () => configStep(),
  ladder: () => ladderStep(enterCli()),
  'signer-seed': () => signerSeedStep(),
};
if (!steps[step]) {
  console.error(`usage: deploy.mjs <${Object.keys(steps).join('|')}> [--execute] [--env <env>] [--admin <alias>]`);
  process.exit(2);
}
await steps[step]();

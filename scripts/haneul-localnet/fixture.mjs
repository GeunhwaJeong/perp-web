#!/usr/bin/env node
/**
 * Localnet fixture for the perpetuals front end.
 *
 *   node scripts/haneul-localnet/fixture.mjs setup   publish the engine and the signed-price source,
 *                                                    open a BTC/USD market, set the fee schedule,
 *                                                    fund the dev wallet, seed a maker ladder and
 *                                                    write public/configs/haneul/perp.localnet.json
 *   node scripts/haneul-localnet/fixture.mjs push    the local price service (loop): signs BTC/USD
 *                                                    and TUSD/USD every round, relays them, and
 *                                                    serves them on GET /v1/updates like oracle-v2
 *   node scripts/haneul-localnet/fixture.mjs push --no-relay
 *                                                    the same service without the relay, so only
 *                                                    trades that carry the served updates go through
 *   node scripts/haneul-localnet/fixture.mjs price <usd>
 *                                                    move the BTC price the service signs
 *   node scripts/haneul-localnet/fixture.mjs seed    (re)post the maker ladder around that price
 *   node scripts/haneul-localnet/fixture.mjs fund <address> [tusd]
 *                                                    gas and test dollars for another wallet
 *   node scripts/haneul-localnet/fixture.mjs oracle-v2-config
 *                                                    write .localnet/oracle-v2.json and print how to run
 *                                                    the real price service (~/oracle-v2) on this
 *                                                    deployment instead of `push`
 *
 * Prices come from the `oracle_haneul` source: an update is accepted on chain when it carries a
 * signature by one of the source's signers. The fixture registers a throwaway signer kept in
 * .localnet/, signs with it the way oracle-v2 does, and the source is shared so any transaction,
 * the front end's included, can relay an update.
 *
 * Admin operations go through the CLI (`client ptb`), mirroring perp-dex/e2e/localnet_e2e.py,
 * which is the reference for every argument. The dev wallet key is kept in .localnet/ so the
 * browser and the smoke test share one account.
 *
 * Start the network first:  <perp-dex>/deps/bin/haneul start --with-faucet --force-regenesis
 */
import { spawnSync } from 'node:child_process';
import { createPrivateKey, createPublicKey, randomBytes, sign as nodeSign } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
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
const SIGNER_SEED_FILE = join(LOCAL_DIR, 'oracle-signer.seed');
const RELAYER_KEY_FILE = join(LOCAL_DIR, 'oracle-relayer.key');
const ORACLE_V2_CONFIG = join(LOCAL_DIR, 'oracle-v2.json');
const CONFIG_FILE = join(WEB_ROOT, 'public', 'configs', 'haneul', 'perp.localnet.json');
const MAINNET_CHAIN_ID = 'a0053d9e';
const GAS_BUDGET = '2000000000';
const CLOCK = '@0x6';
const ORACLE_HOST = '127.0.0.1';
const ORACLE_PORT = Number(process.env.ORACLE_PORT ?? 8787);

const ONE = 10n ** 18n; // ifixed 1.0
const B9 = 10n ** 9n;
const TUSD_UNIT = 10n ** 6n;
const HANEUL_UNIT = 10n ** 9n;
const U64_MAX = 2n ** 64n - 1n;
const PACKAGES = [
  'ifixed', 'authority_cap', 'ordered_map', 'af_lp', 'position', 'vendor', 'oracle_aggregator',
  'oracle_haneul', 'perpetuals', 'perpetuals_orders', 'staking_tiers', 'perpetuals_fees',
  'market_making_vault',
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
const BTC0 = BigInt(process.env.BTC_PRICE ?? 100_000) * ONE;
// A 1 ms TWAP window makes the feed TWAP follow the signed spot price between transactions.
const TWAP_PERIOD_MS = 1n;

const log = (...a) => console.log('[fixture]', ...a);
const u64 = (n) => `${n}u64`;
const u16 = (n) => `${n}u16`;
const u128 = (n) => `${n}u128`;
const u256 = (n) => `${n}u256`;
const obj = (id) => `@${id}`;
const vecU8 = (bytes) => `vector[${Array.from(bytes, (b) => `${b}u8`).join(',')}]`;
const vecU256 = (values) => `[${values.map(u256).join(', ')}]`;
const vecU64 = (values) => `[${values.map(u64).join(', ')}]`;
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
const createdSharedEndingWith = (j, typeSuffix) =>
  j.objectChanges.find((c) => c.type === 'created' && c.objectType.endsWith(typeSuffix) && c.owner?.Shared)?.objectId;

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

const loadKeypair = (file) => {
  mkdirSync(LOCAL_DIR, { recursive: true });
  if (existsSync(file)) {
    return Ed25519Keypair.fromSecretKey(readFileSync(file, 'utf8').trim());
  }
  const kp = Ed25519Keypair.generate();
  writeFileSync(file, kp.getSecretKey() + '\n', { mode: 0o600 });
  return kp;
};

const faucet = (address) => {
  const r = cli('client', 'faucet', '--address', address);
  if (r.code !== 0) log(`faucet for ${address.slice(0, 10)} returned ${r.code}: ${r.out.slice(-200)}`);
};

// ---------------------------------------------------------------- price signer
//
// The message is the BCS encoding of `oracle_haneul::price_feed_storage::PriceUpdate`
// (domain, source object id, storage id, price, confidence, timestamp), byte for byte what
// oracle-v2's `priceUpdateMessage` builds and `price_feed_storage::price_update_message`
// returns on chain.

const MESSAGE_DOMAIN = Buffer.from('haneul_oracle::PriceUpdate', 'ascii');
// DER prefix of a PKCS#8 Ed25519 private key; the 32-byte seed follows.
const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

const littleEndian = (value, bytes) => {
  const out = Buffer.alloc(bytes);
  let rest = BigInt(value);
  for (let i = 0; i < bytes; i += 1) {
    out[i] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return out;
};

const objectIdBytes = (id) => Buffer.from(id.replace(/^0x/i, '').padStart(64, '0'), 'hex');

const priceUpdateMessage = ({ source, storageId, price, confidence, timestampMs }) =>
  Buffer.concat([
    Buffer.of(MESSAGE_DOMAIN.length),
    MESSAGE_DOMAIN,
    objectIdBytes(source),
    littleEndian(storageId, 4),
    littleEndian(price, 16),
    littleEndian(confidence, 16),
    littleEndian(timestampMs, 8),
  ]);

const loadSigner = () => {
  mkdirSync(LOCAL_DIR, { recursive: true });
  if (!existsSync(SIGNER_SEED_FILE)) {
    writeFileSync(SIGNER_SEED_FILE, randomBytes(32).toString('hex') + '\n', { mode: 0o600 });
  }
  const seed = Buffer.from(readFileSync(SIGNER_SEED_FILE, 'utf8').trim(), 'hex');
  const key = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]), format: 'der', type: 'pkcs8' });
  const spki = createPublicKey(key).export({ format: 'der', type: 'spki' });
  return { publicKey: spki.subarray(spki.length - 32), sign: (message) => nodeSign(null, message, key) };
};

// Feeds skip an update that is not newer than the stored one, so timestamps only go up. They
// trail the wall clock a little: the chain refuses a timestamp ahead of its own clock by more
// than the source's drift bound.
let lastSignedMs = 0n;
const signTimestamp = () => {
  const now = BigInt(Date.now() - 200);
  lastSignedMs = now > lastSignedMs ? now : lastSignedMs + 1n;
  return lastSignedMs;
};

/** A signed update of one feed, in the shape oracle-v2 serves on `/v1/updates`. */
const signedUpdate = (signer, s, feed, price) => {
  const timestampMs = signTimestamp();
  const confidence = 0n;
  const signature = signer.sign(priceUpdateMessage({ source: s.signedSource, storageId: feed.storageId, price, confidence, timestampMs }));
  return {
    symbol: feed.symbol,
    storageId: feed.storageId,
    priceFeedStorageId: feed.pfs,
    price: price.toString(),
    confidence: confidence.toString(),
    timestampMs: timestampMs.toString(),
    publicKey: Buffer.from(signer.publicKey).toString('hex'),
    signature: Buffer.from(signature).toString('hex'),
  };
};

const feedsOf = (s) => [
  { symbol: 'BTC/USD', pfs: s.pfsBtc, storageId: s.storageIds.btc },
  { symbol: 'TUSD/USD', pfs: s.pfsTusd, storageId: s.storageIds.tusd },
];

const currentUpdates = (signer, s) =>
  feedsOf(s).map((feed) => signedUpdate(signer, s, feed, feed.pfs === s.pfsBtc ? BigInt(s.btcPrice) : ONE));

/** `update_price_feed` calls that relay the given updates. */
const relayCommands = (s, updates) =>
  updates.flatMap((u) =>
    call(
      `${s.P.oracle_haneul}::price_feed_storage::update_price_feed`,
      [],
      obj(s.signedSource),
      obj(s.oracleConfig),
      obj(u.priceFeedStorageId),
      u128(u.price),
      u128(u.confidence),
      u64(u.timestampMs),
      vecU8(Buffer.from(u.publicKey, 'hex')),
      vecU8(Buffer.from(u.signature, 'hex')),
      CLOCK
    )
  );

// ---------------------------------------------------------------- setup

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
const writeState = (s) => writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));

const setup = () => {
  const me = safetyCheck();
  faucet(me);
  const dev = loadKeypair(DEV_KEY_FILE);
  const devAddress = dev.getPublicKey().toHaneulAddress();
  faucet(devAddress);
  faucet(devAddress);
  const relayer = loadKeypair(RELAYER_KEY_FILE);
  faucet(relayer.getPublicKey().toHaneulAddress());
  const signer = loadSigner();

  const ids = publishAll();
  const P = Object.fromEntries(Object.entries(ids).map(([k, v]) => [k, v.pkg]));
  const AUTH = P.authority_cap;
  const VENDOR = P.vendor;
  const ORACLE = P.oracle_aggregator;
  const SIGNED = P.oracle_haneul;
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
  const tierRegistry = createdShared(ids.staking_tiers.tx, '::registry::TierRegistry');
  const tierAdmin = createdOwned(ids.staking_tiers.tx, '::registry::AdminCap');
  const feeSchedule = createdShared(ids.perpetuals_fees.tx, '::config::FeeSchedule');
  const feeScheduleAdmin = createdOwned(ids.perpetuals_fees.tx, '::config::AdminCap');
  const tusdTreasury = createdOwned(ids.perp_e2e.tx, '::coin::TreasuryCap<', '::tusd::TUSD>');
  const tusdMetadata = ids.perp_e2e.tx.objectChanges.find(
    (c) => c.type === 'created' && c.objectType.includes('::coin::CoinMetadata<') && c.objectType.endsWith('::tusd::TUSD>')
  ).objectId;

  // Vendor, the signed-price source and its feed storages, extensions.
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
  // The source keeps its default step limit (0.5% at once plus 0.5% a second, 20% at most),
  // the bound a live feed runs under.
  cmds.push(...call(`${SIGNED}::source::create`, [ADMIN], obj(oracleConfig), obj(oraclePkgAdmin)), ...assign('src'));
  cmds.push(...call(`${SIGNED}::source::authorize`, [ADMIN], 'src', obj(oracleConfig), obj(oraclePkgAdmin)));
  cmds.push(...call(`${SIGNED}::source::set_signer`, [ADMIN], 'src', obj(oracleConfig), obj(oraclePkgAdmin), vecU8(signer.publicKey), u64(U64_MAX), CLOCK));
  // Shared, so that any transaction can relay a signed update, not only the admin's.
  cmds.push(...call('0x2::transfer::public_share_object', [`${ORACLE}::source::Source<${SIGNED}::source::HANEUL>`], 'src'));
  cmds.push(...call(`${ORACLE}::price_feed_storage::new`, [VK, ADMIN], obj(oracleConfig), 'oracle_vk', "'BTC/USD'"), ...assign('pfs_btc'));
  cmds.push(...call(`${ORACLE}::price_feed_storage::new`, [VK, ADMIN], obj(oracleConfig), 'oracle_vk', "'TUSD/USD'"), ...assign('pfs_tusd'));
  cmds.push('--make-move-vec', `<${ORACLE}::price_feed_storage::PriceFeedStorage>`, '[pfs_btc, pfs_tusd]', ...assign('pfs_vec'));
  cmds.push(...call(`${ORACLE}::price_feed_storage::share_vec`, [], 'pfs_vec'));
  cmds.push('--transfer-objects', '[meta, oracle_vk, perp_vk, treasury, pauser]', obj(me));
  j = ptb('vendor registration, signed-price source and feed storages', cmds);

  const sourceId = Number(events(j, '::events::CreatedSource')[0].source_id);
  const signedSource = createdSharedEndingWith(j, `::source::Source<${SIGNED}::source::HANEUL>`);
  const storages = Object.fromEntries(events(j, '::events::CreatedPriceFeedStorage').map((e) => [e.symbol, e]));
  const pfsBtc = storages['BTC/USD'].price_feed_storage_obj_id;
  const pfsTusd = storages['TUSD/USD'].price_feed_storage_obj_id;
  const storageIds = { btc: Number(storages['BTC/USD'].storage_id), tusd: Number(storages['TUSD/USD'].storage_id) };
  const perpVk = createdOwned(j, `AuthorityCap<${PERP}::authority::VENDOR<${VK}>, ${ADMIN}>`);
  const oracleVk = createdOwned(j, `AuthorityCap<${ORACLE}::authority::VENDOR<`);
  if (!signedSource) throw new Error('the signed-price source was not shared');
  log(`signed-price source ${signedSource} (source id ${sourceId}), signer ${signer.publicKey.toString('hex').slice(0, 16)}...`);

  const partial = { P, oracleConfig, signedSource, pfsBtc, pfsTusd, storageIds, btcPrice: BTC0.toString() };
  cmds = [];
  for (const u of currentUpdates(signer, partial)) {
    cmds.push(
      ...call(
        `${SIGNED}::price_feed_storage::new_price_feed`,
        [VK, ADMIN],
        obj(signedSource),
        obj(oracleVk),
        obj(oracleConfig),
        obj(u.priceFeedStorageId),
        u128(u.price),
        u128(u.confidence),
        u64(u.timestampMs),
        vecU8(Buffer.from(u.publicKey, 'hex')),
        vecU8(Buffer.from(u.signature, 'hex')),
        u64(TWAP_PERIOD_MS),
        CLOCK
      )
    );
  }
  j = ptb('signed price feeds', cmds);
  log(`price feeds created: ${events(j, '::events::CreatedPriceFeed').length}`);

  // BTC/USD clearing house on the signed source: the market stops when the base price is older
  // than ten seconds (the engine's default tolerance), which is what the relay has to prevent.
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

  // Fee tiers at the market's own rates: one volume tier, a 10% staking discount from 100
  // HANEUL. Sessions that end through the extension record their volume against it.
  cmds = [];
  cmds.push('--make-move-vec', '<u256>', vecU256([0n]), ...assign('vmin'));
  cmds.push('--make-move-vec', '<u256>', vecU256([TAKER_FEE]), ...assign('vtaker'));
  cmds.push('--make-move-vec', '<u256>', vecU256([MAKER_FEE]), ...assign('vmaker'));
  cmds.push('--make-move-vec', '<u64>', vecU64([100n * HANEUL_UNIT]), ...assign('smin'));
  cmds.push('--make-move-vec', '<u256>', vecU256([ONE / 10n]), ...assign('sdisc'));
  cmds.push('--make-move-vec', '<u256>', '[]', ...assign('shmin'));
  cmds.push('--make-move-vec', '<u256>', '[]', ...assign('shvol'));
  cmds.push('--make-move-vec', '<u256>', '[]', ...assign('shfee'));
  cmds.push(
    ...call(`${P.perpetuals_fees}::config::set_schedule`, [], obj(feeSchedule), obj(feeScheduleAdmin), u256(TAKER_FEE), u256(MAKER_FEE), 'vmin', 'vtaker', 'vmaker', 'smin', 'sdisc', 'shmin', 'shvol', 'shfee', u64(86_400_000), u64(14))
  );
  cmds.push('--make-move-vec', '<u64>', vecU64([100n * HANEUL_UNIT]), ...assign('thresholds'));
  cmds.push(...call(`${P.staking_tiers}::registry::set_thresholds`, [], obj(tierRegistry), obj(tierAdmin), 'thresholds'));
  ptb('fee schedule and staking thresholds', cmds);

  // Collateral for the dev wallet.
  cmds = [];
  cmds.push(...call('0x2::coin::mint', [TUSD], obj(tusdTreasury), u64(1_000_000n * TUSD_UNIT)), ...assign('dev_coin'));
  cmds.push('--transfer-objects', '[dev_coin]', obj(devAddress));
  ptb('mint 1,000,000 TUSD to the dev wallet', cmds);

  const state = {
    me, devAddress, P, registry, oracleConfig, signedSource, sourceId, pfsBtc, pfsTusd, storageIds,
    signerPublicKey: signer.publicKey.toString('hex'), relayerAddress: relayer.getPublicKey().toHaneulAddress(),
    tusdTreasury, tusdMetadata, TUSD, ADMIN, clearingHouse, feeSchedule, tierRegistry,
    btcPrice: BTC0.toString(), maker: null,
  };
  writeState(state);

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
    oracle: {
      package: SIGNED,
      source: signedSource,
      sourceId,
      aggregatorConfig: oracleConfig,
      updatesUrl: `http://${ORACLE_HOST}:${ORACLE_PORT}/v1/updates`,
    },
    fees: { schedule: feeSchedule, tierRegistry },
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
        maintenanceMarginRatio: MMR.toString(),
      },
    },
  };
  mkdirSync(dirname(CONFIG_FILE), { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');
  log(`wrote ${CONFIG_FILE}`);
  writeOracleV2Config(state);
  seed();
};

/** The admin account posts an ask/bid ladder around the signed price so takers have liquidity. */
const seed = () => {
  const s = readState();
  const signer = loadSigner();
  const { P, TUSD, ADMIN, registry, clearingHouse: ch, pfsBtc, pfsTusd } = s;
  const PERP = P.perpetuals;
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
    writeState(s);
  }
  const btc = BigInt(s.btcPrice) / ONE;
  cmds = relayCommands(s, currentUpdates(signer, s));
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
};

// ---------------------------------------------------------------- local price service

/**
 * Signs both feeds every round and serves the latest updates on `/v1/updates` in oracle-v2's
 * format, so the front end reads this service and the real one the same way. With the relay
 * on (the default) every round also lands on chain; with `--no-relay` the chain's prices go
 * stale after the market's tolerance and only transactions that carry the served updates trade.
 */
const push = async () => {
  const relay = !process.argv.includes('--no-relay');
  const interval = Number(process.env.PUSH_INTERVAL_MS ?? 3000);
  const signer = loadSigner();
  let latest = { updates: [], signedAt: 0 };

  const sign = () => {
    const s = readState();
    latest = {
      body: { packageId: s.P.oracle_haneul, sourceId: s.signedSource, aggregatorConfigId: s.oracleConfig, updates: currentUpdates(signer, s) },
      signedAt: Date.now(),
      state: s,
    };
  };
  sign();

  const server = createServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify(body));
    };
    const path = (req.url ?? '/').split('?')[0];
    if (req.method !== 'GET') return send(405, { error: 'method not allowed' });
    if (path === '/v1/updates') return send(200, latest.body);
    if (path === '/healthz') return send(200, { healthy: Date.now() - latest.signedAt <= 3 * interval, relay });
    return send(404, { error: 'not found' });
  });
  server.listen(ORACLE_PORT, ORACLE_HOST);
  log(`price service on http://${ORACLE_HOST}:${ORACLE_PORT}/v1/updates, signing every ${interval} ms, relay ${relay ? 'on' : 'off'} (ctrl-c to stop)`);

  for (;;) {
    try {
      sign();
      if (relay) ptb('relay prices', relayCommands(latest.state, latest.body.updates));
    } catch (e) {
      log(`round failed: ${String(e).slice(0, 300)}`);
    }
    await new Promise((r) => setTimeout(r, interval));
  }
};

const setPrice = () => {
  const usd = process.argv[3];
  if (!usd || !(Number(usd) > 0)) throw new Error('usage: fixture.mjs price <usd>');
  const s = readState();
  const [whole, frac = ''] = usd.split('.');
  s.btcPrice = (BigInt(whole) * ONE + BigInt((frac + '0'.repeat(18)).slice(0, 18))).toString();
  writeState(s);
  log(`the price service now signs BTC/USD at $${usd}`);
};

// ---------------------------------------------------------------- the real price service

const writeOracleV2Config = (s) => {
  const config = {
    rpcUrl: 'http://127.0.0.1:9000',
    network: 'localnet',
    packageId: s.P.oracle_haneul,
    sourceId: s.signedSource,
    aggregatorConfigId: s.oracleConfig,
    intervalMs: 3000,
    fetchTimeoutMs: 2000,
    httpHost: ORACLE_HOST,
    httpPort: ORACLE_PORT,
    streamExchanges: ['binance', 'okx', 'bybit', 'coinbaseexchange', 'kraken'],
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
        minSources: 3,
        sources: [
          { exchange: 'binance', market: 'BTC/USDT', weight: 3 },
          { exchange: 'okx', market: 'BTC/USDT', weight: 2 },
          { exchange: 'bybit', market: 'BTC/USDT', weight: 2 },
          { exchange: 'coinbaseexchange', market: 'BTC/USD', weight: 2 },
          { exchange: 'kraken', market: 'BTC/USD' },
        ],
      },
      { symbol: 'TUSD/USD', storageId: s.storageIds.tusd, priceFeedStorageId: s.pfsTusd, fixedPrice: '1' },
    ],
  };
  writeFileSync(ORACLE_V2_CONFIG, JSON.stringify(config, null, 2) + '\n');
  return config;
};

const oracleV2Config = () => {
  const s = readState();
  writeOracleV2Config(s);
  log(`wrote ${ORACLE_V2_CONFIG}`);
  log('run the real price service on this deployment instead of `push` (live exchange prices):');
  console.log(
    `\n  cd ~/oracle-v2 && ORACLE_SIGNER_SEED=$(cat ${SIGNER_SEED_FILE}) RELAYER_KEY=$(cat ${RELAYER_KEY_FILE}) \\\n` +
      `    node src/main.ts --config ${ORACLE_V2_CONFIG}\n\n` +
      'The signed source refuses a first price more than 20% away from the stored one, so set up\n' +
      'with BTC_PRICE=<about the market> when the service will sign live prices.\n'
  );
};

/** Gas from the faucet and freshly minted TUSD for a wallet, e.g. a first-time user in a check. */
const fund = () => {
  const address = process.argv[3];
  if (!address?.startsWith('0x')) throw new Error('usage: fixture.mjs fund <address> [tusd]');
  const tusd = BigInt(process.argv[4] ?? 10_000);
  const s = readState();
  faucet(address);
  ptb(
    `mint ${tusd} TUSD to ${address.slice(0, 10)}`,
    [...call('0x2::coin::mint', [s.TUSD], obj(s.tusdTreasury), u64(tusd * TUSD_UNIT)), ...assign('coin'), '--transfer-objects', '[coin]', obj(address)]
  );
  log(`funded ${address} with gas and ${tusd} TUSD`);
};

const mode = process.argv[2] ?? 'setup';
if (mode === 'setup') setup();
else if (mode === 'seed') seed();
else if (mode === 'push') await push();
else if (mode === 'price') setPrice();
else if (mode === 'oracle-v2-config') oracleV2Config();
else if (mode === 'fund') fund();
else {
  console.error(`unknown mode ${mode}`);
  process.exit(2);
}

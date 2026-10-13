/* eslint-disable no-console */

/**
 * The name issuer: writes a free `username.haneul` for a new Sigma account.
 *
 * HaneulNS on mainnet has no public registration path (the payments package is not
 * deployed), so names are issued by the operator: this service holds the ns-ops key,
 * applies the free-name rules, signs `admin::reserve_domain` and sends the registration
 * NFT to the account's address. The page only ever posts the (name, address) pair.
 *
 *   NAME_ISSUER_KEY=haneulprivkey1... pnpm exec tsx scripts/haneul-mainnet/name-issuer.ts
 *
 * Environment:
 *   NAME_ISSUER_KEY      bech32 secret key of the wallet holding the HaneulNS AdminCap (required)
 *   HANEUL_GRPC_URL      default https://rpc.haneul.io
 *   HANEULNS_ADMIN_CAP   default: the mainnet AdminCap
 *   PORT                 default 8787
 *   ALLOWED_ORIGIN       CORS origin, default https://sigma.exchange
 *   FREE_MIN_LENGTH      shortest name issued for free, default 6
 *   LEDGER_PATH          where issued names are recorded, default .name-issuer/issued.json
 *
 * Rules enforced here, because the chain cannot: one name per address, a minimum length
 * for free names, the format the sign-up field allows, and per-IP rate limiting. The deny
 * lists and the registry are checked on chain before every write.
 */
import { HaneulGrpcClient } from '@haneullabs/haneul/grpc';
import { Ed25519Keypair } from '@haneullabs/haneul/keypairs/ed25519';
import { Transaction } from '@haneullabs/haneul/transactions';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';

import {
  checkNameAvailability,
  fullName,
  getNameFormatError,
  NAME_SERVICE_CONFIGS,
  normalizeName,
} from '../../src/haneul/names';

const ROOT = join(import.meta.dirname, '..', '..');

const env = {
  key: process.env.NAME_ISSUER_KEY,
  grpcUrl: process.env.HANEUL_GRPC_URL ?? 'https://rpc.haneul.io',
  adminCap:
    process.env.HANEULNS_ADMIN_CAP ??
    '0x343c3ae3be240b1ecec92326bed9c81155e3b1063b4dee137b6e4f1019a601ad',
  port: Number(process.env.PORT ?? 8787),
  allowedOrigin: process.env.ALLOWED_ORIGIN ?? 'https://sigma.exchange',
  freeMinLength: Number(process.env.FREE_MIN_LENGTH ?? 6),
  ledgerPath: process.env.LEDGER_PATH ?? join(ROOT, '.name-issuer', 'issued.json'),
};

if (!env.key) {
  console.error('NAME_ISSUER_KEY is required (the bech32 secret of the HaneulNS operator)');
  process.exit(1);
}

const config = NAME_SERVICE_CONFIGS.mainnet!;
const CLOCK = '0x6';
const YEARS = 1;
const RATE_LIMIT_PER_HOUR = 5;
const GAS_BUDGET = 50_000_000n;

const client = new HaneulGrpcClient({ network: 'mainnet', baseUrl: env.grpcUrl });
const signer = Ed25519Keypair.fromSecretKey(env.key);
console.log('issuer address', signer.getPublicKey().toHaneulAddress());

/* ------------------------------------------------------------------ ledger */

type Ledger = Record<string, { name: string; digest: string; at: number }>;

const loadLedger = (): Ledger => {
  if (!existsSync(env.ledgerPath)) return {};
  return JSON.parse(readFileSync(env.ledgerPath, 'utf8')) as Ledger;
};

const ledger = loadLedger();

const saveLedger = () => {
  mkdirSync(dirname(env.ledgerPath), { recursive: true });
  writeFileSync(env.ledgerPath, JSON.stringify(ledger, null, 2));
};

/* -------------------------------------------------------------- rate limit */

const hits = new Map<string, number[]>();

const rateLimited = (ip: string) => {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((at) => now - at < 60 * 60 * 1000);
  hits.set(ip, recent);
  if (recent.length >= RATE_LIMIT_PER_HOUR) return true;
  recent.push(now);
  return false;
};

/* ------------------------------------------------------------------- issue */

class IssueError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

const ADDRESS = /^0x[0-9a-f]{64}$/;

// One write at a time: the AdminCap and the gas coin are owned objects, and two
// transactions in flight would race on their versions.
let queue: Promise<unknown> = Promise.resolve();

const issue = async ({ name, address }: { name: string; address: string }) => {
  const label = normalizeName(name);
  const formatError = getNameFormatError(label);
  if (formatError) throw new IssueError(400, formatError.message);
  if (label.length < env.freeMinLength) {
    throw new IssueError(400, `Free names need at least ${env.freeMinLength} characters`);
  }
  if (!ADDRESS.test(address)) throw new IssueError(400, 'Not a Haneul address');
  if (ledger[address]) throw new IssueError(409, 'This address already has a name');

  const availability = await checkNameAvailability({ client, config, name: label });
  if (availability === 'unknown') throw new IssueError(503, 'Could not reach the chain');
  if (availability !== 'available') throw new IssueError(409, 'Username unavailable.');

  const tx = new Transaction();
  tx.setSender(signer.getPublicKey().toHaneulAddress());
  tx.setGasBudget(GAS_BUDGET);
  const registration = tx.moveCall({
    target: `${config.packageId}::admin::reserve_domain`,
    arguments: [
      tx.object(env.adminCap),
      tx.object(config.haneulNs),
      tx.pure.string(fullName(label)),
      tx.pure.u8(YEARS),
      tx.object(CLOCK),
    ],
  });
  tx.transferObjects([registration], address);

  const result = await signer.signAndExecuteTransaction({ transaction: tx, client });
  if (result.FailedTransaction) {
    throw new IssueError(502, `Registration failed on chain: ${result.FailedTransaction.digest}`);
  }
  const digest = result.Transaction!.digest;
  ledger[address] = { name: label, digest, at: Date.now() };
  saveLedger();
  console.log('issued', fullName(label), 'to', address, digest);
  return { digest };
};

/* ------------------------------------------------------------------ server */

const readJson = (request: IncomingMessage) =>
  new Promise<unknown>((resolve, reject) => {
    let body = '';
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > 4096) reject(new IssueError(413, 'Body too large'));
    });
    request.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new IssueError(400, 'Body is not JSON'));
      }
    });
    request.on('error', reject);
  });

const send = (response: ServerResponse, status: number, payload: unknown) => {
  response.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': env.allowedOrigin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  });
  response.end(JSON.stringify(payload));
};

const server = createServer(async (request, response) => {
  const url = request.url ?? '/';
  if (request.method === 'OPTIONS') return send(response, 204, {});
  if (request.method === 'GET' && url === '/health') {
    return send(response, 200, { ok: true, issued: Object.keys(ledger).length });
  }
  if (request.method !== 'POST' || url !== '/names') {
    return send(response, 404, { error: 'Not found' });
  }

  const ip = request.socket.remoteAddress ?? 'unknown';
  if (rateLimited(ip)) return send(response, 429, { error: 'Too many requests. Try later.' });

  try {
    const body = (await readJson(request)) as { name?: unknown; address?: unknown };
    if (typeof body.name !== 'string' || typeof body.address !== 'string') {
      throw new IssueError(400, 'Expected { name, address }');
    }
    const { name, address } = body;
    const work = queue.then(() => issue({ name, address: address.toLowerCase() }));
    queue = work.catch(() => undefined);
    return send(response, 200, await work);
  } catch (error) {
    if (error instanceof IssueError) return send(response, error.status, { error: error.message });
    console.error(error);
    return send(response, 500, { error: 'Name issuing failed' });
  }
});

server.listen(env.port, () => console.log(`name issuer listening on :${env.port}`));

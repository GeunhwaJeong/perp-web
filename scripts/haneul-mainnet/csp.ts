/* eslint-disable no-console */

/**
 * The production build under the site's Content-Security-Policy. The build is served from a
 * local port with the policy on every document, the way Caddy sends it, and the pages a visitor
 * without a wallet reaches are opened: the browser must report no violation, the chart must
 * draw, and requests must go to the site, the indexer API and the full node only. The build
 * reads mainnet; nothing is signed or sent.
 *
 * The policy is the `Content-Security-Policy` (or `-Report-Only`) header of
 * `deploy/vps/Caddyfile`, or `CSP` when set. The three script hashes in it are the inline
 * scripts the TradingView library writes into the chart's frame; they belong to the library's
 * version, so this check is what tells that an upgrade changed them.
 *
 * The pages are opened in Chrome and in WebKit. The engines apply a policy differently: WebKit
 * holds the chart's frame, a blob document that inherits the policy, to `frame-ancestors`, and
 * Chrome does not. `BROWSERS=chrome` or `BROWSERS=webkit` opens one of them. WebKit needs
 * `playwright install webkit` once.
 *
 *   PLAYWRIGHT=/path/to/node_modules/playwright pnpm exec tsx scripts/haneul-mainnet/csp.ts [dist]
 */
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize } from 'node:path';

const require = createRequire(import.meta.url);
// eslint-disable-next-line import/no-dynamic-require -- resolved from an external checkout
const { chromium, webkit } = require(process.env.PLAYWRIGHT ?? 'playwright');

const ROOT = join(import.meta.dirname, '..', '..');
const dist = process.argv[2] ?? join(ROOT, 'dist');

const ENGINES: Record<string, () => Promise<any>> = {
  chrome: () => chromium.launch({ channel: 'chrome' }),
  webkit: () => webkit.launch(),
};
const engines = (process.env.BROWSERS ?? 'chrome,webkit').split(',').map((name) => name.trim());
const unknown = engines.filter((name) => !(name in ENGINES));
if (unknown.length > 0) throw new Error(`Unknown browser: ${unknown.join(' ')}`);

const policyFromCaddyfile = () => {
  const caddyfile = readFileSync(join(ROOT, 'deploy', 'vps', 'Caddyfile'), 'utf8');
  return /Content-Security-Policy(?:-Report-Only)?\s+"([^"]+)"/.exec(caddyfile)?.[1];
};
const policy = process.env.CSP ?? policyFromCaddyfile();
if (policy == null)
  throw new Error('No policy: set CSP, or add the header to deploy/vps/Caddyfile');
if (!existsSync(join(dist, 'entry-points', 'index.html'))) throw new Error(`No build in ${dist}`);

const READ_HOSTS = [
  'https://api.sigma.haneul.io',
  'wss://api.sigma.haneul.io',
  'https://rpc.haneul.io',
];
// The price service is asked only when a trade is built, which a visitor without a wallet never does.
const ALLOWED_HOSTS = [...READ_HOSTS, 'https://oracle.haneul.io'];

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ico': 'image/x-icon',
  '.cur': 'image/x-icon',
  '.md': 'text/markdown',
};

// Serves the build as Caddy does: a file when there is one, the single page otherwise, and the
// policy on every HTML response.
const server = createServer((request, response) => {
  const path = normalize(decodeURIComponent((request.url ?? '/').split('?')[0]!));
  let file = join(dist, path);
  if (!file.startsWith(dist) || !existsSync(file) || !statSync(file).isFile()) {
    file = join(dist, 'entry-points', 'index.html');
  }
  const type = TYPES[extname(file)] ?? 'application/octet-stream';
  const headers: Record<string, string> = { 'content-type': type };
  if (type.startsWith('text/html')) headers['content-security-policy'] = policy;
  response.writeHead(200, headers);
  createReadStream(file).pipe(response);
});
await new Promise<void>((resolve) => {
  server.listen(0, '127.0.0.1', resolve);
});
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

let passed = 0;
const failed: string[] = [];
const check = (engine: string, name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
  if (ok) passed += 1;
  else failed.push(`${engine}: ${name}`);
};

type Violation = { directive: string; blocked: string; source: string; sample: string };

const visit = async (engine: string) => {
  const violations: Violation[] = [];
  const consoleReports: string[] = [];
  const pageErrors: string[] = [];
  const hosts = new Map<string, number>();
  const seen = (host: string) => hosts.set(host, (hosts.get(host) ?? 0) + 1);

  const browser = await ENGINES[engine]!();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.exposeBinding('__cspReport', (_source: unknown, v: Violation) =>
    violations.push(v)
  );
  await context.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      (window as unknown as { __cspReport: (v: unknown) => void }).__cspReport({
        directive: e.effectiveDirective,
        blocked: String(e.blockedURI).slice(0, 120),
        source: `${String(e.sourceFile).slice(0, 120)}:${e.lineNumber}`,
        sample: String(e.sample).slice(0, 80),
      });
    });
  });
  const page = await context.newPage();
  page.on('console', (m: { text: () => string }) => {
    const text = m.text();
    if (/Content Security Policy/i.test(text)) consoleReports.push(text.slice(0, 400));
  });
  // WebKit raises this notice as an error when a resize callback resizes an element again. The
  // browser delivers the rest on the next frame, so it is not a fault of the page.
  page.on('pageerror', (e: Error) => {
    if (!/^ResizeObserver loop/.test(e.message)) pageErrors.push(e.message.slice(0, 200));
  });
  page.on('request', (r: { url: () => string }) => {
    const u = new URL(r.url());
    if (u.protocol === 'http:' || u.protocol === 'https:') seen(u.origin);
  });
  page.on('websocket', (ws: { url: () => string }) => {
    const u = new URL(ws.url());
    seen(`${u.protocol}//${u.host}`);
  });

  const open = async (hash: string) => {
    await page.goto(`${origin}/#${hash}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  };
  const reported = () => violations.length + consoleReports.length;

  console.log('1. the trade page and its chart');
  await open('/trade/BTC-USD');
  await page.locator('#tv-price-chart iframe').first().waitFor({ timeout: 90_000 });
  await page.getByText('Mark Price').first().waitFor({ timeout: 60_000 });
  const canvases = await page
    .waitForFunction(
      () => {
        const frame = document.querySelector<HTMLIFrameElement>('#tv-price-chart iframe');
        const count = frame?.contentDocument?.querySelectorAll('canvas').length ?? 0;
        return count > 0 ? count : false;
      },
      undefined,
      { timeout: 60_000 }
    )
    .then((handle: { jsonValue: () => Promise<number> }) => handle.jsonValue())
    .catch(() => 0);
  check(engine, 'the chart draws inside its frame', canvases > 0, `${canvases} canvases`);
  // The tab's title carries the market's price once the indexer API has answered.
  const title = await page
    .waitForFunction(
      () => (/^\$[\d,.]+ BTC-USD/.test(document.title) ? document.title : false),
      undefined,
      {
        timeout: 60_000,
      }
    )
    .then((handle: { jsonValue: () => Promise<string> }) => handle.jsonValue())
    .catch(() => page.title());
  check(engine, 'the market data arrives', /^\$[\d,.]+ BTC-USD/.test(title), title);
  await page.waitForTimeout(8_000);
  check(engine, 'the trade page reports no violation', reported() === 0, `${reported()} reports`);

  console.log('2. the other pages');
  const pages = [
    '/markets',
    '/portfolio/overview',
    '/portfolio/history',
    '/portfolio/fees',
    '/vault',
    '/terms',
    '/privacy',
  ];
  await pages.reduce(async (previous, hash) => {
    await previous;
    const before = reported();
    await open(hash);
    await page.waitForTimeout(5_000);
    check(
      engine,
      `${hash} reports no violation`,
      reported() === before,
      `${reported() - before} reports`
    );
  }, Promise.resolve());

  console.log('3. the sign-in dialog');
  await open('/trade/BTC-USD');
  const signIn = page.getByRole('button', { name: /^(Log in|Get started)$/ }).first();
  await signIn.waitFor({ timeout: 60_000 });
  const beforeDialog = reported();
  await signIn.click();
  const dialog = await page
    .locator('[role="dialog"]')
    .first()
    .innerText({ timeout: 15_000 })
    .catch(() => '');
  check(engine, 'the dialog opens', /Passkey/.test(dialog) && /Create account/.test(dialog));
  await page.waitForTimeout(3_000);
  check(
    engine,
    'the dialog reports no violation',
    reported() === beforeDialog,
    `${reported() - beforeDialog} reports`
  );

  console.log('4. where requests went');
  const others = [...hosts.keys()].filter((h) => h !== origin && !ALLOWED_HOSTS.includes(h));
  check(
    engine,
    'only the site, the indexer API and the full node',
    others.length === 0,
    others.join(' ')
  );
  check(
    engine,
    'the indexer API and the full node were reached',
    READ_HOSTS.every((h) => (hosts.get(h) ?? 0) > 0),
    READ_HOSTS.map((h) => `${h} ${hosts.get(h) ?? 0}`).join(', ')
  );
  check(engine, 'no page error', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

  await browser.close();

  if (violations.length + consoleReports.length > 0) {
    console.log('reports:');
    const lines = new Set([
      ...violations.map((v) => `${v.directive} | ${v.blocked} | ${v.source} | ${v.sample}`),
      ...consoleReports,
    ]);
    lines.forEach((line) => console.log(`  ${line}`));
  }
};

console.log(`policy: ${policy}`);
await engines.reduce(async (previous, engine) => {
  await previous;
  console.log(`== ${engine}`);
  await visit(engine);
}, Promise.resolve());
server.close();

console.log(`${passed} checks passed${failed.length > 0 ? `, ${failed.length} failed` : ''}`);
process.exit(failed.length > 0 ? 1 : 0);

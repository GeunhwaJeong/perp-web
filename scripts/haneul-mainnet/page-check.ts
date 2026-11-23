/* eslint-disable no-console */

/**
 * Checks of the page that only the page itself can make: what it shows of an order it placed.
 * A browser of its own opens the site, restores the check account from its 12-word phrase, and
 * presses what a person would press. `shadow-check.ts` places orders from outside the page;
 * this is for what the page keeps about its own submissions, which no order from outside leaves.
 *
 *   PLAYWRIGHT=/path/to/node_modules/playwright \
 *     pnpm exec tsx scripts/haneul-mainnet/page-check.ts <check> --env <mainnet|local> [options]
 *
 *   stop-notice     A stop market sell of `--btc` (0.001 by default) with its trigger `--below`
 *                   percent (10 by default) under the index price. The notification of the
 *                   submission has to read "Untriggered" and the Stop Orders tab has to list the
 *                   ticket as Open; after the ticket's X the ticket must no longer be Open and
 *                   the notification has to read "Canceled".
 *   tickets         What the Stop Orders tab lists. Nothing is pressed.
 *   cancel-tickets  The same list; with `--execute`, the X of every ticket that is still Open.
 *   cancel-burst    Three limit buys of `--btc` each, `--below` percent under the index price
 *                   and further, and then the X of all three without waiting for any of them.
 *                   Each X is a transaction of the same wallet, and two that are built at the
 *                   same moment cannot both go through, so the page has to send them one after
 *                   the other. All three orders have to leave the book with no cancel failing;
 *                   the check says how many of the cancels waited for their turn, and where the
 *                   collateral the orders took is afterwards. It reads the chain for that
 *                   (`--deployment <file>` for a local network other than the page's own).
 *
 * The page refuses to trade for an account that holds a conditional order another device
 * placed. So `stop-notice` does not start while a ticket is Open, and while its own ticket rests
 * (some seconds) the account's other devices show that refusal. Should the check stop between
 * its order and its cancel, `cancel-tickets --execute` takes the ticket off.
 *
 * The account's key comes from its phrase in `--phrase-file` (~/.sigma/check.phrase by default;
 * the file must not be readable by others). The phrase is typed into the site's own restore
 * screen in a browser profile that is thrown away when the check ends; the password it sets is
 * random and never leaves the process. Neither is printed, and no screenshot is taken while the
 * restore screens are open.
 *
 * Without `--execute` the check restores the account, fills the form and stops before the
 * order. On mainnet `--execute` needs `--confirm-mainnet` as well. `--url` names another origin
 * of the same host than the default (https://sigma.haneul.io, or http://localhost:5173 for
 * `--env local`). Screenshots go to `--shots` (.deploy/page-check by default). `--headed` shows
 * the browser.
 */
import { HaneulGrpcClient } from '@haneullabs/haneul/grpc';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  isValidMnemonic,
  keypairFromMnemonic,
  normalizeMnemonic,
} from '../../src/haneul/account/mnemonic';
import {
  findPerpAccount,
  readPosition,
  unitsToCollateral,
  type PerpDeployment,
} from '../../src/haneul/perp';

const require = createRequire(import.meta.url);
// eslint-disable-next-line import/no-dynamic-require -- resolved from an external checkout
const { chromium } = require(process.env.PLAYWRIGHT ?? 'playwright');

const ROOT = join(import.meta.dirname, '..', '..');
const MARKET = 'BTC-USD';
/** The largest order this script places: it is for checks, not for trading. */
const MAX_BTC = 0.01;

const args = process.argv.slice(2);
const check = args[0];
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const fail = (message: string): never => {
  console.error(`page-check: ${message}`);
  process.exit(1);
};

const env = value('--env');
if (env !== 'mainnet' && env !== 'local') fail('--env mainnet or --env local is required');
const mainnet = env === 'mainnet';
const execute = flag('--execute');
if (mainnet && execute && !flag('--confirm-mainnet')) {
  fail('on mainnet --execute needs --confirm-mainnet as well');
}
const origin = value('--url') ?? (mainnet ? 'https://sigma.haneul.io' : 'http://localhost:5173');
// The phrase is typed into this origin, so its host is held to the letter.
const { protocol, hostname } = new URL(origin);
const isSite = protocol === 'https:' && hostname === 'sigma.haneul.io';
const isLocal = protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1');
if (mainnet ? !isSite : !isLocal) fail(`${origin} is not the site of --env ${env}`);
const size = Number(value('--btc') ?? 0.001);
if (!(size > 0) || size > MAX_BTC) fail(`--btc has to be above 0, ${MAX_BTC} at most`);
const below = Number(value('--below') ?? 10);
if (!(below >= 2) || below > 50) fail('--below has to be from 2 to 50 (percent under the index)');
const shots = value('--shots') ?? join(ROOT, '.deploy', 'page-check');
mkdirSync(shots, { recursive: true });

const phrase = (() => {
  const file = value('--phrase-file') ?? join(homedir(), '.sigma', 'check.phrase');
  let mode: number;
  try {
    mode = statSync(file).mode;
  } catch {
    return fail(`no phrase file at ${file}`);
  }
  // eslint-disable-next-line no-bitwise
  if ((mode & 0o077) !== 0) fail(`${file} is readable by others; chmod 600 it`);
  const text = readFileSync(file, 'utf8');
  if (!isValidMnemonic(text)) fail(`${file} does not hold a valid 12-word phrase`);
  return normalizeMnemonic(text);
})();

const results: { ok: boolean; what: string; saw: string }[] = [];
const expect = (ok: boolean, what: string, saw = '') => {
  results.push({ ok, what, saw });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${saw ? ` (${saw})` : ''}`);
};
const squash = (text: string) => text.replace(/\s+/g, ' ').trim();
/** Ends the check where it stands; unlike `fail`, the browser closes and the report prints. */
const stop = (message: string): never => {
  throw new Error(message);
};

const browser = await chromium.launch({ headless: !flag('--headed') });
const context = await browser.newContext({ viewport: { width: 1512, height: 900 } });
const page = await context.newPage();
const pageErrors: string[] = [];
page.on('pageerror', (e: Error) => pageErrors.push(e.message.slice(0, 160)));
page.on('console', (m: { type(): string; text(): string }) => {
  // React's development warnings are not errors of the page.
  if (m.type() === 'error' && !m.text().startsWith('Warning:'))
    pageErrors.push(m.text().slice(0, 160));
});
let shot = 0;
/** True from the moment the phrase is typed until the restore screens have closed. */
let phraseOnScreen = false;
const snap = async (name: string) => {
  if (phraseOnScreen) return undefined;
  shot += 1;
  const file = join(shots, `${check}-${env}-${String(shot).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file });
  return file;
};
const bodyText = async () => squash(await page.evaluate(() => document.body.innerText));

/** Restores the account through the site's own screens. */
const restore = async () => {
  await page.goto(`${origin}/trade/${MARKET}`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.getByRole('button', { name: 'Get started' }).first().click({ timeout: 60_000 });
  await page.getByText('Log in with recovery phrase').click({ timeout: 30_000 });
  phraseOnScreen = true;
  await page.locator('textarea').fill(phrase);
  await page.getByRole('button', { name: 'Continue' }).click();
  const password = randomUUID();
  await page.getByPlaceholder('New password').fill(password);
  await page.getByPlaceholder('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Restore wallet' }).click();
  // The device may be offered a biometric unlock first; the check does not take it.
  const notNow = page.getByText('Not now');
  const done = page.getByRole('button', { name: 'Start trading' });
  await Promise.race([
    notNow.waitFor({ timeout: 60_000 }).catch(() => undefined),
    done.waitFor({ timeout: 60_000 }),
  ]);
  if (await notNow.isVisible().catch(() => false)) await notNow.click();
  await done.click({ timeout: 60_000 });
  await done.waitFor({ state: 'hidden', timeout: 30_000 });
  phraseOnScreen = false;
  await page.waitForTimeout(6000);
};

/** The text of the page's notification whose title is `title`: "<title> <status> …". */
const noticeOf = (title: string) =>
  page.evaluate((t: string) => {
    let best: string | undefined;
    document.querySelectorAll<HTMLElement>('div, li, button').forEach((el) => {
      const text = el.innerText.replace(/\s+/g, ' ').trim();
      if (!text.startsWith(`${t} `) || text.length > 400) return;
      if (best == null || text.length < best.length) best = text;
    });
    return best;
  }, title) as Promise<string | undefined>;

/**
 * The same, read from the list the bell opens. A toast leaves after some seconds; the list keeps
 * its rows. The bell is the last button without text in the bar at the top of the page.
 */
const listedNotice = async (title: string) => {
  const bell = await page.evaluateHandle(() =>
    [...document.querySelectorAll('button')]
      .filter((button) => {
        const box = button.getBoundingClientRect();
        return box.width > 0 && box.top < 44 && button.innerText.trim() === '';
      })
      .sort((one, other) => one.getBoundingClientRect().x - other.getBoundingClientRect().x)
      .at(-1)
  );
  const button = bell.asElement();
  if (button == null) return undefined;
  await button.click();
  await page.waitForTimeout(1500);
  return noticeOf(title);
};

/** Asks `read` again until `done` accepts its answer, for `seconds` at most. */
const until = async <T>(read: () => Promise<T>, done: (answer: T) => boolean, seconds: number) => {
  const end = Date.now() + seconds * 1000;
  let answer = await read();
  while (!done(answer) && Date.now() < end) {
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(1000);
    // eslint-disable-next-line no-await-in-loop
    answer = await read();
  }
  return answer;
};

// A ticket that still waits for its trigger reads "Open" in the Stop Orders tab; the tab is the
// only table on the page while it is selected. A row's text has no space between its cells.
const stopRows = page.getByRole('row').filter({ hasText: /Open/ });
const openTickets = (): Promise<number> => stopRows.count();
const openStopOrders = async () => {
  await page.getByRole('tab', { name: /^Stop Orders/ }).click();
  await page.waitForTimeout(2500);
};

const stopNotice = async () => {
  const TITLE = 'Stop Market';
  await restore();
  const header = await bodyText();
  await snap('restored');
  const portfolio = header.match(/Portfolio Value \$[\d,.]+/)?.[0];
  expect(
    portfolio != null,
    'the restored account shows its portfolio value',
    portfolio ?? 'no value'
  );
  if (portfolio == null) return;

  // The X this check presses has to be the X of its own ticket.
  if (!header.includes('You have no open positions'))
    stop('the account has a position; close it first');
  await openStopOrders();
  if ((await stopRows.count()) > 0) stop('a stop ticket is Open; run cancel-tickets first');

  const index = Number((header.match(/Index Price \$([\d,]+)/)?.[1] ?? '').replace(/,/g, ''));
  if (!(index > 0)) stop('the page shows no index price');
  const trigger = Math.round(index * (1 - below / 100));

  await page.getByRole('tab', { name: 'Sell | Short' }).click();
  await page.getByRole('tab', { name: 'Advanced' }).click();
  await page.getByText(TITLE, { exact: true }).first().click();
  await page.locator('[id="price.triggerPrice"]').fill(String(trigger));
  await page.locator('#trade-amount').fill(String(size));
  await page.waitForTimeout(1500);
  const submit = page.locator('button[type="submit"]').last();
  const label = squash(await submit.innerText());
  await snap('form');
  console.log(
    `  stop market: sell ${size} BTC when the price is ${trigger} or less (index ${index})`
  );
  console.log(`  the form's button reads "${label}"`);
  if (!execute) {
    console.log('  no --execute: the order was not placed');
    return;
  }

  await submit.click();
  let resting = true;
  try {
    const first = await until(
      () => noticeOf(TITLE),
      (t) => /Untriggered/.test(t ?? ''),
      60
    );
    await snap('placed');
    expect(
      /Untriggered/.test(first ?? ''),
      'the notification of the new ticket reads Untriggered',
      (first ?? 'no notification').slice(0, 160)
    );

    await openStopOrders();
    const rows = await until(openTickets, (n) => n > 0, 60);
    expect(rows === 1, 'the Stop Orders tab lists the ticket as Open', `${rows} row`);
    if (rows !== 1) return;
    console.log(`  the ticket: ${squash(await stopRows.first().innerText()).slice(0, 120)}`);
    await snap('ticket');

    await stopRows.first().getByRole('button').last().click();
    // The toast of the cancel can be gone before the tab shows the ticket as deleted, so both are
    // read in one pass, and the notification list, which keeps its rows, is read after them.
    let toast: string | undefined;
    const sample = async () => {
      const text = await noticeOf(TITLE);
      if (/Canceled/.test(text ?? '')) toast = text;
      return openTickets();
    };
    const left = await until(sample, (n) => n === 0, 90);
    if (toast == null) await until(sample, () => toast != null, 8);
    resting = left > 0;
    expect(left === 0, 'after its X the ticket is no longer Open', `${left} row left`);
    await snap('canceled');
    const listed = toast == null ? await listedNotice(TITLE) : undefined;
    if (listed != null) await snap('notifications');
    const after = toast ?? listed;
    expect(
      /Canceled/.test(after ?? ''),
      'the notification of the canceled ticket reads Canceled',
      `${(after ?? 'no notification').slice(0, 160)}${toast == null ? ', in the list' : ', as a toast'}`
    );
  } finally {
    if (resting) {
      console.log(
        '  A STOP TICKET MAY STILL REST. Run cancel-tickets, or press its X in the Stop Orders tab.'
      );
    }
  }
};

/** What the Stop Orders tab lists; with `--execute`, the X of every ticket that is still Open. */
const listTickets = async (press: boolean) => {
  await restore();
  await openStopOrders();
  const rows = await page.getByRole('row').allInnerTexts();
  rows.slice(1).forEach((row: string) => console.log(`  ${squash(row).slice(0, 150)}`));
  const open = await stopRows.count();
  console.log(`  ${open} ticket${open === 1 ? '' : 's'} still Open`);
  if (!press || open === 0) return;
  for (let i = 0; i < open; i += 1) {
    // One X at a time: each is a transaction of the same account.
    // eslint-disable-next-line no-await-in-loop
    await stopRows.first().getByRole('button').last().click();
    // eslint-disable-next-line no-await-in-loop
    await until(openTickets, (n) => n < open - i, 90);
  }
  const left = await stopRows.count();
  await snap('tickets');
  expect(left === 0, 'no ticket is Open after the X of each', `${left} left`);
};

/** What the chain holds for the check account: its balance, and its side of the market. */
const onChain = async () => {
  const file =
    value('--deployment') ??
    join(ROOT, 'public', 'configs', 'haneul', mainnet ? 'perp.mainnet.json' : 'perp.localnet.json');
  const deployment: PerpDeployment = JSON.parse(readFileSync(file, 'utf8'));
  if (mainnet !== (deployment.network === 'mainnet'))
    stop(`${file} describes ${deployment.network}, not ${env}`);
  const client = new HaneulGrpcClient({
    network: mainnet ? 'mainnet' : 'localnet',
    baseUrl: mainnet ? 'https://rpc.haneul.io' : 'http://127.0.0.1:9000',
  });
  const address = keypairFromMnemonic(phrase).toHaneulAddress();
  const decimals = Number(deployment.collateral.decimals);
  /** A signed ifixed (1e18) value held as a two's complement `u256`. */
  const ifixed = (raw: bigint) => Number(raw >= 2n ** 255n ? raw - 2n ** 256n : raw) / 1e18;
  return async () => {
    const account = await findPerpAccount(client, deployment, address);
    if (account == null) return stop('the check account has no trading account');
    const position = await readPosition(client, deployment, MARKET, account.accountId);
    return {
      balance: unitsToCollateral(account.collateral, decimals).toNumber(),
      inMarket: position ? ifixed(position.collateral) : 0,
      size: position ? ifixed(position.base) : 0,
      resting: position ? Number(position.pendingOrders) : 0,
    };
  };
};

// The Open Orders tab is the only table on the page while it is selected. Its rows name the
// order's type where the Stop Orders tab says "Open"; the row of the column names does not.
const ORDER_ROW = 'Limit';
const orderRows = page.getByRole('row').filter({ hasText: ORDER_ROW });
const openOrders = (): Promise<number> => orderRows.count();
const openOrdersTab = async () => {
  await page.getByRole('tab', { name: /^Open Orders/ }).click();
  await page.waitForTimeout(2500);
};
const BURST = 3;

const cancelBurst = async () => {
  const read = await onChain();
  await restore();
  const header = await bodyText();
  await snap('restored');
  const portfolio = header.match(/Portfolio Value \$[\d,.]+/)?.[0];
  expect(
    portfolio != null,
    'the restored account shows its portfolio value',
    portfolio ?? 'no value'
  );
  if (portfolio == null) return;

  // The X's this check presses have to be those of its own orders, and what it reads of the
  // collateral afterwards has to be theirs.
  const before = await read();
  if (before.size !== 0) stop('the account has a position; close it first');
  if (before.resting !== 0) stop('the account has resting orders; cancel them first');
  await openOrdersTab();
  if ((await openOrders()) > 0) stop('an order is Open; cancel it first');
  const usd = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 6 });
  console.log(
    `  before: balance ${usd(before.balance)}, in the market ${usd(before.inMarket)} (the chain)`
  );

  const index = Number((header.match(/Index Price \$([\d,]+)/)?.[1] ?? '').replace(/,/g, ''));
  if (!(index > 0)) stop('the page shows no index price');
  // Far enough under the market that none of them trades, and apart so that the rows differ.
  const prices = Array.from({ length: BURST }, (_, i) =>
    Math.round(index * (1 - (below + i) / 100))
  );
  await page.getByRole('tab', { name: 'Buy | Long' }).click();
  await page.getByRole('tab', { name: 'Limit' }).click();
  await page.locator('[id="price.limitPrice"]').fill(String(prices[0]));
  await page.locator('#trade-amount').fill(String(size));
  await page.waitForTimeout(1500);
  const submit = page.locator('button[type="submit"]').last();
  await snap('form');
  console.log(
    `  ${BURST} limit buys of ${size} BTC at ${prices.join(', ')} (index ${index}); the form's button reads "${squash(await submit.innerText())}"`
  );
  if (!execute) {
    console.log('  no --execute: no order was placed');
    return;
  }

  /** Places one limit buy through the form and waits for its row. */
  const place = async (price: number, rowsBefore: number) => {
    await page.locator('[id="price.limitPrice"]').fill(String(price));
    await page.locator('#trade-amount').fill(String(size));
    await page.waitForTimeout(1000);
    await submit.click();
    const rows = await until(openOrders, (n) => n > rowsBefore, 60);
    if (rows <= rowsBefore) stop(`the order at ${price} did not come to rest within a minute`);
  };
  /**
   * Presses the X of every order row, one straight after the other, as fast as the mouse goes.
   * From the last row up: a row leaves the table when its X is pressed, and the rows above it
   * stay where they are. Answers how many it pressed and within how many milliseconds.
   */
  const pressEveryX = async () => {
    const count = await openOrders();
    const buttons = [];
    for (let i = 0; i < count; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      buttons.push(await orderRows.nth(i).getByRole('button').last().elementHandle());
    }
    const since = Date.now();
    for (let i = count - 1; i >= 0; i -= 1) {
      // eslint-disable-next-line no-await-in-loop
      await buttons[i].click();
    }
    return { pressed: buttons.length, within: Date.now() - since };
  };
  /**
   * Follows the cancels until nothing rests on chain and no transaction of the wallet holds or
   * waits for its turn. A row leaves the page as soon as its X is pressed, so the page does not
   * say when they are through. Answers the most cancels that waited at one time, what the page
   * said of a failure, and what the chain holds at the end.
   */
  const follow = async () => {
    const since = Date.now();
    let waited = 0;
    let failure: string | undefined;
    let chain = await read();
    let readAt = Date.now();
    while (Date.now() - since < 90_000) {
      // eslint-disable-next-line no-await-in-loop
      const turns = (await page.evaluate(async () => {
        const state = await navigator.locks.query();
        return {
          held: (state.held ?? []).filter((l) => l.name?.startsWith('haneul:tx:')).length,
          pending: (state.pending ?? []).filter((l) => l.name?.startsWith('haneul:tx:')).length,
        };
      })) as { held: number; pending: number };
      waited = Math.max(waited, turns.pending);
      // eslint-disable-next-line no-await-in-loop
      const text = await bodyText();
      failure ??= text.match(
        /Another transaction from this wallet[^.]*\.|already locked[^.]{0,80}|[^.]{0,60}(?:could not be canceled|Cancel(?:lation)? Failed)[^.]{0,60}/i
      )?.[0];
      if (Date.now() - readAt > 400) {
        // eslint-disable-next-line no-await-in-loop
        chain = await read();
        readAt = Date.now();
      }
      if (chain.resting === 0 && turns.held + turns.pending === 0) break;
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(50);
    }
    // The return of the collateral is in the last cancel's own transaction: read once more.
    chain = await read();
    return { waited, failure, chain, seconds: ((Date.now() - since) / 1000).toFixed(1) };
  };

  let resting = true;
  try {
    // One order and its X alone first. That cancel empties the market, so it has to return the
    // market's collateral to the balance, whatever was left there before the check.
    await place(prices[0]!, 0);
    await until(read, (c) => c.resting === 1, 30);
    const one = await pressEveryX();
    const alone = await follow();
    expect(
      one.pressed === 1 && alone.chain.resting === 0,
      'one X alone takes its order off the book',
      `${one.pressed} pressed, ${alone.chain.resting} resting after ${alone.seconds} s`
    );
    expect(
      alone.chain.inMarket < 0.01,
      "and returns the market's collateral to the balance",
      `balance ${usd(alone.chain.balance)}, in the market ${usd(alone.chain.inMarket)}`
    );
    if (alone.chain.resting !== 0) return;
    await until(openOrders, (n) => n === 0, 30);

    for (let i = 0; i < BURST; i += 1) {
      // One order at a time: the orders are not what is checked.
      // eslint-disable-next-line no-await-in-loop
      await place(prices[i]!, i);
    }
    const placed = await until(read, (c) => c.resting === BURST, 30);
    expect(
      placed.resting === BURST && (await openOrders()) === BURST,
      `${BURST} orders rest, on the page and on chain`,
      `${await openOrders()} rows, ${placed.resting} on chain`
    );
    if (placed.resting !== BURST) return;
    console.log(
      `  resting: balance ${usd(placed.balance)}, in the market ${usd(placed.inMarket)}; the orders took ${usd(alone.chain.balance - placed.balance)}`
    );
    await snap('resting');

    const all = await pressEveryX();
    const burst = await follow();
    const after = burst.chain;
    resting = after.resting > 0;
    expect(
      all.pressed === BURST,
      `the X of ${BURST} rows was pressed, one straight after the other`,
      `${all.pressed} pressed within ${all.within} ms`
    );
    expect(
      after.resting === 0,
      'no order rests on chain afterwards',
      `${after.resting} resting after ${burst.seconds} s`
    );
    const left = await until(openOrders, (n) => n === 0, 30);
    expect(left === 0, 'no order is listed on the page afterwards', `${left} listed`);
    expect(
      burst.failure == null,
      'the page shows no cancel that failed',
      burst.failure ?? 'none shown'
    );
    expect(
      burst.waited >= 1,
      'the cancels took turns: at least one waited for another',
      `at most ${burst.waited} waiting at a time`
    );
    await snap('canceled');
    console.log(
      `  after: balance ${usd(after.balance)}, in the market ${usd(after.inMarket)} (the chain)`
    );
    // What the owner of the account reads of it, once the page has taken in the cancels.
    await page.waitForTimeout(4000);
    const shown = (await bodyText()).match(/Available Balance \$[\d,.]+/)?.[0];
    console.log(`  the page shows: ${shown ?? 'no available balance'}`);
    // A cancel is built when its X is pressed, and each of these was built while the others
    // still rested: none of them knew that it would be the one to empty the market.
    expect(
      after.inMarket < 0.01,
      "none of the account's collateral is left in the market",
      after.inMarket < 0.01
        ? `balance ${usd(after.balance)}`
        : `${usd(after.inMarket)} waits there for the next cancel or withdrawal; balance ${usd(after.balance)}`
    );
  } finally {
    if (resting) {
      console.log(
        '  ORDERS MAY STILL REST. Press Cancel All in Open Orders, or run shadow-check.ts cancel.'
      );
    }
  }
};

const checks: Record<string, () => Promise<unknown>> = {
  'stop-notice': stopNotice,
  'cancel-burst': cancelBurst,
  tickets: () => listTickets(false),
  'cancel-tickets': () => listTickets(execute),
};
const run =
  checks[check ?? ''] ?? fail(`unknown check ${check}; one of ${Object.keys(checks).join(', ')}`);
console.log(`${check} on ${origin}${execute ? '' : ' (no --execute: stops before the order)'}`);
try {
  await run();
} catch (error) {
  const shown = await snap('error').catch(() => undefined);
  // Only the first line: the lines after it can repeat what a step typed.
  console.log(`  FAIL  the check stopped: ${String(error).split('\n')[0]!.slice(0, 200)}`);
  if (shown == null) console.log('  no screenshot of it: the restore screens were open');
  results.push({ ok: false, what: 'the check ran to its end', saw: '' });
} finally {
  await browser.close();
}
if (pageErrors.length > 0) console.log(`  page errors: ${pageErrors.length} (${pageErrors[0]})`);
const failed = results.filter((r) => !r.ok).length;
console.log(
  failed === 0 ? `${results.length} checks passed` : `${failed} of ${results.length} checks FAILED`
);
console.log(`screenshots in ${shots}`);
process.exit(failed === 0 ? 0 : 1);

/* eslint-disable no-console */

/**
 * Drives the account dialog end to end in a browser: the password account with Face ID,
 * the recovery phrase and the 12-word restore, and the chain-native passkey account with
 * its recovery. Needs only `pnpm dev`; no chain, since the dev environment answers every
 * name as available and the account never has to sign on chain here.
 *
 * WebAuthn is served by a CDP virtual authenticator standing in for Touch ID / Face ID,
 * so every registration, assertion and user-handle round trip is real; only the system
 * prompt is skipped. HEADED=1 shows the window; CHANNEL=chrome uses the installed Chrome.
 *
 *   PLAYWRIGHT=/path/to/node_modules/playwright node scripts/haneul-localnet/account.mjs
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// eslint-disable-next-line import/no-dynamic-require -- resolved from an external checkout
const { chromium } = require(process.env.PLAYWRIGHT ?? 'playwright');

const url = process.env.APP_URL ?? 'http://localhost:5173/';
const PASSWORD = 'account-qa-password';
const RESTORED_PASSWORD = 'account-qa-password-2';

let passed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) throw new Error(`FAIL ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}${detail ? ` (${detail})` : ''}`);
};

const browser = await chromium.launch({
  headless: !process.env.HEADED,
  channel: process.env.CHANNEL,
});
const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const page = await context.newPage();
page.on('pageerror', (e) => {
  if (!/Bars are not available/.test(e.message)) console.log('  page error:', e.message);
});

const cdp = await context.newCDPSession(page);
await cdp.send('WebAuthn.enable', { enableUI: false });
let authenticatorId;
// With no system picker, the virtual authenticator answers a discoverable-credential
// request with any resident credential for the site, so each part gets its own.
const freshAuthenticator = async () => {
  if (authenticatorId) await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
  ({ authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  }));
};
await freshAuthenticator();

const button = (name) => page.getByRole('button', { name });
const stored = () =>
  page.evaluate(() => JSON.parse(localStorage.getItem('haneul:account:v1') ?? 'null'));
const passkeyStored = () =>
  page.evaluate(() => JSON.parse(localStorage.getItem('haneul:passkey-account:v1') ?? 'null'));
const sessionOpen = () =>
  page.evaluate(() => sessionStorage.getItem('haneul:account:session') !== null);
const dropSession = () => page.evaluate(() => sessionStorage.removeItem('haneul:account:session'));
const wipeDevice = () =>
  page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
// The header trigger shows the account's name once it has one, else the short address.
const headerShows = async (label) => {
  const expected = label.startsWith('0x') ? `${label.slice(0, 6)}...${label.slice(-4)}` : label;
  const names = await page.getByRole('button').allInnerTexts();
  return names.some((n) => n.includes(expected));
};
const credentialCount = async () =>
  (await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials.length;

const openFresh = async () => {
  await page.goto(url);
  await wipeDevice();
  await page.goto(url);
  await button(/get started/i)
    .first()
    .waitFor({ timeout: 30000 });
};

const toConnectScreen = async () => {
  await button(/get started|log in/i)
    .first()
    .click();
  await page.getByText('Connect a wallet').waitFor();
};

const restoreFromPhrase = async (words, password) => {
  await page.getByText('Restore your wallet').waitFor({ timeout: 10000 });
  await page.locator('textarea').fill(words.join(' '));
  await button(/^continue$/i).click();
  await page.getByPlaceholder('New password').waitFor({ timeout: 10000 });
  await page.getByPlaceholder('New password').fill(password);
  await page.getByPlaceholder('Confirm password').fill(password);
  await button(/restore wallet/i).click();
  await button(/enable face id/i).waitFor({ timeout: 15000 });
  await button(/not now/i).click();
  await page.getByText("You're all set").waitFor({ timeout: 15000 });
  await button(/start trading/i).click();
  await page.waitForTimeout(1000);
};

try {
  // ---- 1. Password account with Face ID -------------------------------------------------
  await openFresh();
  check(
    'platform authenticator reported available',
    await page.evaluate(() => PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())
  );
  // The deployment is English only, whatever the browser's language: the nav reads in
  // English and nothing on the page is in Korean, the language this Mac's Chrome runs in.
  const chrome = await page.locator('body').innerText();
  check('interface is English only', /Portfolio/.test(chrome) && !/[가-힣]/.test(chrome));
  await toConnectScreen();
  await button(/^create account$/i).click();
  await page.getByText('Welcome to Sigma').waitFor({ timeout: 10000 });
  await button(/^continue$/i).click();
  const nameInput = page.getByPlaceholder('yourname');
  await nameInput.waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  const username = (await nameInput.inputValue()).trim();
  check('a name was suggested', /^[a-z][a-z0-9]{2,19}$/.test(username), username);
  await button(/^continue$/i).click();
  await page.getByPlaceholder('New password').fill(PASSWORD);
  await page.getByPlaceholder('Confirm password').fill(PASSWORD);
  await button(/create wallet/i).click();
  await button(/enable face id/i).waitFor({ timeout: 15000 });
  check('Face ID offered after the password', true);
  await button(/enable face id/i).click();
  await page.getByText("You're all set").waitFor({ timeout: 15000 });
  let account = await stored();
  check('account stored with the name', account?.username === username && !!account?.address);
  check(
    'Face ID enrolled (one resident credential)',
    !!account?.biometric && (await credentialCount()) === 1
  );
  const address = account.address;
  await button(/start trading/i).click();
  await page.waitForTimeout(1200);
  check('header shows the new name', await headerShows(`${username}.haneul`));

  await page.reload();
  await page.waitForTimeout(2500);
  check(
    'reload keeps the session open',
    (await sessionOpen()) && (await button(/^log in$/i).count()) === 0
  );

  await dropSession();
  await page.reload();
  await button(/^log in$/i)
    .first()
    .waitFor({ timeout: 15000 });
  check('new tab is locked ("Log in")', true);
  await button(/^log in$/i)
    .first()
    .click();
  await page.getByText('Welcome back').waitFor();
  await button(/unlock with face id/i).click();
  await page.waitForTimeout(2000);
  check('Face ID unlocks the vault', await sessionOpen());

  await dropSession();
  await page.reload();
  await button(/^log in$/i)
    .first()
    .click();
  await page.getByText('Welcome back').waitFor();
  await page.getByPlaceholder('Password').fill('wrong-password');
  await button(/^unlock$/i).click();
  await page.getByText(/incorrect password/i).waitFor({ timeout: 15000 });
  check('wrong password rejected', !(await sessionOpen()));
  await page.getByPlaceholder('Password').fill(PASSWORD);
  await button(/^unlock$/i).click();
  await page.waitForTimeout(2500);
  check('right password unlocks', await sessionOpen());

  // ---- 2. Recovery phrase, Face ID toggle, lock, reset and restore -----------------------
  const openMenu = async () => {
    await page
      .getByRole('button', { name: /\.haneul$|0x[0-9a-f]{4}/i })
      .first()
      .click();
    await page.waitForTimeout(600);
  };
  await openMenu();
  const menu = await page.locator('body').innerText();
  check(
    'drawer shows the name, the status, the tiles and the backup card',
    [
      '.haneul',
      'Name saved on this device only',
      'Deposit',
      'Back up your recovery phrase',
      'View portfolio',
    ].every((s) => menu.includes(s))
  );
  await button(/^settings$/i).click();
  await page.waitForTimeout(500);
  const settings = await page.locator('body').innerText();
  check(
    'settings slide-out lists Theme, Recovery phrase, Face ID unlock, Lock and Disconnect',
    ['Theme', 'Recovery phrase', 'Face ID unlock', 'Lock', 'Disconnect'].every((s) =>
      settings.includes(s)
    )
  );
  await page.getByText('Recovery phrase', { exact: true }).click();
  await page.getByText('Before you view it').waitFor({ timeout: 10000 });
  await button(/view phrase/i).click();
  await page.getByText('Confirm your password').waitFor({ timeout: 10000 });
  await page.getByPlaceholder('Password').fill(PASSWORD);
  await button(/^continue$/i).click();
  await page.getByText('Your recovery phrase').waitFor({ timeout: 15000 });
  await button(/^show$/i).click();
  await page.waitForTimeout(400);
  const dialogText = await page.locator('[role="dialog"]').last().innerText();
  const words = dialogText
    .split(/\s+/)
    .filter((w) => /^[a-z]{3,8}$/.test(w))
    .slice(-12);
  check('twelve words revealed', words.length === 12);
  await button(/^done$/i).click();
  await page.waitForTimeout(800);
  account = await stored();
  check('Done records the backup', !!account?.backedUpAt);
  await openMenu();
  check(
    'backup card gone once backed up',
    !(await page.locator('body').innerText()).includes('Back up your recovery phrase')
  );

  await button(/^settings$/i).click();
  await page.getByRole('switch').waitFor({ timeout: 10000 });
  await page.waitForTimeout(300);
  await page.getByRole('switch').click();
  await page.waitForTimeout(1000);
  check('Face ID turned off', !(await stored())?.biometric);
  await page.getByRole('switch').click();
  await page.getByPlaceholder('Password').waitFor({ timeout: 10000 });
  await page.getByPlaceholder('Password').fill(PASSWORD);
  await button(/^continue$/i).click();
  await button(/enable face id/i).waitFor({ timeout: 10000 });
  await button(/enable face id/i).click();
  await page.waitForTimeout(2000);
  check('Face ID turned back on', !!(await stored())?.biometric);

  await page.keyboard.press('Escape');
  await openMenu();
  await button(/^settings$/i).click();
  await page.waitForTimeout(500);
  await page.getByText(/^Lock$/).click();
  await page.waitForTimeout(1000);
  check('Lock closes the session', !(await sessionOpen()));

  await page.reload();
  await button(/^log in$/i)
    .first()
    .click();
  await page.getByText('Welcome back').waitFor();
  await button(/forgot password/i).click();
  await button(/reset wallet/i).click();
  await restoreFromPhrase(words, RESTORED_PASSWORD);
  check('reset + restore gives the same address', (await stored())?.address === address);

  await wipeDevice();
  await page.reload();
  await toConnectScreen();
  await button(/log in with recovery phrase/i).click();
  await restoreFromPhrase(words, PASSWORD);
  check(
    'cold restore on a wiped device gives the same address',
    (await stored())?.address === address
  );

  // ---- 3. Chain-native passkey account ---------------------------------------------------
  await freshAuthenticator();
  await openFresh();
  await toConnectScreen();
  await button(/^passkey/i)
    .first()
    .click();
  await page.getByText('Sign in with a passkey').waitFor({ timeout: 10000 });
  const credentialsBefore = await credentialCount();
  await button(/create passkey/i).click();
  await page.getByPlaceholder('yourname').waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  const passkeyName = (await page.getByPlaceholder('yourname').inputValue()).trim();
  await button(/^continue$/i).click();
  await page.getByText("You're all set").waitFor({ timeout: 20000 });
  let record = await passkeyStored();
  check(
    'passkey account stored with its name',
    record?.username === passkeyName && !!record?.address,
    passkeyName
  );
  check(
    'passkey credential registered on the platform authenticator',
    (await credentialCount()) === credentialsBefore + 1
  );
  const cardText = await page.locator('[role="dialog"]').last().innerText();
  check(
    'completion card shows the name and no recovery-phrase copy',
    cardText.includes(`${passkeyName}.haneul`) && !/recovery phrase/i.test(cardText)
  );
  const passkeyAddress = record.address;
  await button(/start trading/i).click();
  await page.waitForTimeout(1200);
  check('header shows the passkey name', await headerShows(`${passkeyName}.haneul`));
  await page.reload();
  await page.waitForTimeout(2500);
  check('reload keeps the passkey account connected', await headerShows(`${passkeyName}.haneul`));

  await wipeDevice();
  await page.reload();
  await toConnectScreen();
  await button(/^passkey/i)
    .first()
    .click();
  await page.getByText('Sign in with a passkey').waitFor({ timeout: 10000 });
  await button(/i already have one/i).click();
  await page.getByText("You're all set").waitFor({ timeout: 20000 });
  record = await passkeyStored();
  check(
    '"I already have one" recovers the same address from two assertions',
    record?.address === passkeyAddress
  );
  await button(/start trading/i).click();
  await page.waitForTimeout(1200);
  // Recovery finds no name here (dev has no name service), so the address shows.
  check('recovered passkey account connected', await headerShows(passkeyAddress));

  console.log(`\n${passed} checks passed`);
} catch (e) {
  const names = await page
    .getByRole('button')
    .allInnerTexts()
    .catch(() => []);
  console.log('  buttons on screen:', JSON.stringify(names.map((n) => n.trim()).filter(Boolean)));
  if (process.env.SCREENSHOT) await page.screenshot({ path: process.env.SCREENSHOT });
  console.log(`\n${e.message} after ${passed} checks`);
  process.exitCode = 1;
} finally {
  await browser.close();
}

import { chromium } from 'playwright-core';
import { resolve } from 'node:path';
import { ROOT, loadConfig } from './config.js';
import { Human } from './human.js';

/**
 * Comax raises native `alert`/`confirm` dialogs — printing is one — and with no
 * handler registered Playwright silently dismisses them. That dismissal can
 * fail and take the whole CDP connection down with it, which is what kept
 * killing the agent window mid-print.
 *
 * Accepting is the right default here: these are informational prompts in a
 * flow the caller already chose to run. Every one is logged, so a dialog we did
 * not expect still shows up in the run log rather than vanishing.
 */
function handleDialogs(page, logger) {
  page.on('dialog', (d) => {
    // Accept first, log after: the dialog can be torn down by the page while an
    // awaited log line is still resolving, and the accept then arrives too late
    // — which silently answered "no" to Comax's "האם ברצונך להדפיס?".
    const type = d.type();
    const full = d.message();
    const message = full.slice(0, 120);
    // Keep the last dialog on the page so callers can react to it. Comax
    // refuses a login only through an alert ("קוד משתמש בשימוש") — the page
    // itself just sits on the login form, so without this there is no way to
    // tell a wrong password from "the previous session is still open".
    page.__lastDialog = { type, message: full, at: Date.now() };
    d.accept()
      .then(() => logger?.step('dialog', `${type} אושר: ${message}`))
      .catch((e) => logger?.step('dialog', `${type} "${message}" — לא אושר: ${e.message}`));
  });
}

/**
 * Tell Chrome to accept downloads without asking.
 *
 * Comax's report exports arrive as `.htm` served with an Excel content type,
 * and Chrome stalls them: the matrix report left a 14 KB `.crdownload` stub in
 * Downloads and never finished. `Browser.setDownloadBehavior` at the browser
 * level covers downloads started from any frame or popup, which page-level
 * settings miss.
 */
async function allowDownloads(context, downloadPath) {
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    const cdp = await context.newCDPSession(page);
    await cdp.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath,
      eventsEnabled: true,
    });
  } catch {
    // Older Chrome builds only expose the page-level command; the launch flags
    // below still cover the common case.
  }
}

const HIDE_AUTOMATION = () => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  if (!navigator.languages || navigator.languages.length === 0) {
    Object.defineProperty(navigator, 'languages', { get: () => ['he-IL', 'he', 'en-US'] });
  }
};

/**
 * Stop Comax from opening Chrome's print dialog.
 *
 * `chrome://print/` is browser UI, not a page: the agent can see the tab exists
 * but cannot click anything in it, cannot screenshot it (the screenshot hangs on
 * "waiting for fonts to load"), and cannot even close it — the close call hangs
 * too. One appeared after issuing an invoice and left the session stuck with
 * nothing the agent could do about it. That is fine when someone is sitting at
 * the machine and fatal when they are not.
 *
 * Comax requires at least one copy when the customer has no email on file, so
 * the copy count cannot simply be zeroed. But the document is already committed
 * by the time printing starts — the print itself is a side effect. Neutralising
 * `window.print` keeps the commit and drops the dialog.
 *
 * Set `suppressPrintDialog: false` in the config to get real printing back.
 */
const SUPPRESS_PRINT = () => {
  const noop = () => { try { console.info('[agent] window.print suppressed'); } catch { /* ignore */ } };
  try { Object.defineProperty(window, 'print', { value: noop, writable: true, configurable: true }); }
  catch { window.print = noop; }
};

/**
 * Launches the real, installed Google Chrome (not bundled Chromium, never
 * headless) against a dedicated persistent profile inside the project. The
 * profile keeps the Comax session alive between runs, so you log in by hand
 * once and the agent picks up from there.
 *
 * A CDP port is exposed so other tools (snapshot, task runs) can attach to the
 * same window while you keep browsing. Chrome only permits this on a non-default
 * profile, which is exactly what we use.
 */
export async function openBrowser({ logger = null } = {}) {
  const cfg = loadConfig();
  const profileDir = resolve(ROOT, cfg.profileDir);

  const context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chrome',
    headless: false,
    viewport: null,
    locale: cfg.locale,
    timezoneId: cfg.timezone,
    acceptDownloads: true,
    downloadsPath: resolve(ROOT, 'runs', 'downloads'),
    // Playwright defaults this to false, which passes --no-sandbox. Chrome then
    // shows "היציבות והאבטחה ייפגעו" and lives up to it: the window died
    // repeatedly mid-export and downloads stalled as .crdownload stubs. There is
    // no reason to disable the sandbox here — this is a normal desktop Chrome.
    chromiumSandbox: true,
    args: [
      `--remote-debugging-port=${cfg.debugPort}`,
      // No --disable-blink-features=AutomationControlled here. Chrome lists it
      // as unsupported and answers with the yellow "היציבות והאבטחה ייפגעו"
      // banner, which pushes the whole page down — and this agent clicks by
      // coordinates from boundingBox, so a banner that appears or disappears
      // moves every target under the mouse. `ignoreDefaultArgs` below already
      // removes the automation notice, and HIDE_AUTOMATION covers
      // navigator.webdriver. There is nobody to hide from: Comax is a portal we
      // sign into as ourselves.
      '--start-maximized',
      '--no-first-run',
      '--no-default-browser-check',
      // One --disable-features flag only: a second occurrence replaces the
      // first rather than adding to it.
      '--disable-features=Translate,OptimizationHints,InsecureDownloadWarnings,DownloadBubble,DownloadBubbleV2',
      // Comax serves report exports as HTML under an Excel content type, which
      // Chrome stalls mid-transfer — the matrix report left a 14 KB
      // `.crdownload` stub and never finished.
      '--safebrowsing-disable-download-protection',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  await context.addInitScript(HIDE_AUTOMATION);
  if (cfg.suppressPrintDialog !== false) await context.addInitScript(SUPPRESS_PRINT);
  await allowDownloads(context, resolve(ROOT, 'runs/downloads'));

  const page = context.pages()[0] ?? (await context.newPage());
  page.setDefaultTimeout(cfg.pace.actionTimeoutMs);
  page.setDefaultNavigationTimeout(cfg.pace.navTimeoutMs);
  handleDialogs(page, logger);

  return { context, page, human: new Human(page, cfg.pace, logger), cfg, profileDir, owned: true };
}

/**
 * Attaches to the window already opened by `npm run open`, so mapping and task
 * runs happen in the session you are looking at. Returns null if nothing is up.
 */
export async function attachBrowser({ logger = null } = {}) {
  const cfg = loadConfig();
  let browser;
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${cfg.debugPort}`, { timeout: 5000 });
  } catch {
    return null;
  }

  const context = browser.contexts()[0];
  if (!context) {
    await browser.close().catch(() => {});
    return null;
  }

  // Prefer the tab that is actually showing something.
  const pages = context.pages().filter((p) => p.url() !== 'about:blank');
  const page = pages[pages.length - 1] ?? context.pages()[0] ?? (await context.newPage());
  page.setDefaultTimeout(cfg.pace.actionTimeoutMs);
  page.setDefaultNavigationTimeout(cfg.pace.navTimeoutMs);
  handleDialogs(page, logger);

  return { browser, context, page, human: new Human(page, cfg.pace, logger), cfg, owned: false };
}

/** Attach to the open window if there is one, otherwise launch a fresh one. */
export async function getBrowser({ logger = null } = {}) {
  return (await attachBrowser({ logger })) ?? (await openBrowser({ logger }));
}

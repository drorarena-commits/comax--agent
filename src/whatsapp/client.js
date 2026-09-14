/**
 * WhatsApp bridge — the connection layer.
 *
 * WHY whatsapp-web.js AND NOT BAILEYS
 * -----------------------------------
 * Both give a linked-device QR, and both are unofficial. The difference is what
 * the connection LOOKS like from WhatsApp's side, and that difference is the
 * whole risk here — Dror's private number is also his business number, so a ban
 * costs him the channel his customers know.
 *
 * Baileys speaks the protocol directly with a reimplemented crypto stack: no
 * real client ever produces that connection signature. whatsapp-web.js drives
 * the actual WhatsApp Web app inside a real Chrome and reads the app's own
 * internal Store, so the traffic is WhatsApp Web traffic. Slower and heavier —
 * it needs a browser — and that is the price we are deliberately paying.
 *
 * Chrome is the one already installed on this machine (same as the Comax
 * agent's approach: a real browser, not a bundled one). puppeteer's own
 * Chromium download is skipped, which is why `executablePath` is mandatory
 * rather than a nicety.
 */

import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from '../config.js';

// whatsapp-web.js is CommonJS and this project is ESM. A default import would
// work for the namespace but not reliably for named bindings across versions,
// so take the module object explicitly.
const require = createRequire(import.meta.url);
const { Client, LocalAuth } = require('whatsapp-web.js');

/** Where the linked-device session lives. Git-ignored: it is a live credential. */
export const PROFILE_DIR = resolve(ROOT, '.whatsapp-profile');

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA
    ? `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`
    : null,
].filter(Boolean);

function findChrome() {
  const fromEnv = process.env.WA_CHROME || process.env.CHROME_PATH;
  if (fromEnv) {
    if (!existsSync(fromEnv)) {
      throw new Error(`WA_CHROME מצביע על קובץ שלא קיים: ${fromEnv}`);
    }
    return fromEnv;
  }
  const found = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      'לא נמצא כרום מותקן. התקן כרום, או הצבע עליו עם WA_CHROME ב-.env.',
    );
  }
  return found;
}

/**
 * Is there a session on disk at all?
 *
 * Used to tell "you never linked" apart from "you linked and it expired" — two
 * situations with different answers, and the QR flow should only run for the
 * first one unless asked.
 */
export function hasSession() {
  return existsSync(resolve(PROFILE_DIR, 'session', 'Default'));
}

/**
 * Build a client. Does not connect — call `connect()` for that.
 *
 * @param {object} [opts]
 * @param {(qr: string) => void} [opts.onQr]  Called with the QR payload when
 *   WhatsApp asks for a link. Absence of this callback is not an error: an
 *   unlinked session simply fails to become ready, and the caller reports it.
 * @param {boolean} [opts.headed]  Show the Chrome window. Off by default —
 *   nobody is at the screen when this runs from Dror's phone.
 */
export function makeClient({ onQr, headed = false } = {}) {
  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: PROFILE_DIR }),
    puppeteer: {
      executablePath: findChrome(),
      headless: headed ? false : true,
      args: [
        // WhatsApp Web is a single heavy tab; the default /dev/shm size is the
        // usual cause of silent renderer crashes in long-lived sessions.
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
      ],
    },
    // Ask WhatsApp to push chat history on link. Without this the bridge only
    // ever sees messages that arrive after it connects — which is precisely
    // NOT what Dror asked for ("לראות הודעות אחורה").
    syncFullHistory: true,
  });

  if (onQr) client.on('qr', onQr);
  return client;
}

/**
 * Connect and wait for the app to be usable.
 *
 * Resolves with the client once `ready` fires. Rejects on auth failure or on
 * timeout — and a timeout with no session on disk means "not linked yet",
 * which is reported as such rather than as a crash.
 */
export function connect(client, { timeoutMs = 120000 } = {}) {
  return new Promise((resolveReady, reject) => {
    let settled = false;
    const done = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(arg);
    };

    const timer = setTimeout(() => {
      done(
        reject,
        new Error(
          hasSession()
            ? `הסשן קיים אבל לא נטען תוך ${Math.round(timeoutMs / 1000)} שניות — ייתכן שהקישור פג. הרץ: npm run wa-link`
            : 'אין סשן מקושר. הרץ: npm run wa-link כדי לקבל קוד QR',
        ),
      );
    }, timeoutMs);

    client.on('ready', () => done(resolveReady, client));
    client.on('auth_failure', (m) =>
      done(reject, new Error(`אימות נכשל: ${m}`)),
    );
    client.on('disconnected', (r) =>
      done(reject, new Error(`הקישור נותק: ${r}`)),
    );

    client.initialize().catch((e) => done(reject, e));
  });
}

/**
 * The linked account's own JID — i.e. the "message yourself" chat.
 *
 * This is the single entry on the send allowlist, so it is read from the live
 * connection and never from config: a hand-typed number in `.env` is exactly
 * the kind of thing that would quietly point the allowlist at someone else.
 */
export function selfJid(client) {
  const wid = client.info?.wid;
  if (!wid?._serialized) {
    throw new Error('הלקוח לא מחובר — אין מזהה עצמי');
  }
  return wid._serialized;
}

/** Close cleanly. Leaving Chrome up would hold the session and the profile lock. */
export async function shutdown(client) {
  try {
    await client.destroy();
  } catch {
    // Already gone. Nothing to reclaim.
  }
}

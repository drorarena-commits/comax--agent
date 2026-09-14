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
import { existsSync, rmSync } from 'node:fs';
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
 * Is there a Chrome profile on disk?
 *
 * ⚠️ THIS IS NOT "AM I LINKED". Measured 14/09/2026: a pairing attempt that
 * failed mid-flow still left a 22 MB profile behind, and this returned true
 * with no link whatsoever — which then refused a retry as "already linked".
 *
 * That is the same lie `isLoggedIn()` tells about Comax (finding 4 in MAP.md:
 * a dead session is indistinguishable from a live one when inspected from
 * outside). The only proof of a link is a successful `connect()`, so callers
 * must treat this as "a profile exists, worth trying" and nothing more.
 */
export function hasProfile() {
  return existsSync(resolve(PROFILE_DIR, 'session', 'Default'));
}

/** @deprecated Misleading name kept only so older callers keep working. */
export const hasSession = hasProfile;

/**
 * Delete the profile. Used when a half-finished link has to be started over.
 *
 * Windows holds file handles open for a moment after a process dies, and a
 * killed run leaves ORPHANED Chrome children behind that keep the profile
 * locked — measured 14/09/2026: eight chrome.exe processes survived killing the
 * npm parent, and this threw `EPERM` on the directory. `maxRetries` covers the
 * brief-handle case; a still-running Chrome is a different problem and the
 * error message has to say so rather than read as a permissions mystery.
 */
export function clearProfile() {
  try {
    rmSync(PROFILE_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  } catch (e) {
    if (e.code === 'EPERM' || e.code === 'EBUSY') {
      throw new Error(
        `הפרופיל נעול — כמעט בוודאי יש כרום של הגשר שעוד רץ. לסגור אותו:\n` +
          `  npm run wa-kill\n` +
          `(המקורי: ${e.code})`,
      );
    }
    throw e;
  }
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
    // ⚠️ MEASURED 14/09/2026 — THIS SETTING IS A TRADE, NOT A FREE WIN.
    //
    // It asks WhatsApp to push full chat history, which is exactly what Dror
    // wants ("לראות הודעות אחורה"). But with 899 chats the sync pins the load
    // screen at 99% and `ready` never fires — the first runs after linking
    // succeeded in 40s, and once WhatsApp actually started pushing, every run
    // timed out at 7 minutes. A setting that fetches the history and prevents
    // reading it is worse than one that fetches less.
    //
    // Default is therefore OFF, with WA_FULL_HISTORY=1 to run a deliberate,
    // long, one-off sync. Not a guess: both states are measured by wa-syncmode.
    syncFullHistory: process.env.WA_FULL_HISTORY === '1',
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
export function connect(client, { timeoutMs = 420000, onProgress } = {}) {
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
            ? [
                `הטעינה לא הסתיימה תוך ${Math.round(timeoutMs / 1000)} שניות.`,
                'זה כמעט בוודאי אינו קישור שפג — אלא WhatsApp Web שנתקע בטעינה (נמדד: 99%).',
                'הגורם הוא אתחול חוזר של האפליקציה בכל פקודה. אין לסרוק QR מחדש.',
                'לנקות ולנסות:  npm run wa-kill',
              ].join(' ')
            : 'אין סשן מקושר. הרץ: npm run wa-link כדי לקבל קוד QR',
        ),
      );
    }, timeoutMs);

    // WhatsApp Web reports load progress in steps, and the steps matter: a run
    // pinned at 99% is NOT a slow run. Measured 14/09/2026 on this account —
    // 40s to ready on early runs, then repeated 99% stalls past 7 minutes with
    // no setting changed (including with syncFullHistory off, which disproved
    // the obvious suspect). Surfacing the percentage is what makes the two
    // distinguishable at all.
    client.on('loading_screen', (percent, message) => {
      onProgress?.(Number(percent) || 0, message || '');
    });
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

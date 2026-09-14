#!/usr/bin/env node
/**
 * Link the bridge to Dror's WhatsApp — one time, then the session persists.
 *
 * TWO ROUTES, AND THE DEFAULT IS THE PHONE-FRIENDLY ONE
 * -----------------------------------------------------
 * A QR code is the obvious mechanism and the wrong default here. WhatsApp
 * rotates the QR roughly every 20 seconds, and Dror drives this project from an
 * iPhone without seeing the screen — by the time a PNG reaches him in chat the
 * code it contains is dead. That is not a slow delivery, it is a route that
 * cannot work.
 *
 * So the default is a PAIRING CODE: eight characters, valid ~3 minutes, typed
 * into the phone under Linked Devices → Link with phone number. It survives the
 * trip through chat, which is the only requirement that matters.
 *
 * `--qr` keeps the QR route for working at this machine, writing a PNG that is
 * rewritten on every rotation so the file on disk is always the live one.
 *
 * Usage:
 *   npm run wa-link -- 0501234567      pairing code for that number
 *   npm run wa-link -- --qr            QR PNG instead
 *   npm run wa-link -- --status        is it already linked?
 *   npm run wa-link -- <n> --force     wipe a half-finished profile and retry
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { ROOT } from '../src/config.js';
import {
  makeClient,
  connect,
  hasProfile,
  clearProfile,
  selfJid,
  shutdown,
} from '../src/whatsapp/client.js';
import { jidToNumber } from '../src/whatsapp/guard.js';

const require = createRequire(import.meta.url);
const QRCode = require('qrcode');

const OUT_DIR = resolve(ROOT, 'runs', 'whatsapp');
const QR_PNG = resolve(OUT_DIR, 'qr.png');

const argv = process.argv.slice(2);
const wantQr = argv.includes('--qr');
const wantStatus = argv.includes('--status');
const headed = argv.includes('--headed');
const force = argv.includes('--force');
const phoneArg = argv.find((a) => !a.startsWith('-'));

function digitsFor(input) {
  const digits = String(input).replace(/[\s\-().+]/g, '');
  if (!/^\d+$/.test(digits)) {
    throw new Error(`מספר לא תקין: "${input}"`);
  }
  if (digits.startsWith('0') && digits.length === 10) {
    return `972${digits.slice(1)}`;
  }
  if (digits.startsWith('972')) return digits;
  throw new Error(
    `לא מזהה את המספר "${input}" כמספר ישראלי. מסור אותו כ-05XXXXXXXX או 972XXXXXXXXX.`,
  );
}

async function main() {
  if (wantStatus) {
    if (!hasProfile()) {
      console.log('לא מקושר. אין פרופיל על הדיסק.');
      console.log('להתחיל: npm run wa-link -- 05XXXXXXXX');
      return;
    }
    console.log('יש פרופיל על הדיסק — בודק אם הוא באמת מקושר...');
    const client = makeClient({ headed });
    try {
      await connect(client, { timeoutMs: 90000 });
      console.log(`✅ מקושר. המספר: ${jidToNumber(selfJid(client))}`);
    } finally {
      await shutdown(client);
    }
    return;
  }

  if (hasProfile() && !force) {
    // Deliberately worded as "profile", not "session": a link that failed
    // halfway still leaves one behind, and calling that "already linked" is
    // what blocked the retry after the 14/09 failure.
    console.log('⚠️ קיים פרופיל כרום לוואטסאפ — אבל זו אינה הוכחה שהוא מקושר.');
    console.log('   לבדוק אם הוא חי:   npm run wa-link -- --status');
    console.log('   להתחיל קישור מאפס: npm run wa-link -- <מספר> --force');
    return;
  }

  if (force && hasProfile()) {
    clearProfile();
    console.log('הפרופיל הקודם נמחק — מתחיל קישור מאפס.');
  }

  mkdirSync(OUT_DIR, { recursive: true });

  if (wantQr) {
    let rotation = 0;
    const client = makeClient({
      headed,
      onQr: async (qr) => {
        rotation += 1;
        // Overwrite rather than version: an old QR file is worse than no file,
        // because it looks usable and silently is not.
        await QRCode.toFile(QR_PNG, qr, { width: 512, margin: 2 });
        console.log(
          `QR #${rotation} נכתב ל-${QR_PNG} — בתוקף לכ-20 שניות בלבד.`,
        );
      },
    });
    console.log('ממתין לקישור... (סרוק מהטלפון: הגדרות → מכשירים מקושרים)');
    try {
      await connect(client, { timeoutMs: 300000 });
      console.log(`✅ מקושר. המספר: ${jidToNumber(selfJid(client))}`);
    } finally {
      await shutdown(client);
    }
    return;
  }

  if (!phoneArg) {
    console.error('חסר מספר טלפון.');
    console.error('  npm run wa-link -- 0501234567');
    console.error('  npm run wa-link -- --qr        (במקום זה, קוד QR)');
    process.exitCode = 2;
    return;
  }

  const phone = digitsFor(phoneArg);

  /**
   * WHY THIS WAITS FOR THE `qr` EVENT
   * ---------------------------------
   * The first version asked for a pairing code after a fixed 12-second wait.
   * That guessed at when WhatsApp Web would be ready, and on 14/09/2026 it
   * guessed wrong: `requestPairingCode` ran before the auth store existed and
   * the `evaluate` tore the page down — Invariant Violation #56367 inside
   * `allUserPrefsIdb`, then the browser closed and nothing recovered.
   *
   * The `qr` event is the page SAYING it reached the auth screen with its store
   * loaded. Waiting for that fact instead of estimating it is the whole fix.
   * And because WhatsApp rotates the QR every ~20s, a failed attempt gets
   * another chance on the next rotation rather than ending the run.
   */
  let attempts = 0;
  let requesting = false;
  let gotCode = false;

  const client = makeClient({
    headed,
    onQr: async () => {
      if (requesting || gotCode || attempts >= 3) return;
      requesting = true;
      attempts += 1;
      try {
        await client.requestPairingCode(phone, true);
      } catch (e) {
        console.error(`ניסיון ${attempts}/3 לבקש קוד נכשל: ${e.message}`);
        if (attempts >= 3) {
          console.error('');
          console.error('שלושת הניסיונות נכשלו. מסלול הגיבוי:');
          console.error('  npm run wa-link -- --qr --force');
        }
      } finally {
        requesting = false;
      }
    },
  });

  client.on('code', (code) => {
    gotCode = true;
    const pretty = String(code).replace(/(.{4})(.*)/, '$1-$2');
    console.log('');
    console.log('┌──────────────────────────────┐');
    console.log(`│   קוד קישור:  ${pretty}      `);
    console.log('└──────────────────────────────┘');
    console.log('בטלפון: וואטסאפ → הגדרות → מכשירים מקושרים →');
    console.log('        קישור מכשיר → "קשר עם מספר טלפון" → הקלד את הקוד');
    console.log('הקוד בתוקף לכ-3 דקות ויתחדש מעצמו אם יפוג.');
    console.log('');
  });

  console.log('פותח את WhatsApp Web וממתין שהדף יהיה מוכן...');
  console.log('(הקוד יופיע כאן ברגע שוואטסאפ מגיעה למסך האימות)');

  try {
    await connect(client, { timeoutMs: 600000 });
    console.log(`✅ מקושר. המספר: ${jidToNumber(selfJid(client))}`);
    console.log('מעתה: npm run wa -- chats');
  } finally {
    await shutdown(client);
  }
}

// puppeteer surfaces a TargetCloseError as an unhandled rejection when the
// browser dies mid-flow — that is how the 14/09 failure ended, with a stack
// trace and exit 0 instead of a readable message. Report and exit non-zero.
process.on('unhandledRejection', (e) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`הדפדפן נפל באמצע: ${msg}`);
  console.error('לנסות שוב: npm run wa-link -- <מספר> --force');
  process.exit(1);
});

main().catch((e) => {
  console.error(`נכשל: ${e.message}`);
  process.exitCode = 1;
});

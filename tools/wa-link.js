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
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { ROOT } from '../src/config.js';
import {
  makeClient,
  connect,
  hasSession,
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
    if (!hasSession()) {
      console.log('לא מקושר. אין סשן על הדיסק.');
      console.log('להתחיל: npm run wa-link -- 05XXXXXXXX');
      return;
    }
    console.log('יש סשן על הדיסק — בודק שהוא עוד חי...');
    const client = makeClient({ headed });
    try {
      await connect(client, { timeoutMs: 90000 });
      console.log(`✅ מקושר. המספר: ${jidToNumber(selfJid(client))}`);
    } finally {
      await shutdown(client);
    }
    return;
  }

  if (hasSession()) {
    console.log('⚠️ כבר קיים סשן. לבדיקה: npm run wa-link -- --status');
    console.log('   לקישור מחדש — למחוק את .whatsapp-profile/ קודם.');
    return;
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
  const client = makeClient({ headed });

  client.on('code', (code) => {
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

  // The client must be initialising before a pairing code can be requested —
  // the code is produced by the page's own auth store, not by us.
  let ready = false;
  const readyPromise = connect(client, { timeoutMs: 600000 }).then((c) => {
    ready = true;
    return c;
  });

  // Give the page time to load WhatsApp Web and expose the auth store.
  await new Promise((r) => setTimeout(r, 12000));
  if (!ready) {
    try {
      await client.requestPairingCode(phone, true);
    } catch (e) {
      console.error(`לא הצלחתי לבקש קוד קישור: ${e.message}`);
      console.error('נסה את מסלול ה-QR: npm run wa-link -- --qr');
      await shutdown(client);
      process.exitCode = 1;
      return;
    }
  }

  try {
    await readyPromise;
    console.log(`✅ מקושר. המספר: ${jidToNumber(selfJid(client))}`);
    console.log('מעתה: npm run wa -- chats');
  } finally {
    await shutdown(client);
  }
}

main().catch((e) => {
  console.error(`נכשל: ${e.message}`);
  process.exitCode = 1;
});

#!/usr/bin/env node
/**
 * Start the WhatsApp daemon DETACHED, so it survives the session that started it.
 *
 * WHY THIS EXISTS — AND IT IS THE THING I MISSED ALL DAY
 * -----------------------------------------------------
 * `npm run wa-daemon` runs in the foreground. Started from inside a Claude
 * session it dies with that session — measured 14/09/2026: the daemon came up
 * perfectly (connected, 899/899 chats, listening) and was gone minutes later
 * with nothing in the log after the last line.
 *
 * That failure mode is the worst one this bridge has, because it is SILENT in
 * the exact way that matters: Dror sends "הי קלוד" from his phone, nothing
 * listens, nothing errors, and the instruction is simply lost. Everything else
 * built today depends on the daemon being up.
 *
 * Same pattern the project already uses for Chrome in `src/ensure-comax.js`:
 * spawn detached, ignore stdio, unref. Logs go to a file because a detached
 * process has nowhere else to write.
 *
 *   npm run wa-start     start it and wait until it is actually listening
 *   npm run wa-up        is it running?  (no connection needed)
 *   npm run wa-kill      stop it
 */

import { spawn, execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from '../src/config.js';
import { hasProfile } from '../src/whatsapp/client.js';

const STATE_DIR = resolve(ROOT, 'runs', 'whatsapp');
const LOG = resolve(STATE_DIR, 'daemon.log');
const DAEMON = resolve(ROOT, 'tools', 'wa-daemon.js');

const checkOnly = process.argv.includes('--check');

/**
 * Count live daemon processes by command line.
 *
 * ⚠️ Match `wa-daemon.js`, not `wa-daemon`. An earlier check looked for
 * `tools\wa-daemon.js` with a backslash while npm runs it with a forward
 * slash — it reported 0 daemons while one was running fine, and nearly sent me
 * chasing a problem that did not exist.
 */
function liveDaemons() {
  const q = String.fromCharCode(39);
  const cmd =
    `Get-CimInstance Win32_Process -Filter "Name=${q}node.exe${q}" | ` +
    `Where-Object { $_.CommandLine -match ${q}wa-daemon\\.js${q} } | ` +
    `ForEach-Object { $_.ProcessId }`;
  try {
    return execFileSync('powershell.exe', ['-NoProfile', '-Command', cmd], {
      encoding: 'utf8',
    })
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => /^\d+$/.test(s));
  } catch {
    return [];
  }
}

function readStatus() {
  const f = resolve(STATE_DIR, 'daemon-status.json');
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
}

function report() {
  const pids = liveDaemons();
  const st = readStatus();
  if (pids.length === 0) {
    console.log('⛔ הדמון אינו רץ.');
    console.log('   הוראות מהטלפון ("הי קלוד") לא ייתפסו — ובשקט.');
    console.log('   להפעיל:  npm run wa-start');
    return false;
  }
  if (pids.length > 1) {
    // Two daemons can answer the SAME instruction — two WhatsApp messages to a
    // real person. Never "probably fine".
    console.log(`⚠️ ${pids.length} דמונים רצים (${pids.join(', ')}) — זה מצב לא תקין.`);
    console.log('   שני דמונים עלולים לענות פעמיים לאדם אמיתי.');
    console.log('   לסדר:  npm run wa-kill  ואז  npm run wa-start');
    return false;
  }
  console.log(`✅ הדמון רץ (PID ${pids[0]}).`);
  if (st?.state) {
    const age = st.updatedAt
      ? Math.round((Date.now() - new Date(st.updatedAt).getTime()) / 1000)
      : null;
    console.log(
      `   מצב: ${st.state}` +
        (st.chats ? ` · ${st.chats} שיחות` : '') +
        (st.unread !== undefined ? ` · ${st.unread} לא נקראו` : '') +
        (st.queued !== undefined ? ` · ${st.queued} בתור` : '') +
        (age !== null ? ` · עודכן לפני ${age} שניות` : ''),
    );
  }
  return true;
}

if (checkOnly) {
  process.exitCode = report() ? 0 : 1;
} else {
  if (!hasProfile()) {
    console.error('לא מקושר לוואטסאפ. קודם:  npm run wa-link -- 05XXXXXXXX');
    process.exitCode = 2;
  } else {
    const existing = liveDaemons();
    if (existing.length > 0) {
      console.log(`הדמון כבר רץ (PID ${existing.join(', ')}). לא מפעיל שני.`);
      report();
    } else {
      mkdirSync(STATE_DIR, { recursive: true });
      const out = openSync(LOG, 'a');

      const child = spawn(process.execPath, [DAEMON], {
        cwd: ROOT,
        detached: true,
        // stdio to the log file, not 'ignore': a detached daemon that fails has
        // nowhere else to say so, and this bridge's whole risk is silent failure.
        stdio: ['ignore', out, out],
        windowsHide: true,
      });
      // Without unref this process would not exit while the daemon lives, which
      // defeats the entire point of detaching.
      child.unref();

      console.log(`הדמון משוגר מנותק (PID ${child.pid}) — שורד סגירת סשן.`);
      console.log(`לוג: ${LOG}`);
      console.log('ממתין שיאזין (עד 5 דקות — טעינת WhatsApp Web)...');

      // Wait on the FACT of listening, not on a timer. Reporting success before
      // the daemon is listening would be the same mistake that broke the pairing
      // code earlier today.
      const deadline = Date.now() + 300000;
      const before = existsSync(LOG) ? statSync(LOG).size : 0;
      const poll = setInterval(() => {
        let tail = '';
        try {
          const buf = readFileSync(LOG, 'utf8');
          tail = buf.slice(Math.max(0, before - 2000));
        } catch {
          tail = '';
        }
        if (tail.includes('מאזין')) {
          clearInterval(poll);
          console.log('');
          const line = tail
            .split(/\r?\n/)
            .find((l) => l.includes('שיחות (מתוך'));
          if (line) console.log(line.trim());
          console.log('✅ הדמון מאזין. שלח מהטלפון: "הי קלוד ..."');
          process.exit(0);
        }
        if (tail.includes('נכשל:') || liveDaemons().length === 0) {
          clearInterval(poll);
          console.log('');
          console.log('⛔ הדמון נפל. הסוף של הלוג:');
          console.log(tail.split(/\r?\n/).slice(-8).join('\n'));
          process.exit(1);
        }
        if (Date.now() > deadline) {
          clearInterval(poll);
          console.log('');
          console.log('⚠️ חמש דקות ולא הגיע ל"מאזין". הוא עדיין עשוי לעלות —');
          console.log('   לבדוק:  npm run wa-up');
          process.exit(1);
        }
      }, 3000);
    }
  }
}

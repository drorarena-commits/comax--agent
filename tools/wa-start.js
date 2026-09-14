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
  // ⚠️ A LIVE PROCESS IS NOT A WORKING BRIDGE.
  //
  // Measured 14/09/2026: the daemon process was alive while its state was
  // 'failed' (it had stalled in loading and given up), and this reported
  // "✅ running" — on the strength of which I told Dror his queued answer had
  // been sent. It had not. Same class of mistake as hasProfile() meaning
  // "linked": checking the cheap proxy instead of the thing that matters.
  const bad = st?.state === 'failed' || st?.state === 'disconnected' || st?.state === 'stopped';
  if (bad) {
    console.log(`⛔ הדמון לא תקין — התהליך חי (PID ${pids[0]}) אבל מצבו: ${st.state}`);
    if (st.error) console.log(`   ${st.error}`);
    const q = st.queued ?? 0;
    if (q > 0) {
      console.log(`   ⚠️ ${q} פריטים בתור לא יטופלו עד שהוא יעלה מחדש.`);
    }
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
      // ⚠️ Measured 14/09/2026: the deadline is counted from SPAWN, and the
      // spawn-to-"connecting" gap alone ate five minutes on one run while the
      // page load that followed took THIRTEEN seconds. The old 5-minute budget
      // therefore reported failure on a start that succeeded moments later —
      // and a launcher that cries wolf gets ignored, which is how a genuinely
      // dead bridge ends up unnoticed. Ten minutes, and the message below says
      // to check rather than asserting anything.
      const deadline = Date.now() + 600000;
      // ⚠️ Read ONLY what this run appends — measured 14/09/2026, the first
      // version sliced from `before - 2000` and so re-read the PREVIOUS run's
      // "מאזין" line, declaring success within a second of launching. A
      // readiness check that can pass on stale output is worse than none: it
      // reports a live bridge when nothing came up.
      const before = existsSync(LOG) ? statSync(LOG).size : 0;
      const poll = setInterval(() => {
        let tail = '';
        try {
          const buf = readFileSync(LOG, 'utf8');
          tail = buf.length > before ? buf.slice(before) : '';
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
          console.log('⚠️ עשר דקות ולא הגיע ל"מאזין" — אבל הוא עדיין עשוי לעלות.');
          console.log('   זה לא בהכרח כשל. לבדוק לפני שמסיקים:');
          console.log('   לבדוק:  npm run wa-up');
          process.exit(1);
        }
      }, 3000);
    }
  }
}

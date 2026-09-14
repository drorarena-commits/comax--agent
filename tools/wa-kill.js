#!/usr/bin/env node
/**
 * Kill the bridge's own Chrome processes — and nothing else.
 *
 * WHY THIS EXISTS
 * ---------------
 * Measured 14/09/2026: stopping a `wa-link` run killed the npm parent but left
 * EIGHT orphaned chrome.exe children alive, still holding a lock on
 * `.whatsapp-profile/`. The next run then failed with a bare `EPERM` on the
 * directory, which reads like a permissions problem and is not one.
 *
 * ⚠️ THE DANGEROUS PART, AND WHY IT IS SAFE HERE
 * This machine runs Chrome for Dror himself AND for the Comax agent — 21 other
 * chrome.exe processes were alive at the time of the measurement. Killing by
 * image name would have taken down his browser and the Comax session with it.
 *
 * So the filter is the profile path in the process command line, and there is
 * deliberately no `--all` and no fallback to killing by name: a run that cannot
 * identify its own processes must report that, never widen its aim.
 *
 *   npm run wa-kill
 */

import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { PROFILE_DIR } from '../src/whatsapp/client.js';

const MARKER = '.whatsapp-profile';
const DAEMON_MARKER = 'wa-daemon';

/**
 * ⚠️ THE DAEMON PROCESS MUST BE CLOSED TOO — this was missing and it cost.
 *
 * The first version killed only Chrome. So every "clean up and restart" left
 * the previous daemon's NODE process alive, and by the end of 14/09/2026 ten of
 * them were running at once. The `claimPid` guard exists precisely to stop
 * that, and it was defeated by deleting `daemon.pid` before each start —
 * a guard is only as good as the habit around it.
 *
 * Two daemons can answer the SAME instruction, which means two WhatsApp
 * messages to a real person. That is the harm being prevented here.
 */
function listOwnDaemons() {
  const ps = [
    '-NoProfile',
    '-Command',
    `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ` +
      `Where-Object { $_.CommandLine -like '*${DAEMON_MARKER}*' } | ` +
      `ForEach-Object { $_.ProcessId }`,
  ];
  try {
    return execFileSync('powershell.exe', ps, { encoding: 'utf8' })
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => /^\d+$/.test(s))
      .filter((pid) => Number(pid) !== process.pid);
  } catch {
    return [];
  }
}

function listOwnChrome() {
  // CIM over tasklist: tasklist cannot filter on the command line, which is the
  // only thing that distinguishes our Chrome from Dror's.
  const ps = [
    '-NoProfile',
    '-Command',
    `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | ` +
      `Where-Object { $_.CommandLine -like '*${MARKER}*' } | ` +
      `ForEach-Object { $_.ProcessId }`,
  ];
  const out = execFileSync('powershell.exe', ps, { encoding: 'utf8' });
  return out
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s));
}

/**
 * Ask first, force second.
 *
 * ⚠️ MEASURED 14/09/2026 — SIGKILL ON CHROME HAS A COST.
 * The daemon already handles SIGTERM: it calls `shutdown()`, which closes
 * Chrome through puppeteer so the profile is left consistent. SIGKILL skips all
 * of that, and a Chrome killed mid-write leaves IndexedDB dirty — after which
 * the NEXT startup stalls at 99% reading it. Four starts succeeded today after
 * orderly stops; the one that followed a forced kill hung.
 *
 * So: SIGTERM, a grace period, and SIGKILL only for what refuses to go.
 */
function alive(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function askToStop(pid) {
  try {
    process.kill(Number(pid), 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}

function kill(pid) {
  try {
    process.kill(Number(pid), 'SIGKILL');
    return true;
  } catch {
    return false;
  }
}

function waitGone(pids, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (!pids.some(alive)) return true;
    // Busy-wait: this is a short-lived CLI, and pulling in a sleep helper for
    // a few seconds of shutdown is not worth the dependency.
    execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Start-Sleep -Milliseconds 400']);
  }
  return !pids.some(alive);
}

// Daemon first, then Chrome: killing Chrome out from under a live daemon makes
// it log a disconnect and thrash before it exits.
const daemons = listOwnDaemons();
if (daemons.length > 0) {
  console.log(`נמצאו ${daemons.length} תהליכי דמון — מבקש סגירה מסודרת.`);
  for (const pid of daemons) askToStop(pid);
  if (waitGone(daemons, 15000)) {
    console.log('  נסגרו מסודר — הכרום נסגר דרך puppeteer והפרופיל נשאר נקי.');
  } else {
    const stubborn = daemons.filter(alive);
    console.log(`  ⚠️ ${stubborn.length} לא נסגרו תוך 15 שניות — אין ברירה, SIGKILL.`);
    console.log('     ייתכן שהטעינה הבאה תהיה איטית או תיתקע ב-99%.');
    for (const pid of stubborn) kill(pid);
  }
}

// Only Chrome that OUTLIVED its daemon gets forced: an orderly daemon shutdown
// takes its own Chrome with it, so anything still here is already orphaned.
const pids = listOwnChrome();
if (pids.length > 0) {
  console.log(`נשארו ${pids.length} תהליכי כרום יתומים — סוגר.`);
  for (const pid of pids) kill(pid);
}

// The pid file is state, not a process: a stale one blocks the next start with
// "daemon already running" when nothing is.
try {
  rmSync(resolve(PROFILE_DIR, '..', 'runs', 'whatsapp', 'daemon.pid'), { force: true });
} catch {
  /* nothing to clear */
}

const leftD = listOwnDaemons();
const leftC = listOwnChrome();
if (daemons.length === 0 && pids.length === 0) {
  console.log('אין תהליכי גשר פתוחים. הפרופיל פנוי.');
  console.log(`(${PROFILE_DIR})`);
} else {
  console.log(`נשארו: דמון=${leftD.length} כרום=${leftC.length}`);
  if (leftD.length > 0 || leftC.length > 0) {
    console.log('⚠️ נשארו תהליכים. להריץ שוב.');
    process.exitCode = 1;
  }
}

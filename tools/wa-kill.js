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
import { PROFILE_DIR } from '../src/whatsapp/client.js';

const MARKER = '.whatsapp-profile';

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

function kill(pid) {
  try {
    process.kill(Number(pid), 'SIGKILL');
    return true;
  } catch {
    return false;
  }
}

const pids = listOwnChrome();

if (pids.length === 0) {
  console.log('אין תהליכי כרום של הגשר. הפרופיל פנוי.');
  console.log(`(${PROFILE_DIR})`);
} else {
  console.log(`נמצאו ${pids.length} תהליכי כרום של הגשר — סוגר.`);
  let killed = 0;
  for (const pid of pids) {
    if (kill(pid)) killed += 1;
  }
  const left = listOwnChrome();
  console.log(`נסגרו ${killed}. נשארו: ${left.length}`);
  if (left.length > 0) {
    console.log('⚠️ נשארו תהליכים. ייתכן שצריך להריץ שוב.');
    process.exitCode = 1;
  }
}

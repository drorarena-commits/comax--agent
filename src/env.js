/**
 * Minimal .env reader — no dependency, and deliberately dumb.
 *
 * The credentials file is written by hand and never committed (.gitignore).
 * Nothing here logs, echoes or stores a value anywhere else.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './config.js';

export function loadEnv() {
  const file = resolve(ROOT, '.env');
  if (!existsSync(file)) return {};
  const out = {};
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

/** Returns credentials only if all three are present. Never logs them. */
export function comaxCredentials() {
  const e = loadEnv();
  const org = e.COMAX_ORG ?? process.env.COMAX_ORG;
  const user = e.COMAX_USER ?? process.env.COMAX_USER;
  const pass = e.COMAX_PASS ?? process.env.COMAX_PASS;
  if (!org || !user || !pass) return null;
  return { org, user, pass };
}

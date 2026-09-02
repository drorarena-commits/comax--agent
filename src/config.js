import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const CONFIG_PATH = resolve(ROOT, 'config/comax.config.json');

export function loadConfig() {
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
}

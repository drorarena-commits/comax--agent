import { mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './config.js';

function stamp(d = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export class RunLogger {
  constructor(name) {
    this.name = name;
    this.startedAt = Date.now();
    this.dir = resolve(ROOT, 'runs', `${stamp()}-${name}`);
    mkdirSync(this.dir, { recursive: true });
    this.logFile = resolve(this.dir, 'steps.log');
    this.shotIndex = 0;
    this.step('run', `start: ${name}`);
  }

  step(kind, detail = '') {
    const t = new Date();
    const elapsed = ((Date.now() - this.startedAt) / 1000).toFixed(1);
    const line = `${t.toISOString()} +${elapsed.padStart(7)}s  ${kind.padEnd(8)} ${detail}\n`;
    appendFileSync(this.logFile, line, 'utf8');
    process.stdout.write(`  ${kind.padEnd(8)} ${detail}\n`);
  }

  async shot(page, label = 'screen') {
    this.shotIndex += 1;
    const file = resolve(this.dir, `${String(this.shotIndex).padStart(2, '0')}-${label}.png`);
    try {
      await page.screenshot({ path: file, fullPage: false });
      this.step('shot', file);
    } catch (e) {
      this.step('shot', `FAILED: ${e.message}`);
    }
    return file;
  }

  save(filename, data) {
    const file = resolve(this.dir, filename);
    const body = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    writeFileSync(file, body, 'utf8');
    this.step('save', file);
    return file;
  }

  done(status = 'ok') {
    this.step('run', `end: ${status} (${((Date.now() - this.startedAt) / 1000).toFixed(1)}s)`);
    return this.dir;
  }
}

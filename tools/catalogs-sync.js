/**
 * מסנכרן קטלוגי ארנה מתיקייה בגוגל דרייב אל `content/arena-catalogs/`.
 *
 *   node tools/catalogs-sync.js <manifest.json>
 *   node tools/catalogs-sync.js <manifest.json> --force   מוריד גם מה שלא השתנה
 *   node tools/catalogs-sync.js --state                   מה כבר מסונכרן
 *
 * ה-manifest הוא מה שמחבר הדרייב מחזיר על התיקייה — מערך של
 * `{ id, name, modifiedTime }`. חלוקת העבודה מכוונת:
 *
 *   **החיפוש בדרייב נעשה על ידי Claude** דרך מחבר הדרייב, כי הוא זה שיודע
 *   לזהות איזה קובץ רלוונטי. **ההורדה נעשית כאן**, דרך חלון הסוכן, כי כך
 *   הבייטים עוברים ישירות לדיסק ולא דרך השיחה — קובץ של 2 MB בבסיס 64 עולה
 *   מאות אלפי טוקנים ואי אפשר בכלל לכתוב אותו לדיסק (אותו שיקול כמו
 *   `tools/drive-get.js`).
 *
 * מה שכבר סונכרן נרשם ב-`content/arena-catalogs/.state.json` לפי
 * `modifiedTime`, ולכן הרצה חוזרת מורידה רק מה שהשתנה.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve, basename, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { ROOT, loadConfig } from '../src/config.js';

const DIR = resolve(ROOT, 'content/arena-catalogs');
const STATE = resolve(DIR, '.state.json');

const readState = () => { try { return JSON.parse(readFileSync(STATE, 'utf8')); } catch { return {}; } };
const writeState = (s) => { mkdirSync(DIR, { recursive: true }); writeFileSync(STATE, JSON.stringify(s, null, 2), 'utf8'); };

/** שם תיקייה בטוח לקטלוג — בלי סיומת ובלי תווים שמפילים נתיבים. */
const slug = (name) => basename(name, extname(name)).replace(/[^\w֐-׿.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

const args = process.argv.slice(2);
const state = readState();

if (args[0] === '--state') {
  const rows = Object.entries(state);
  console.log(rows.length ? `מסונכרנים (${rows.length}):` : 'עוד לא סונכרן דבר.');
  for (const [id, v] of rows) console.log(`  ${v.name}  ·  ${v.modifiedTime}  ·  ${id.slice(0, 12)}…`);
  process.exit(0);
}

const manifestPath = args.find((a) => !a.startsWith('--'));
if (!manifestPath) {
  console.error('שימוש: node tools/catalogs-sync.js <manifest.json> [--force]');
  process.exit(1);
}
const force = args.includes('--force');
const manifest = JSON.parse(readFileSync(resolve(ROOT, manifestPath), 'utf8'));
const wanted = (Array.isArray(manifest) ? manifest : manifest.files ?? []).filter((f) => f?.id && f?.name);
if (!wanted.length) { console.error('ה-manifest ריק.'); process.exit(1); }

const todo = wanted.filter((f) => force || state[f.id]?.modifiedTime !== f.modifiedTime);
console.log(`בתיקייה: ${wanted.length} קבצים · להורדה: ${todo.length}`);
for (const f of wanted) if (!todo.includes(f)) console.log(`  ⏭  ${f.name} — לא השתנה`);

if (todo.length) {
  const cfg = loadConfig();
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cfg.debugPort}`, { timeout: 120_000 });
  const ctx = browser.contexts()[0];
  if (!ctx) { console.error('אין חלון סוכן פתוח. תריץ npm run open.'); process.exit(1); }

  try {
    mkdirSync(DIR, { recursive: true });
    for (const f of todo) {
      const p = await ctx.newPage();
      const dl = ctx.waitForEvent('download', { timeout: 10 * 60_000 });
      // `confirm=t` מדלג על מסך "אי אפשר לסרוק לווירוסים" שקבצים גדולים תמיד
      // נתקלים בו, ושבלעדיו ההורדה נשארת תלויה.
      await p.goto(`https://drive.google.com/uc?export=download&id=${f.id}&confirm=t`,
        { waitUntil: 'domcontentloaded', timeout: 90_000 }).catch(() => {});
      const d = await dl;
      const src = resolve(DIR, d.suggestedFilename());
      await d.saveAs(src);
      console.log(`  ⬇  ${d.suggestedFilename()}  (${(statSync(src).size / 1024 / 1024).toFixed(2)} MB)`);

      // המרה ל-CSV. הקוד קורא CSV בלבד, וזיהוי הקטלוג הוא לפי התוכן.
      execFileSync(process.execPath, [resolve(ROOT, 'tools/xlsx.js'), src, resolve(DIR, slug(f.name))],
        { stdio: 'pipe' });
      state[f.id] = { name: f.name, modifiedTime: f.modifiedTime, at: new Date().toISOString() };
      writeState(state);
      await p.close().catch(() => {});
    }
  } finally {
    await browser.close().catch(() => {}); // מנתק CDP בלבד; החלון נשאר פתוח
  }
}

// ── דיווח כיסוי ─────────────────────────────────────────────────────────────
// לא רק "ירד" — כמה תיאורי צבע יש עכשיו ומה עדיין חסר. זה מה שבאמת נמדד.
const { loadSources, buildRows, IMPORT_HEADERS } = await import('../src/items/build-import.js');
const src = loadSources();
const { ready } = buildRows(src);
const iE = IMPORT_HEADERS.indexOf('שם פריט באנגלית');
const iM = IMPORT_HEADERS.indexOf('דגם');
const iC = IMPORT_HEADERS.indexOf('צבע');
const iN = IMPORT_HEADERS.indexOf('שם פריט');

const filled = ready.filter((r) => String(r[iE] ?? '').trim()).length;
console.log(`\nקטלוגים: ${src.colors.files.length} · תיאור צבע: ${filled}/${ready.length}`);

const left = new Map();
for (const r of ready) {
  if (String(r[iE] ?? '').trim()) continue;
  const k = `${r[iM]} | ${r[iC]}`;
  const e = left.get(k) ?? { n: 0, name: String(r[iN]).slice(0, 34) };
  e.n += 1;
  left.set(k, e);
}
if (!left.size) console.log('כל תיאורי הצבע מולאו ✅');
else {
  console.log(`חסר: ${[...left.values()].reduce((s, e) => s + e.n, 0)} שורות · ${left.size} צמדים`);
  for (const [k, v] of [...left].sort()) console.log(`  ${k.padEnd(15)} ${String(v.n).padStart(2)}  ${v.name}`);
}
console.log('\nלבניית הקובץ:  node tools/items-import-file.js');

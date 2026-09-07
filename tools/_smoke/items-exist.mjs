/**
 * בודק אם ברקודים קיימים במסך הפריטים (a84) — דרך תיבת החיפוש, לא בדפדוף.
 *
 *   node tools/_smoke/items-exist.mjs 3468337939436 3468336980101 ...
 *   node tools/_smoke/items-exist.mjs --file <xlsx>            כל הקובץ, מדגם 12
 *
 * קריאה בלבד.
 */
import { chromium } from 'playwright-core';
import { loadConfig } from '../../src/config.js';

const cfg = loadConfig();
const args = process.argv.slice(2);
let codes = args.filter((a) => /^\d{8,}$/.test(a));
if (args[0] === '--file') {
  const { sheetNames, readSheet } = await import('../xlsx.js');
  const sh = sheetNames(args[1])[0];
  const rows = readSheet(args[1], sh.path);
  const bi = rows[0].indexOf('ברקוד');
  const all = rows.slice(1).map((r) => String(r[bi]).trim()).filter(Boolean).sort();
  const n = Number(args[2] ?? 12);
  // מדגם פרוס על כל הטווח — כולל את מה שלא הופיע בתצוגת ה-100
  codes = Array.from({ length: n }, (_, i) => all[Math.floor(i * (all.length - 1) / (n - 1))]);
}
if (!codes.length) { console.error('לא נמסרו ברקודים.'); process.exit(1); }

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cfg.debugPort}`, { timeout: 120_000 });
try {
  const page = browser.contexts()[0].pages().find((p) => /Max2000/i.test(p.url()));
  const items = page.frames().find((f) => /Erp\/Prt\/PrtV/i.test(f.url()));
  if (!items) throw new Error('מסך הפריטים לא פתוח.');

  let found = 0;
  for (const code of codes) {
    const box = items.locator('#wBk');
    await box.fill('');
    await box.fill(code);
    await box.press('Enter');            // על השדה, לא על הדף — אחרת הסינון לא קורה
    await new Promise((r) => setTimeout(r, 1400));
    const hit = await items.evaluate((c) => {
      const txt = document.body.innerText || '';
      return txt.includes(c);
    }, code);
    if (hit) found += 1;
    console.log(`  ${code}  ${hit ? '✅ קיים' : '⛔ לא נמצא'}`);
  }
  await items.locator('#wBk').fill('');
  await items.locator('#wBk').press('Enter');
  console.log(`\n${found}/${codes.length} נמצאו.`);
  process.exitCode = found === codes.length ? 0 : 1;
} finally {
  await browser.close().catch(() => {});
}

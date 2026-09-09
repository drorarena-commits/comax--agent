/**
 * מוכיח ששער העמודות של `items-import` תופס את המלכודת.
 *
 *   node tools/_smoke/items-import-gate.mjs
 *
 * מקלקל בכוונה שדה אחד ב-FMiun — מוחק את `.title` ומשאיר את `.value`, כלומר
 * בדיוק המצב שנראה תקין על המסך ושולח את העמודה הלא נכונה — ואז מריץ את
 * הקריאה-בחזרה של המשימה ומוודא שהיא נופלת. דורש שדיאלוג היבוא כבר פתוח
 * וממופה (הרצת dry-run של items-import).
 */
import { chromium } from 'playwright-core';
import { loadConfig } from '../../src/config.js';

const cfg = loadConfig();
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cfg.debugPort}`, { timeout: 120_000 });
try {
  const page = browser.contexts()[0].pages().find((p) => /Max2000/i.test(p.url()));
  const picker = page.frames().find((f) => /MiunSwImp/i.test(f.url()));
  if (!picker) throw new Error('פריים FMiun לא פתוח. תריץ קודם dry-run של items-import.');

  const read = () => picker.evaluate(() =>
    [...document.querySelectorAll('input[id^="chk"]')].map((e) => ({ id: e.id, letter: e.value, ordinal: e.title })));

  const before = (await read()).filter((f) => f.letter);
  if (!before.length) throw new Error('אין מיפוי על המסך. תריץ קודם dry-run של items-import.');
  const victim = before.find((f) => f.id === 'chk113') ?? before[0];
  console.log(`הקורבן: ${victim.id}  אות="${victim.letter}"  סידורי="${victim.ordinal}"`);

  await picker.evaluate((id) => { document.getElementById(id).title = ''; }, victim.id);
  const after = await read();
  const got = after.find((f) => f.id === victim.id);
  console.log(`אחרי הקלקול: אות="${got.letter}"  סידורי="${got.ordinal}"  ← על המסך זה נראה זהה`);

  const caught = String(got.ordinal) !== String(victim.ordinal);
  console.log(caught
    ? `✅ השער תופס: הסידורי השתנה, והבדיקה של items-import משווה אותו — לא את האות.`
    : `⛔ השער לא היה תופס.`);

  await picker.evaluate(([id, t]) => { document.getElementById(id).title = t; }, [victim.id, victim.ordinal]);
  console.log('הוחזר למצבו.');
  process.exitCode = caught ? 0 : 1;
} finally {
  await browser.close().catch(() => {});
}

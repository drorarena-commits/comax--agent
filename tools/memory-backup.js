/**
 * מגבה את **הזיכרון של הסוכן** לתוך הריפו, כדי שהוא ישרוד מחשב חדש וגיבוי.
 *
 *   npm run memory-backup            # מקור ⇒ ריפו (ברירת המחדל)
 *   npm run memory-backup -- --restore   # ריפו ⇒ מקור, **רק קבצים חסרים**
 *
 * הזיכרון של הסוכן יושב **מחוץ לריפו**, ב-
 * `~/.claude/projects/C--AGENT-COMAX-CLOAD/memory/`, ולכן `git ls-files`
 * החזיר עליו **0** — 44 קבצים, מהם חמישה שנשמרו ב-08/09/2026, לא היו מגובים
 * בשום מקום. הפרויקט עובד משני מחשבים, ולכן במחשב השני הם פשוט לא קיימים.
 *
 * ## הכיוון הוא הכלל, לא פרט מימוש
 *
 * דרור הכתיב: **מהמקור לריפו, לא הפוך.** העותק בריפו הוא גיבוי, והמקור הוא
 * הסמכות. לכן:
 *
 *   1. **הגיבוי לעולם אינו כותב למקור.** ברירת המחדל היא כיוון אחד בלבד.
 *   2. **הגיבוי אינו מוחק מהריפו.** שני מחשבים שמגבים לאותה תיקייה היו
 *      מוחקים זה את זכרונות זה אילו זה היה מראה (mirror) — מחשב עם 40 קבצים
 *      היה מוחק 4 של השני בלי סימן. לכן זו **מיזוג**: מוסיף ומעדכן, לא גורע.
 *      מחיקת זיכרון שבאמת התיישן היא פעולה ידנית ומודעת.
 *   3. **`--restore` מוסיף רק את מה שחסר** ואינו דורס קובץ קיים במקור. זו
 *      הדרך להביא זיכרונות למחשב חדש בלי לדרוס למידה מקומית.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { ROOT } from '../src/config.js';

const SOURCE = join(homedir(), '.claude', 'projects', 'C--AGENT-COMAX-CLOAD', 'memory');
const TARGET = resolve(ROOT, 'memory');

const restore = process.argv.includes('--restore');
const [from, to] = restore ? [TARGET, SOURCE] : [SOURCE, TARGET];

if (!existsSync(from)) {
  console.error(`\n⛔ תיקיית המקור לא קיימת: ${from}\n`);
  process.exit(1);
}
if (!existsSync(to)) mkdirSync(to, { recursive: true });

const files = readdirSync(from).filter((f) => f.endsWith('.md') && statSync(join(from, f)).isFile());
const added = [], updated = [], same = [], skipped = [];

for (const f of files) {
  const src = join(from, f);
  const dst = join(to, f);
  const body = readFileSync(src, 'utf8');
  if (!existsSync(dst)) { writeFileSync(dst, body, 'utf8'); added.push(f); continue; }
  // ⚠️ `--restore` לעולם אינו דורס קובץ שקיים במקור — למידה מקומית גוברת.
  if (restore) { skipped.push(f); continue; }
  if (readFileSync(dst, 'utf8') === body) { same.push(f); continue; }
  writeFileSync(dst, body, 'utf8');
  updated.push(f);
}

// קבצים שיש ביעד ואין במקור — **נשארים**. ראו כלל 2 בכותרת.
const orphans = readdirSync(to).filter((f) => f.endsWith('.md') && !files.includes(f));

console.log(`\n  ${restore ? 'ריפו ⇒ מקור (רק חסרים)' : 'מקור ⇒ ריפו'}`);
console.log(`  מ:  ${from}`);
console.log(`  אל: ${to}\n`);
console.log(`  ${files.length} קבצי זיכרון במקור`);
if (added.length) console.log(`  נוספו:   ${added.length}  ${added.join(' · ')}`);
if (updated.length) console.log(`  עודכנו:  ${updated.length}  ${updated.join(' · ')}`);
if (same.length) console.log(`  זהים:    ${same.length}`);
if (skipped.length) console.log(`  דולגו (קיימים במקור, לא נדרסים): ${skipped.length}`);
if (orphans.length) console.log(`  ביעד ולא במקור — נשמרים בכוונה: ${orphans.length}  ${orphans.join(' · ')}`);
console.log('');

/**
 * מוודא שקומקס מוכן לעבודה, ומדפיס סטטוס אחד ברור.
 *
 *   npm run ensure
 *   npm run ensure -- --reset    מנקה חסימת לוגין ידנית
 *
 * השורה האחרונה היא תמיד בדיוק אחת מ: READY / NEEDS_LOGIN / FAILED — כדי שתהיה
 * קריאה גם מהאייפון, בלי לחפש בתוך הפלט.
 *
 * יציאה: 0 ל-READY, 1 לשאר.
 */
import { ensureComax, clearBlock } from '../src/ensure-comax.js';
import { RunLogger } from '../src/logger.js';

const logger = new RunLogger('ensure');

if (process.argv.includes('--reset')) {
  console.log(clearBlock() ? '  חסימת הלוגין נוקתה.' : '  לא הייתה חסימת לוגין.');
}

const r = await ensureComax({ logger });

console.log('\n─────────────────────────────────────────────────────────────');
if (r.status === 'READY') {
  console.log('  חלון הסוכן חי וקומקס מחובר.');
} else if (r.status === 'NEEDS_LOGIN') {
  console.log('  צריך התחברות ידנית.');
} else {
  console.log('  לא הצלחתי להכין את קומקס.');
}
console.log(`  ${r.reason}`);
console.log('─────────────────────────────────────────────────────────────\n');

// ה-CLI מנתק, בניגוד לקריאה מתוך run.js: כאן אין מי שימשיך להשתמש בסשן.
// ניתוק CDP בלבד — החלון נשאר פתוח והמושב נשאר תפוס עד שקומקס ישחרר אותו לבד.
if (r.session) await r.session.browser?.close().catch(() => {});

logger.done(r.status === 'READY' ? 'ok' : 'failed');
console.log(r.status);
process.exit(r.status === 'READY' ? 0 : 1);

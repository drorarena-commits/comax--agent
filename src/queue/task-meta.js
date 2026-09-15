/**
 * קריאת `meta` של משימה — בתהליך נפרד, ובכוונה.
 *
 * המאזין חי ימים. `import` של קובץ משימה לתוכו היה גורר לתוכו את playwright
 * ואת כל שרשרת המודולים, ומשאיר אותם שם לנצח — וגם היה הופך תקלת טעינה
 * במשימה אחת לקריסה של התור כולו. תהליך בן שמת מיד מבודד את שניהם.
 *
 * ⛔ ברירת המחדל היא `writes: true`, בדיוק כמו ב-`run.js`. משימה שה-meta שלה
 * לא נקרא — קובץ שבור, טעינה שנכשלה, כל סיבה — נחשבת כותבת. המאזין לא מנחש
 * לטובת עצמו במקום שבו טעות פירושה מסמך חשבונאי שנוצר בלי שאיש ראה אותו.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from '../config.js';

const PROBE = `
import { pathToFileURL } from 'node:url';
const m = await import(pathToFileURL(process.env.QUEUE_TASK_FILE).href);
process.stdout.write(JSON.stringify({
  writes: m.meta?.writes !== false,
  description: m.meta?.description ?? null,
  hasRun: typeof m.run === 'function',
}));
`;

export function readTaskMeta(name) {
  const file = resolve(ROOT, 'src/tasks', `${name}.js`);
  if (!existsSync(file)) {
    return { ok: false, writes: true, error: `אין משימה בשם "${name}" ב-src/tasks/.` };
  }
  try {
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', PROBE], {
      cwd: ROOT,
      env: { ...process.env, QUEUE_TASK_FILE: file },
      encoding: 'utf8',
      timeout: 60_000,
    });
    const meta = JSON.parse(out);
    if (!meta.hasRun) {
      return { ok: false, writes: true, error: `${name}.js אינו מייצא פונקציה בשם run.` };
    }
    return { ok: true, writes: meta.writes !== false, description: meta.description };
  } catch (e) {
    return { ok: false, writes: true, error: `לא ניתן לקרוא את meta של "${name}": ${e.message.split('\n')[0]}` };
  }
}

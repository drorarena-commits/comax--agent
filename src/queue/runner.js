/**
 * הרצת משימה כתהליך בן, וקריאת מה שיצא ממנה.
 *
 * המאזין **לא** מייבא את קוד המשימה לתוכו ולא משכפל שום לוגיקה מ-`run.js`:
 * הוא מפעיל בדיוק את אותה שורת פקודה שדרור היה מקליד. כך כל השערים שכבר
 * קיימים — הנעילה, `ensureComax`, `precheck`, שדות חובה, הלוגין מחדש — חלים
 * עליו בלי שאיש יזכור לשמור על שני מסלולים מסונכרנים.
 *
 * ⛔ `--confirm` אינו נוסף כאן בשום תנאי. הוא יגיע בעתיד ממסלול האישור
 * (§5 במפרט) ורק ממנו.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve, isAbsolute } from 'node:path';
import { ROOT } from '../config.js';

/** שעה. הייצוא המלא לבדו לוקח כחצי שעה, ולכן התקרה גבוהה בכוונה. */
const DEFAULT_TIMEOUT_MS = 60 * 60_000;

/** כמה פלט לשמור בזיכרון — מספיק לשגיאה מלאה, לא מספיק כדי לנפח תהליך שחי ימים. */
const MAX_OUTPUT = 200_000;

/**
 * מריץ `node tools/run.js <task> --json <input>`.
 *
 * `onLine` מקבל כל שורה תוך כדי, כדי שהלוג של המאזין יתמלא בזמן אמת ולא רק
 * בסוף — משימה של חצי שעה ששותקת נראית כמו תקיעה (זו הסיבה שכלל "לומר מה רץ"
 * קיים גם מול המסך).
 */
export function runTask({ task, input = {}, timeoutMs = DEFAULT_TIMEOUT_MS, onLine = () => {} }) {
  const args = [resolve(ROOT, 'tools', 'run.js'), task, '--json', JSON.stringify(input)];

  return new Promise((done) => {
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      // ⚠️ בלי shell: הקלט מגיע מקובץ שנכתב מבחוץ, ומעבר דרך מעטפת היה הופך
      // ערך עם תווים מיוחדים לפקודה. מערך ארגומנטים אינו עובר פרסור מחדש.
      shell: false,
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });

    let out = '';
    let pending = '';
    let killed = null;

    const feed = (buf) => {
      const text = buf.toString('utf8');
      if (out.length < MAX_OUTPUT) out += text;
      pending += text;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      for (const l of lines) onLine(l);
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);

    const timer = setTimeout(() => {
      // SIGTERM ולא הרג בכוח: ל-`run.js` יש מטפל שמשחרר את המושב לפני היציאה.
      killed = `המשימה חרגה מ-${Math.round(timeoutMs / 60_000)} דקות ונעצרה.`;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.on('error', (e) => {
      clearTimeout(timer);
      done({ code: -1, output: out, error: `הפעלת המשימה נכשלה: ${e.message}`, runDir: null, result: null });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (pending) onLine(pending);
      const runDir = findRunDir(out);
      done({
        code,
        output: out,
        error: killed,
        runDir,
        result: runDir ? readResult(runDir) : null,
      });
    });
  });
}

/** `run.js` מסיים תמיד ב-"לוג והרצה: <נתיב>". האחרון הוא הנכון. */
function findRunDir(output) {
  const hits = [...output.matchAll(/לוג והרצה:\s*(.+)/g)];
  if (!hits.length) return null;
  const dir = hits[hits.length - 1][1].trim();
  return existsSync(dir) ? rel(dir) : null;
}

function readResult(runDir) {
  const file = resolve(ROOT, runDir, 'result.json');
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** נתיב יחסי לשורש, עם קו נטוי — כדי שקובץ התוצאה ייקרא זהה בשני המחשבים. */
const rel = (p) => (isAbsolute(p) && p.startsWith(ROOT) ? relative(ROOT, p).replaceAll('\\', '/') : p);

/**
 * המושב תפוס — מזוהה מהפלט ולא מקוד היציאה.
 *
 * `run.js` יוצא ב-1 גם על סירוב נעילה וגם על תקלה אמיתית, ושתיהן אינן אותו
 * דבר: תפוס פירושו "לנסות שוב בעוד חצי דקה", תקלה פירושה "לעצור ולדווח".
 * ההצצה בלוק לפני ההרצה תופסת את רוב המקרים; זה תופס את המרוץ שנשאר.
 */
export const looksBusy = (output) =>
  /לקומקס יש מושב אחד|שחרור מושב אוטומטי רץ כרגע|הרצה אחרת מחזיקה בנעילה/.test(output);

/**
 * שורות ה-`RunLogger` — `kind` בן 8 תווים ואז פירוט.
 *
 * ⚠️ הן **לא** התשובה, והנפילה לשורות האחרונות בלי לסנן אותן הפכה בקשה אמיתית
 * לסיכום חסר תועלת: ב-15/09/2026 דרור ביקש את הצעת המחיר האחרונה של שחייני
 * אונו, המשימה החזירה שתי הצעות עם מספרים, תאריכים וסכומים — ומה שהגיע לטלפון
 * היה `shot` · `save` · `run end: ok`, כי התשובה ישבה שש שורות מעל החיתוך.
 */
const LOGGER_NOISE =
  /^(run|step|shot|save|input|mode|think|click|type|paste|press|verify|frame|program|dialog|session|login|error|warehouse|download|downloads|settle)\s/;

/**
 * סיכום קריא לטלפון.
 *
 * הסדר הוא לפי מי יודע יותר: `result.summary` שהמשימה כתבה בעצמה · דפוסים
 * מוכרים מתוך `result.json` · ורק בסוף שורות הפלט, **מסוננות מרעש הלוגר**.
 * דרור קורא את השדה הזה במסך נעול, ולכן "המשימה הסתיימה" אינו סיכום.
 */
export function summarize({ task, result, output }) {
  if (result && typeof result.summary === 'string' && result.summary.trim()) {
    return result.summary.trim();
  }

  // ייצוא פר-מחסן: מה ירד, וגם מה **לא** — כשלון חלקי אינו נראה בקוד היציאה.
  if (result && Array.isArray(result.done)) {
    const ok = result.done
      .map((d) => `${d.name ?? d.code}${d.sizeBytes ? ` (${(d.sizeBytes / 1024 / 1024).toFixed(1)} MB)` : ''}`)
      .join(' · ');
    const bad = (result.failed ?? []).map((f) => `${f.name ?? f.code}: ${f.error}`).join(' · ');
    return [`${task} · ${result.done.length} הצליחו`, ok, bad && `⚠️ נכשלו: ${bad}`]
      .filter(Boolean)
      .join('\n');
  }

  // רשימת מסמכים (`quote-read` ודומיו): מספר · תאריך · לקוח · סכום.
  if (result && Array.isArray(result.list) && result.list.length) {
    const rows = result.list
      .slice(0, 8)
      .map((r) => `${r.docNo ?? '?'} · ${r.date ?? ''} · ${r.amount ?? ''}`.trim());
    const who = result.list[0].customer ?? result.customer ?? '';
    const more = result.list.length > 8 ? `\n… ועוד ${result.list.length - 8}` : '';
    const hidden = result.hiddenByYear ? `\n(${result.hiddenByYear} הוסתרו בסינון השנה)` : '';
    // ⛔ בלי "האחרונה היא X": מספר מסמך אינו מזהה ייחודי (כלל 18), ושתי הצעות
    // באותו תאריך הן בדיוק המצב שבו בחירה אוטומטית קוראת את המסמך הלא נכון.
    const pick = result.list.length > 1 ? '\n⚠️ יותר מאחת — צריך docNo מדויק.' : '';
    return `${result.list.length} מסמכים · ${who}\n${rows.join('\n')}${more}${hidden}${pick}`;
  }

  // שורות המסמך שנקראו בפועל.
  if (result && Array.isArray(result.matches) && result.matches.length) {
    const rows = result.matches
      .slice(0, 10)
      .map((m) => [m.sku ?? m.alt ?? m.item, m.description, m.qty && `×${m.qty}`, m.price]
        .filter(Boolean)
        .join(' · '));
    return `${result.matches.length} שורות\n${rows.join('\n')}`;
  }

  const tail = output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('לוג והרצה:') && !LOGGER_NOISE.test(l))
    .slice(-6)
    .join('\n');
  return tail.slice(0, 600) || `${task} הסתיימה.`;
}

/**
 * קבצים שהמשימה ייצרה — נאספים מתוך `result.json` לפי מה שקיים על הדיסק.
 *
 * הבדיקה היא `existsSync` ולא ניחוש לפי סיומת: מחרוזת שנראית כמו נתיב ואינה
 * קיימת היא בדרך כלל שם, לא קובץ.
 */
export function collectArtifacts(result, limit = 20) {
  const found = new Set();
  const walk = (v) => {
    if (found.size >= limit) return;
    if (typeof v === 'string') {
      // ⚠️ שני סוגי הלוכסן. הגרסה הראשונה בדקה קו נטוי בלבד, ולכן כל נתיב
      // ווינדוס — כלומר כל נתיב שקומקס מחזיר — נשר בשקט: התוצאה דיווחה
      // `artifacts: []` על ייצוא של 22.6MB שנחת בפועל (נמדד 15/09/2026).
      if (v.length > 4 && /[/\\]/.test(v) && existsSync(v)) found.add(rel(v));
      return;
    }
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === 'object') return Object.values(v).forEach(walk);
  };
  walk(result);
  return [...found];
}

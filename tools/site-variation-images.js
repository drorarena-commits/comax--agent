#!/usr/bin/env node
/**
 * תמונות ווריאציה באתר ארנה ישראל — סריקה, ושכפול תמונה מווריאציה אחות.
 *
 * הרקע: `WC_Product_Variation::get_image_id()` **נופל בשקט** לתמונה הראשית של
 * מוצר האב כשלווריאציה אין תמונה משלה, וכך גם שדה `image` שה-REST מחזיר. לכן
 * "יש תמונה" אינו אומר שהווריאציה מוגדרת, ואת הבדיקה האמיתית עושים בהשוואת
 * `variation.image.id` ל-`parent.images[0].id`.
 *
 * ⚠️ אבל זהות בין השתיים אינה בהכרח תקלה. במוצר **חד-צבעי** התמונה הראשית
 * היא ממילא התמונה של הצבע היחיד, ואין שום דבר לתקן. נמדד 15/09/2026 על
 * מוצר 74623: כל שש הווריאציות הצביעו על 74641, וזה המצב הנכון. לכן הקריטריון
 * הוא **מוצר עם יותר מצבע אחד** שבו לצבע מסוים אין תמונה משלו.
 *
 * מקור השכפול שהכלי הזה מבצע הוא **ווריאציה אחות באותו `pa_color`** שיש לה
 * תמונה משלה. אסורים: `ux_image` של המונח (ריבוע צבע 50×50 המשותף לכל
 * המוצרים) ו-`commercekit_*` — CommerceKit הוסר מהאתר, והערכים שנשארו שם הם
 * שאריות של שכפולי מוצרים ומצביעים על צבעים שאינם של המוצר כלל.
 *
 * ⚠️ **תיקון להנחה מוקדמת: גלריית ההורה כן ניתנת לשיוך.** כתוב כאן קודם שאי
 * אפשר לדעת איזו תמונה בגלריה שייכת לאיזה צבע — וזה לא נכון. שמות הקבצים של
 * ארנה בנויים `<קוד דגם>-<קוד צבע>-<שם>-<מס' צילום>-<זווית>`, למשל
 * `004714-102-AIR-BOLD-SWIPE-003-BL-S.jpg`, ולכן השיוך הוא על **מזהה מפורש**
 * ולא על דמיון. נמדד 15/09/2026: מתוך 78 קבוצות הצבע החסרות שיש מהן מלאי,
 * ל-49 יש בגלריית ההורה תמונה שגם קוד הדגם וגם קוד הצבע שבשמה תואמים לקומקס.
 * ⛔ אבל **שני המזהים נדרשים, ושניהם ממיקום קבוע בשם**: חיפוש קוד הצבע בכל
 * מקום בשם מתנגש עם מספר הצילום (`-001-`) ועם קוד הדגם, ומחזיר תמונה של צבע
 * אחר בלי שום סימן. התאמה על קוד הצבע בלבד היא **הצעה לאישור בעין**, לא כתיבה.
 *
 *   node tools/site-variation-images.js                    סריקה ודוח, בלי לגעת באתר
 *   node tools/site-variation-images.js --fix              משכפל בפועל
 *   node tools/site-variation-images.js --fix --limit 5    תיקון מדוד לבדיקה
 *   node tools/site-variation-images.js --fix --from <קובץ>  תיקון מדוח קיים, בלי סריקה חוזרת
 *
 * ⚠️ `--from` אינו רק חיסכון בזמן. הסריקה נמשכת כחמש דקות, ובלעדיו כל ריצת
 * ניסיון קטנה (`--limit 2`) הייתה דורשת סריקה מלאה — מה שמעודד לדלג על
 * הניסיון ולכתוב 82 שינויים בבת אחת. הדוח כולל `was` לכל שורה, ולכן הוא גם
 * נקודת השחזור: `was` הוא מה ש**הוצג** קודם (תמונת האב), בעוד שמה שהיה
 * **מוגדר** בפועל הוא כלום — שחזור פירושו ריקון השדה, לא כתיבת `was` בחזרה.
 */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from '../orders-app/config.js';
import { parseFlags, flagProblems } from '../src/cli-args.js';

const ROOT = resolve(import.meta.dirname, '..');

// ⛔ `--limit` היה `Number(args[i + 1])` בלי בדיקה, ו-`--limit abc` או `--limit`
// בסוף השורה נתנו `NaN`. `slice(0, NaN)` מחזיר **מערך ריק**, ולכן הכלי סיים
// בהצלחה, דיווח "0 תוקנו" ויצא 0 — ומכאן המסקנה שאין מה לתקן באתר. הצלחה שאינה
// מבדילה מעצמה גרועה מקריסה, ולכן `numbers` נאכף בפרסר.
const flags = parseFlags(process.argv.slice(2), {
  skipFirst: false,
  booleans: ['fix'],
  valued: ['from', 'skip'],
  numbers: ['limit'],
});
const problems = flagProblems(flags);
if (flags._.length) problems.push(`ארגומנט חופשי: "${flags._.join('", "')}".`);
if (problems.length) {
  console.error('\n' + problems.join('\n')
    + '\n\nשימוש: node tools/site-variation-images.js [--fix] [--limit <מספר>] [--from <מק"ט>] [--skip <דוח קודם.json>]\n');
  process.exit(1);
}

const FIX = flags.input.fix === true;
const LIMIT = flags.input.limit ?? Infinity;
const FROM = flags.input.from ?? null;
/** מה שכבר תוקן בריצה קודמת — כדי ש-`--from` חוזר לא יכתוב פעמיים. */
const SKIP = (() => {
  if (!flags.input.skip) return new Set();
  const prev = JSON.parse(readFileSync(flags.input.skip, 'utf8'));
  return new Set((prev.fixed || []).map(x => x.variation));
})();

const auth = 'Basic ' + Buffer.from(`${config.site.key}:${config.site.secret}`).toString('base64');

async function wc(path, { method = 'GET', body } = {}) {
  const url = `${config.site.url}/wp-json/wc/v3/${path}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: auth,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(45_000),
      });
      const text = await res.text();
      if (!res.ok) {
        let detail = text.slice(0, 300);
        try { detail = JSON.parse(text).message || detail; } catch { /* גוף שאינו JSON */ }
        throw new Error(`WooCommerce ${res.status} על ${method} ${path}: ${detail}`);
      }
      return text ? JSON.parse(text) : null;
    } catch (err) {
      // ⚠️ ניסיון חוזר רק בקריאה. כתיבה שנכשלה נזרקת החוצה — חזרה עליה היא
      // שכתוב שני של אותו שדה, ואת זה מחליטים למעלה ולא כאן.
      if (method !== 'GET' || attempt === 3) throw err;
      await new Promise(r => setTimeout(r, attempt * 1500));
    }
  }
}

const attrOf = (v, slug, hebrew) =>
  (v.attributes || []).find(a => a.slug === slug || a.name === hebrew)?.option || '';
const colorOf = v => attrOf(v, 'pa_color', 'צבעים') || '(ללא צבע)';
const sizeOf = v => attrOf(v, 'pa_size', 'מידות למוצר');

/** כל המוצרים מסוג variable, בכל הסטטוסים — טיוטה שמחכה לסחורה נספרת גם היא. */
async function allVariableProducts() {
  const out = [];
  for (let page = 1; ; page++) {
    const batch = await wc(`products?type=variable&status=any&per_page=100&page=${page}&orderby=id&order=asc`);
    if (!batch?.length) break;
    out.push(...batch);
    process.stdout.write(`\r  נסרקו ${out.length} מוצרי אב...`);
    if (batch.length < 100) break;
  }
  process.stdout.write('\n');
  return out;
}

async function main() {
  console.log(`אתר: ${config.site.url}`);
  console.log(FIX ? 'מצב תיקון — כותב לאתר\n' : 'סריקה בלבד — לא נוגע באתר\n');

  if (FROM) {
    const prev = JSON.parse(readFileSync(FROM, 'utf8'));
    console.log(`עובד מדוח קיים: ${FROM}`);
    console.log(`נסרק ב-${prev.scannedAt} · ${prev.fixable.length} שורות לשכפול\n`);
    const report = { ...prev, scannedAt: new Date().toISOString(), mode: 'fix-from-report', source: FROM, fixed: [], failed: [] };
    await applyFixes(report);
    return finish(report);
  }

  const products = await allVariableProducts();
  console.log(`${products.length} מוצרי אב מסוג variable. קורא ווריאציות...\n`);

  const report = {
    scannedAt: new Date().toISOString(),
    site: config.site.url,
    mode: FIX ? 'fix' : 'scan',
    totals: { products: products.length, variations: 0, singleColor: 0, missing: 0, fixable: 0, noSource: 0 },
    fixable: [],
    noSource: [],
    fixed: [],
    failed: [],
  };

  let done = 0;
  for (const p of products) {
    done++;
    process.stdout.write(`\r  ${done}/${products.length} — ${String(p.name).slice(0, 38)}`.padEnd(68));

    const parentImg = p.images?.[0]?.id || 0;
    let variations = [];
    try {
      variations = (await wc(`products/${p.id}/variations?per_page=100&status=any`)) || [];
    } catch (err) {
      report.failed.push({ product: p.id, name: p.name, stage: 'read', error: err.message });
      continue;
    }
    report.totals.variations += variations.length;

    const colors = new Set(variations.map(colorOf));
    if (colors.size <= 1) {
      // מוצר חד-צבעי: התמונה הראשית היא ממילא הצבע היחיד. אין מה לתקן.
      report.totals.singleColor++;
      continue;
    }

    // תמונה "משלה" = קיימת ואינה התמונה הראשית של האב.
    const ownImage = v => (v.image?.id && v.image.id !== parentImg ? v.image.id : 0);
    const byColor = new Map();
    for (const v of variations) {
      const c = colorOf(v);
      if (!byColor.has(c)) byColor.set(c, []);
      byColor.get(c).push(v);
    }

    for (const [color, group] of byColor) {
      const source = group.find(v => ownImage(v));
      const orphans = group.filter(v => !ownImage(v));
      if (!orphans.length) continue;
      report.totals.missing += orphans.length;

      if (!source) {
        report.totals.noSource++;
        report.noSource.push({
          product: p.id,
          name: p.name,
          status: p.status,
          color,
          count: orphans.length,
          variations: orphans.map(v => ({ id: v.id, size: sizeOf(v), sku: v.sku })),
          parentImage: parentImg,
        });
        continue;
      }

      const srcImage = ownImage(source);
      for (const v of orphans) {
        report.totals.fixable++;
        report.fixable.push({
          product: p.id,
          name: p.name,
          status: p.status,
          color,
          variation: v.id,
          size: sizeOf(v),
          sku: v.sku,
          from: source.id,
          fromSize: sizeOf(source),
          imageId: srcImage,
          was: v.image?.id || 0,
        });
      }
    }
  }
  process.stdout.write('\n\n');

  if (FIX) await applyFixes(report);
  return finish(report);
}

/** הכתיבה עצמה — שדה `image` בלבד, ווריאציה־ווריאציה. */
async function applyFixes(report) {
  const todo = report.fixable.filter(x => !SKIP.has(x.variation)).slice(0, LIMIT);
  console.log(`מתקן ${todo.length} ווריאציות${SKIP.size ? ` (מדלג על ${SKIP.size} שכבר תוקנו)` : ''}...\n`);
  let n = 0;
  for (const t of todo) {
    n++;
    process.stdout.write(`\r  ${n}/${todo.length} — ווריאציה ${t.variation}`.padEnd(58));
    try {
      // PUT חלקי: רק `image` נשלח, ולכן מחיר, מלאי ומק"ט אינם נוגעים בו.
      await wc(`products/${t.product}/variations/${t.variation}`, {
        method: 'PUT',
        body: { image: { id: t.imageId } },
      });
      report.fixed.push(t);
    } catch (err) {
      report.failed.push({ ...t, stage: 'write', error: err.message });
    }
    await new Promise(r => setTimeout(r, 250));
  }
  process.stdout.write('\n\n');
}

function finish(report) {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const dir = resolve(ROOT, 'content', 'site-reports');
  mkdirSync(dir, { recursive: true });
  const jsonPath = resolve(dir, `variation-images-${stamp}.json`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');

  const t = report.totals;
  console.log('-'.repeat(64));
  console.log(`מוצרי אב variable:            ${t.products}`);
  console.log(`ווריאציות סה"כ:               ${t.variations}`);
  console.log(`מוצרים חד-צבעיים (תקין):      ${t.singleColor}`);
  console.log(`ווריאציות בלי תמונת צבע:      ${t.missing}`);
  console.log(`  ניתנות לשכפול מאחות:        ${t.fixable}`);
  console.log(`  בלי מקור לשכפול:            ${t.noSource} קבוצות צבע`);
  if (FIX) console.log(`תוקנו בפועל:                  ${report.fixed.length}`);
  if (report.failed.length) console.log(`כשלים:                        ${report.failed.length}`);
  console.log('-'.repeat(64));
  console.log(`דוח מלא: ${jsonPath}`);
}

main().catch(err => {
  console.error('\nשגיאה:', err.message);
  process.exit(1);
});

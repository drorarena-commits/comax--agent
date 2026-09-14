#!/usr/bin/env node
/**
 * דוח HTML לתמונות הווריאציה באתר — מה שוכפל, ומה עדיין חסר תמונה.
 *
 * ⚠️ הדוח **קורא את הווריאציות מחדש מהאתר** ולא מסתפק בקובץ ה-JSON של
 * `site-variation-images.js`. זו אינה כפילות: קריאה חוזרת היא ההוכחה שהכתיבה
 * באמת נחתה, והיא גם המקור לכתובות התמונות שמוצגות כאן. דוח שנבנה מתוך מה
 * שביקשנו לכתוב — במקום ממה שנמצא באתר — ייראה מושלם גם כשהכתיבה נכשלה.
 *
 * הפלט הוא HTML יחיד עם תמונות, כי דרור קורא את התוצרים באייפון: כאן חייבים
 * לראות את התמונה עצמה כדי לדעת שהצבע הנכון הוצמד, ו-CSV או טבלת מזהים לא
 * עונים על זה.
 *
 * ⚠️ **ברירת המחדל מסננת לפריטים עם מלאי במחסן ראשי.** כלל של דרור
 * (15/09/2026): "מעניין רק וריאציות שיש להן מלאי זמין". פריט שאין ממנו סחורה
 * אינו פריט לטיפול, ורשימה שמערבבת את השניים היא רשימה שלא נקראת — 831 שורות
 * נכונות־טכנית שמתוכן רק עשרות ברות פעולה.
 *
 * ⚠️ **והמלאי נמדד בקומקס, לא באתר.** הכמות שרשומה בוורדפרס יכולה להיות שארית
 * ישנה שלא משקפת סחורה בחנות — נמדד על קרש `002024`, שבו לצבע 114 היו 28
 * יחידות רשומות באתר ודרור הורה להוריד אותו בכל זאת. המקור הוא הייצוא המקומי
 * שב-`content/`, וההצלבה לפי מק"ט/ברקוד. המחסן הוא **ראשי**, כי האתר מוכר ממנו
 * בלבד.
 *
 *   node tools/site-variation-images-report.js <קובץ-json> [--out <קובץ-html>] [--all]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { config } from '../orders-app/config.js';
import { stock } from '../src/catalog/local-stock.js';

const args = process.argv.slice(2);
const jsonPath = args.find(a => !a.startsWith('--'));
if (!jsonPath) {
  console.error('שימוש: node tools/site-variation-images-report.js <קובץ-json> [--out <קובץ-html>]');
  process.exit(1);
}
const outArg = args.indexOf('--out');
const outPath = outArg >= 0 ? args[outArg + 1] : jsonPath.replace(/\.json$/, '.html');
const SHOW_ALL = args.includes('--all');

/**
 * מלאי מקומי לפי מק"ט האתר.
 *
 * ⚠️ האינדקס נבנה על **שלושה** שדות — קוד הפריט, הברקוד והמק"ט החלופי — ולא
 * על אחד. בקטלוג של דרור המק"ט והברקוד זהים ב-13,283 מתוך 13,316 הפריטים,
 * אבל לא בכולם, והשארית היא בדיוק המקום שבו "לא נמצא" היה נקרא בטעות כ"אין
 * מלאי". בלי שום נרמול: ערך ממקור חיצוני נבדק כפי שהוא.
 */
function stockIndex() {
  const s = stock();
  const by = new Map();
  const put = (k, r) => { if (k && !by.has(k)) by.set(k, r); };
  for (const r of s.items.values()) {
    put(r.code, r);
    put(r.barcode, r);
    put(r.altCode, r);
  }
  const main = s.warehouses.find(w => w === 'ראשי') || 'ראשי';
  return {
    source: s.source,
    warehouses: s.warehouses,
    /** מחזיר null כשהמק"ט אינו בייצוא כלל — זה לא אפס, זה "לא ידוע". */
    look(sku) {
      const r = sku ? by.get(String(sku).trim()) : null;
      if (!r) return null;
      return { main: r.per?.[main] ?? 0, total: r.total ?? 0, label: r.altCode || r.model || r.name };
    },
  };
}

const auth = 'Basic ' + Buffer.from(`${config.site.key}:${config.site.secret}`).toString('base64');
const wc = async path => {
  const res = await fetch(`${config.site.url}/wp-json/wc/v3/${path}`, {
    headers: { Authorization: auth, Accept: 'application/json' },
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`${res.status} על ${path}`);
  return res.json();
};

const esc = s =>
  String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const adminUrl = id => `${config.site.url}/wp-admin/post.php?post=${id}&action=edit`;

/** כתובת תמונה לפי מזהה — דרך ה-API הציבורי של המדיה, עם מטמון. */
const mediaCache = new Map();
async function mediaSrc(id) {
  if (!id) return null;
  if (mediaCache.has(id)) return mediaCache.get(id);
  let src = null;
  try {
    const res = await fetch(`${config.site.url}/wp-json/wp/v2/media/${id}`, { signal: AbortSignal.timeout(20_000) });
    if (res.ok) {
      const m = await res.json();
      src = m.media_details?.sizes?.thumbnail?.source_url || m.source_url || null;
    }
  } catch { /* תמונה שנמחקה — מוצגת כחסרה, לא מפילה את הדוח */ }
  mediaCache.set(id, src);
  return src;
}

async function main() {
  const report = JSON.parse(readFileSync(jsonPath, 'utf8'));
  const fixed = report.fixed || [];
  console.log(`דוח מ-${basename(jsonPath)} — ${fixed.length} שורות שתוקנו, ${(report.noSource || []).length} קבוצות בלי מקור`);

  // --- אימות: קוראים מחדש כל ווריאציה שתוקנה ---
  console.log('\nמאמת מול האתר...');
  const verified = [];
  let n = 0;
  for (const f of fixed) {
    n++;
    process.stdout.write(`\r  ${n}/${fixed.length}`.padEnd(20));
    try {
      const v = await wc(`products/${f.product}/variations/${f.variation}`);
      verified.push({ ...f, actualImage: v.image?.id || 0, src: v.image?.src || null, ok: v.image?.id === f.imageId });
    } catch (err) {
      verified.push({ ...f, actualImage: null, src: null, ok: false, error: err.message });
    }
  }
  process.stdout.write('\n');
  const bad = verified.filter(v => !v.ok);
  console.log(bad.length ? `⚠️  ${bad.length} שורות לא אומתו` : `✅ כל ${verified.length} השורות אומתו מול האתר`);

  // --- סינון למלאי זמין (ברירת מחדל), מהייצוא המקומי של קומקס ---
  const idx = stockIndex();
  console.log(`\nמלאי מ-${basename(idx.source.named || idx.source.matrix || '?')}${idx.source.matrix ? ` + ${basename(idx.source.matrix)}` : ''}`);

  let noSource = report.noSource || [];
  const before = noSource.reduce((s, x) => s + x.count, 0);
  const skipped = { noStock: 0, unknown: 0, otherWarehouse: 0 };

  for (const g of noSource) {
    // ⚠️ הסינון הוא **ברמת הווריאציה**, לא ברמת קבוצת הצבע: לצבע אחד יכולה
    // להיות מידה אחת במלאי ושש שלא, ולזרוק את כולן יחד היה מסתיר עבודה אמיתית.
    for (const v of g.variations) {
      const st = idx.look(v.sku);
      v.mainStock = st ? st.main : null;
      v.totalStock = st ? st.total : null;
    }
    g.inStock = g.variations.filter(v => (v.mainStock ?? 0) > 0);
    g.elsewhere = g.variations.filter(v => (v.mainStock ?? 0) <= 0 && (v.totalStock ?? 0) > 0);
    skipped.unknown += g.variations.filter(v => v.mainStock === null).length;
    skipped.otherWarehouse += g.elsewhere.length;
  }
  skipped.noStock = before - noSource.reduce((s, g) => s + g.inStock.length, 0);

  if (!SHOW_ALL) {
    noSource = noSource.filter(g => g.inStock.length);
    for (const g of noSource) { g.variations = g.inStock; g.count = g.inStock.length; }
  }
  const after = noSource.reduce((s, x) => s + x.count, 0);
  console.log(
    SHOW_ALL
      ? `מציג הכל: ${before} ווריאציות`
      : `מלאי זמין בראשי: ${after} מתוך ${before} · ${skipped.otherWarehouse} עם מלאי במחסן אחר בלבד · ${skipped.unknown} לא נמצאו בייצוא`,
  );

  console.log('\nמביא תמונות אב לקבוצות שנשארו...');
  for (const g of noSource) g.parentSrc = await mediaSrc(g.parentImage);

  // --- קיבוץ לפי מוצר ---
  const group = (rows, key) => {
    const m = new Map();
    for (const r of rows) {
      const k = key(r);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
    return m;
  };
  const fixedByProduct = group(verified, r => r.product);
  const missingByProduct = group(noSource, r => r.product);

  const t = report.totals || {};
  const when = new Date(report.scannedAt || Date.now()).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' });

  const fixedHtml = [...fixedByProduct.entries()]
    .map(([pid, rows]) => {
      const byColor = group(rows, r => r.color);
      const colors = [...byColor.entries()]
        .map(([color, list]) => {
          const src = list.find(x => x.src)?.src;
          const sizes = list.map(x => esc(x.size)).join(' · ');
          const flag = list.every(x => x.ok) ? '' : ' <span class="bad">לא אומת</span>';
          return `<div class="color">
        ${src ? `<img src="${esc(src)}" alt="${esc(color)}" loading="lazy">` : '<div class="noimg">—</div>'}
        <div><b>${esc(color)}</b>${flag}<br><span class="sizes">${list.length} מידות: ${sizes}</span>
        <br><span class="from">שוכפל מווריאציה ${list[0].from} (מידה ${esc(list[0].fromSize)})</span></div>
      </div>`;
        })
        .join('\n');
      return `<section class="product">
      <h3><a href="${adminUrl(pid)}">${esc(rows[0].name)}</a> <span class="pid">#${pid}</span> <span class="badge">${rows.length}</span></h3>
      ${colors}
    </section>`;
    })
    .join('\n');

  const missingHtml = [...missingByProduct.entries()]
    .sort((a, b) => b[1].reduce((s, x) => s + x.count, 0) - a[1].reduce((s, x) => s + x.count, 0))
    .map(([pid, groups]) => {
      const total = groups.reduce((s, x) => s + x.count, 0);
      const src = groups[0].parentSrc;
      const list = groups
        .map(g => {
          // המידות עצמן, עם הכמות שיושבת בראשי — זה מה שהופך את השורה למטלה.
          const sizes = g.variations
            .map(v => `${esc(v.size || '—')}<span class="q">${v.mainStock ?? '?'}</span>`)
            .join(' ');
          return `<li><b>${esc(g.color)}</b> — ${g.count} ${g.count === 1 ? 'מידה' : 'מידות'}
            <div class="sizerow">${sizes}</div></li>`;
        })
        .join('');
      const status = groups[0].status === 'draft' ? '<span class="draft">טיוטה</span>' : '';
      return `<section class="product">
      <h3><a href="${adminUrl(pid)}">${esc(groups[0].name)}</a> <span class="pid">#${pid}</span> ${status} <span class="badge warn">${total}</span></h3>
      <div class="color">
        ${src ? `<img src="${esc(src)}" alt="" loading="lazy">` : '<div class="noimg">—</div>'}
        <div><span class="sizes">כל הצבעים האלה מציגים כרגע את התמונה הזאת — התמונה הראשית של המוצר:</span>
        <ul class="colors">${list}</ul></div>
      </div>
    </section>`;
    })
    .join('\n');

  const html = `<!doctype html>
<html lang="he" dir="rtl">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>תמונות ווריאציה — אתר ארנה ישראל</title>
<style>
  body { font: 16px/1.6 -apple-system, "Segoe UI", Arial, sans-serif; margin: 0; background: #f4f5f7; color: #1d2327; }
  .wrap { max-width: 900px; margin: 0 auto; padding: 20px 16px 60px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .when { color: #666; font-size: 14px; margin-bottom: 20px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 28px; }
  .card { background: #fff; border-radius: 10px; padding: 14px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .card b { display: block; font-size: 26px; line-height: 1.2; }
  .card span { color: #666; font-size: 13px; }
  .card.good b { color: #1a7f37; }
  .card.warn b { color: #b35900; }
  h2 { font-size: 19px; margin: 32px 0 6px; padding-bottom: 6px; border-bottom: 2px solid #d7dade; }
  h2 .sub { display: block; font-size: 14px; font-weight: 400; color: #666; border: 0; margin-top: 4px; }
  .product { background: #fff; border-radius: 10px; padding: 12px 14px; margin: 10px 0; box-shadow: 0 1px 2px rgba(0,0,0,.06); }
  .product h3 { font-size: 15px; margin: 0 0 8px; font-weight: 600; }
  .product h3 a { color: #1d2327; text-decoration: none; }
  .product h3 a:hover { text-decoration: underline; }
  .pid { color: #888; font-weight: 400; font-size: 13px; }
  .badge { background: #1a7f37; color: #fff; border-radius: 10px; padding: 1px 9px; font-size: 12px; }
  .badge.warn { background: #b35900; }
  .draft { background: #e8e9eb; color: #555; border-radius: 10px; padding: 1px 8px; font-size: 12px; }
  .color { display: flex; gap: 12px; align-items: flex-start; padding: 8px 0; border-top: 1px solid #f0f0f1; }
  .color img, .noimg { width: 72px; height: 72px; object-fit: contain; background: #fafafa; border-radius: 6px; flex: 0 0 72px; }
  .noimg { display: flex; align-items: center; justify-content: center; color: #bbb; }
  .sizes, .from { color: #666; font-size: 13px; }
  .from { color: #1a7f37; }
  .colors { margin: 6px 0 0; padding-inline-start: 20px; font-size: 14px; }
  .sizerow { margin-top: 3px; display: flex; flex-wrap: wrap; gap: 5px; }
  .sizerow > span, .sizerow { font-size: 12px; }
  .sizerow { color: #444; }
  .q { background: #e7f3ea; color: #1a7f37; border-radius: 8px; padding: 0 5px; margin-inline-start: 3px; font-weight: 600; }
  .filter { background: #fff8e6; border-radius: 8px; padding: 10px 13px; font-size: 14px; margin: 0 0 22px; }
  .bad { color: #b32d2e; font-weight: 600; }
  footer { color: #777; font-size: 13px; margin-top: 36px; }
</style>
<div class="wrap">
<h1>תמונות ווריאציה — אתר ארנה ישראל</h1>
<div class="when">${esc(when)} · ${esc(report.site || config.site.url)}</div>

<div class="cards">
  <div class="card"><b>${t.products ?? '—'}</b><span>מוצרי אב עם ווריאציות</span></div>
  <div class="card"><b>${t.variations ?? '—'}</b><span>ווריאציות נסרקו</span></div>
  <div class="card good"><b>${verified.length}</b><span>תמונות שוכפלו</span></div>
  <div class="card warn"><b>${after}</b><span>${SHOW_ALL ? 'עדיין בלי תמונת צבע' : 'חסרות — ויש מהן מלאי'}</span></div>
</div>
${SHOW_ALL ? '' : `<p class="filter">מסונן למלאי זמין במחסן <b>ראשי</b>: ${after} מתוך ${before} הווריאציות החסרות.
  ${skipped.otherWarehouse} נוספות יש מהן מלאי במחסן אחר בלבד (האתר מוכר מראשי בלבד), ו-${skipped.unknown} לא נמצאו בייצוא —
  וחוסר בייצוא הוא &quot;≤0 במחסנים שהדוח כיסה&quot;, לא אפס ודאי. המלאי מקומקס (<code>${esc(basename(idx.source.named || ''))}</code>), לא מוורדפרס.</p>`}

<h2>מה תוקן
  <span class="sub">${verified.length} ווריאציות ב-${fixedByProduct.size} מוצרים. לכל אחת הוצמדה התמונה של <b>אותו צבע בדיוק</b>, ממידה אחרת של אותו מוצר — ${bad.length ? `<span class="bad">${bad.length} לא אומתו</span>` : 'כולן אומתו בקריאה חוזרת מהאתר'}.</span>
</h2>
${fixedHtml || '<p>אין.</p>'}

<h2>מה לא ניתן לתקן בשכפול
  <span class="sub">${after} ווריאציות ב-${missingByProduct.size} מוצרים${SHOW_ALL ? "" : " <b>שיש מהן מלאי בראשי</b>"}. כאן <b>לאף מידה בצבע אין תמונה</b>, ולכן אין ממה לשכפל — צריך תמונה חדשה מה-PIM של ארנה. המספר שליד כל מידה הוא הכמות בראשי. מסודר לפי מספר הווריאציות המושפעות.</span>
</h2>
${missingHtml || '<p>אין.</p>'}

<footer>
  נוצר על ידי <code>tools/site-variation-images.js</code> · הדוח המלא:
  <code>${esc(basename(jsonPath))}</code>
</footer>
</div>
</html>`;

  const out = resolve(outPath);
  writeFileSync(out, html, 'utf8');
  console.log(`\nדוח: ${out}`);
}

main().catch(err => {
  console.error('\nשגיאה:', err.message);
  process.exit(1);
});

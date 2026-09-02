/**
 * מלאי מהייצוא המקומי — CLI.
 *
 *   npm run stock                          מה נטען מ-content/ ומתי
 *   npm run stock -- find "cobra core"     חיפוש חופשי / מק"ט / ברקוד
 *   npm run stock -- item AR12345          פירוט מחסנים לפריט אחד
 *   npm run stock -- warehouse "רמת גן"    מה יש במחסן, מהגדול לקטן
 *   npm run stock -- warehouses            סיכום לכל המחסנים
 *
 * Answers come off disk, never from a fresh Comax report — see the header of
 * src/catalog/local-stock.js.
 */
import { stock, find, whereIs, inWarehouse, label } from '../src/catalog/local-stock.js';

const [cmd = 'info', ...rest] = process.argv.slice(2);
const arg = rest.join(' ').trim();
const n = (v) => Number(v).toLocaleString('he-IL');

/** One item, per Dror's rule: מק"ט חלופי or דגם+צבע — never the barcode. */
function line(r) {
  const price = r.price1 ? `  ₪${Number(r.price1).toFixed(2)}` : '';
  const at = Object.entries(r.per).filter(([, q]) => q > 0).map(([w, q]) => `${w} ${q}`).join(' · ');
  return `  ${label(r)}${price}\n      סה"כ ${r.total}${at ? `   (${at})` : ''}${r.stale ? '   [מהייצוא המלא הישן]' : ''}`;
}

try {
  if (cmd === 'info') {
    const s = stock();
    const short = (f) => (f ? f.split(/[\\/]/).pop() : '—');
    console.log(`\nמקורות ב-content/:`);
    console.log(`  מטריצה (עדכני):  ${short(s.source.matrix)}${s.source.calibrated ? '  [עמודות המחסנים זוהו בהצלבה]' : ''}`);
    console.log(`  ייצוא מלא:        ${short(s.source.named)}`);
    if (s.source.matrixError) console.log(`\n  אזהרה — המטריצה לא נטענה:\n  ${s.source.matrixError.replace(/\n/g, '\n  ')}\n`);
    console.log(`\nמחסנים: ${s.warehouses.join(' · ')}`);
    console.log(`פריטים: ${n(s.items.size)}  ·  מתוכם עם מלאי חיובי: ${n([...s.items.values()].filter((r) => r.total > 0).length)}`);
    console.log(`המטריצה מכסה ${s.source.covers} — פריט שלא בה אינו "0", אלא ≤0 במחסנים שהדוח כיסה.\n`);
  } else if (cmd === 'find') {
    const hits = find(arg, { limit: 40 });
    console.log(`\n"${arg}" → ${hits.length} תוצאות\n`);
    hits.forEach((r) => console.log(line(r)));
    console.log();
  } else if (cmd === 'item') {
    const hits = find(arg, { limit: 5 });
    if (!hits.length) {
      console.log(`\nלא נמצא "${arg}" בייצוא שב-content/.`);
      console.log('זה לא אומר שאין מלאי — זה אומר שהפריט לא בייצוא. לרענן ייצוא, או לבדוק את המק"ט.\n');
      process.exit(1);
    }
    for (const r of hits) {
      const w = whereIs(r.code);
      console.log(`\n${label(r)}`);
      console.log(`  פריט ${r.code}${r.department ? `  ·  ${r.department}` : ''}${r.price1 ? `  ·  מחירון 1 ₪${Number(r.price1).toFixed(2)}` : ''}`);
      console.log(`  סה"כ ${r.total}${r.stale ? '   [מהייצוא המלא הישן — לא במטריצה העדכנית]' : ''}`);
      if (!w?.at.length) console.log('  אין יתרה חיובית באף מחסן בייצוא.');
      else w.at.forEach(({ warehouse, qty }) => console.log(`    ${warehouse.padEnd(20)} ${qty}`));
    }
    console.log();
  } else if (cmd === 'warehouse') {
    const top = Number(rest.at(-1)) || 0;
    const name = top ? rest.slice(0, -1).join(' ') : arg;
    const { warehouse, rows, units } = inWarehouse(name, { limit: top });
    console.log(`\n${warehouse} — ${n(rows.length)} פריטים${top ? ` (מוצגים ${top} הגדולים)` : ''}, ${n(units)} יחידות\n`);
    rows.forEach((r) => console.log(`  ${String(r.per[warehouse]).padStart(6)}   ${label(r)}`));
    console.log();
  } else if (cmd === 'warehouses') {
    const s = stock();
    console.log();
    for (const w of s.warehouses) {
      const rows = [...s.items.values()].filter((r) => (r.per[w] ?? 0) > 0);
      const units = rows.reduce((a, r) => a + r.per[w], 0);
      console.log(`  ${w.padEnd(22)} ${String(n(rows.length)).padStart(7)} פריטים   ${String(n(units)).padStart(9)} יחידות`);
    }
    console.log();
  } else {
    console.log('פקודות: info | find <טקסט> | item <מק"ט> | warehouse <שם> [כמה] | warehouses');
    process.exit(1);
  }
} catch (e) {
  console.error(`\n${e.message}\n`);
  process.exit(1);
}

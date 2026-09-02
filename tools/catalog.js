/**
 * Catalog CLI.
 *
 *   npm run catalog -- build items [file]      בונה קטלוג מקובץ ייצוא (ברירת מחדל: האחרון)
 *   npm run catalog -- find "cobra core"       חיפוש חופשי
 *   npm run catalog -- model 003930 [565]      כל הצבעים של דגם, או צבע אחד
 *   npm run catalog -- info
 */
import { build, latestDownload, latestContent } from '../src/catalog/build.js';
import { findItems, findCustomers, findModel, load } from '../src/catalog/search.js';

const [cmd, ...rest] = process.argv.slice(2);

/** One item as a line: model · colour number · colour description · price · stock. */
function line(h) {
  if (h.email !== undefined || h.city !== undefined) {
    const bits=[h.code,h.name,h.city||null,h.phone||h.mobile||null,h.email||null].filter(Boolean).join("  ·  ");
    return "  "+bits;
  }
  const bits = [
    h.code,
    h.name,
    h.modelCode ? `דגם ${h.modelCode}` : null,
    h.colorCode ? `צבע ${h.colorCode}` : null,
    h.nameEn || null,
    h.size || null,
  ].filter(Boolean).join(' · ');
  const price = h.price1 ? `  ₪${Number(h.price1).toFixed(2)}` : '';
  const stock = h.stock !== '' && h.stock != null ? `  מלאי ${h.stock}` : '  מלאי 0';
  return `  ${bits}${price}${stock}`;
}

if (cmd === 'build') {
  const catalog = rest[0] ?? 'items';
  const file = rest[1] ?? (catalog === 'customers' ? latestContent(/.txt$/i) : latestDownload());
  console.log(`בונה קטלוג "${catalog}" מתוך:\n  ${file}\n`);
  const r = build(catalog, file);
  console.log(`נשמרו ${r.count.toLocaleString()} רשומות → ${r.out}`);
  if (r.missing.length) {
    console.log(`\nאזהרה — עמודות שלא נמצאו:\n  ${r.missing.join('\n  ')}`);
    console.log(`\nהעמודות שקיימות:\n  ${r.headers.join(' | ')}`);
  }
} else if (cmd === 'model') {
  const [modelCode, color] = rest;
  const hits = findModel(modelCode, { color: color ?? null });
  console.log(`\nדגם ${modelCode}${color ? ` צבע ${color}` : ''} → ${hits.length} תוצאות`);
  if (hits.length) console.log(`  ${hits[0].model}\n`);
  hits.forEach((h) => console.log(line(h)));
} else if (cmd === 'find' || cmd === 'find-customer') {
  const q = rest.join(' ');
  const hits = (cmd === 'find' ? findItems : findCustomers)(q, { limit: 30 });
  console.log(`\n"${q}" → ${hits.length} תוצאות\n`);
  hits.forEach((h) => console.log(line(h)));
} else if (cmd === 'info') {
  for (const name of rest.length ? rest : ['items']) {
    const d = load(name);
    console.log(`${name}: ${d.count.toLocaleString()} רשומות · נבנה ${d.builtAt}`);
    if (d.missingColumns?.length) console.log(`  עמודות חסרות: ${d.missingColumns.join(', ')}`);
  }
} else {
  console.log('שימוש: catalog build <items|customers> [file] | find <query> | model <דגם> [צבע] | info');
}

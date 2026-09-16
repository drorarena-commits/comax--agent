#!/usr/bin/env node
/**
 * ריבועי הצבע באתר ארנה ישראל — סריקה כגולש: האם הקובץ של כל ריבוע באמת נטען.
 *
 * 💣 **ריבוע יכול להישבר כשרשומת המדיה קיימת והקובץ נמחק מהדיסק.** נמדד
 * 16/09/2026 על מוצר 9753 (משקפת Spider): ה-`ux_image` של ארבעה מונחי צבע
 * הצביע על מדיה מ-2023/02 שהרשומה שלה תקינה בכל בדיקה במסד — והקובץ עצמו
 * מחזיר 404. לכן "יש `ux_image`" ו"המדיה קיימת" אינם הוכחה. הבדיקה היחידה
 * שאומרת את האמת היא **טעינת הקובץ בפועל** (200 + תמונה שמתפענחת).
 *
 * המקור הוא דף המוצר האנונימי, לא המסד: ה-`ux_image` אינו נגיש ב-REST ולא
 * בקונקטור, אבל Flatsome מרנדר את כתובת הריבוע ב-`data-lazy-src` של כל
 * `ux-swatch`. זה גם בדיוק מה שהלקוח רואה.
 *
 * המלאי: ברקוד הווריאציה מול ייצוא **מחסן ראשי** (`data/exports/מלאי-ראשי-*.xls`),
 * כי האתר מוכר מראשי בלבד ו-`_stock` באתר אינו ראיה.
 *
 *   node tools/site-swatch-audit.js            סריקה, קריאה בלבד. לא כותב לאתר.
 *   node tools/site-swatch-audit.js --limit 5  על חמישה מוצרים לבדיקה
 */
import { writeFileSync, readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { config } from '../orders-app/config.js';
import { parseFlags, flagProblems } from '../src/cli-args.js';

const ROOT = resolve(import.meta.dirname, '..');
const flags = parseFlags(process.argv.slice(2), { skipFirst: false, numbers: ['limit'], valued: ['out'] });
const problems = flagProblems(flags);
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
const LIMIT = flags.input.limit ?? Infinity;

const auth = 'Basic ' + Buffer.from(`${config.site.key}:${config.site.secret}`).toString('base64');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128 arena-swatch-audit';

async function wc(path) {
  for (let a = 1; a <= 3; a++) {
    try {
      const r = await fetch(`${config.site.url}/wp-json/wc/v3/${path}`, {
        headers: { Authorization: auth, Accept: 'application/json' }, signal: AbortSignal.timeout(60_000),
      });
      if (!r.ok) throw new Error(`WC ${r.status} ${path}`);
      return await r.json();
    } catch (e) { if (a === 3) throw e; await new Promise(s => setTimeout(s, a * 2000)); }
  }
}

/** מלאי ראשי לפי ברקוד — הקובץ העדכני ביותר. מחרוזת מדויקת, בלי נרמול. */
function rashiStock() {
  const dir = resolve(ROOT, 'data/exports');
  const f = readdirSync(dir).filter(n => /^מלאי-ראשי-\d{4}-\d{2}-\d{2}\.xls$/.test(n)).sort().pop();
  if (!f) throw new Error('אין ייצוא מלאי-ראשי ב-data/exports — להריץ stock-export על מחסן 1');
  const html = new TextDecoder('windows-1255').decode(readFileSync(resolve(dir, f)));
  const clean = new Map();
  for (const tr of html.split(/<tr/i).slice(2)) {
    const c = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1].replace(/<[^>]+>/g, '').trim());
    if (c.length < 37) continue;
    const qty = Number(String(c[36]).replace(/,/g, '')) || 0;
    for (const key of new Set([c[5], c[1]].filter(Boolean))) clean.set(key, qty);
  }
  return { file: f, map: clean };
}

const decode = s => s.replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").replace(/&quot;/g, '"');

/** הריבועים של pa_color כפי שהם מרונדרים בדף. */
function parseSwatches(html) {
  // ⚠️ ה-<select> הנסתר נושא אותו data-attribute_name — מאתרים את מכל הריבועים עצמו.
  const m = html.match(/<div class="ux-swatches ([^"]*)" data-attribute_name="attribute_pa_color"/);
  if (!m) return { mode: 'none', swatches: [] };
  const mode = (m[1].match(/ux-swatches-attribute-(\S+)/) || [])[1] || '?';
  const start = m.index + m[0].length;
  const ends = [html.indexOf('<div class="ux-swatches ', start), html.indexOf('<select', start)].filter(x => x > 0);
  const chunk = html.slice(start, Math.min(...ends, start + 60000));
  const parts = chunk.split('<div class="ux-swatch ').slice(1);
  const swatches = parts.map(p => {
    const cls = p.slice(0, p.indexOf('"'));
    const slug = decode((p.match(/data-value="([^"]*)"/) || [])[1] || '');
    const name = decode((p.match(/data-name="([^"]*)"/) || [])[1] || '');
    const lazy = (p.match(/data-lazy-src="([^"]+)"/) || [])[1];
    const src = (p.match(/<img[^>]*\ssrc="(https?:[^"]+)"/) || [])[1];
    const color = (p.match(/background-color:\s*([^;"]+)/) || [])[1];
    return { slug, name, cls: cls.trim(), img: lazy || src || null, bg: color || null };
  });
  return { mode, swatches };
}

async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

async function checkImage(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30_000) });
    const buf = Buffer.from(await r.arrayBuffer());
    const res = { status: r.status, type: r.headers.get('content-type'), bytes: buf.length };
    if (r.ok) {
      try { const m = await sharp(buf).metadata(); res.w = m.width; res.h = m.height; res.format = m.format; res.valid = true; }
      catch { res.valid = false; }
    }
    return res;
  } catch (e) { return { status: 0, error: e.message }; }
}

async function main() {
  const stock = rashiStock();
  console.log(`מלאי ראשי: ${stock.file} · ${stock.map.size} מפתחות`);

  const products = [];
  for (let page = 1; ; page++) {
    const b = await wc(`products?type=variable&status=publish&per_page=100&page=${page}&orderby=id&order=asc&_fields=id,name,permalink,sku,attributes,date_created`);
    products.push(...b); if (b.length < 100) break;
  }
  const list = products.slice(0, LIMIT);
  console.log(`${products.length} מוצרי אב מפורסמים (variable)${list.length < products.length ? ` · סורק ${list.length}` : ''}`);

  let done = 0;
  const rows = await pool(list, 3, async p => {
    const colorAttr = (p.attributes || []).find(a => a.slug === 'pa_color');
    const rec = { id: p.id, name: p.name, sku: p.sku, url: p.permalink, created: p.date_created, colors: [] };
    if (!colorAttr) { rec.noColorAttr = true; done++; return rec; }
    let variations = [];
    try {
      for (let page = 1; ; page++) {
        const b = await wc(`products/${p.id}/variations?per_page=100&page=${page}&_fields=id,sku,status,stock_status,attributes,image`);
        variations.push(...b); if (b.length < 100) break;
      }
    } catch (e) { rec.error = 'variations: ' + e.message; }
    let html = '';
    try {
      const r = await fetch(p.permalink, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60_000) });
      rec.pageStatus = r.status; html = await r.text();
    } catch (e) { rec.pageStatus = 0; rec.error = 'page: ' + e.message; }
    const { mode, swatches } = parseSwatches(html);
    rec.swatchMode = mode;
    for (const opt of colorAttr.options) {
      const vs = variations.filter(v => (v.attributes || []).find(a => a.slug === 'pa_color')?.option === opt);
      const pub = vs.filter(v => v.status === 'publish');
      const rashi = pub.reduce((s, v) => s + Math.max(0, stock.map.get(v.sku) ?? 0), 0);
      const sw = swatches.find(s => s.name === opt) || null;
      rec.colors.push({
        name: opt, slug: sw?.slug ?? null, variations: vs.length, published: pub.length,
        rashi, siteInStock: pub.some(v => v.stock_status === 'instock'),
        skus: pub.map(v => v.sku), variationImage: pub.find(v => v.image?.src)?.image?.src ?? null,
        swatch: sw,
      });
    }
    rec.swatchesNotInAttr = swatches.filter(s => !colorAttr.options.includes(s.name)).map(s => s.name);
    done++; process.stdout.write(`\r  ${done}/${list.length}`);
    return rec;
  });
  process.stdout.write('\n');

  const urls = [...new Set(rows.flatMap(r => r.colors.map(c => c.swatch?.img)).filter(Boolean))];
  console.log(`בודק ${urls.length} קובצי ריבוע ייחודיים...`);
  const checked = new Map();
  await pool(urls, 4, async u => { checked.set(u, await checkImage(u)); });

  for (const r of rows) for (const c of r.colors) {
    const img = c.swatch?.img;
    const chk = img ? checked.get(img) : null;
    c.check = chk;
    c.state = !c.swatch ? 'no-swatch-element'
      : !img ? 'no-image'
      : /woocommerce-placeholder/.test(img) ? 'placeholder'
      : chk?.status === 200 && chk.valid ? 'ok'
      : 'broken';
  }

  const date = new Date().toISOString().slice(0, 10);
  const out = flags.input.out || resolve(ROOT, `content/site-reports/swatch-audit-${date}.json`);
  mkdirSync(resolve(out, '..'), { recursive: true });
  writeFileSync(out, JSON.stringify({ scannedAt: new Date().toISOString(), stockFile: stock.file, products: rows }, null, 1));
  const all = rows.flatMap(r => r.colors);
  const tally = {}; for (const c of all) tally[c.state] = (tally[c.state] || 0) + 1;
  console.log(`נשמר: ${out}\nמוצרים ${rows.length} · צבעים ${all.length} ·`, tally);
}

main().catch(e => { console.error(e); process.exit(1); });

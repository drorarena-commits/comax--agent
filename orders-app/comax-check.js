/**
 * הצלבת המק"טים שבהזמנה מול קטלוג הפריטים של קומקס.
 *
 * ⚠️ **הבאג שזה משרת:** תוסף הסנכרון מפיל **הזמנה שלמה** אם אחד הפריטים בה
 * לא קיים בקומקס — ההזמנה לא משודרת, המלאי לא יורד, ואין שגיאה שמישהו רואה.
 * לכן ההתרעה הזאת נכנסת לתוך הודעת הטלגרם עצמה, ברגע שההזמנה נכנסת, ולא
 * מחכה שמישהו יפתח מסך.
 *
 * ⛔ **בלי נרמול** — לא חיתוך סיומות, לא ריפוד באפסים, לא lowercase. התוסף
 * משווה מחרוזות, ו"כמעט זהה" הוא בדיוק מה שמפיל את ההזמנה. מה שכן נעשה:
 * למק"ט חסר מדווח גם החלק שלפני המקף אם הוא כן נמצא — כרמז לאדם, לא כהתאמה.
 *
 * המקור הוא `content/פריטים-מלא-<תאריך>.csv`, שמתרענן מהייצוא הלילי ב-03:00.
 * גיל הקובץ מוחזר עם כל בדיקה — קטלוג ישן מייצר התרעות שווא, וזה חייב להיות
 * גלוי במקום שבו מסתכלים על התוצאה.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './config.js';

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\r') { /* דילוג */ }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

let cache = null; // { path, mtimeMs, known, exportedAt }

function catalogFile() {
  const dir = resolve(ROOT, 'content');
  const files = readdirSync(dir).filter((f) => /^פריטים-מלא-.*\.csv$/.test(f)).sort();
  if (!files.length) return null;
  return resolve(dir, files[files.length - 1]);
}

function loadCatalog() {
  const path = catalogFile();
  if (!path) return null;
  const { mtimeMs } = statSync(path);
  if (cache && cache.path === path && cache.mtimeMs === mtimeMs) return cache;

  const rows = parseCsv(readFileSync(path, 'utf8'));
  const head = rows[0] || [];
  const ix = (n) => head.indexOf(n);
  const col = {
    sku: ix('פריט'), bar: ix('ברקוד'), alt: ix('קוד חלופי'),
    name: ix('שם פריט'), model: ix('שם דגם'), color: ix('שם צבע'), size: ix('שם מידה'),
  };

  // מפתח אחד לכל צורת זיהוי — פריט, ברקוד וקוד חלופי — כי לא כל פריט בקומקס
  // נושא ברקוד בשדה הברקוד, ובאתר הוזנו לפעמים דווקא האחרים.
  const known = new Map();
  for (const r of rows.slice(1)) {
    if (!r[col.sku]) continue;
    for (const k of [r[col.sku], r[col.bar], r[col.alt]]) {
      const v = (k || '').trim();
      if (v && !known.has(v)) known.set(v, r);
    }
  }

  cache = { path, mtimeMs, known, col, exportedAt: new Date(mtimeMs) };
  return cache;
}

/**
 * בודק את שורות ההזמנה. מחזיר `{ checked, missing, catalog }`.
 * `checked: false` פירושו שאין קטלוג מקומי — וזה **לא** "הכל תקין".
 */
export function checkOrderItems(order) {
  const cat = loadCatalog();
  const lines = order?.line_items || [];
  if (!cat) {
    return { checked: false, missing: [], catalog: null, reason: 'אין קובץ קטלוג ב-content/' };
  }

  const missing = [];
  // מה שנמצא — מוחזר גם הוא, לפי מזהה השורה. זה מה שמאפשר למלקט לאמת
  // ליד התמונה שהדגם, הצבע והמידה בקומקס הם אלה שהוא מחזיק ביד, במקום
  // להשוות מק"ט בן 13 ספרות בעיניים.
  const matched = {};

  for (const li of lines) {
    const sku = (li.sku || '').trim();
    if (!sku) {
      missing.push({ sku: '', name: li.name, note: 'לשורה באתר אין מק"ט כלל' });
      continue;
    }

    const row = cat.known.get(sku);
    if (row) {
      const val = (i) => (i >= 0 ? (row[i] || '').trim() : '');
      matched[li.id] = {
        barcode: val(cat.col.bar) || val(cat.col.sku),
        name: val(cat.col.name),
        model: val(cat.col.model),
        color: val(cat.col.color),
        size: val(cat.col.size),
      };
      continue;
    }

    // רמז בלבד: אולי המק"ט באתר הוא ברקוד עם סיומת מידה.
    const base = sku.includes('-') ? sku.slice(0, sku.indexOf('-')) : '';
    const hint = base && cat.known.has(base) ? base : null;
    missing.push({ sku, name: li.name, hint });
  }

  const ageDays = Math.floor((Date.now() - cat.exportedAt.getTime()) / 86_400_000);
  return {
    checked: true,
    missing,
    matched,
    catalog: { path: cat.path, exportedAt: cat.exportedAt.toISOString(), ageDays },
  };
}

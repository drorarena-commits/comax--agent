/**
 * ההגדרות של אפליקציית ההזמנות — הכל מ-.env, בלי ערכי ברירת מחדל סודיים.
 *
 * הקובץ הזה נשען על אותו `loadEnv` של סוכן קומקס, כדי שיהיה **קובץ סודות
 * אחד** לפרויקט. `.env` אינו נשמר בגיט, ולכן כל מחשב מגדיר אותו בנפרד —
 * בדיוק כמו פרטי ההתחברות לקומקס.
 *
 * ⚠️ הממשק נגיש דרך מנהרה ציבורית, ולכן `ORDERS_TOKEN` אינו אופציונלי.
 * בלעדיו השרת מסרב לעלות — כתובת מנהרה שדולפת בלי שער היא חשיפה של
 * שמות, טלפונים וכתובות של לקוחות.
 */
import { loadEnv } from '../src/env.js';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
export const ROOT = resolve(APP_ROOT, '..');

const e = loadEnv();
const pick = (k, fallback) => e[k] ?? process.env[k] ?? fallback;

export const config = {
  site: {
    url: (pick('WOO_URL', 'https://arenaisrael.co.il') || '').replace(/\/+$/, ''),
    key: pick('WOO_KEY'),
    secret: pick('WOO_SECRET'),
  },
  telegram: {
    token: pick('TELEGRAM_TOKEN'),
    chatId: pick('TELEGRAM_CHAT_ID'),
  },
  server: {
    port: Number(pick('ORDERS_PORT', '4180')),
    token: pick('ORDERS_TOKEN'),
    /** כתובת המנהרה. משמשת לקישור "פתיחת ההזמנה" שבתוך הודעת הטלגרם. */
    publicUrl: (pick('ORDERS_PUBLIC_URL', '') || '').replace(/\/+$/, ''),
  },
  /** כל כמה שניות לשאול את האתר אם נכנסה הזמנה. 60 הוא איזון בין מיידיות לעומס. */
  pollSeconds: Number(pick('ORDERS_POLL_SECONDS', '60')),
  /** קובץ המצב — אילו הזמנות כבר דווחו בטלגרם. ב-runs/ שאינו נשמר בגיט. */
  statePath: resolve(ROOT, 'runs', 'orders-state.json'),
};

/**
 * מה חסר כדי שהאפליקציה תוכל לרוץ. מחזיר רשימת הודעות בעברית, ריקה אם הכל תקין.
 * מופרד מ-`config` כדי ש-`--check` יוכל לדווח בלי להפיל את התהליך.
 */
export function missingConfig({ needTelegram = true } = {}) {
  const gaps = [];
  if (!config.site.key || !config.site.secret) {
    gaps.push('WOO_KEY / WOO_SECRET — מפתחות ה-API של WooCommerce חסרים ב-.env');
  }
  if (!config.server.token) {
    gaps.push('ORDERS_TOKEN — סיסמת הכניסה לממשק חסרה ב-.env (כל מחרוזת ארוכה)');
  }
  if (needTelegram && (!config.telegram.token || !config.telegram.chatId)) {
    gaps.push('TELEGRAM_TOKEN / TELEGRAM_CHAT_ID — פרטי בוט הטלגרם חסרים ב-.env');
  }
  return gaps;
}

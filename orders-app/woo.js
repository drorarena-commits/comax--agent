/**
 * לקוח WooCommerce REST — קריאה של הזמנות ועדכון סטטוס.
 *
 * האימות הוא Basic מעל HTTPS, כפי ש-WooCommerce מגדיר למפתחות v3. זה תקף
 * **רק** כשהחיבור מוצפן; לכן כתובת `http://` נדחית כאן ולא במקום אחר —
 * מפתח ה-API עובר בכותרת, ומעל חיבור פתוח הוא נחשף לכל מי שבדרך.
 */
import { config } from './config.js';

const auth = () =>
  'Basic ' + Buffer.from(`${config.site.key}:${config.site.secret}`).toString('base64');

async function call(path, { method = 'GET', body, query } = {}) {
  // http מותר רק מול localhost — שם הוא לא יוצא מהמחשב. כל כתובת אחרת
  // חייבת להיות מוצפנת, אחרת מפתח ה-API עובר גלוי בכותרת.
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(config.site.url);
  if (!config.site.url.startsWith('https://') && !local) {
    throw new Error(`כתובת האתר חייבת להיות https — התקבל: ${config.site.url}`);
  }
  const url = new URL(`${config.site.url}/wp-json/wc/v3/${path}`);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: auth(),
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });

  const text = await res.text();
  if (!res.ok) {
    // גוף השגיאה של WooCommerce מסביר בדיוק מה נדחה — שווה יותר מקוד הסטטוס לבדו.
    let detail = text.slice(0, 400);
    try { detail = JSON.parse(text).message || detail; } catch { /* גוף שאינו JSON */ }
    throw new Error(`WooCommerce ${res.status} על ${path}: ${detail}`);
  }
  return { data: text ? JSON.parse(text) : null, headers: res.headers };
}

/**
 * הזמנות לפי סינון.
 *
 * ⚠️ `dates_are_gmt` אינו קישוט. בלעדיו WooCommerce מפרש את `after` לפי אזור
 * הזמן של האתר (Asia/Jerusalem) בעוד שאנחנו שולחים UTC, והפער של שלוש שעות
 * גורם לכל סבב למשוך שלוש שעות אחורה. נמדד 14/09/2026: ההרצה הראשונה דיווחה
 * על שתי הזמנות ישנות אף שנקודת ההתחלה הייתה רגע ההפעלה. הכפילות עצמה נמנעה
 * על ידי `reportedIds`, ולכן התקלה נראתה כמו התנהגות תקינה.
 */
export async function listOrders({ status, after, perPage = 25, page = 1, search } = {}) {
  const { data, headers } = await call('orders', {
    query: {
      status: status && status !== 'all' ? status : undefined,
      after,
      dates_are_gmt: after ? true : undefined,
      search,
      per_page: perPage,
      page,
      orderby: 'date',
      order: 'desc',
    },
  });
  return {
    orders: data || [],
    totalPages: Number(headers.get('x-wp-totalpages') || 1),
    total: Number(headers.get('x-wp-total') || (data || []).length),
  };
}

export async function getOrder(id) {
  const { data } = await call(`orders/${id}`);
  return data;
}

export async function setOrderStatus(id, status) {
  const { data } = await call(`orders/${id}`, { method: 'PUT', body: { status } });
  return data;
}

/** בדיקת חיבור — מחזיר את מספר ההזמנות הכולל, או זורק שגיאה מוסברת. */
export async function ping() {
  const { total } = await listOrders({ perPage: 1 });
  return total;
}

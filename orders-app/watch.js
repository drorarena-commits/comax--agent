/**
 * הלולאה שמזהה הזמנה חדשה ושולחת אותה לטלגרם.
 *
 * **למה סקירה (polling) ולא webhook:** webhook דורש שהאתר יצליח להגיע אל
 * המחשב הזה ברגע ההזמנה. עם מנהרה זה אפשרי, אבל מנהרה שנופלת לחצי דקה
 * מבליעה הזמנה **לתמיד** ואין ממה להתאושש. סקירה כל דקה מתאוששת מעצמה:
 * הסבב הבא מושך את מה שהוחמץ. ההפרש במיידיות הוא עד דקה; ההפרש באמינות
 * הוא בין "הוחמץ" ל"הגיע באיחור".
 *
 * ⚠️ כישלון סבב אינו מקדם את המצב ואינו מפיל את התהליך — הוא נרשם, והסבב
 * הבא ינסה שוב מאותה נקודה. אתר שנופל לרבע שעה לא אמור לעלות בהזמנה.
 */
import { listOrders } from './woo.js';
import { sendMessage } from './telegram.js';
import { telegramMessage, currencySymbol } from './format.js';
import { checkOrderItems } from './comax-check.js';
import { since, wasReported, markReported, loadState } from './store.js';
import { config } from './config.js';

/** סטטוסים שלא שווה להתריע עליהם: עגלה נטושה וזבל. */
const IGNORED = new Set(['checkout-draft', 'trash']);

const log = (msg) => console.log(`[${new Date().toLocaleTimeString('he-IL')}] ${msg}`);

/** כתובת ההזמנה בממשק שלנו — ממנה אפשר לשנות סטטוס. */
function appUrlFor(order) {
  const base = (config.server.publicUrl || '').replace(/\/+$/, '');
  if (!base) return null;
  return `${base}/?order=${order.id}`;
}

export async function pollOnce({ quiet = false } = {}) {
  const after = since();
  const { orders } = await listOrders({ after, perPage: 50 });

  // מהישן לחדש, כדי שההתראות יגיעו בסדר שבו ההזמנות נכנסו.
  const fresh = orders
    .filter((o) => !IGNORED.has(o.status) && !wasReported(o.id))
    .sort((a, b) => (a.date_created_gmt > b.date_created_gmt ? 1 : -1));

  for (const order of fresh) {
    const comax = checkOrderItems(order);
    const text = telegramMessage(order, { comax, appUrl: appUrlFor(order) });
    if (!quiet) await sendMessage(text);
    markReported(order.id, order.date_created_gmt);
    const cur = currencySymbol(order);
    const flag = comax.checked && comax.missing.length ? ` ⚠️ ${comax.missing.length} פריטים חסרים בקומקס` : '';
    log(`הזמנה #${order.number} — ${order.total} ${cur}${flag}`);
  }

  return fresh.length;
}

export async function watch() {
  const state = loadState();
  log(`ניטור הזמנות התחיל · סקירה כל ${config.pollSeconds} שניות · ${config.site.url}`);
  if (!state.reportedIds.length) {
    log('הרצה ראשונה — הזמנות שנכנסו לפני הרגע הזה לא ידווחו למפרע.');
  }

  for (;;) {
    try {
      await pollOnce();
    } catch (err) {
      // נרשם ולא מפיל: הסבב הבא ינסה שוב מאותה נקודה.
      log(`סבב נכשל — ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, config.pollSeconds * 1000));
  }
}

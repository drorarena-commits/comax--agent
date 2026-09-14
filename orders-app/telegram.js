/**
 * שליחת הודעות דרך בוט טלגרם.
 *
 * הבחירה בטלגרם: התראה מיידית לאייפון, בלי App Store, בלי עלות, ובלי אישור
 * מטא — ובעיקר, ההודעה נושאת את **כל** סיכום ההזמנה בתוכה, כך שהמסך הנעול
 * כבר מספיק כדי להבין מה נכנס.
 */
import { config } from './config.js';

const api = (method) => `https://api.telegram.org/bot${config.telegram.token}/${method}`;

/**
 * הנמענים. `TELEGRAM_CHAT_ID` יכול להחזיק **כמה מזהים מופרדים בפסיק** —
 * כך מצטרף עובד נוסף בלי לגעת בקוד, וכל אחד מקבל בפרטי במקום בקבוצה
 * משותפת. מזהה של קבוצה עובד כאן בדיוק כמו מזהה של אדם.
 */
const recipients = () =>
  String(config.telegram.chatId || '').split(',').map((s) => s.trim()).filter(Boolean);

async function sendToOne(chatId, text, silent) {
  const res = await fetch(api('sendMessage'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      disable_notification: silent,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok) {
    throw new Error(`טלגרם דחה את ההודעה ל-${chatId}: ${body.description || res.status}`);
  }
  return body.result;
}

export async function sendMessage(text, { chatId, silent = false } = {}) {
  if (!config.telegram.token || !config.telegram.chatId) {
    throw new Error('בוט הטלגרם לא מוגדר — חסרים TELEGRAM_TOKEN / TELEGRAM_CHAT_ID ב-.env');
  }
  const targets = chatId ? [chatId] : recipients();

  // ⚠️ נמען אחד שנכשל אינו מבטל את השאר — עובד שחסם את הבוט היה מונע את
  // ההתראה מכולם. הכישלון נרשם, וההודעה ממשיכה הלאה.
  const results = [];
  const failures = [];
  for (const t of targets) {
    try {
      results.push(await sendToOne(t, text, silent));
    } catch (err) {
      failures.push(err.message);
    }
  }
  if (!results.length) throw new Error(failures.join(' · ') || 'אין נמעני טלגרם מוגדרים');
  if (failures.length) console.error(`[טלגרם] ${failures.join(' · ')}`);
  return results[0];
}

/**
 * מאתר את מזהה השיחה מתוך ההודעות האחרונות שנשלחו לבוט. משמש פעם אחת
 * בהתקנה: דרור לוחץ Start בטלגרם, ואנחנו קוראים מכאן את המזהה שלו.
 */
export async function findChatId() {
  if (!config.telegram.token) throw new Error('חסר TELEGRAM_TOKEN ב-.env');
  const res = await fetch(api('getUpdates'), { signal: AbortSignal.timeout(20_000) });
  const body = await res.json().catch(() => ({}));
  if (!body.ok) throw new Error(`טלגרם: ${body.description || res.status}`);

  const chats = new Map();
  for (const u of body.result || []) {
    const chat = u.message?.chat || u.channel_post?.chat;
    if (chat) chats.set(chat.id, chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' '));
  }
  return [...chats].map(([id, name]) => ({ id, name }));
}

/**
 * שליחת הודעות דרך בוט טלגרם.
 *
 * הבחירה בטלגרם: התראה מיידית לאייפון, בלי App Store, בלי עלות, ובלי אישור
 * מטא — ובעיקר, ההודעה נושאת את **כל** סיכום ההזמנה בתוכה, כך שהמסך הנעול
 * כבר מספיק כדי להבין מה נכנס.
 */
import { config } from './config.js';

const api = (method) => `https://api.telegram.org/bot${config.telegram.token}/${method}`;

export async function sendMessage(text, { chatId, silent = false } = {}) {
  if (!config.telegram.token || !config.telegram.chatId) {
    throw new Error('בוט הטלגרם לא מוגדר — חסרים TELEGRAM_TOKEN / TELEGRAM_CHAT_ID ב-.env');
  }
  const res = await fetch(api('sendMessage'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId || config.telegram.chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      disable_notification: silent,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok) {
    throw new Error(`טלגרם דחה את ההודעה: ${body.description || res.status}`);
  }
  return body.result;
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

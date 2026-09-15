/**
 * התראת טלגרם על תוצאת משימה.
 *
 * משתמש בבוט שכבר קיים לאפליקציית ההזמנות (`orders-app/telegram.js`) ולא
 * בונה שני — טוקן אחד, נמענים אחד, ותקלת שליחה אחת להבין.
 *
 * ⚠️ התראה שנכשלה אינה מכשילה את המשימה. התוצאה כבר יושבת ב-`queue/done/`
 * וניתנת לקריאה; לאבד אותה כי טלגרם היה למטה יהיה הרע מבין השניים.
 */
import { sendMessage } from '../../orders-app/telegram.js';

/** טלגרם ב-HTML: שלושה תווים חייבים בריחה, אחרת ההודעה כולה נדחית. */
const esc = (s) =>
  String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

const ICON = {
  ok: '✅',
  failed: '⛔',
  busy: '⏳',
  rejected: '🚫',
  'awaiting-approval': '✋',
};

export function formatResult(done) {
  const icon = ICON[done.status] ?? '•';
  const lines = [
    `${icon} <b>${esc(done.request)}</b>`,
    '',
    esc(done.summary || done.error || done.status),
  ];
  if (done.status === 'failed' && done.runDir) lines.push('', `לוג: ${esc(done.runDir)}`);
  lines.push('', `<code>${esc(done.id)}</code>`);
  return lines.join('\n');
}

export async function notifyResult(done) {
  try {
    await sendMessage(formatResult(done));
    return { sent: true };
  } catch (e) {
    return { sent: false, error: e.message };
  }
}

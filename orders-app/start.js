/**
 * נקודת הכניסה של אפליקציית ההזמנות.
 *
 *   npm run orders            — הכל יחד: ניטור + ממשק (זה מה שרץ ביום-יום)
 *   npm run orders -- check   — בדיקת חיבור: WooCommerce, טלגרם, קטלוג קומקס
 *   npm run orders -- chat-id — מציאת מזהה השיחה בטלגרם, פעם אחת בהתקנה
 *   npm run orders -- test    — שולח לטלגרם את ההזמנה האחרונה, כדי לראות איך זה נראה
 *   npm run orders -- boot    — אחרי אתחול: מנהרה + הכל + הכתובת החדשה לטלגרם
 *   npm run orders -- serve   — ממשק בלבד, בלי התראות
 *   npm run orders -- watch   — התראות בלבד, בלי ממשק
 */
import { config, missingConfig } from './config.js';
import { startServer } from './server.js';
import { watch, pollOnce } from './watch.js';
import { ping, listOrders } from './woo.js';
import { sendMessage, findChatId } from './telegram.js';
import { telegramMessage } from './format.js';
import { checkOrderItems } from './comax-check.js';

const cmd = process.argv[2] || 'all';

function requireConfig({ needTelegram = true } = {}) {
  const gaps = missingConfig({ needTelegram });
  if (gaps.length) {
    console.error('\nחסרות הגדרות ב-.env:\n');
    for (const g of gaps) console.error(`  • ${g}`);
    console.error('\nראה orders-app/README.md — יש שם בדיוק מאיפה לקחת כל אחת.\n');
    process.exit(1);
  }
}

async function check() {
  const gaps = missingConfig();
  console.log(`אתר: ${config.site.url}`);

  if (gaps.length) {
    console.log('\nחסר:');
    for (const g of gaps) console.log(`  • ${g}`);
  }

  if (config.site.key && config.site.secret) {
    try {
      console.log(`WooCommerce: מחובר · ${await ping()} הזמנות בסך הכל`);
    } catch (err) {
      console.log(`WooCommerce: ✗ ${err.message}`);
    }
  }

  if (config.telegram.token && config.telegram.chatId) {
    try {
      await sendMessage('✅ בדיקת חיבור — אפליקציית ההזמנות מחוברת לטלגרם.', { silent: true });
      console.log('טלגרם: נשלחה הודעת בדיקה');
    } catch (err) {
      console.log(`טלגרם: ✗ ${err.message}`);
    }
  }

  // הקטלוג נבדק על הזמנה ריקה — מספיק כדי לדעת אם הקובץ נמצא ומה גילו.
  const cat = checkOrderItems({ line_items: [] });
  if (cat.checked) {
    console.log(`קטלוג קומקס: ${cat.catalog.path} · בן ${cat.catalog.ageDays} ימים`);
    if (cat.catalog.ageDays > 2) {
      console.log('  ⚠️ קטלוג ישן מייצר התרעות שווא. הרץ: npm run catalog-sync');
    }
  } else {
    console.log(`קטלוג קומקס: ✗ ${cat.reason}`);
  }

  if (!config.server.publicUrl) {
    console.log('ORDERS_PUBLIC_URL לא הוגדר — להודעות הטלגרם לא יצורף קישור לאפליקציה.');
  }
}

async function chatId() {
  const chats = await findChatId();
  if (!chats.length) {
    console.log('לא נמצאה שיחה. פתח את הבוט בטלגרם, לחץ Start, ואז הרץ שוב.');
    return;
  }
  console.log('שיחות שנמצאו — הוסף ל-.env את השורה המתאימה:\n');
  for (const c of chats) console.log(`  TELEGRAM_CHAT_ID=${c.id}    (${c.name})`);
}

async function test() {
  requireConfig();
  const { orders } = await listOrders({ perPage: 1 });
  if (!orders.length) return console.log('אין הזמנות באתר להדגמה.');
  const order = orders[0];
  const comax = checkOrderItems(order);
  await sendMessage(telegramMessage(order, {
    comax,
    appUrl: config.server.publicUrl ? `${config.server.publicUrl}/?order=${order.id}` : null,
  }));
  console.log(`נשלחה לטלגרם הדוגמה של הזמנה #${order.number}.`);
}

switch (cmd) {
  case 'check': await check(); break;
  case 'chat-id': await chatId(); break;
  case 'test': await test(); break;
  case 'poll': requireConfig(); console.log(`נשלחו ${await pollOnce()} התראות.`); break;
  case 'serve': requireConfig({ needTelegram: false }); startServer(); break;
  // מנהרה + שרת + הודעת טלגרם עם הכתובת החדשה. זה מה שרץ אחרי אתחול המחשב.
  case 'boot': requireConfig(); await import('./boot.js'); break;
  case 'watch': requireConfig(); await watch(); break;
  case 'all':
    requireConfig();
    startServer();
    await watch();
    break;
  default:
    console.error(`פקודה לא מוכרת: ${cmd}. ראה orders-app/README.md`);
    process.exit(1);
}

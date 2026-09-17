/**
 * בדיקה עצמית מקצה לקצה, בלי לגעת באתר האמיתי ובלי לשלוח טלגרם.
 *
 *   node orders-app/selftest.js
 *
 * מרימה **WooCommerce מדומה** על localhost, מפנה אליו את האפליקציה, ובודקת
 * את מה שבאמת יכול להישבר: שער הטוקן, רשימת ההזמנות, פרטי הזמנה, שינוי
 * סטטוס שבאמת נכתב חזרה, וזיהוי פריט שלא קיים בקומקס.
 *
 * הבדיקה רצה בתת-תהליך עם `.env` משלה, כי `config` נקרא פעם אחת בטעינת
 * המודול — אי אפשר להחליף הגדרות באמצע אותו תהליך.
 */
import { createServer } from 'node:http';

const TOKEN = 'selftest-token-0123456789';
const GUEST = 'selftest-guest-0123456789';

/** הזמנת דמה. המק"ט הראשון יילקח מהקטלוג האמיתי, השני מזויף בכוונה. */
function fakeOrder(id, number, status, realSku) {
  return {
    id, number: String(number), status,
    date_created_gmt: new Date(Date.now() - 3600_000).toISOString().replace(/\.\d+Z$/, ''),
    currency: 'ILS', total: '447', shipping_total: '35', discount_total: '0', total_tax: '0',
    payment_method_title: 'כרטיס אשראי',
    customer_note: 'נא להתקשר לפני המשלוח',
    billing: { first_name: 'רונית', last_name: 'לוי', phone: '052-5551234', email: 'ronit@example.com' },
    shipping: { address_1: 'הרצל 14', city: 'רמת גן' },
    shipping_lines: [{ method_title: 'משלוח עד הבית' }],
    line_items: [
      {
        id: 1, name: 'משקפת שחייה', quantity: 1, total: '212', sku: realSku,
        meta_data: [{ key: 'pa_color', display_key: 'צבע', display_value: 'כחול' }],
      },
      {
        id: 2, name: 'בגד ים אימון', quantity: 2, total: '200', sku: 'SKU-לא-קיים-999',
        meta_data: [{ key: 'pa_size', display_key: 'מידה', display_value: '38' }],
      },
    ],
  };
}

async function main() {
  // מק"ט אמיתי מהקטלוג, כדי שההצלבה תוכיח גם התאמה וגם חוסר.
  const { checkOrderItems } = await import('./comax-check.js');
  const probe = checkOrderItems({ line_items: [] });
  if (!probe.checked) throw new Error('אין קטלוג קומקס ב-content/ — הבדיקה לא יכולה לרוץ');

  const { readFileSync } = await import('node:fs');
  const rows = readFileSync(probe.catalog.path, 'utf8').replace(/^﻿/, '').split('\n');
  // העמודה הראשונה בקטלוג היא "קוד פנימי" ולא המק"ט — לוקחים לפי שם העמודה.
  const skuCol = rows[0].split(',').indexOf('פריט');
  if (skuCol < 0) throw new Error('לא נמצאה עמודת "פריט" בקטלוג');
  let realSku = '';
  for (const line of rows.slice(1, 400)) {
    if (line.includes('"')) continue;               // שורה עם פסיק מצוטט — לא לפרסר כאן
    const v = (line.split(',')[skuCol] || '').trim();
    if (v.length >= 4) { realSku = v; break; }      // מק"ט אמיתי, לא "1" של פריט כללי
  }
  if (!realSku) throw new Error('לא הצלחתי לקרוא מק"ט לדוגמה מהקטלוג');

  // --- WooCommerce מדומה ---
  const orders = [
    fakeOrder(101, 1001, 'processing', realSku),
    fakeOrder(102, 1002, 'completed', realSku),
  ];
  let sawAuth = false;

  const woo = createServer((req, res) => {
    if ((req.headers.authorization || '').startsWith('Basic ')) sawAuth = true;
    const url = new URL(req.url, 'http://localhost');
    const send = (body, headers = {}) => {
      res.writeHead(200, { 'Content-Type': 'application/json', ...headers });
      res.end(JSON.stringify(body));
    };

    const noteMatch = url.pathname.match(/\/orders\/(\d+)\/notes$/);
    if (noteMatch) {
      const order = orders.find((o) => o.id === Number(noteMatch[1]));
      order.notes ||= [];
      if (req.method === 'POST') {
        let raw = '';
        req.on('data', (c) => { raw += c; });
        return req.on('end', () => {
          const b = JSON.parse(raw);
          const n = { id: order.notes.length + 1, note: b.note, customer_note: b.customer_note, author: 'dror', date_created_gmt: '2026-09-17T10:00:00' };
          order.notes.unshift(n);
          send(n);
        });
      }
      return send(order.notes);
    }

    const one = url.pathname.match(/\/orders\/(\d+)$/);
    if (one) {
      const order = orders.find((o) => o.id === Number(one[1]));
      if (req.method === 'PUT') {
        let raw = '';
        req.on('data', (c) => { raw += c; });
        return req.on('end', () => {
          order.status = JSON.parse(raw).status;   // הכתיבה נשמרת — כך נוכיח שהיא באמת קרתה
          send(order);
        });
      }
      return send(order);
    }

    const status = url.searchParams.get('status');
    const list = status && status !== 'any' ? orders.filter((o) => o.status === status) : orders;
    return send(list, { 'x-wp-total': String(list.length), 'x-wp-totalpages': '1' });
  });

  await new Promise((r) => woo.listen(0, '127.0.0.1', r));
  const wooPort = woo.address().port;

  // --- האפליקציה, עם הגדרות הבדיקה ---
  process.env.WOO_URL = `http://127.0.0.1:${wooPort}`;
  process.env.WOO_KEY = 'ck_test';
  process.env.WOO_SECRET = 'cs_test';
  process.env.ORDERS_TOKEN = TOKEN;
  process.env.ORDERS_PORT = '0';

  const { config } = await import('./config.js');
  // config נקרא מ-.env לפני process.env; בבדיקה כופים את ערכי הדמה.
  config.site.url = process.env.WOO_URL;
  config.site.key = 'ck_test';
  config.site.secret = 'cs_test';
  config.server.token = TOKEN;
  config.server.guestToken = GUEST;
  config.server.port = 0;

  const { startServer } = await import('./server.js');
  const app = startServer();
  await new Promise((r) => app.once('listening', r));
  const base = `http://127.0.0.1:${app.address().port}`;

  const results = [];
  const check = (name, ok, detail = '') => {
    results.push({ name, ok, detail });
    console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  };

  const withToken = { headers: { Authorization: `Bearer ${TOKEN}` } };

  // 1. שער הטוקן
  const noAuth = await fetch(`${base}/api/orders`);
  check('בקשה בלי טוקן נדחית', noAuth.status === 401, `התקבל ${noAuth.status}`);

  const badAuth = await fetch(`${base}/api/orders`, { headers: { Authorization: 'Bearer wrong-token-x' } });
  check('טוקן שגוי נדחה', badAuth.status === 401, `התקבל ${badAuth.status}`);

  // 2. הממשק מוגש
  const page = await fetch(`${base}/`, withToken);
  const html = await page.text();
  check('דף הממשק מוגש', page.ok && html.includes('הזמנות'), `${page.status}`);

  const manifest = await fetch(`${base}/manifest.webmanifest`, withToken);
  check('manifest של ה-PWA מוגש', manifest.ok);

  // 3. מניעת יציאה מהתיקייה
  const escape = await fetch(`${base}/../config.js`, withToken);
  check('נתיב שמנסה לצאת מ-public נחסם', escape.status === 404 || escape.status === 403, `${escape.status}`);

  // 4. רשימת הזמנות
  const list = await (await fetch(`${base}/api/orders?status=any`, withToken)).json();
  check('רשימת הזמנות חוזרת', list.orders?.length === 2, `${list.orders?.length} הזמנות`);
  check('שם הלקוח ברשימה', list.orders?.[0]?.customer === 'רונית לוי', list.orders?.[0]?.customer);
  check('ספירת פריטים ברשימה', list.orders?.[0]?.itemCount === 3, String(list.orders?.[0]?.itemCount));
  check('מפתח ה-API נשלח לאתר', sawAuth);

  // 5. סינון לפי סטטוס
  const open = await (await fetch(`${base}/api/orders?status=processing`, withToken)).json();
  check('סינון לפי סטטוס', open.orders?.length === 1 && open.orders[0].status === 'processing');

  // 6. פרטי הזמנה + הצלבת קומקס
  const detail = await (await fetch(`${base}/api/orders/101`, withToken)).json();
  check('פרטי הזמנה נטענים', detail.order?.number === '1001');
  check('הצלבת קומקס רצה', detail.comax?.checked === true);
  const missing = detail.comax?.missing || [];
  check('פריט שלא קיים בקומקס זוהה', missing.length === 1 && missing[0].sku === 'SKU-לא-קיים-999',
    `${missing.length} חסרים`);
  check('פריט שקיים בקומקס לא סומן', !missing.some((m) => m.sku === realSku), `נבדק מול ${realSku}`);

  // פרטי הפריט מקומקס — מה שמאפשר למלקט לאמת דגם/צבע/מידה ליד התמונה.
  const matched = detail.comax?.matched || {};
  check('פרטי הפריט מקומקס הוחזרו לשורה שנמצאה', !!matched[1], Object.keys(matched).join(','));
  check('ולשורה שלא נמצאה אין פרטים', !matched[2]);
  check('הברקוד מקומקס מולא', !!matched[1]?.barcode, matched[1]?.barcode);
  check('קוד דגם-צבע-מידה נבנה', !!matched[1]?.code, matched[1]?.code);

  // 7. שינוי סטטוס — ומוודאים שהוא באמת נכתב, לא רק שהתשובה הייתה 200
  const put = await fetch(`${base}/api/orders/101/status`, {
    ...withToken, method: 'POST',
    headers: { ...withToken.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'completed' }),
  });
  check('בקשת שינוי סטטוס התקבלה', put.ok, `${put.status}`);
  check('הסטטוס באמת השתנה באתר', orders.find((o) => o.id === 101).status === 'completed',
    orders.find((o) => o.id === 101).status);

  const bad = await fetch(`${base}/api/orders/101/status`, {
    ...withToken, method: 'POST',
    headers: { ...withToken.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'משהו-לא-חוקי' }),
  });
  check('סטטוס לא חוקי נדחה', bad.status === 400, `${bad.status}`);

  // 8. הודעת הטלגרם — נבנית ומכילה את מה שצריך
  const { telegramMessage } = await import('./format.js');
  const msg = telegramMessage(detail.order, { comax: detail.comax, appUrl: 'https://example.test/?order=101' });
  check('ההודעה כוללת את שם הלקוח', msg.includes('רונית לוי'));
  check('ההודעה כוללת סכום', msg.includes('447'));
  check('ההודעה כוללת שיטת משלוח', msg.includes('משלוח עד הבית'));
  check('ההודעה כוללת אמצעי תשלום', msg.includes('כרטיס אשראי'));
  check('ההודעה מתריעה על הפריט החסר', msg.includes('SKU-לא-קיים-999'));
  check('ההודעה כוללת קישור לאפליקציה', msg.includes('example.test'));

  // 9. טוקן אורח — רואה הכל, אינו משנה סטטוס.
  // ⚠️ שינוי סטטוס שולח מייל אוטומטי ללקוח, ולכן זו הגנה על פעולה בלתי הפיכה
  // כלפי אדם אמיתי — לא על נוחות ממשק.
  const guest = { headers: { Authorization: `Bearer ${GUEST}` } };

  const meFull = await (await fetch(`${base}/api/me`, withToken)).json();
  check('בעל ההרשאה המלאה מזוהה כ-full', meFull.role === 'full', meFull.role);

  const meGuest = await (await fetch(`${base}/api/me`, guest)).json();
  check('האורח מזוהה כ-guest', meGuest.role === 'guest', meGuest.role);

  const guestList = await fetch(`${base}/api/orders?status=any`, guest);
  check('האורח רואה את רשימת ההזמנות', guestList.ok, `${guestList.status}`);

  const guestDetail = await fetch(`${base}/api/orders/102`, guest);
  check('האורח רואה פרטי הזמנה', guestDetail.ok, `${guestDetail.status}`);

  const before = orders.find((o) => o.id === 102).status;
  const guestWrite = await fetch(`${base}/api/orders/102/status`, {
    ...guest, method: 'POST',
    headers: { ...guest.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'cancelled' }),
  });
  check('האורח נדחה בשינוי סטטוס', guestWrite.status === 403, `${guestWrite.status}`);
  check('והסטטוס באמת לא השתנה', orders.find((o) => o.id === 102).status === before,
    orders.find((o) => o.id === 102).status);

  // 9ב. הערות פרטיות — נכתבות באמת, לעולם לא ללקוח, ואורח אינו כותב
  const post = (h, body) => ({ ...h, method: 'POST', headers: { ...h.headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const addNote = await fetch(`${base}/api/orders/101/notes`, post(withToken, { note: 'לארוז במתנה', customer_note: true }));
  check('הוספת הערה התקבלה', addNote.ok, `${addNote.status}`);
  const stored = orders.find((o) => o.id === 101).notes?.[0];
  check('ההערה באמת נכתבה באתר', stored?.note === 'לארוז במתנה', stored?.note);
  check('ההערה פרטית גם כשביקשו ללקוח', stored?.customer_note === false, String(stored?.customer_note));
  const readNotes = await (await fetch(`${base}/api/orders/101/notes`, withToken)).json();
  check('ההערות נקראות חזרה', readNotes.notes?.[0]?.text === 'לארוז במתנה');
  const emptyNote = await fetch(`${base}/api/orders/101/notes`, post(withToken, { note: '  ' }));
  check('הערה ריקה נדחית', emptyNote.status === 400, `${emptyNote.status}`);
  const guestNote = await fetch(`${base}/api/orders/101/notes`, post(guest, { note: 'x' }));
  check('האורח נדחה בהוספת הערה', guestNote.status === 403, `${guestNote.status}`);
  check('והערת האורח לא נכתבה', orders.find((o) => o.id === 101).notes.length === 1);
  check('האורח רואה הערות', (await fetch(`${base}/api/orders/101/notes`, guest)).ok);

  // 10. נרמול מספר הטלפון לוואטסאפ — מספר שגוי פונה לאדם זר בשם העסק
  const { toWhatsappNumber, defaultMessage } = await import('./public/whatsapp.js');
  const cases = [
    ['052-555-1234', '972525551234', 'נייד מקומי עם מקפים'],
    ['0525551234', '972525551234', 'נייד מקומי רצוף'],
    ['+972 52 555 1234', '972525551234', 'בינלאומי עם פלוס ורווחים'],
    ['00972525551234', '972525551234', 'בינלאומי עם 00'],
    ['04-8123456', '9724812345 6'.replace(' ', ''), 'קו נייח'],
    ['', null, 'מספר ריק'],
    ['123', null, 'מספר קצר מדי'],
    ['לא מספר', null, 'טקסט שאינו מספר'],
  ];
  for (const [input, want, label] of cases) {
    const got = toWhatsappNumber(input);
    check(`טלפון — ${label}`, got === want, `${input || '(ריק)'} → ${got}`);
  }

  check('פנייה בשם הלקוח בהודעת הוואטסאפ',
    defaultMessage(detail.order).includes('רונית') && defaultMessage(detail.order).includes('1001'));
  check('פנייה תקינה גם בלי שם פרטי',
    !defaultMessage({ number: '7', billing: {} }).includes('undefined'));

  app.close();
  woo.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} בדיקות עברו`);
  if (failed.length) {
    console.log('\nנכשלו:');
    for (const f of failed) console.log(`  • ${f.name} ${f.detail}`);
    process.exit(1);
  }
}

main().catch((err) => { console.error('הבדיקה נפלה:', err); process.exit(1); });

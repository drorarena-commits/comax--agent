/**
 * תצוגה מקדימה של הממשק — מרים WooCommerce מדומה, פותח את האפליקציה בגודל
 * אייפון, ומצלם.
 *
 *   node orders-app/preview.js
 *
 * קיים כדי שאפשר יהיה **לראות** את המסך לפני שמשקיעים בעיצוב, ומהטלפון —
 * תיאור מילולי של מסך אינו תחליף לצילום שלו.
 */
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './config.js';

const TOKEN = 'preview-token-0123456789';
const OUT = resolve(ROOT, 'runs', 'orders-preview');

const ORDERS = [
  {
    id: 101, number: '1042', status: 'processing', total: '447',
    billing: { first_name: 'רונית', last_name: 'לוי', phone: '052-5551234', email: 'ronit@example.com' },
    minutesAgo: 12,
    items: [
      { name: 'משקפת שחייה Cobra Ultra', qty: 1, total: '212', sku: '003929-100', attr: ['צבע', 'כחול'] },
      { name: 'בגד ים אימון Solid', qty: 2, total: '200', sku: 'SKU-חסר-בקומקס', attr: ['מידה', '38'] },
    ],
  },
  {
    id: 102, number: '1041', status: 'on-hold', total: '189',
    billing: { first_name: 'עומר', last_name: 'בן דוד', phone: '054-7778899', email: 'omer@example.com' },
    minutesAgo: 140,
    items: [{ name: 'כובע ים סיליקון', qty: 1, total: '59', sku: '002024-109', attr: ['צבע', 'שחור'] }],
  },
  {
    id: 103, number: '1040', status: 'completed', total: '1,320',
    billing: { first_name: 'מכבי חיפה', last_name: '', phone: '04-8123456', email: 'club@example.com' },
    minutesAgo: 1500,
    items: [{ name: 'סנפירים Powerfin', qty: 6, total: '1320', sku: '004112-055', attr: ['מידה', '43-44'] }],
  },
  {
    id: 104, number: '1039', status: 'pending', total: '95',
    billing: { first_name: 'דנה', last_name: 'שמש', phone: '050-2223344', email: 'dana@example.com' },
    minutesAgo: 2600,
    items: [{ name: 'אטמי אוזניים', qty: 1, total: '95', sku: '009001-001', attr: ['צבע', 'שקוף'] }],
  },
];

const expand = (o) => ({
  id: o.id, number: o.number, status: o.status, currency: 'ILS',
  total: String(o.total).replace(/,/g, ''),
  shipping_total: '35', discount_total: '0', total_tax: '0',
  date_created_gmt: new Date(Date.now() - o.minutesAgo * 60_000).toISOString().replace(/\.\d+Z$/, ''),
  payment_method_title: 'כרטיס אשראי',
  customer_note: o.id === 101 ? 'נא להתקשר לפני המשלוח' : '',
  billing: o.billing,
  shipping: { address_1: 'הרצל 14', city: 'רמת גן' },
  shipping_lines: [{ method_title: 'משלוח עד הבית' }],
  line_items: o.items.map((it, i) => ({
    id: i + 1, name: it.name, quantity: it.qty, total: it.total, sku: it.sku,
    meta_data: [{ key: 'pa_x', display_key: it.attr[0], display_value: it.attr[1] }],
  })),
});

async function main() {
  mkdirSync(OUT, { recursive: true });
  const data = ORDERS.map(expand);

  const woo = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const one = url.pathname.match(/\/orders\/(\d+)$/);
    const body = one ? data.find((o) => o.id === Number(one[1])) : (() => {
      const s = url.searchParams.get('status');
      return s && s !== 'any' ? data.filter((o) => o.status === s) : data;
    })();
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'x-wp-total': String(Array.isArray(body) ? body.length : 1),
      'x-wp-totalpages': '1',
    });
    res.end(JSON.stringify(body));
  });
  await new Promise((r) => woo.listen(0, '127.0.0.1', r));

  const { config } = await import('./config.js');
  config.site.url = `http://127.0.0.1:${woo.address().port}`;
  config.site.key = 'ck_preview';
  config.site.secret = 'cs_preview';
  config.server.token = TOKEN;
  config.server.port = 0;

  const { startServer } = await import('./server.js');
  const app = startServer();
  await new Promise((r) => app.once('listening', r));
  const base = `http://127.0.0.1:${app.address().port}`;

  const browser = await chromium.launch({ channel: 'chrome' });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },   // iPhone 14/15
    deviceScaleFactor: 2,
    locale: 'he-IL',
  });
  const page = await ctx.newPage();

  await page.goto(`${base}/?k=${TOKEN}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.card');
  await page.screenshot({ path: resolve(OUT, '1-רשימה.png') });

  // הזמנה עם התרעת קומקס — המסך שהכי חשוב לראות
  await page.click('.card');
  await page.waitForSelector('.block.warn');
  await page.screenshot({ path: resolve(OUT, '2-פרטי-הזמנה.png') });

  // דיאלוג הוואטסאפ — הבחירה בין ביזנס לרגיל
  await page.click('.wa-btn');
  await page.waitForSelector('.wa-panel');
  await page.waitForTimeout(250);
  await page.screenshot({ path: resolve(OUT, '3-וואטסאפ.png') });
  await page.click('.wa-cancel');

  // גלילה עד כפתורי הסטטוס
  await page.locator('.actions').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(OUT, '4-שינוי-סטטוס.png') });

  await ctx.close();
  await browser.close();
  app.close();
  woo.close();
  console.log(`צילומים נשמרו ב-${OUT}`);
}

main().catch((err) => { console.error(err); process.exit(1); });

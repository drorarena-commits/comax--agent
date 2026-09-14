/**
 * שרת HTTP — מגיש את הממשק ואת ה-API שמאחוריו.
 *
 * ⚠️ **הכתובת הזאת יוצאת לאינטרנט דרך המנהרה**, ומאחוריה יושבים שמות,
 * טלפונים וכתובות של לקוחות. לכן כל בקשה — כולל הדף עצמו — עוברת שער
 * טוקן. הכניסה הראשונה היא `?k=<ORDERS_TOKEN>`, ומשם הטוקן יושב בעוגייה
 * ואין צורך להקליד שוב.
 *
 * ההשוואה לטוקן היא בזמן קבוע (`timingSafeEqual`) ולא ב-`===`. זו לא
 * פרנויה: כתובת ציבורית מאפשרת לתוקף לנחש תו-תו לפי זמן התגובה.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { config, APP_ROOT } from './config.js';
import { listOrders, getOrder, setOrderStatus, ping } from './woo.js';
import { checkOrderItems } from './comax-check.js';
import { currencySymbol } from './format.js';
import { pollOnce } from './watch.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

function tokenOk(given) {
  const expected = config.server.token || '';
  if (!given || !expected) return false;
  const a = Buffer.from(String(given));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function cookieToken(req) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === 'orders_token') return decodeURIComponent(v.join('='));
  }
  return null;
}

const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}

async function serveStatic(res, urlPath) {
  // normalize חוסם `..` — בלעדיו כתובת יכולה לצאת מתיקיית public אל הדיסק.
  const rel = normalize(urlPath === '/' ? '/index.html' : urlPath).replace(/^([/\\])+/, '');
  const file = join(APP_ROOT, 'public', rel);
  if (!file.startsWith(join(APP_ROOT, 'public'))) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('לא נמצא');
  }
}

async function handleApi(req, res, url) {
  const path = url.pathname.replace(/^\/api/, '');

  if (path === '/health') {
    const total = await ping();
    return json(res, 200, { ok: true, site: config.site.url, totalOrders: total });
  }

  if (path === '/orders' && req.method === 'GET') {
    const { orders, totalPages, total } = await listOrders({
      status: url.searchParams.get('status') || 'any',
      search: url.searchParams.get('q') || undefined,
      page: Number(url.searchParams.get('page') || 1),
      perPage: 20,
    });
    // הרשימה מוחזרת רזה — המסך מציג כותרות, והפרטים נטענים בפתיחת הזמנה.
    return json(res, 200, {
      totalPages,
      total,
      orders: orders.map((o) => ({
        id: o.id,
        number: o.number,
        status: o.status,
        date: o.date_created_gmt,
        total: o.total,
        currency: currencySymbol(o),
        customer: [o.billing?.first_name, o.billing?.last_name].filter(Boolean).join(' ') || o.billing?.company || '',
        phone: o.billing?.phone || '',
        itemCount: (o.line_items || []).reduce((n, li) => n + (li.quantity || 0), 0),
      })),
    });
  }

  const one = path.match(/^\/orders\/(\d+)$/);
  if (one && req.method === 'GET') {
    const order = await getOrder(one[1]);
    return json(res, 200, { order, comax: checkOrderItems(order) });
  }

  const setStatus = path.match(/^\/orders\/(\d+)\/status$/);
  if (setStatus && req.method === 'POST') {
    const { status } = await readBody(req);
    const allowed = ['processing', 'on-hold', 'completed', 'cancelled', 'pending', 'refunded'];
    if (!allowed.includes(status)) return json(res, 400, { error: `סטטוס לא מוכר: ${status}` });
    const order = await setOrderStatus(setStatus[1], status);
    return json(res, 200, { ok: true, status: order.status });
  }

  if (path === '/poll' && req.method === 'POST') {
    const n = await pollOnce();
    return json(res, 200, { ok: true, sent: n });
  }

  return json(res, 404, { error: 'אין נתיב כזה' });
}

export function startServer() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${config.server.port}`);

    // כניסה עם ?k= — מניחה עוגייה ומנקה את הטוקן מהכתובת, כדי שלא יישאר
    // בהיסטוריית הדפדפן ובלוגים של המנהרה.
    const viaQuery = url.searchParams.get('k');
    if (viaQuery && tokenOk(viaQuery)) {
      url.searchParams.delete('k');
      res.writeHead(302, {
        'Set-Cookie': `orders_token=${encodeURIComponent(viaQuery)}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`,
        Location: url.pathname + (url.search || ''),
      });
      return res.end();
    }

    if (!tokenOk(cookieToken(req)) && !tokenOk((req.headers.authorization || '').replace(/^Bearer /, ''))) {
      if (url.pathname.startsWith('/api/')) return json(res, 401, { error: 'נדרשת כניסה' });
      res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<meta charset="utf-8"><div dir="rtl" style="font:16px system-ui;padding:2rem">נדרשת כניסה — פתח את הקישור המלא שכולל <code>?k=…</code></div>');
    }

    try {
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
      return await serveStatic(res, url.pathname);
    } catch (err) {
      console.error(`[שגיאה] ${req.method} ${url.pathname} — ${err.message}`);
      if (!res.headersSent) json(res, 500, { error: err.message });
      else res.end();
    }
  });

  server.listen(config.server.port, '0.0.0.0', () => {
    console.log(`ממשק ההזמנות עלה על http://localhost:${config.server.port}/?k=<ORDERS_TOKEN>`);
  });
  return server;
}

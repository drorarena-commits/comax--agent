/**
 * הממשק — רשימת הזמנות לפי סטטוס, פרטי הזמנה, ושינוי סטטוס מהטלפון.
 *
 * הכל vanilla, בלי שלב בנייה: הקובץ שנפתח בדפדפן הוא הקובץ שנערך, וזה מה
 * שמאפשר לתקן משהו בשתי דקות מהמחשב בחנות בלי טולצ'יין.
 */

const TABS = [
  { key: 'any', label: 'הכל' },
  { key: 'processing', label: 'לטיפול' },
  { key: 'on-hold', label: 'בהמתנה' },
  { key: 'pending', label: 'ממתינה לתשלום' },
  { key: 'completed', label: 'הושלמו' },
  { key: 'cancelled', label: 'בוטלו' },
];

const STATUS_HE = {
  pending: 'ממתינה לתשלום',
  processing: 'לטיפול',
  'on-hold': 'בהמתנה',
  completed: 'הושלמה',
  cancelled: 'בוטלה',
  refunded: 'זוכתה',
  failed: 'נכשלה',
};

const ACTIONS = [
  { key: 'processing', label: 'לטיפול' },
  { key: 'completed', label: 'הושלמה' },
  { key: 'on-hold', label: 'בהמתנה' },
  { key: 'cancelled', label: 'ביטול' },
];

import { openWhatsapp, toWhatsappNumber, defaultMessage } from '/whatsapp.js';

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const state = { status: 'any', q: '', page: 1, totalPages: 1, orders: [], loading: false };

function money(v, currency = 'ILS') {
  const n = Number(v || 0);
  const sym = currency === 'ILS' ? '₪' : currency;
  return `${Number.isInteger(n) ? n : n.toFixed(2)} ${sym}`;
}

function when(iso) {
  // התאריכים מ-WooCommerce הם GMT בלי סיומת Z; בלי ההוספה הדפדפן יפרש
  // אותם כזמן מקומי והשעה תזוז בשעתיים.
  const d = new Date(/Z$/.test(iso) ? iso : iso + 'Z');
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return d.toLocaleString('he-IL', sameDay
    ? { hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

async function api(path, opts) {
  const res = await fetch('/api' + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts?.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `שגיאה ${res.status}`);
  }
  return res.json();
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2800);
}

/* ---------- רשימה ---------- */

function renderTabs() {
  const nav = $('#tabs');
  nav.textContent = '';
  for (const t of TABS) {
    const b = el('button', 'tab', t.label);
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(state.status === t.key));
    b.onclick = () => { state.status = t.key; state.page = 1; renderTabs(); load(); };
    nav.append(b);
  }
}

function orderCard(o) {
  // div ולא button: כפתור הוואטסאפ יושב בתוך הכרטיס, ו-button בתוך button
  // אינו HTML חוקי ומתנהג שונה בין דפדפנים.
  const card = el('div', 'card');
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.append(
    el('div', 'card-name', o.customer || `הזמנה #${o.number}`),
    el('div', 'card-total', money(o.total, o.currency)),
  );

  const meta = el('div', 'card-meta');
  meta.append(el('span', `pill ${o.status}`, STATUS_HE[o.status] || o.status));
  meta.append(el('span', null, `#${o.number}`));
  meta.append(el('span', null, when(o.date)));
  meta.append(el('span', null, `${o.itemCount} פריטים`));

  if (toWhatsappNumber(o.phone)) {
    const wa = el('button', 'wa-mini', '✆');
    wa.setAttribute('aria-label', `וואטסאפ ל${o.customer || 'לקוח'}`);
    wa.onclick = async (e) => {
      e.stopPropagation();           // אחרת הכרטיס ייפתח מתחת לדיאלוג
      // הרשימה רזה ואין בה שם פרטי ומספר הזמנה כטקסט — נטען את ההזמנה
      // המלאה, כדי שההודעה תצא מנוסחת נכון ולא "היי ,".
      try {
        const { order } = await api(`/orders/${o.id}`);
        whatsappDialog(order);
      } catch (err) {
        toast(err.message);
      }
    };
    meta.append(wa);
  }

  card.append(meta);
  card.onclick = () => openOrder(o.id);
  card.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openOrder(o.id); } };
  return card;
}

async function load({ append = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  $('#refresh').classList.add('spin');
  try {
    const params = new URLSearchParams({ status: state.status, page: String(state.page) });
    if (state.q) params.set('q', state.q);
    const data = await api('/orders?' + params);
    state.totalPages = data.totalPages;
    state.orders = append ? state.orders.concat(data.orders) : data.orders;
    renderList();
  } catch (err) {
    $('#list').textContent = '';
    $('#list').append(el('div', 'empty', err.message));
  } finally {
    state.loading = false;
    $('#refresh').classList.remove('spin');
  }
}

function renderList() {
  const list = $('#list');
  list.textContent = '';
  if (!state.orders.length) {
    list.append(el('div', 'empty', 'אין הזמנות שתואמות את הסינון'));
  } else {
    for (const o of state.orders) list.append(orderCard(o));
  }
  $('#more-wrap').classList.toggle('hidden', state.page >= state.totalPages);
}

/* ---------- וואטסאפ ---------- */

/**
 * שואל באיזו אפליקציה לפתוח, ומאפשר לערוך את ההודעה לפני היציאה.
 * הבחירה האחרונה נזכרת ומוצגת כברירת מחדל — אבל **לא נבחרת אוטומטית**:
 * שליחה מהאפליקציה הלא נכונה מציגה ללקוח מספר אחר, וזו לא טעות שכדאי
 * לחסוך עליה קליק.
 */
function whatsappDialog(order) {
  const phone = order.billing?.phone;
  const number = toWhatsappNumber(phone);
  if (!number) {
    toast(phone ? `לא הצלחתי להבין את המספר ${phone}` : 'אין מספר טלפון בהזמנה');
    return;
  }

  const wrap = el('div', 'wa-dialog');
  const bg = el('div', 'sheet-bg');
  bg.dataset.close = '';
  const panel = el('div', 'wa-panel');

  panel.append(el('h3', 'wa-title', `הודעת וואטסאפ ל${order.billing?.first_name || 'לקוח'}`));
  panel.append(el('div', 'wa-num', `+${number}`));

  const box = el('textarea', 'wa-text');
  box.rows = 4;
  box.value = defaultMessage(order);
  panel.append(box);

  const last = localStorage.getItem('wa-app');
  panel.append(el('div', 'wa-ask', 'באיזו אפליקציה לפתוח?'));

  const row = el('div', 'actions');
  for (const opt of [
    { key: 'business', label: 'וואטסאפ ביזנס' },
    { key: 'regular', label: 'וואטסאפ רגיל' },
  ]) {
    const b = el('button', 'action', opt.label + (last === opt.key ? ' ·' : ''));
    b.onclick = () => {
      localStorage.setItem('wa-app', opt.key);
      const ok = openWhatsapp({ phone, text: box.value, app: opt.key });
      if (!ok) toast('לא הצלחתי להבין את מספר הטלפון');
      wrap.remove();
    };
    row.append(b);
  }
  panel.append(row);

  const cancel = el('button', 'wa-cancel', 'ביטול');
  cancel.onclick = () => wrap.remove();
  panel.append(cancel);

  wrap.append(bg, panel);
  wrap.addEventListener('click', (e) => { if (e.target.dataset.close !== undefined) wrap.remove(); });
  document.body.append(wrap);
  box.focus();
}

/* ---------- פרטי הזמנה ---------- */

function block(title, rows) {
  const b = el('div', 'block');
  if (title) b.append(el('h3', null, title));
  for (const r of rows) b.append(r);
  return b;
}

function kv(k, v, cls = 'kv') {
  const row = el('div', cls);
  row.append(el('span', null, k), el('span', null, v));
  return row;
}

function renderOrder(order, comax) {
  const body = $('#sheet-body');
  body.textContent = '';

  body.append(el('h2', null, `הזמנה #${order.number}`));
  body.append(el('div', 'when', `${when(order.date_created_gmt)} · ${STATUS_HE[order.status] || order.status}`));

  // --- לקוח ---
  const b = order.billing || {};
  const custRows = [kv('שם', [b.first_name, b.last_name].filter(Boolean).join(' ') || b.company || '—')];
  if (b.phone) {
    const row = el('div', 'kv');
    const link = el('a', 'tel', b.phone);
    link.href = `tel:${b.phone.replace(/[^\d+]/g, '')}`;
    row.append(el('span', null, 'טלפון'), link);
    custRows.push(row);
  }
  if (b.email) {
    const row = el('div', 'kv');
    const link = el('a', 'tel', b.email);
    link.href = `mailto:${b.email}`;
    row.append(el('span', null, 'אימייל'), link);
    custRows.push(row);
  }
  if (toWhatsappNumber(b.phone)) {
    const wa = el('button', 'wa-btn');
    wa.append(el('span', 'wa-icon', '✆'), el('span', null, 'שליחת וואטסאפ ללקוח'));
    wa.onclick = () => whatsappDialog(order);
    custRows.push(wa);
  }
  body.append(block('לקוח', custRows));

  // --- פריטים ---
  const items = (order.line_items || []).map((li) => {
    const it = el('div', 'item');
    const top = el('div', 'item-top');
    top.append(
      el('span', null, li.name + (li.quantity > 1 ? ` × ${li.quantity}` : '')),
      el('span', null, money(li.total, order.currency)),
    );
    it.append(top);
    const variation = (li.meta_data || [])
      .filter((m) => m.key && !m.key.startsWith('_') && m.display_value)
      .map((m) => `${m.display_key || m.key}: ${m.display_value}`)
      .join(' · ');
    const sub = [variation, li.sku ? `מק"ט ${li.sku}` : null].filter(Boolean).join(' · ');
    if (sub) it.append(el('div', 'item-sub', sub));
    return it;
  });
  body.append(block('פריטים', items));

  // --- התרעת קומקס: הכשל היחיד שנראה בדיוק כמו הצלחה ---
  if (comax?.checked && comax.missing.length) {
    const rows = comax.missing.map((m) => {
      const it = el('div', 'item');
      it.append(el('div', 'item-top', m.sku || m.note || '—'));
      it.append(el('div', 'item-sub', m.name + (m.hint ? ` · בקומקס קיים ${m.hint}` : '')));
      return it;
    });
    if (comax.catalog?.ageDays > 2) {
      rows.push(el('div', 'item-sub', `הקטלוג המקומי בן ${comax.catalog.ageDays} ימים — ייתכן שהפריט כבר הוקם`));
    }
    const warn = block('⚠️ לא נמצאו בקומקס — ההזמנה לא תסתנכרן', rows);
    warn.classList.add('warn');
    body.append(warn);
  } else if (comax && !comax.checked) {
    const warn = block('⚠️ לא נבדקה הצלבה מול קומקס', [el('div', 'item-sub', comax.reason || '')]);
    warn.classList.add('warn');
    body.append(warn);
  }

  // --- משלוח ---
  const s = order.shipping || {};
  const addr = [s.address_1, s.address_2, s.city].filter(Boolean).join(', ');
  const method = (order.shipping_lines || []).map((l) => l.method_title).filter(Boolean).join(', ');
  body.append(block('משלוח', [
    kv('שיטה', method || 'לא צוינה'),
    kv('כתובת', addr || 'אין כתובת — ככל הנראה איסוף עצמי'),
  ]));

  // --- תשלום ---
  const payRows = [kv('אמצעי', order.payment_method_title || 'לא צוין')];
  if (Number(order.discount_total) > 0) payRows.push(kv('הנחה', '−' + money(order.discount_total, order.currency)));
  if (Number(order.shipping_total) > 0) payRows.push(kv('דמי משלוח', money(order.shipping_total, order.currency)));
  if (Number(order.total_tax) > 0) payRows.push(kv('מע"מ', money(order.total_tax, order.currency)));
  payRows.push(kv('סה"כ', money(order.total, order.currency), 'kv total'));
  body.append(block('תשלום', payRows));

  if (order.customer_note) body.append(block('הערת לקוח', [el('div', null, order.customer_note)]));

  // --- שינוי סטטוס ---
  const actions = el('div', 'actions');
  for (const a of ACTIONS) {
    const btn = el('button', 'action', a.label);
    btn.setAttribute('aria-current', String(order.status === a.key));
    btn.onclick = () => changeStatus(order, a, actions);
    actions.append(btn);
  }
  body.append(block('שינוי סטטוס', [actions]));
}

async function changeStatus(order, action, container) {
  if (order.status === action.key) return;
  // ביטול הוא הפעולה היחידה שקשה לחזור ממנה בלי לבלבל את הלקוח — ולכן
  // היחידה שמבקשת אישור.
  if (action.key === 'cancelled' && !confirm(`לבטל את הזמנה #${order.number}?`)) return;

  for (const b of container.querySelectorAll('button')) b.disabled = true;
  try {
    await api(`/orders/${order.id}/status`, { method: 'POST', body: JSON.stringify({ status: action.key }) });
    toast(`הזמנה #${order.number} — ${action.label}`);
    await openOrder(order.id);   // רענון מלא מהאתר, כדי לא להציג מצב מדומיין
    load();
  } catch (err) {
    toast(err.message);
    for (const b of container.querySelectorAll('button')) b.disabled = false;
  }
}

async function openOrder(id) {
  const sheet = $('#sheet');
  sheet.classList.remove('hidden');
  $('#sheet-body').textContent = '';
  $('#sheet-body').append(el('div', 'empty', 'טוען…'));
  try {
    const { order, comax } = await api(`/orders/${id}`);
    renderOrder(order, comax);
  } catch (err) {
    $('#sheet-body').textContent = '';
    $('#sheet-body').append(el('div', 'empty', err.message));
  }
}

function closeSheet() {
  $('#sheet').classList.add('hidden');
  if (location.search.includes('order=')) history.replaceState({}, '', location.pathname);
}

/* ---------- חיווט ---------- */

$('#refresh').onclick = () => { state.page = 1; load(); };
$('#more').onclick = () => { state.page++; load({ append: true }); };
$('#sheet').addEventListener('click', (e) => { if (e.target.dataset.close !== undefined) closeSheet(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

let searchTimer;
$('#search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const v = e.target.value.trim();
  searchTimer = setTimeout(() => { state.q = v; state.page = 1; load(); }, 350);
});

// חזרה למסך מרעננת — הקישור בטלגרם מביא לכאן, ומה שמוצג חייב להיות עדכני.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && $('#sheet').classList.contains('hidden')) load();
});

renderTabs();
load();

// קישור ישיר מהודעת הטלגרם: /?order=123
const deepLink = new URLSearchParams(location.search).get('order');
if (deepLink) openOrder(deepLink);

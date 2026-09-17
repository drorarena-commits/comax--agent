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

const state = { status: 'any', q: '', page: 1, totalPages: 1, orders: [], loading: false, role: null };

/**
 * ⚠️ האתר מחזיר `currency` כקוד HTML (`&#8362;`) ולא כ-`ILS` — תוסף עברי
 * דורס את השדה. בטלגרם זה מתפענח במקרה ובממשק לא, ולכן מפענחים כאן במפורש.
 */
function currencySymbol(order) {
  const raw = order?.currency_symbol || order?.currency || 'ILS';
  const decoded = String(raw).replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
  return decoded === 'ILS' ? '₪' : decoded;
}

function money(v, symbol = '₪') {
  const n = Number(v || 0);
  return `${Number.isInteger(n) ? n : n.toFixed(2)} ${symbol}`;
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
 * מאפשר לערוך את ההודעה לפני היציאה, ופותח וואטסאפ בקישור אחד.
 * הבחירה בין ביזנס לרגיל **אינה שלנו** — iOS שואל אותה בעצמו.
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

  // כפתור אחד. אם מותקנת גם וואטסאפ ביזנס, iOS שואל בעצמו אם לעבור אליה —
  // ולכן בורר אפליקציות כאן היה מסך מיותר בדרך לכל לקוח.
  const row = el('div', 'actions');
  const send = el('button', 'action', 'פתיחת וואטסאפ');
  send.onclick = () => {
    const ok = openWhatsapp({ phone, text: box.value });
    if (!ok) toast('לא הצלחתי להבין את מספר הטלפון');
    wrap.remove();
  };
  row.append(send);
  panel.append(row);

  const cancel = el('button', 'wa-cancel', 'ביטול');
  cancel.onclick = () => wrap.remove();
  panel.append(cancel);

  wrap.append(bg, panel);
  wrap.addEventListener('click', (e) => { if (e.target.dataset.close !== undefined) wrap.remove(); });
  document.body.append(wrap);
  box.focus();
}

/* ---------- הגדלת תמונה ---------- */

/**
 * תמונה במסך מלא עם הברקוד והפרטים מתחתיה.
 *
 * הפרטים נשארים על המסך **יחד עם** התמונה ולא מוחלפים בה: הרגע שבו מגדילים
 * את התמונה הוא בדיוק הרגע שבו משווים אותה לפריט שביד, ואז צריך לראות גם
 * את הברקוד. תמונה לבדה מחזירה את המלקט למסך הקודם.
 */
function lightbox(line, comaxRow) {
  const wrap = el('div', 'lb');
  wrap.dataset.close = '';

  const img = el('img', 'lb-img');
  img.src = line.image.src;
  img.alt = line.name;
  wrap.append(img);

  const cap = el('div', 'lb-cap');
  cap.append(el('div', 'lb-name', line.name));
  if (line.sku) cap.append(el('div', 'lb-code', line.sku));
  if (comaxRow?.code) cap.append(el('div', 'lb-comax', comaxRow.code));
  wrap.append(cap);

  wrap.onclick = () => wrap.remove();
  document.body.append(wrap);
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
  const cur = currencySymbol(order);
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
  // התמונה היא **של הווריאציה**, לא של מוצר האב: WooCommerce מחזיר
  // `line_items[].image` לפי הווריאציה שנקנתה, ולכן הצבע שרואים הוא הצבע
  // שהוזמן. זה מה שמאפשר ללקט לפי המסך בלי ללכת למחשב.
  const items = (order.line_items || []).map((li) => {
    const it = el('div', 'item item-row');

    if (li.image?.src) {
      const thumb = el('img', 'item-img');
      // ⚠️ ה-API מחזיר את התמונה **המקורית** — נמדד 453KB עבור ריבוע של
      // 68 פיקסל. בסלולר זה איטי ויקר, ובמנהרה זה גם לא הספיק להיטען.
      // וורדפרס מייצר `-150x150` בכל העלאה (9–13KB, פי 40 פחות), ואם הוא
      // במקרה חסר — `onerror` נופל חזרה למקור ולא משאיר ריבוע ריק.
      thumb.src = li.image.src.replace(/(\.[a-z0-9]+)$/i, '-150x150$1');
      thumb.onerror = () => { thumb.onerror = null; thumb.src = li.image.src; };
      thumb.alt = li.name;
      thumb.loading = 'lazy';
      thumb.onclick = () => lightbox(li, comax?.matched?.[li.id]);
      it.append(thumb);
    }

    const info = el('div', 'item-info');
    const top = el('div', 'item-top');
    top.append(
      el('span', null, li.name + (li.quantity > 1 ? ` × ${li.quantity}` : '')),
      el('span', null, money(li.total, cur)),
    );
    info.append(top);

    const variation = (li.meta_data || [])
      .filter((m) => m.key && !m.key.startsWith('_') && m.display_value)
      .map((m) => `${m.display_key || m.key}: ${m.display_value}`)
      .join(' · ');
    if (variation) info.append(el('div', 'item-sub', variation));

    // הברקוד המלא בשורה משלו ובגופן רחב — הוא נקרא ספרה-ספרה מול המדבקה.
    if (li.sku) info.append(el('div', 'item-code', li.sku));

    // דגם-צבע-מידה — המזהה שמודפס על המדבקה. **לא** שם הפריט מקומקס: הוא
    // חוזר על שם המוצר שכבר מופיע למעלה ורק מאריך את השורה. ההצלבה עצמה
    // ממשיכה לרוץ מאחורי הקלעים, ופריט שלא נמצא מתריע בבלוק האדום.
    const m = comax?.matched?.[li.id];
    if (m?.code) info.append(el('div', 'item-comax', m.code));

    it.append(info);
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
  if (Number(order.discount_total) > 0) payRows.push(kv('הנחה', '−' + money(order.discount_total, cur)));
  if (Number(order.shipping_total) > 0) payRows.push(kv('דמי משלוח', money(order.shipping_total, cur)));
  if (Number(order.total_tax) > 0) payRows.push(kv('מע"מ', money(order.total_tax, cur)));
  payRows.push(kv('סה"כ', money(order.total, cur), 'kv total'));
  body.append(block('תשלום', payRows));

  if (order.customer_note) body.append(block('הערת לקוח', [el('div', null, order.customer_note)]));

  // --- הערות הזמנה (כמו בממשק הניהול) ---
  body.append(notesBlock(order));

  // --- שינוי סטטוס ---
  // מקופל בכוונה. דרור כמעט לא משנה סטטוס מהטלפון — האריזה והמדבקה נעשות
  // ממילא במחשב — ולכן ארבעה כפתורים פתוחים תפסו את תחתית המסך בלי תמורה.
  // הוא נשאר זמין בהקשה אחת, ולא יותר מזה.
  //
  // לאורח לא מוצגים הכפתורים כלל. זו נוחות בלבד — האכיפה עצמה בשרת, כי
  // שינוי סטטוס שולח מייל אוטומטי ללקוח וכפתור מוסתר אינו הגנה.
  const fold = el('details', 'fold');
  fold.append(el('summary', 'fold-head', 'שינוי סטטוס'));
  if (state.role === 'full') {
    const actions = el('div', 'actions');
    for (const a of ACTIONS) {
      const btn = el('button', 'action', a.label);
      btn.setAttribute('aria-current', String(order.status === a.key));
      btn.onclick = () => changeStatus(order, a, actions);
      actions.append(btn);
    }
    fold.append(actions);
  } else {
    fold.append(el('div', 'item-sub', 'הרשאת צפייה בלבד — שינוי סטטוס שולח מייל אוטומטי ללקוח'));
  }
  body.append(fold);
}

/**
 * הערות ההזמנה — נטענות בנפרד, כדי שפרטי ההזמנה לא יחכו להן.
 * רק הערה **פרטית** נכתבת מכאן; הערה ללקוח נשלחת אליו במייל ואין לה כפתור.
 */
function notesBlock(order) {
  const b = block('הערות', []);

  // ההיסטוריה מקופלת ונגללת בתוך עצמה: בהזמנה עם UPS, מיילים ושינויי סטטוס
  // יש בקלות 10+ רשומות, ורשימה פתוחה דחפה את תיבת הכתיבה לתחתית המסך
  // ונראתה כהמשך של בלוק התשלום ולא כהיסטוריה. דרור, 17/09/2026.
  const fold = el('details', 'fold notes-fold');
  const head = el('summary', 'fold-head', 'היסטוריית עדכונים');
  const listEl = el('div', 'notes');
  listEl.append(el('div', 'item-sub', 'טוען הערות…'));
  fold.append(head, listEl);

  const refresh = async () => {
    try {
      const { notes } = await api(`/orders/${order.id}/notes`);
      head.textContent = `היסטוריית עדכונים (${notes.length})`;
      listEl.textContent = '';
      if (!notes.length) listEl.append(el('div', 'item-sub', 'אין הערות'));
      for (const n of notes) {
        const row = el('div', `note${n.toCustomer ? ' to-customer' : ''}`);
        // וורדפרס מחזיר HTML (קישורים, <br>). DOMParser לא מריץ סקריפטים ולא
        // טוען תמונות, והתוצאה מוצגת כטקסט נקי בלבד.
        const doc = new DOMParser().parseFromString(n.text.replace(/<br\s*\/?>/gi, '\n'), 'text/html');
        row.append(el('div', 'note-text', doc.body.textContent));
        row.append(el('div', 'note-meta',
          `${when(n.date)} · ${n.author === 'system' ? 'מערכת' : n.author}${n.toCustomer ? ' · נשלחה ללקוח' : ''}`));
        listEl.append(row);
      }
    } catch (err) {
      head.textContent = 'היסטוריית עדכונים — שגיאה בטעינה';
      fold.open = true;   // שגיאה מקופלת נראית בדיוק כמו "אין היסטוריה"
      listEl.textContent = '';
      listEl.append(el('div', 'item-sub', err.message));
    }
  };

  if (state.role === 'full') {
    const box = el('textarea', 'wa-text');
    box.rows = 2;
    box.placeholder = 'הערה פרטית — לא נשלחת ללקוח';
    const add = el('button', 'action note-add', 'הוספת הערה');
    add.onclick = async () => {
      const text = box.value.trim();
      if (!text) return;
      add.disabled = true;
      try {
        await api(`/orders/${order.id}/notes`, { method: 'POST', body: JSON.stringify({ note: text }) });
        box.value = '';
        toast('ההערה נוספה');
        await refresh();
        fold.open = true;   // לראות מיד שההערה נחתה בראש ההיסטוריה
      } catch (err) {
        toast(err.message);
      } finally {
        add.disabled = false;
      }
    };
    b.append(box, add);
  }

  b.append(fold);
  refresh();
  return b;
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

// ההרשאה נקראת לפני הרשימה — אחרת פתיחת הזמנה מקישור ישיר תרנדר לפני
// שידוע אם מותר להציג כפתורי סטטוס.
(async () => {
  try {
    const me = await api('/me');
    state.role = me.role;
  } catch {
    state.role = 'guest';   // ברירת מחדל מחמירה
  }
  renderTabs();
  await load();

  // קישור ישיר מהודעת הטלגרם: /?order=123
  const deepLink = new URLSearchParams(location.search).get('order');
  if (deepLink) openOrder(deepLink);
})();

/**
 * סיכום הזמנה לטקסט — אותו סיכום שמגיע בטלגרם ונפתח גם בממשק.
 *
 * העיקרון: **מה שדרור צריך כדי להחליט מה לעשות, בלי לפתוח את האתר.** מי
 * הזמין ואיך משיגים אותו, מה הוא קנה באיזו מידה, איך זה נשלח ולאן, כמה
 * שילם ובמה. כל השאר הוא רעש בהתראה שמגיעה באמצע היום.
 */

const STATUS_HE = {
  pending: 'ממתינה לתשלום',
  processing: 'חדשה — לטיפול',
  'on-hold': 'בהמתנה',
  completed: 'הושלמה',
  cancelled: 'בוטלה',
  refunded: 'זוכתה',
  failed: 'נכשלה',
  trash: 'באשפה',
  'checkout-draft': 'טיוטת עגלה',
};

export function statusHe(status) {
  return STATUS_HE[status] || status;
}

export function money(amount, currency = 'ILS') {
  const n = Number(amount || 0);
  const symbol = currency === 'ILS' ? '₪' : currency;
  // שקלים שלמים מוצגים בלי אגורות — כך גם המחירים בקטלוג.
  const body = Number.isInteger(n) ? String(n) : n.toFixed(2);
  return `${body} ${symbol}`;
}

/** הפרטים שמבדילים ווריאציה אחת מהשנייה — מידה וצבע — מתוך meta_data. */
export function variationOf(line) {
  const skip = /^_|^pa_$/;
  return (line.meta_data || [])
    .filter((m) => m.key && !skip.test(m.key) && m.display_value)
    .map((m) => `${m.display_key || m.key}: ${m.display_value}`)
    .join(' · ');
}

export function customerName(order) {
  const b = order.billing || {};
  const name = [b.first_name, b.last_name].filter(Boolean).join(' ').trim();
  return name || b.company || 'לקוח ללא שם';
}

export function shippingLine(order) {
  const s = order.shipping || {};
  const parts = [s.address_1, s.address_2, s.city].filter(Boolean);
  const method = (order.shipping_lines || []).map((l) => l.method_title).filter(Boolean).join(', ');
  return {
    method: method || 'לא צוינה שיטת משלוח',
    address: parts.length ? parts.join(', ') : 'אין כתובת — ככל הנראה איסוף עצמי',
  };
}

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * הודעת הטלגרם. `parse_mode: HTML` — הקישור בסוף פותח את ההזמנה בממשק שלנו,
 * לא בוורדפרס, כדי שאפשר יהיה לשנות סטטוס מאותו מסך.
 */
export function telegramMessage(order, { comax, appUrl } = {}) {
  const b = order.billing || {};
  const ship = shippingLine(order);
  const when = new Date(order.date_created_gmt + 'Z').toLocaleString('he-IL', {
    timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });

  const lines = [];
  lines.push(`🛒 <b>הזמנה חדשה #${esc(order.number)}</b>  ·  ${esc(when)}`);
  lines.push('');
  lines.push(`👤 ${esc(customerName(order))}`);
  if (b.phone) lines.push(`📞 ${esc(b.phone)}`);
  if (b.email) lines.push(`✉️ ${esc(b.email)}`);
  lines.push('');

  lines.push('<b>הפריטים</b>');
  for (const li of order.line_items || []) {
    const variation = variationOf(li);
    const head = `• ${esc(li.name)}${li.quantity > 1 ? ` × ${li.quantity}` : ''}`;
    lines.push(head);
    const details = [variation, li.sku ? `מק"ט ${li.sku}` : null].filter(Boolean).join(' · ');
    if (details) lines.push(`   <i>${esc(details)}</i>`);
    lines.push(`   ${esc(money(li.total, order.currency))}`);
  }
  lines.push('');

  lines.push(`🚚 ${esc(ship.method)}`);
  lines.push(`📍 ${esc(ship.address)}`);
  const shipCost = Number(order.shipping_total || 0);
  if (shipCost > 0) lines.push(`   דמי משלוח: ${esc(money(shipCost, order.currency))}`);
  lines.push('');

  lines.push(`💳 ${esc(order.payment_method_title || 'לא צוין אמצעי תשלום')}`);
  const discount = Number(order.discount_total || 0);
  if (discount > 0) lines.push(`🏷️ הנחה: ${esc(money(discount, order.currency))}`);
  lines.push(`<b>סה"כ: ${esc(money(order.total, order.currency))}</b>`);

  if (order.customer_note) {
    lines.push('');
    lines.push(`📝 הערת לקוח: ${esc(order.customer_note)}`);
  }

  // ההתרעה החשובה ביותר בהודעה — פריט שלא קיים בקומקס מפיל את כל ההזמנה בשקט.
  if (comax?.checked && comax.missing.length) {
    lines.push('');
    lines.push('⚠️ <b>פריטים שלא נמצאו בקומקס — ההזמנה לא תסתנכרן</b>');
    for (const m of comax.missing) {
      const hint = m.hint ? ` (בקומקס קיים ${esc(m.hint)})` : '';
      lines.push(`   ${esc(m.sku || m.note || '—')}${hint} — ${esc(m.name)}`);
    }
    if (comax.catalog?.ageDays > 2) {
      lines.push(`   <i>הקטלוג המקומי בן ${comax.catalog.ageDays} ימים — ייתכן שהפריט כבר הוקם</i>`);
    }
  } else if (comax && !comax.checked) {
    lines.push('');
    lines.push('⚠️ <i>לא נבדקה הצלבה מול קומקס — אין קטלוג מקומי</i>');
  }

  if (appUrl) {
    lines.push('');
    lines.push(`<a href="${esc(appUrl)}">פתיחת ההזמנה באפליקציה</a>`);
  }

  return lines.join('\n');
}

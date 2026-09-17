/**
 * Deciding what a batch actually needs — the step between reading the invoice
 * and writing anything.
 *
 * Every invoice row lands in exactly one bucket:
 *
 *   exists   — the barcode is already a child in the card. Nothing to do.
 *   newChild — the parent exists, this size/colour does not.
 *   newBoth  — neither exists. A new parent and its children.
 *   blocked  — the barcode exists but hangs off a *different* parent than the
 *              one this invoice implies. Never set up, always reported: it
 *              means either Arena reused a barcode or we derived the parent
 *              wrong, and both need a human before anything is sent.
 *
 * Parents are deduplicated across the batch — one invoice usually carries six
 * sizes of the same model, and Sport & More want the parent once.
 *
 * A row with no barcode is blocked unless `selfBarcodes` is on. Arena omits the
 * barcode on customised orders — federation caps and the like — and the
 * stand-in is then the child code without its `AR`. It stays opt-in because on
 * an ordinary invoice a missing barcode means a broken export, not a customised
 * item, and silently inventing an identifier there is the worst possible
 * response. The derived code is looked up in the card like any other, so a cap
 * already set up under the same stand-in blocks instead of duplicating.
 */
import { parentSku, selfBarcode } from './arena-invoice.js';
import { classify, learnFromInvoice, unresolved } from './classify.js';
import { priceFromCost } from './pricing.js';

/**
 * המידות שנצפו בכרטיס תחת סרגל נתון — מהבנים בפועל, לא מטבלת סרגלים
 * (הכרטיס אינו מחזיק אחת).
 */
function sizesInScale(card, scale) {
  const out = new Set();
  const want = String(scale ?? '').trim();
  if (!want) return out;
  for (const [psku, p] of card.parents) {
    if (String(p.sizeScale ?? '').trim() !== want) continue;
    for (const k of card.childrenOfParent.get(psku) ?? []) {
      const s = String(k.size ?? '').trim();
      if (s) out.add(s.toUpperCase());
    }
  }
  return out;
}

/**
 * שער המידה — האם המידה שאנחנו עומדים לכתוב קיימת בסרגל שנבחר.
 *
 * ⛔ הכישלון שהשער הזה נועד למנוע נמדד על מנת ISRAEL FEDERATION CAPS
 * (17/09/2026): ארנה כתבה `TU`, הסיווג בחר סרגל 74 — והמידה `TU` **אינה קיימת
 * באף בן בכרטיס**. הקובץ נראה תקין לחלוטין: מק"ט אב נכון, ברקוד נכון, מחיר
 * נכון, ומידה שלא תיקלט. `TU → OS` נוסף כהמרה מדודה ב-arena-invoice.js, אבל
 * המרה מטפלת רק בטוקן שכבר נמדד — **השער הוא מה שיתפוס את הבא.**
 *
 * שער ולא ניחוש: אין "המידה הכי דומה". מידה שאינה בסרגל נעצרת ונשאלת,
 * בדיוק כמו שדה סיווג שלא הוכרע (כלל 9).
 *
 * ⚠️ סרגל בלי אף בן בכרטיס אינו ראיה לכלום — אין מול מה להשוות, ולכן אין
 * אזהרה. אזהרה שנדלקת על היעדר מידע מלמדת להתעלם ממנה.
 */
function sizeGate(card, parents, rows) {
  const out = [];
  const scaleOf = new Map(parents.map((p) => [p.sku, p.classification?.sizeScale?.value]));
  for (const r of rows) {
    if (r.status !== 'newBoth' && r.status !== 'newChild') continue;
    const scale = scaleOf.has(r.parent)
      ? scaleOf.get(r.parent)
      : card.parents.get(r.parent)?.sizeScale;
    if (scale === null || scale === undefined || String(scale).trim() === '') continue;
    const known = sizesInScale(card, scale);
    if (!known.size) continue;
    const size = String(r.row.size ?? '').trim().toUpperCase();
    if (!size || known.has(size)) continue;
    out.push({
      row: r.row.row,
      parent: r.parent,
      scale: String(scale).trim(),
      size: String(r.row.size ?? '').trim(),
      sizeArena: r.row.sizeArena ?? null,
      known: [...known].sort(),
    });
  }
  return out;
}

export function planBatch({ invoice, card, codes, rounding = 'x99', selfBarcodes = false, profile = null }) {
  const learned = learnFromInvoice(card, invoice.rows);
  const rows = [];
  const parentsNeeded = new Map();

  for (const row of invoice.rows) {
    const parent = parentSku(row);
    const parentExists = parent ? card.parents.has(parent) : false;

    // `hasBarcode` is set by the invoice reader, but rows are also built by hand
    // — by the regression fixture, and by anything that normalises an invoice that
    // did not arrive as a SAP export. Deriving it from the barcode when it is
    // absent keeps a hand-built row from silently reading as customised.
    const hasBarcode = row.hasBarcode ?? !!String(row.ean ?? '').trim();

    // A customised row has no barcode of its own, so one is derived — and the
    // derived code is then looked up exactly like a real one, which is what
    // catches a cap that was already set up under this same stand-in.
    const selfCoded = !hasBarcode && selfBarcodes && !!parent;
    const barcode = selfCoded ? selfBarcode(row) : String(row.ean).trim();
    const child = barcode ? card.byBarcode.get(barcode) : undefined;

    let status;
    let why = '';
    if (!parent) {
      status = 'blocked';
      why = 'לא ניתן לגזור מק"ט אב — הדגם או קוד הצבע חסרים';
    } else if (!hasBarcode && !selfBarcodes) {
      status = 'blocked';
      why = 'אין ברקוד. למוצר קוסטומייז יש --self-barcode, שייצר ברקוד מהמק"ט';
    } else if (selfCoded && child) {
      status = 'blocked';
      why = 'הברקוד המקודד-עצמית ' + barcode + ' כבר קיים בכרטיס — הפריט כנראה הוקם';
    } else if (child && !child.isParent && child.parent && child.parent !== parent) {
      status = 'blocked';
      why = 'הברקוד קיים בכרטיס תחת אב אחר: ' + child.parent;
    } else if (child && !child.isParent) {
      status = 'exists';
      why = 'קיים — ' + child.sku;
    } else if (parentExists) {
      status = 'newChild';
      why = 'האב קיים, המידה הזאת לא';
    } else {
      status = 'newBoth';
      why = 'האב והבן חדשים';
    }

    rows.push({ row, parent, parentExists, child, status, why, barcode, selfCoded });

    if ((status === 'newBoth' || status === 'newChild') && !parentExists && !parentsNeeded.has(parent)) {
      parentsNeeded.set(parent, row);
    }
  }

  const parents = [...parentsNeeded.values()].map((row) => {
    const classification = classify(row, card, learned, undefined, profile);
    return {
      row,
      sku: parentSku(row),
      classification,
      unresolved: unresolved(classification),
      price: priceFromCost(row.price, rounding),
    };
  });

  const children = rows.filter((r) => r.status === 'newChild' || r.status === 'newBoth');
  const blocked = rows.filter((r) => r.status === 'blocked');

  const sizeProblems = sizeGate(card, parents, rows);

  return {
    rows,
    parents,
    children,
    blocked,
    sizeProblems,
    counts: {
      total: rows.length,
      exists: rows.filter((r) => r.status === 'exists').length,
      newChild: rows.filter((r) => r.status === 'newChild').length,
      newBoth: rows.filter((r) => r.status === 'newBoth').length,
      blocked: blocked.length,
      newParents: parents.length,
      selfCoded: rows.filter((r) => r.selfCoded && r.status !== 'blocked').length,
    },
    needsDecision: parents.filter((p) => p.unresolved.length),
  };
}

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

  return {
    rows,
    parents,
    children,
    blocked,
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

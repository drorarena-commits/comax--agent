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
 */
import { parentSku } from './arena-invoice.js';
import { classify, learnFromInvoice, unresolved } from './classify.js';
import { priceFromCost } from './pricing.js';

export function planBatch({ invoice, card, codes, rounding = 'x99' }) {
  const learned = learnFromInvoice(card, invoice.rows);
  const rows = [];
  const parentsNeeded = new Map();

  for (const row of invoice.rows) {
    const parent = parentSku(row);
    const child = card.byBarcode.get(String(row.ean).trim());
    const parentExists = parent ? card.parents.has(parent) : false;

    let status;
    let why = '';
    if (!parent) {
      status = 'blocked';
      why = 'לא ניתן לגזור מק"ט אב — הדגם או קוד הצבע חסרים';
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

    rows.push({ row, parent, parentExists, child, status, why });

    if ((status === 'newBoth' || status === 'newChild') && !parentExists && !parentsNeeded.has(parent)) {
      parentsNeeded.set(parent, row);
    }
  }

  const parents = [...parentsNeeded.values()].map((row) => {
    const classification = classify(row, card, learned);
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
    },
    needsDecision: parents.filter((p) => p.unresolved.length),
  };
}

/**
 * Deciding משפחה · סרגל מידות · דויזן · מגדר for a parent that does not exist yet.
 *
 * These four are the only fields on the setup sheet that are neither constant
 * nor copied from the invoice, and getting one wrong sets an item up in the
 * wrong place in Priority — which nobody notices until it is sold. So the
 * classifier is tiered, and it reports how it decided rather than just what it
 * decided:
 *
 *   STYLE  — a parent of the same Arena style already exists in the card. A new
 *            parent is usually just a new colour of a style Sport & More
 *            already carry, so this is the strong signal: on the 28.5.26
 *            invoice it covered 14 of 14 styles. Siblings that agree → high
 *            confidence; siblings that disagree → the majority, flagged.
 *
 *   BACKBONE — no same-style sibling. Fall back to what the Backbone levels on
 *            the invoice imply, learned by joining previous invoice rows to the
 *            card through the barcode. Good enough for סרגל / דויזן / מגדר.
 *            **Not** good enough for משפחה: MAN/Brief resolves to both 00603
 *            and 00602, WOMAN/One piece to both 00601 and 00600.
 *
 *   none   — refused. `value` is null and the caller must stop and ask Dror.
 *            Rule 9 of the project: "לא ידוע" is a refusal, not a guess.
 */
import { readFileSync } from 'node:fs';
import { parentSku as parentSkuOf } from './arena-invoice.js';
import { resolve } from 'node:path';
import { ROOT } from '../config.js';

export const CODES_PATH = resolve(ROOT, 'sportmore/reference/codes.json');
export const OVERRIDES_PATH = resolve(ROOT, 'sportmore/reference/overrides.json');

export function loadCodes() {
  return JSON.parse(readFileSync(CODES_PATH, 'utf8'));
}

const FIELDS = ['family', 'sizeScale', 'division', 'gender'];

/**
 * Values that mean "nobody classified this yet", not a classification.
 *
 * 370 of the 728 parents carry family `0` — "משפחת מוצר כללית" — and 62 carry
 * size scale `90B`, whose own name in the card is "לא לשימוש". Counting those
 * as votes is how the classifier first answered family `0` / scale `1` for the
 * COBRA CORE SWIPE goggles: the three correctly-filed siblings had been removed
 * for the test, and the two left standing were both placeholders. A placeholder
 * never wins a vote, and a field whose siblings are *all* placeholders is
 * refused rather than answered.
 */
const PLACEHOLDER = {
  family: new Set(['0', '00', '000', '0000', '00000']),
  sizeScale: new Set(['1', '90B', '0']),
  division: new Set(['0']),
  gender: new Set(['0']),
};

const isPlaceholder = (field, v) =>
  v === null || v === undefined || v === '' || PLACEHOLDER[field]?.has(String(v).trim().toUpperCase());

/**
 * Values Dror has fixed by hand, in `sportmore/reference/overrides.json`:
 *
 *   { "AR007964100": { "family": "00610", "sizeScale": "74" },
 *     "007450":      { "family": "00613" } }
 *
 * Keyed by parent מק"ט or by Arena style code — style is the useful one, since
 * the next colour of the same model will need the same answer. An override
 * always wins; it is the one place a human decision outranks the card.
 */
/**
 * A named set of classified-field values for a whole batch, from
 * `codes.json` → `profiles`. `caps` was lifted from the six customised caps
 * already in the card, every one of which carries family 00610, size scale 74,
 * division 14 and gender 30.
 *
 * Profiles exist because customised items defeat the style tier completely:
 * each cap style has exactly one parent, so a new federation order is always a
 * new style with no sibling to learn from, and the classifier refuses all four
 * fields. A profile is a declaration about the batch, not a guess about it.
 */
export function loadProfile(codes, name) {
  if (!name) return null;
  const p = codes?.profiles?.[name];
  if (!p) {
    const known = Object.keys(codes?.profiles || {}).join(' · ');
    throw new Error(
      `פרופיל לא מוכר: ${name}
${known ? `הפרופילים שקיימים: ${known}` : 'אין פרופילים ב-codes.json'}`
    );
  }
  const { note, ...values } = p;
  return values;
}

export function loadOverrides() {
  try {
    return JSON.parse(readFileSync(OVERRIDES_PATH, 'utf8'));
  } catch {
    return {};
  }
}

/** Most common value in a list, with how dominant it was. */
function majority(values, field) {
  const counts = new Map();
  for (const v of values) if (!isPlaceholder(field, v)) counts.set(v, (counts.get(v) || 0) + 1);
  if (!counts.size) return null;
  const sorted = [...counts].sort((a, b) => b[1] - a[1]);
  const total = values.filter((v) => !isPlaceholder(field, v)).length;
  return { value: sorted[0][0], n: sorted[0][1], total, unanimous: sorted.length === 1 };
}

/**
 * Learn Backbone → attributes by joining rows to the card through the barcode.
 * Called with every invoice row we can see, existing items included — those are
 * the training data, not noise.
 */
export function learnFromInvoice(card, rows) {
  const table = new Map();
  for (const r of rows) {
    const child = card.byBarcode.get(String(r.ean).trim());
    if (!child?.parent) continue;
    const parent = card.parents.get(child.parent);
    if (!parent) continue;
    const key = backboneKey(r);
    if (!key) continue;
    if (!table.has(key)) table.set(key, []);
    table.get(key).push(parent);
  }
  return table;
}

/**
 * Backbone levels 4 and 5 — gender-ish and garment-ish, the useful pair.
 *
 * Returns null when neither level is present. An all-blank key is not a weak
 * signal, it is no signal: pooling every row that happens to have empty
 * Backbone columns produces a majority drawn from unrelated products, and that
 * majority looks exactly as confident as a real one. It answered size scale 27
 * for a swim cap before this returned null instead.
 */
export function backboneKey(row) {
  const l4 = row.backbone?.[3];
  const l5 = row.backbone?.[4];
  if (!l4 && !l5) return null;
  return [l4 || '?', l5 || '?'].join(' / ');
}

/**
 * @param {object} row      one normalised invoice row
 * @param {object} card     from loadItemCard()
 * @param {Map} learned     from learnFromInvoice()
 * @returns {{family,sizeScale,division,gender, source, notes:string[]}}
 *          each field is `{ value, confidence: 'high'|'medium'|null, why }`
 */
export function classify(row, card, learned, overrides = loadOverrides(), profile = null) {
  const notes = [];
  const style = String(row.style || '').toUpperCase();
  const siblings = style
    ? [...card.parents.values()].filter((p) => p.sku.startsWith(`AR${style}`))
    : [];

  const out = { source: siblings.length ? 'style' : 'backbone', notes };
  const sku = `AR${style}`;
  // Ranked weakest to strongest. A profile is Dror declaring what kind of batch
  // this is — "these are customised caps" — so it outranks anything derived
  // from the card; an override names one style or one item and outranks even
  // that. Neither is inference, which is why both are allowed to win.
  const fixed = {
    ...(profile || {}),
    ...(overrides[style] || {}),
    ...(overrides[parentSkuOf(row)] || {}),
  };
  const fixedWhy = (field) =>
    (overrides[parentSkuOf(row)] || {})[field] !== undefined || (overrides[style] || {})[field] !== undefined
      ? 'נקבע ידנית ב-overrides.json'
      : 'לפי הפרופיל שנבחר למנה';

  for (const field of FIELDS) {
    if (fixed[field] !== undefined && fixed[field] !== null && fixed[field] !== '') {
      out[field] = { value: String(fixed[field]), confidence: 'high', why: fixedWhy(field) };
      continue;
    }
    if (siblings.length) {
      const m = majority(siblings.map((p) => p[field]), field);
      // משפחה is the field the card itself is inconsistent about, and every
      // classification error measured on the 28.5 batch was one: 00602 against
      // 00603, 00616 against 00617, 00600 against 00601. Siblings that disagree
      // about a family are not a majority worth acting on — they are a sign the
      // model spans two families, and that is Dror's call. Every other field is
      // happy with a majority.
      const usable = m && (field !== 'family' || m.unanimous);
      if (usable) {
        out[field] = {
          value: m.value,
          confidence: m.unanimous ? 'high' : 'medium',
          why: m.unanimous
            ? `כל ${m.total} האבות של דגם ${style} בכרטיס`
            : `רוב — ${m.n} מתוך ${m.total} האבות של דגם ${style}`,
        };
        if (!m.unanimous) notes.push(`${field}: האבות הקיימים של דגם ${style} לא מסכימים`);
        continue;
      }
    }

    const key = backboneKey(row);
    const pool = key ? learned.get(key) || [] : [];
    const m = majority(pool.map((p) => p[field]), field);

    // Family is the field the backbone cannot settle. Accept it only when every
    // observation agrees; a majority here has been wrong before.
    const needsUnanimous = field === 'family';
    if (m && (!needsUnanimous || m.unanimous)) {
      out[field] = {
        value: m.value,
        confidence: m.unanimous ? 'medium' : 'medium',
        why: `לפי ${key} — ${m.n} מתוך ${m.total} פריטים דומים`,
      };
    } else {
      out[field] = {
        value: null,
        confidence: null,
        why: (siblings.length ? `אין ערך אצל האבות של דגם ${style}` : `אין אב קיים לדגם ${style}`)
          + (key ? `, ו-${key} לא הכריע` : ', ואין Backbone בחשבונית להישען עליו'),
      };
      notes.push(`${field}: לא ידוע — צריך הכרעה ידנית`);
    }
  }

  return out;
}

/** Fields the classifier refused on. An empty list means the row is ready. */
export function unresolved(c) {
  return FIELDS.filter((f) => !c[f]?.value);
}

export { FIELDS as CLASSIFIED_FIELDS };

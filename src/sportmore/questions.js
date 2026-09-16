/**
 * Turning the classifier's refusals into one round of questions.
 *
 * The classifier refuses rather than guesses — rule 9 — and a batch of thirty
 * rows can easily refuse on four or five parents. Asking those one at a time
 * costs a round trip each, and Dror is usually answering from a phone with no
 * view of the item card. So every refusal in the batch is collected, numbered
 * once, and presented together: he replies "1=00616 2=00617" in a single
 * message and `sm -- answer` writes them all to overrides.json at once.
 *
 * One number is one *question*, not one parent — a parent that refused on both
 * משפחה and סרגל asks twice. Numbering per parent would make "1=00616"
 * ambiguous about which field it answers, and a misfiled size scale is exactly
 * the silent error the whole classifier exists to avoid.
 *
 * The numbering is derived, not stored: it is the order of `plan.needsDecision`
 * crossed with the fixed field order, so the same invoice and the same card
 * produce the same numbers on the next run. That is what lets `answer` accept a
 * bare number without a state file — and it is also why `answer` must be given
 * the same `--profile` / `--self-barcode` flags as the `plan` that asked.
 *
 * Two refusals are shown differently because they are different questions:
 *
 *   split      — there were candidates and they disagreed. Show them with the
 *                vote, so the answer is a choice between named options.
 *   no-signal  — nothing voted at all: no sibling of this style, or every
 *                sibling carrying a placeholder, and no Backbone to fall back
 *                on. There is nothing to propose, so the field's own code table
 *                is printed instead and Dror picks from a list rather than from
 *                memory.
 */
import { CLASSIFIED_FIELDS } from './classify.js';

export const FIELD_LABEL = {
  family: 'משפחה',
  sizeScale: 'סרגל מידות',
  division: 'דויזן',
  gender: 'מגדר',
};

/** Values that are in the card but must never be offered as an answer. */
const PLACEHOLDER_NOTE = {
  family: new Set(['0', '00', '000', '0000', '00000']),
  sizeScale: new Set(['1', '90B', '0']),
  division: new Set(['0']),
  gender: new Set(['0']),
};

/**
 * One numbered question per refused field — collapsed across parents that would
 * take the same answer.
 *
 * An invoice usually carries several colours of one model, and they refuse
 * identically: same style, same missing signal, same candidates. Since the
 * answer is written to overrides.json **by style code**, answering one of them
 * answers all of them — so asking four times would be four questions with one
 * real answer between them, and three of them would look unanswered afterwards.
 *
 * Two parents are only merged when the refusal is genuinely the same question:
 * same style, same field, same reason and the same candidates. A colour whose
 * Backbone differs keeps its own number.
 *
 * @returns {Array<{n,style,skus,desc,field,label,info}>}
 */
export function buildQuestions(plan) {
  const byKey = new Map();
  for (const p of plan.needsDecision) {
    for (const field of CLASSIFIED_FIELDS) {
      if (!p.unresolved.includes(field)) continue;
      const info = p.classification[field] || {};
      const style = String(p.row.style || '');
      const signature = [
        style || p.sku,
        field,
        info.reason || '',
        (info.candidates || []).map((c) => c.value + ':' + c.n).join(','),
      ].join('|');
      const existing = byKey.get(signature);
      if (existing) { existing.skus.push(p.sku); continue; }
      byKey.set(signature, {
        n: 0,
        style,
        skus: [p.sku],
        desc: String(p.row.styleDesc || p.row.articleDesc || '').trim(),
        field,
        label: FIELD_LABEL[field] || field,
        info,
      });
    }
  }
  const out = [...byKey.values()];
  out.forEach((q, i) => { q.n = i + 1; });
  return out;
}

const codeName = (codes, field, value) => codes?.[field]?.[String(value)]?.name || '';

/** The whole code table for one field, most-used first. */
export function codeTable(codes, field) {
  return Object.entries(codes?.[field] || {})
    .map(([value, meta]) => ({
      value,
      name: meta?.name || '',
      seen: Number(meta?.seen || 0),
      placeholder: PLACEHOLDER_NOTE[field]?.has(String(value).toUpperCase()),
    }))
    .sort((a, b) => b.seen - a.seen);
}

const padEnd = (s, n) => {
  const t = String(s ?? '');
  return t.length >= n ? t + ' ' : t + ' '.repeat(n - t.length);
};

/**
 * The whole round, as lines. Grouped by parent so the model is named once, but
 * numbered per question so an answer can never land on the wrong field.
 *
 * The code tables are printed once at the bottom rather than under each
 * question that needs one. A batch can refuse on twenty parents, and four
 * twenty-line tables repeated twenty times is not a list anyone picks from —
 * least of all on a phone, which is where these answers usually come from.
 */
export function renderQuestions(questions, codes) {
  const lines = [];
  const needTable = new Set();
  lines.push('');
  lines.push('⛔ ' + questions.length + ' שאלות סיווג פתוחות — קובץ ההקמה לא ייכתב עד שכולן ייענו.');
  lines.push('   לענות בהודעה אחת, לפי המספרים. למשל:  1=00616  2=74');

  let lastSku = null;
  for (const q of questions) {
    const groupKey = q.style || q.skus[0];
    if (groupKey !== lastSku) {
      lines.push('');
      lines.push('  דגם ' + q.style + ' — ' + (q.desc || '(אין תיאור)'));
      lines.push('    ' + (q.skus.length === 1 ? 'אב ' : q.skus.length + ' אבות: ') + q.skus.join(' · '));
      lastSku = groupKey;
    }

    const info = q.info || {};
    const cands = info.candidates || [];

    if (info.reason === 'split' && cands.length) {
      const unit = info.candidateSource === 'siblings' ? 'אחים' : 'פריטים דומים';
      const head = info.candidateSource === 'siblings'
        ? q.label + ' לא הוכרעה — האבות הקיימים של הדגם חלוקים:'
        : q.label + ' לא הוכרעה — Backbone ' + (info.backbone || '') + ' חלוק:';
      lines.push('    ' + q.n + '. ' + head);
      for (const c of cands) {
        lines.push('       ' + padEnd(c.n + ' ' + unit, 16) + '→  ' + padEnd(c.value, 8)
          + codeName(codes, q.field, c.value));
      }
      // Siblings that split are the common case, but the backbone can have its
      // own disagreement underneath. Showing it costs two lines and saves a
      // second question.
      if (info.candidateSource === 'siblings' && (info.backboneVotes || []).length) {
        lines.push('       וגם לפי Backbone ' + (info.backbone || '') + ': '
          + info.backboneVotes.map((c) => c.value + '×' + c.n).join('  ·  '));
      }
    } else {
      // No signal at all — nothing to propose, so the question says so plainly
      // and points at the field's table below.
      needTable.add(q.field);
      lines.push('    ' + q.n + '. ' + q.label + ' — אין אות: ' + (info.why || ''));
      lines.push('       אין מועמדים להציע. לבחור מתוך טבלת ' + q.label + ' שלמטה.');
    }
  }

  if (needTable.size) {
    lines.push('');
    lines.push('  ── טבלאות הקודים לשדות שאין בהם אות ──');
    for (const field of CLASSIFIED_FIELDS) {
      if (!needTable.has(field)) continue;
      lines.push('');
      lines.push('  ' + (FIELD_LABEL[field] || field) + ':');
      for (const c of codeTable(codes, field)) {
        lines.push('     ' + padEnd(c.value, 8) + padEnd(c.name || '—', 32)
          + padEnd('(' + c.seen + ' אבות)', 14)
          + (c.placeholder ? '← ערך דמה, לא לבחור' : ''));
      }
    }
  }

  lines.push('');
  lines.push('  לכתוב את התשובות:');
  lines.push('     npm run sm -- answer --invoice <אותו קובץ> 1=<ערך> 2=<ערך>');
  lines.push('  הן נשמרות ב-sportmore/reference/overrides.json לפי קוד דגם, ולכן');
  lines.push('  הצבע הבא של אותו דגם יקבל את אותה תשובה בלי לשאול שוב.');
  lines.push('');
  return lines;
}

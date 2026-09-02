/**
 * The shared document engine.
 *
 * Every sales document in Comax is the same four screens with different names:
 *
 *   <Doc>V      the list        — `#newRec` starts a new one
 *   <Doc>U      the header      — customer, warehouse, price list; `#OK` commits
 *   <Doc>LinesV the lines grid  — totals live here; `#OK` COMMITS THE DOCUMENT
 *   <Doc>LinesU the line dialog — one item; `#OkNew` saves and reopens
 *
 * Verified identical for Doc612 (הצעת מחיר) and Doc650 (חשבונית מס): both
 * expose `#newRec` on the list with the same toolbar, and the field ids match.
 * So the flow lives here once, and a profile only declares what differs.
 *
 * ⚠️ The one rule that must never be softened: on a **lines** screen `#OK` is
 * labelled "(Alt+e) קליטת חשבונית" and it commits the document. On a *header*
 * it only advances to the lines. `commitHeader` therefore refuses to click
 * unless the frame it is aimed at really is the header, and `finalize` is the
 * only function allowed to press the lines-screen `#OK`.
 */
import { dismissPopups, fillLookup, openProgram } from '../navigate.js';

/** A profile that has not been mapped yet must not be driven blind. */
export function assertMapped(profile, stage) {
  if (profile.mapped?.[stage]) return;
  throw new Error(
    `המסך "${stage}" של ${profile.label} לא מופה עדיין — לא מריץ עליו בעיוורון.\n` +
    `  למפות: npm run open-program -- ${profile.shortcut}  ואז  npm run snapshot -- ${profile.name}-${stage}\n` +
    `  ואז לעדכן את mapped ואת ה-id ב-src/documents/agents/${profile.name}/index.js`,
  );
}

const frameFor = (page, re) => page.frames().find((f) => re.test(f.url()));

/**
 * The open lines frame, for an agent that needs to read it itself.
 *
 * Exported because the totals block is richer than `readTotals` exposes — the
 * price list declares the VAT regime down in the footer — and an agent that
 * gates on that needs the frame, not a pre-digested three-field summary.
 */
export const linesFrame = (ctx, profile) => frameFor(ctx.page, profile.frames.linesGrid);

/** Open the document's own program and return its list frame. */
export async function openList(ctx, profile) {
  assertMapped(profile, 'list');
  const { frame } = await openProgram(ctx, profile.shortcut, { expect: profile.frames.list });
  if (!frame) throw new Error(`${profile.label}: מסך הרשימה לא נפתח.`);
  return frame;
}

/**
 * Press "הוספה" and hand back the header form.
 *
 * The new frame is identified by diffing the frame list, because a header for
 * the same document type may already be open from an earlier run.
 */
export async function startNew(ctx, profile, listFrame) {
  assertMapped(profile, 'header');
  const { page, human, logger } = ctx;

  const before = new Set(page.frames().map((f) => f.url()));
  await human.click(profile.header.new, { scope: listFrame, label: `הוספה (${profile.label} חדש)` });
  await human.settle('header form');

  const frame = page.frames().find((f) => profile.frames.header.test(f.url()) && !before.has(f.url()))
    ?? frameFor(page, profile.frames.header);
  if (!frame) throw new Error(`${profile.label}: טופס הכותרת לא נפתח.`);

  // A preview only — the number the document actually receives is read off the
  // lines screen after the header is committed.
  const preview = await frame.locator(profile.header.docId).innerText().catch(() => null);
  logger.step(profile.name, `מספר שהוקצה (תצוגה מקדימה): ${preview?.trim() || '(לא נקרא)'}`);
  return { frame, preview: preview?.trim() ?? null };
}

/** Fill the header. Explicit values win over whatever the customer card prefills. */
export async function fillHeader(ctx, profile, frame, input) {
  const { human } = ctx;
  const H = profile.header;

  const customer = await fillLookup(ctx, { frame, field: H.customer, value: String(input.customer), what: 'לקוח' });
  await dismissPopups(ctx); // a customer with remarks pops a dialog over the form

  if (input.store) await fillLookup(ctx, { frame, field: H.store, value: input.store, what: 'מחסן' });
  if (input.priceList) await fillLookup(ctx, { frame, field: H.priceList, value: input.priceList, what: 'מחירון' });
  if (input.date) await human.type(H.date, input.date, { scope: frame, label: 'תאריך' });
  if (input.agent) await fillLookup(ctx, { frame, field: H.agent, value: input.agent, what: 'סוכן' });
  if (input.details) await human.type(H.details, input.details, { scope: frame, label: 'פרטים' });
  await dismissPopups(ctx);

  return customer;
}

/** What the header actually holds — for the log, and for the human to review. */
export async function readHeader(profile, frame) {
  const H = profile.header;
  const read = async (sel) => (sel ? frame.locator(sel).inputValue().catch(() => null) : null);
  return {
    מסמך: await frame.locator(H.docId).innerText().catch(() => null),
    תאריך: await read(H.date),
    לקוח: await read(H.customer),
    סוכן: await read(H.agent),
    פרטים: await read(H.details),
    מחסן: await read(H.store),
    מחירון: await read(H.priceList),
  };
}

/**
 * Commit the header and move to the lines.
 *
 * The frame is re-checked against the *header* pattern first. Aiming this at a
 * lines frame would press the button that files the document.
 */
export async function commitHeader(ctx, profile, frame) {
  const { human } = ctx;
  if (!profile.frames.header.test(frame.url())) {
    throw new Error(
      `סירוב: ביקשו לאשר כותרת אבל ה-frame הוא ${frame.url().split('/').pop()?.split('?')[0]}. ` +
      `${profile.header.ok} במסך שורות קולט את המסמך.`,
    );
  }
  await human.click(profile.header.ok, { scope: frame, label: 'אישור הכותרת' });
  await human.settle(`${profile.name} created`);
  await dismissPopups(ctx);
}

/** The live document number, read off the lines grid. */
export async function readDocNumber(ctx, profile) {
  const grid = frameFor(ctx.page, profile.frames.linesGrid);
  if (!grid) return null;
  try {
    const m = /מספר:\s*\(?\s*(\d+)/.exec(await grid.innerText('body'));
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/**
 * Add one line.
 *
 * `#OkNew` saves and reopens the dialog, so a whole document goes in one pass.
 * Never touch `#chg` — it toggles the item *type*, it does not open a picker.
 */
export async function addLine(ctx, profile, item, { index, last }) {
  assertMapped(profile, 'lines');
  const { page, human, logger } = ctx;
  const L = profile.line;

  const frame = frameFor(page, profile.frames.lineForm);
  if (!frame) throw new Error(`${profile.label}: דיאלוג הוספת שורה לא פתוח.`);

  logger.step('line', `שורה ${index}: ${item.code ?? item.name}`);
  await fillLookup(ctx, { frame, field: L.item, value: String(item.code ?? item.name), what: 'פריט' });
  await dismissPopups(ctx);

  await human.type(L.qty, String(item.qty ?? 1), { scope: frame, label: 'כמות' });
  if (item.price != null) await human.type(L.price, String(item.price), { scope: frame, label: 'מחיר' });
  if (item.discount != null) await human.type(L.discount, String(item.discount), { scope: frame, label: '% הנחה' });
  if (item.remark && L.remark) await human.type(L.remark, item.remark, { scope: frame, label: 'הערה' });

  const read = async (sel) => frame.locator(sel).inputValue().catch(() => null);
  const line = {
    item: await read(L.item),
    qty: await read(L.qty),
    price: await read(L.price),
    discount: await read(L.discount),
    amount: await read(L.amount),
  };

  await human.click(last ? L.ok : L.okNew, {
    scope: frame,
    label: last ? 'אישור השורה' : 'אישור + שורה חדשה',
  });
  await human.settle(`line ${index} saved`);
  await dismissPopups(ctx);
  return line;
}

/** Totals at the foot of the lines grid. */
export async function readTotals(ctx, profile) {
  const grid = frameFor(ctx.page, profile.frames.linesGrid);
  if (!grid) return {};
  const read = async (sel) => grid.locator(sel).inputValue().catch(() => null);
  return {
    beforeVat: await read(profile.totals.beforeVat),
    vat: await read(profile.totals.vat),
    total: await read(profile.totals.total),
  };
}

/**
 * File the document. This is the irreversible step and the only place allowed
 * to press `#OK` on a lines screen.
 */
export async function finalize(ctx, profile) {
  const { page, human, logger } = ctx;
  const grid = frameFor(page, profile.frames.linesGrid);
  if (!grid) throw new Error(`${profile.label}: מסך השורות לא פתוח — אין מה לקלוט.`);

  await human.click(profile.line.ok, { scope: grid, label: profile.finalizeLabel });
  await human.settle('confirm dialog');

  const dlg = frameFor(page, profile.frames.closeDialog ?? /Close|Kbl|Ishur/i);
  if (dlg) {
    await human.click('#OK', { scope: dlg, label: `אישור ${profile.finalizeLabel}` });
    await human.settle('filed');
  }
  await dismissPopups(ctx);
  logger.step(profile.name, `${profile.label} נקלט`);
}

/**
 * Leave a document without filing it.
 *
 * `#DoExit` on the lines, then `#Cancel` on the header — the route
 * customer-history proved safe. Never `#OK`.
 */
export async function backOut(ctx, profile) {
  const { page, human, logger } = ctx;
  const grid = frameFor(page, profile.frames.linesGrid);
  if (grid) {
    await human.click('#DoExit', { scope: grid, label: 'יציאה מהשורות בלי קליטה' }).catch(() => {});
    await human.settle('left lines');
  }
  const header = frameFor(page, profile.frames.header);
  if (header) {
    await human.click('#Cancel', { scope: header, label: 'ביטול הכותרת' }).catch(() => {});
    await human.settle('closed');
  }
  logger.step(profile.name, 'יצאנו בלי לקלוט');
}

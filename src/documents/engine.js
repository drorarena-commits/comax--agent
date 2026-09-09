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
import { dismissPopups, fillLookup, framePath, openProgram } from '../navigate.js';
import { resolveWholesale, assertWholesaleLanded } from './wholesale.js';

/** A profile that has not been mapped yet must not be driven blind. */
export function assertMapped(profile, stage) {
  if (profile.mapped?.[stage]) return;
  throw new Error(
    `המסך "${stage}" של ${profile.label} לא מופה עדיין — לא מריץ עליו בעיוורון.\n` +
    `  למפות: npm run open-program -- ${profile.shortcut}  ואז  npm run snapshot -- ${profile.name}-${stage}\n` +
    `  ואז לעדכן את mapped ואת ה-id ב-src/documents/agents/${profile.name}/index.js`,
  );
}

/**
 * Find an open frame by its screen, matching on the **path only**.
 *
 * Max2000 puts the parent frame's name in the query string, so a full-URL match
 * reads frames that merely mention another screen. This is not theoretical: the
 * transfer header carries `SwNoClose=0`, the engine's default close-dialog
 * pattern `/Close|Kbl|Ishur/i` matched *that*, and `finalize` on 4700239 looked
 * for `#PrintCopies` in the header, pressed the header's own `#OK`, and then
 * reported the document unfiled while its real confirmation dialog sat open on
 * screen. Same shape as `/Doc650_ShihzurP/` catching `Doc650_HtmlP_T13.asp`.
 */
const frameFor = (page, re) => page.frames().find((f) => re.test(framePath(f.url())));

/** The same path-only test, for the places that hold a frame rather than find one. */
const isScreen = (re, frame) => re.test(framePath(frame.url()));

/**
 * The open lines frame, for an agent that needs to read it itself.
 *
 * Exported because the totals block is richer than `readTotals` exposes — the
 * price list declares the VAT regime down in the footer — and an agent that
 * gates on that needs the frame, not a pre-digested three-field summary.
 */
export const linesFrame = (ctx, profile) => frameFor(ctx.page, profile.frames.linesGrid);

/**
 * Open the document's own program and return its list frame.
 *
 * A profile that declares `program` gets the path as a fallback for a desktop
 * that no longer carries its icon; one that does not behaves exactly as before.
 */
export async function openList(ctx, profile) {
  assertMapped(profile, 'list');
  const { frame } = await openProgram(ctx, profile.shortcut, {
    expect: profile.frames.list,
    program: profile.program ?? null,
  });
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

  const frame = page.frames().find((f) => isScreen(profile.frames.header, f) && !before.has(f.url()))
    ?? frameFor(page, profile.frames.header);
  if (!frame) throw new Error(`${profile.label}: טופס הכותרת לא נפתח.`);

  // A preview only — the number the document actually receives is read off the
  // lines screen after the header is committed.
  const preview = await frame.locator(profile.header.docId).innerText().catch(() => null);
  logger.step(profile.name, `מספר שהוקצה (תצוגה מקדימה): ${preview?.trim() || '(לא נקרא)'}`);
  return { frame, preview: preview?.trim() ?? null };
}

/** Fill the header. Explicit values win over whatever the customer card prefills. */
/**
 * Did the field actually take what we asked for?
 *
 * Comax normalises as it stores: `1/1/2026` comes back `01/01/2026`, `129.7`
 * comes back `129.70`, `1016.42` comes back `1,016.42`. A strict equality check
 * would fail on every one of those while they are all correct, which is exactly
 * why the old code only *reported* the read-back instead of acting on it.
 *
 * So the comparison is normalised three ways, in order: as text, as a number,
 * as a date. Anything that still differs is a real difference.
 */
const normText = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

const normNumber = (v) => {
  const t = normText(v).replace(/,/g, '');
  if (!t || !/^-?\d*\.?\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const normDate = (v) => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(normText(v));
  if (!m) return null;
  const yy = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}/${yy}`;
};

function sameValue(want, got) {
  const a = normText(want);
  const b = normText(got);
  if (a === b) return true;

  const na = normNumber(a);
  const nb = normNumber(b);
  // half an agora: enough for 129.7 vs 129.70, not enough to hide a real gap
  if (na !== null && nb !== null) return Math.abs(na - nb) < 0.005;

  const da = normDate(a);
  const db = normDate(b);
  if (da && db) return da === db;

  return false;
}

/**
 * Read every field we wrote back off the screen, and refuse to go on if one of
 * them is holding something else.
 *
 * "I typed it" was never proof that it landed. Comax rejects values, rounds
 * them, and quietly puts a field back the way it was — and until now the
 * document engine read the fields back only to print them. `customer-movements`
 * has had a gate like this since it was written, and it is the reason a report
 * has never gone out on the wrong filter.
 *
 * Throwing is the safe direction. A false positive stops a run and shows why;
 * a miss files a document with the wrong number on it. Rule 9 — "not known is a
 * refusal, not a guess".
 */
/**
 * מה האלמנט הזה בכלל, כשהשער נופל עליו.
 *
 * "ביקשנו X ובשדה ריק" לא אומר למי שקורא אם השדה קיים, אם הוא מוסתר, אם הוא
 * לקריאה בלבד, אם יש שניים כאלה, או אם הוא בכלל לא input. נמדד 05/09/2026 על
 * `#Remark` בשורת הצעת המחיר: השדה נקרא בהצלחה, מחזיר ריק, והשאלה מי הוא נשארה
 * פתוחה כי ההודעה לא תיארה אותו. מתואר רק בכישלון — בזרימה תקינה זה עלות מיותרת.
 */
async function describeField(frame, selector) {
  try {
    return await frame.evaluate((sel) => {
      const all = [...document.querySelectorAll(sel)];
      return {
        כמה: all.length,
        אלמנטים: all.slice(0, 3).map((el) => ({
          tag: el.tagName,
          type: el.getAttribute('type'),
          name: el.getAttribute('name'),
          maxLength: el.maxLength > 0 ? el.maxLength : null,
          readOnly: el.readOnly ?? null,
          disabled: el.disabled ?? null,
          מוסתר: el.offsetParent === null,
          value: 'value' in el ? el.value : null,
          onchange: el.getAttribute('onchange'),
          onblur: el.getAttribute('onblur'),
        })),
        frame: location.pathname.split('/').pop(),
      };
    }, selector);
  } catch (e) {
    return { שגיאה: e.message.split('\n')[0] };
  }
}
export async function assertFields(frame, wanted, what) {
  const checked = {};
  const mismatches = [];
  const unreadableFields = [];

  for (const [selector, want] of Object.entries(wanted)) {
    if (want === null || want === undefined || !selector) continue;

    // "Could not read it" and "it is empty" are different answers, and
    // collapsing them is how a gate lies. `inputValue()` throws on anything
    // that is not an <input>/<textarea>/<select> — a contenteditable, a div, an
    // element in a nested frame — and a bare `.catch(() => null)` turns that
    // into an empty string that looks exactly like a value that did not land.
    // Measured 05/09/2026 on the quote line screen: `#Remark` reads back empty
    // both when typed and when pasted, and until this is separated we cannot
    // tell whether the remark is being lost or merely being read wrong.
    let got = null;
    let unreadable = null;
    try {
      got = await frame.locator(selector).inputValue();
    } catch (e) {
      unreadable = e.message.split('\n')[0];
    }

    checked[selector] = unreadable
      ? { ביקשנו: String(want), בשדה: null, שגיאתקריאה: unreadable }
      : { ביקשנו: String(want), בשדה: got };

    if (unreadable) {
      unreadableFields.push(`${selector}: לא ניתן לקרוא את השדה — ${unreadable}`);
    } else if (!sameValue(want, got)) {
      const desc = await describeField(frame, selector);
      // ומי עוד מחזיק את הסלקטור הזה? אם אותו מסך פתוח פעמיים, כתבנו לעותק
      // אחד וקומקס מציג את השני — וזה נראה בדיוק כמו ערך שנעלם.
      const everywhere = [];
      for (const f of frame.page().frames()) {
        const v = await f
          .evaluate((sel) => {
            const all = [...document.querySelectorAll(sel)];
            return all.length ? { כמה: all.length, ערכים: all.map((e) => e.value) } : null;
          }, selector)
          .catch(() => null);
        if (v) everywhere.push({ frame: f.url().split('/').pop().split('?')[0], ...v });
      }
      mismatches.push(
        `${selector}: ביקשנו ${JSON.stringify(String(want))} ובשדה ${JSON.stringify(got)}` +
          `\n      ${JSON.stringify(desc)}` +
          `\n      בכל ה-frames: ${JSON.stringify(everywhere)}`,
      );
    }
  }

  // A field we cannot read is not a field we can vouch for. Stopping is still
  // the safe direction, but the message has to say which problem this is, or
  // the next person debugs the wrong thing.
  if (unreadableFields.length) {
    throw new Error(
      `${what}: לא הצלחתי לקרוא שדה שכתבתי אליו — עוצר, לא מנחש.\n  ` +
        unreadableFields.join('\n  ') +
        '\n  ייתכן שהסלקטור מצביע על אלמנט שאינו input, או על frame אחר.' +
        '\n  זה לא אומר שהערך לא נשמר — זה אומר שאי אפשר לאמת אותו.',
    );
  }

  if (mismatches.length) {
    throw new Error(
      `${what}: הטופס לא מחזיק את מה שביקשנו — עוצר לפני שממשיכים.\n  ` +
        mismatches.join('\n  ') +
        '\n  לא נוצר מסמך. לבדוק את המסך ולהריץ שוב.',
    );
  }

  return checked;
}
export async function fillHeader(ctx, profile, frame, input) {
  const { human } = ctx;
  const H = profile.header;

  const customer = await fillLookup(ctx, { frame, field: H.customer, value: String(input.customer), what: 'לקוח' });
  await dismissPopups(ctx); // a customer with remarks pops a dialog over the form

  if (input.store) await fillLookup(ctx, { frame, field: H.store, value: input.store, what: 'מחסן' });
  if (input.priceList) await fillLookup(ctx, { frame, field: H.priceList, value: input.priceList, what: 'מחירון' });
  if (input.date) await human.type(H.date, input.date, { scope: frame, label: 'תאריך' });
  if (input.agent) await fillLookup(ctx, { frame, field: H.agent, value: input.agent, what: 'סוכן' });
  // Paste rather than type: this is long free text, and typing it costs
  // ~121ms per character (measured 05/09/2026). Dates, quantities and
  // prices deliberately keep typing — see the note in human.type().
  if (input.details) await human.type(H.details, input.details, { scope: frame, label: 'פרטים', paste: true });
  await dismissPopups(ctx);

  // Only the fields this function wrote. The lookups went through `fillLookup`,
  // which resolves and confirms its own value.
  await assertFields(frame, { [H.date]: input.date, [H.details]: input.details }, `${profile.label} — כותרת`);

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
  if (!isScreen(profile.frames.header, frame)) {
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
    const body = await grid.innerText('body');

    /*
     * ⚠️ RTL serialisation puts the number **before** its label.
     *
     * The old pattern was `/מספר:\s*\(?\s*(\d+)/` — label first, number after.
     * What `innerText` actually returns is the other way round:
     *
     *   "06/09/2026 :מתאריך   (6500086)  :חשבונית מספר"
     *
     * so it matched nothing and every invoice came back with an empty number.
     * Measured on 6500086, 06/09/2026: the document was created correctly and
     * simply could not say what it was called — which also means nothing
     * downstream could verify or email it.
     *
     * Same trap `priceListFrom()` in document-totals.js documents for the price
     * list footer. So: find the line the label is on, then take the number in
     * parentheses from it, whichever side it fell.
     */
    const line = body.split(/\r?\n/).find((l) => /מספר/.test(l));
    if (!line) return null;
    return (/\((\d{4,})\)/.exec(line) ?? /מספר:?\s*\(?\s*(\d{4,})/.exec(line) ?? [])[1] ?? null;
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

  /*
   * מחיר סיטונאי — הברוטו נקרא חי, כאן, ולא מחושב מראש.
   *
   * ⚠️ The `Tab` is the mechanism, not politeness: Comax computes the line's
   * gross when focus leaves the quantity, and without it `#Mhr` still holds the
   * previous item's number. Reading it a moment too early is how a wholesale
   * price gets computed off the wrong base — silently, since every field looks
   * filled afterwards.
   *
   * The catalog cannot stand in for this read. `content/מלאי-מלא-*.csv` holds
   * the **net** after the standard discount (289.90 × 0.8275 = 239.89); half of
   * that is 120 where the rule gives 145.
   *
   * `resolveWholesale` decides whether the rule applies at all — it does when
   * the price list the document declares is marked `wholesale` in
   * knowledge/lists.json and the caller gave no explicit price. A transfer
   * declares "לפי מחירון: לא נבחר", so this costs it one field read and
   * changes nothing.
   */
  // `priced: false` (תעודת העברה) opts a document out entirely: its price
  // column is Comax's bookkeeping between two of our own warehouses, and
  // nobody is charged it. Without this the rule would be one company-default
  // away from halving prices inside a stock document.
  const offered = { price: null, discount: null };
  if (profile.priced !== false) {
    await human.press('Tab', { label: 'יציאה משדה הכמות' });
    await human.think('price recalculation');
    offered.price = await frame.locator(L.price).inputValue().catch(() => null);
    offered.discount = await frame.locator(L.discount).inputValue().catch(() => null);
    logger.step('auto', `קומקס הציע: מחיר ${offered.price} · הנחה ${offered.discount}`);
  }

  const gross = Number(String(offered.price ?? '').replace(/[^\d.-]/g, ''));
  const { price, discount, plan } = profile.priced === false
    ? { price: item.price, discount: item.discount, plan: null }
    : await resolveWholesale({
      logger,
      grid: frameFor(page, profile.frames.linesGrid),
      gross: Number.isFinite(gross) ? gross : null,
      item,
    });

  // Tab after each, for the same reason as above: Comax recomputes `#Scm` on
  // blur, and the read-back below is only worth anything once it has.
  if (price != null) {
    await human.type(L.price, String(price), { scope: frame, label: 'מחיר' });
    await human.press('Tab', { label: 'יציאה משדה המחיר' });
    await human.think('amount recalculation');
  }
  if (discount != null) {
    await human.type(L.discount, String(discount), { scope: frame, label: '% הנחה' });
    await human.press('Tab', { label: 'יציאה משדה ההנחה' });
    await human.think('discount applied');
  }
  // ⚠️ `#Remark` בולע את הכתיבה הראשונה.
  //
  // נמדד 05/09/2026 על `Doc612LinesU`: הוא `<textarea>` יחיד בכל הדף, גלוי,
  // לא disabled ולא readOnly, maxlength 500 — ובכל זאת הכתיבה הראשונה אליו לא
  // נשארת. לא בהקלדה תו-תו, לא ב-`insertText`, ולא ב-`fill` ברמת ה-DOM שאינה
  // תלויה במיקוד. המתנה של שנייה וחצי לא עוזרת. **כתיבה שנייה נתפסת מיד:**
  //
  //   לפני כתיבה .......... ""
  //   מיד אחרי fill ....... ""
  //   אחרי 1.5 שניות ...... ""
  //   אחרי כתיבה שנייה .... "בדיקת מיפוי"
  //
  // ככל הנראה הטופס מאתחל את השדה אחרי חיפוש הפריט. הסיבה המדויקת לא ידועה,
  // ולכן זו לא "כתיבה כפולה ליתר ביטחון" אלא לולאה שקוראת ומפסיקה כשנתפס —
  // אם קומקס יתקן את זה, הלולאה תסתיים אחרי סיבוב אחד מעצמה.
  //
  // זה גם מסביר למה הערות שורה נעלמו עד היום בלי שאיש ידע: הקוד הישן הקליד
  // פעם אחת וקרא בחזרה רק כדי להדפיס ללוג.
  if (item.remark && L.remark) {
    const field = frame.locator(L.remark);
    const wanted = String(item.remark);
    let landed = false;
    for (let attempt = 1; attempt <= 3 && !landed; attempt++) {
      await field.fill(wanted);
      landed = (await field.inputValue().catch(() => null)) === wanted;
      if (!landed) logger.step('הערה', `הכתיבה ה-${attempt} לא נתפסה — כותב שוב`);
    }
    logger.step('הערה', landed ? `נכתבה: ${wanted}` : 'לא נתפסה — השער יעצור');
  }

  // Same gate as the header, before the line is committed. A quantity or a
  // price that did not land is money on a real document.
  // `price`/`discount`, not `item.price`/`item.discount` — under a wholesale
  // price list those are the halved price and the zeroed discount, and checking
  // the caller's (absent) values would check nothing at all.
  await assertFields(
    frame,
    { [L.qty]: item.qty ?? 1, [L.price]: price, [L.discount]: discount, [L.remark]: item.remark },
    `${profile.label} — שורה ${index}`,
  );

  const read = async (sel) => frame.locator(sel).inputValue().catch(() => null);
  const line = {
    item: await read(L.item),
    qty: await read(L.qty),
    price: await read(L.price),
    discount: await read(L.discount),
    amount: await read(L.amount),
    gross: plan ? offered.price : null,
    wholesale: plan,
  };

  // The arithmetic is confirmed off the live fields, not assumed — Comax can
  // reinstate a standard discount on blur, and a line that is 18% off looks
  // entirely ordinary in the document afterwards.
  assertWholesaleLanded(plan, line, logger);

  await human.click(last ? L.ok : L.okNew, {
    scope: frame,
    label: last ? 'אישור השורה' : 'אישור + שורה חדשה',
  });
  await human.settle(`line ${index} saved`);
  await dismissPopups(ctx);
  return line;
}

/* ── עריכת שורה קיימת ──────────────────────────────────────────────────── */

/**
 * Bring the row containing `match` onto the visible page, and hand back its cell.
 *
 * The grid paints **10 rows a page** and says nothing about the rest, so a
 * document with more lines than that shows a page that looks like the whole
 * thing. Paging is `#first` / `#prev` / `#next` / `#last` — real element ids.
 *
 * ⚠️ NOT `img:text-is("דף הבא")`. `knowledge/screens/*.txt` prints that selector,
 * and it can never match: an `<img>` has no text content, so the label the
 * snapshot shows comes from an attribute. Measured 06/09/2026 — the text
 * selector matched nothing, `count()` returned 0, and a twenty-unit document
 * was read as eight. Take ids from the `.json` snapshot, not the pretty `.txt`.
 */
export async function findLineRow(ctx, profile, match, { maxPages = 20 } = {}) {
  const { human, logger } = ctx;
  const grid = frameFor(ctx.page, profile.frames.linesGrid);
  if (!grid) throw new Error(`${profile.label}: מסך השורות לא פתוח.`);

  const cell = `td:text-is(${JSON.stringify(String(match))})`;

  if (await grid.locator('#first').count().catch(() => 0)) {
    await human.click('#first', { scope: grid, label: 'לדף הראשון' }).catch(() => {});
    await human.settle('first page');
  }

  for (let page = 0; page < maxPages; page++) {
    if (await grid.locator(cell).count().catch(() => 0)) {
      logger.step('שורה', `${match} נמצא בדף ${page + 1}`);
      return { grid, cell };
    }
    if (!(await grid.locator('#next').count().catch(() => 0))) break;
    await human.click('#next', { scope: grid, label: 'לדף הבא' });
    await human.settle(`page ${page + 2}`);
  }

  throw new Error(
    `לא מצאתי שורה עם "${match}" ברשת השורות של ${profile.label}.\n`
    + '  עברתי על כל הדפים. לבדוק שהמסמך הנכון פתוח ושהקוד הוא כפי שהוא מוצג ברשת.',
  );
}

/**
 * אישור שורה — ורק בדיאלוג השורה.
 *
 * 🚨 There are three different `#OK` in three frames of the same document:
 *
 *   Doc650U      אישור            — advances to the lines
 *   Doc650LinesV `(Alt+e) קליטת חשבונית` — **files it. Moves stock. No undo.**
 *   Doc650LinesU אישור            — saves the line
 *
 * `pressOk` in customer-history guards the header and `commitHeader` guards
 * itself, but nothing guarded *this* one: a single wrong `scope` and saving a
 * line issues the invoice instead. `human.click` takes the scope it is handed.
 * So the check lives here, in code.
 */
async function pressLineOk(ctx, frame, profile, label) {
  const url = frame.url();
  if (!profile.frames.lineForm.test(framePath(url))) {
    throw new Error(
      `סירוב לאשר שורה מחוץ לדיאלוג השורה — ה-frame הוא ${framePath(url).split('/').pop()}.\n`
      + '  ברשת השורות אותו #OK הוא "קליטת חשבונית": הוא קולט את המסמך ומזיז מלאי, ואין ביטול.',
    );
  }
  await ctx.human.click(profile.line.ok, { scope: frame, label });
}

/**
 * פתיחת שורה שמורה ועדכון השדות שנמסרו.
 *
 * The way in is a **double-click on the row's cell** — Dror's own hand motion,
 * shown 06/09/2026. There is no `#editRec` on this grid and the mapping
 * snapshot only ever caught `Doc650LinesU` in `Mode='ADD'`, so this was
 * genuinely unknown territory until he demonstrated it.
 *
 * Only the fields actually passed are written; everything else on the line is
 * left exactly as Comax has it.
 *
 * A **gift line** is `price: <consumer price>` + `discount: 100` — the price
 * goes back up to what a customer would pay and the discount takes all of it,
 * so the item still appears on the invoice with its real value and costs zero.
 * Comax then raises `חריגה ממחירון מינימום ! האם להמשיך ?`, which `browser.js`
 * accepts and logs.
 */
export async function editLine(ctx, profile, { match, price, discount, remark }) {
  assertMapped(profile, 'lines');
  const { page, human, logger } = ctx;
  const L = profile.line;

  const { grid, cell } = await findLineRow(ctx, profile, match);

  await human.doubleClick(cell, { scope: grid, label: `פתיחת שורה ${match} לעריכה` });
  await human.settle('line dialog opening');
  await dismissPopups(ctx);

  let frame = null;
  for (let i = 0; i < 5 && !frame; i++) {
    frame = frameFor(page, profile.frames.lineForm);
    if (!frame) await human.think('waiting for the line dialog');
  }
  if (!frame) {
    throw new Error(
      `דאבל-קליק על ${match} לא פתח את דיאלוג השורה (${profile.frames.lineForm}).\n`
      + '  היציאה הבטוחה: #DoExit ברשת ואז #Cancel בכותרת.',
    );
  }

  const before = {
    item: await frame.locator(L.item).inputValue().catch(() => null),
    qty: await frame.locator(L.qty).inputValue().catch(() => null),
    price: await frame.locator(L.price).inputValue().catch(() => null),
    discount: await frame.locator(L.discount).inputValue().catch(() => null),
  };
  logger.step('שורה', `לפני: ${before.item} · כמות ${before.qty} · מחיר ${before.price} · הנחה ${before.discount}`);

  // Tab after each, for the reason it is everywhere else in this file: Comax
  // recomputes on blur, and a value read before that is the previous one.
  if (price != null) {
    await human.type(L.price, String(price), { scope: frame, label: 'מחיר' });
    await human.press('Tab', { label: 'יציאה משדה המחיר' });
    await human.think('amount recalculation');
  }
  if (discount != null) {
    await human.type(L.discount, String(discount), { scope: frame, label: '% הנחה' });
    await human.press('Tab', { label: 'יציאה משדה ההנחה' });
    await human.think('discount applied');
  }
  // Same swallow-the-first-write loop as `addLine`. Measured on Doc612; whether
  // Doc650 does it too was never tested, so the loop reports which write landed.
  if (remark != null && L.remark) {
    const field = frame.locator(L.remark);
    const wanted = String(remark);
    let landed = false;
    for (let attempt = 1; attempt <= 3 && !landed; attempt++) {
      await field.fill(wanted);
      landed = (await field.inputValue().catch(() => null)) === wanted;
      if (!landed) logger.step('הערה', `הכתיבה ה-${attempt} לא נתפסה — כותב שוב`);
      else if (attempt > 1) logger.step('הערה', `נתפסה בכתיבה ${attempt} — כמו Doc612`);
    }
    if (landed && !remark) logger.step('הערה', 'ריקה');
  }

  await assertFields(
    frame,
    { [L.price]: price, [L.discount]: discount, [L.remark]: remark },
    `${profile.label} — עריכת שורה ${match}`,
  );

  const read = async (sel) => frame.locator(sel).inputValue().catch(() => null);
  const after = {
    item: await read(L.item),
    qty: await read(L.qty),
    price: await read(L.price),
    discount: await read(L.discount),
    remark: L.remark ? await read(L.remark) : null,
    amount: await read(L.amount),
  };

  await logger.shot(page, `line-${match}-edited`);
  await pressLineOk(ctx, frame, profile, 'אישור השורה');
  await human.settle('line saved');
  await dismissPopups(ctx);

  logger.step('שורה', `אחרי: מחיר ${after.price} · הנחה ${after.discount} · סכום ${after.amount}`);
  return { before, after };
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
    // How many copies this document must claim to print.
    //
    // A quote takes 0 and is done. **A tax invoice refuses 0** — Comax answers
    // "חובת הדפסה לפחות עותק אחד !" and simply does not file, which looks like
    // a successful click and is not. So the count is per document.
    //
    // Asking for a copy is safe because `browser.js` neutralises `window.print`
    // (`suppressPrintDialog`, on by default): the document is already committed
    // by the time printing would start, so dropping the print keeps the filing
    // and loses only the paper. With that suppression off, a copy count above 0
    // opens `chrome://print/`, which the agent can neither click, screenshot,
    // nor close — the session is stuck until a human clears it.
    const copies = String(profile.printCopies ?? 0);
    await human.select('#PrintCopies', copies, { scope: dlg, label: `עותקים = ${copies}` })
      .catch(() => logger.step(profile.name, 'אין #PrintCopies בדיאלוג — ממשיך'));
    await human.click('#OK', { scope: dlg, label: `אישור ${profile.finalizeLabel}` });
    await human.settle('filed');

    // Success is the dialog going away, not the click landing.
    //
    // Comax rejects a bad copy count by painting an error and staying put, so a
    // click that "worked" and a document that filed are different things — the
    // agent reported 6500084 as נקלט with the confirmation dialog still on
    // screen behind it.
    //
    // But the dialog does not vanish on the click either: Comax tears it down a
    // few seconds later, and checking once immediately reported the *opposite*
    // lie about the very same document. So: wait for it to go, and only call it
    // a failure when it is still there at the end.
    const closeRe = profile.frames.closeDialog ?? /Close|Kbl|Ishur/i;
    let still = null;
    for (let i = 0; i < 8; i++) {
      still = frameFor(page, closeRe);
      if (!still) break;
      await page.waitForTimeout(1000);
    }
    if (still) {
      const why = await still.innerText('body').catch(() => '');
      const err = await page.evaluate(() => document.body?.innerText?.match(/[^\n]*!\s*$/m)?.[0] ?? null).catch(() => null);
      throw new Error(
        `${profile.label}: דיאלוג הקליטה עדיין פתוח — המסמך לא נקלט.\n`
        + (err ? `  קומקס אומר: ${err.trim()}\n` : '')
        + `  הדיאלוג: ${JSON.stringify(why.replace(/\s+/g, ' ').slice(0, 120))}\n`
        + '  המסמך פתוח על המסך. היציאה בלי לקלוט: #DoExit ואז #Cancel.',
      );
    }
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

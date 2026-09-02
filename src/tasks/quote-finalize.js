/**
 * סגירת הצעת מחיר ("קליטת הצעה") + שמירת PDF.
 *
 * Two things this gets right, both learned the hard way:
 *
 * 1. **Copies is set to 0.** Any other value makes Comax call `window.print()`,
 *    which opens Chrome's print dialog — and that dialog blocks CDP entirely.
 *    The agent then cannot even reconnect, let alone close it; only a human can.
 *    So the print is suppressed and the PDF is produced here instead.
 * 2. **The PDF comes from Comax's own print view** (`Doc612_HtmlP_T13.asp`,
 *    which lives in frame `FrmPr`), rendered through CDP `Page.printToPDF`.
 *    That is the same HTML Comax would have printed, so the output matches —
 *    and no Windows save dialog is involved.
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

export const meta = {
  name: 'quote-finalize',
  description: 'קליטת הצעת מחיר ושמירתה כ-PDF',
  writes: true,
  input: {
    outDir: 'string, אופציונלי — תיקיית יעד. ברירת מחדל: Downloads',
    copies: 'number, אופציונלי — עותקים להדפסה. ברירת המחדל 0 מונעת את דיאלוג ההדפסה',
    docNo: 'string, אופציונלי — מספר המסמך, גובר על זיהוי אוטומטי',
    pdfOnly: 'boolean — רק להפיק PDF למסמך שכבר נקלט (דורש docNo)',
  },
};

/** Windows and Comax both dislike these in a filename. */
const safeName = (s) => String(s ?? '').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();

const PRINT_VIEW = '/Max2000/Erp/Mehirot/Doc612/AzaaMhr/Doc612_HtmlP_T13.asp';

/** Session parameters every Max2000 frame carries; the print view needs them. */
const SESSION_PARAMS = ['CurrCompany', 'CurrYear', 'CurrSnif', 'UserCounter', 'Odbc', 'SwSQL', 'ZorbaLk', 'ZorbaApp'];

/**
 * Builds the print-view URL for a document.
 *
 * Prefers an existing print view to copy from, but does not depend on one:
 * after a fresh sign-in no document has been printed yet, and the earlier
 * version simply gave up and produced no PDF. The fallback assembles the URL
 * from the session parameters that every Max2000 frame carries.
 */
function printViewUrl(page, docNo) {
  const existing = page.frames().find((f) => /Doc612_HtmlP/i.test(f.url()));
  if (existing) {
    const u = new URL(existing.url());
    u.searchParams.set('Doc', String(docNo));
    return u.toString();
  }

  // No single frame carries every parameter, so collect them across all of
  // them: `Atraa_Fr` has the company and year, `checkLast_Task` has ZorbaLk,
  // the menu frames have the rest. First value found for each key wins.
  const collected = {};
  let origin = null;
  for (const f of page.frames()) {
    const raw = f.url();
    if (!raw.includes('comax.co.il')) continue;
    let u;
    try { u = new URL(raw); } catch { continue; }
    origin ??= u.origin;
    for (const p of SESSION_PARAMS) {
      if (collected[p] == null) {
        const v = u.searchParams.get(p);
        if (v != null && v !== '') collected[p] = v;
      }
    }
  }

  // These identify the database and the working year; without them the print
  // view would silently render against the wrong company.
  const required = ['Odbc', 'CurrCompany', 'CurrYear'];
  if (!origin || required.some((p) => collected[p] == null)) return null;

  const u = new URL(`${origin}${PRINT_VIEW}`);
  for (const [k, v] of Object.entries(collected)) u.searchParams.set(k, v);
  u.searchParams.set('CurrSnif', collected.CurrSnif ?? '0');
  u.searchParams.set('Doc', String(docNo));
  u.searchParams.set('Mode', 'ADD');
  u.searchParams.set('PrintCopies', '1');
  u.searchParams.set('SwIEWin9', '1');
  return u.toString();
}

export async function run(ctx) {
  const { page, human, logger, input, dryRun } = ctx;

  // `pdfOnly` regenerates the PDF for a document that is already accepted —
  // useful when the finalize succeeded but the file needs producing again.
  if (input.pdfOnly) {
    if (!input.docNo) throw new Error('pdfOnly דורש docNo.');
    const only = await savePdf(ctx, { docNo: input.docNo, outDir: input.outDir });
    return { docNo: input.docNo, pdf: only };
  }

  const grid = page.frames().find((f) => /Doc612LinesV\.asp/i.test(f.url()));
  if (!grid) throw new Error('אין הצעת מחיר פתוחה על המסך.');

  // Read the identity before the document closes and the screen changes.
  // The grid's text layout is RTL and has bitten this regex before, so an
  // explicit `docNo` always wins over what we manage to scrape.
  const head = await grid.innerText('body').catch(() => '');
  const docNo = input.docNo ?? /מספר:\s*\(?\s*(\d+)/.exec(head)?.[1] ?? null;
  logger.step('doc', `הצעה ${docNo ?? '(לא זוהה)'}`);
  if (!docNo) logger.step('warn', 'לא זיהיתי מספר מסמך — אפשר להעביר docNo מפורשות');

  if (dryRun) {
    logger.step('dryrun', 'עוצר לפני קליטת ההצעה.');
    console.log('\n  DRY RUN — ההצעה לא נקלטה. לאישור: --confirm\n');
    return { dryRun: true, docNo };
  }

  await human.click('#OK', { scope: grid, label: 'קליטת הצעה' });
  await human.settle('close dialog');

  const closeDlg = page.frames().find((f) => /Doc612CloseU\.asp/i.test(f.url()));
  if (!closeDlg) throw new Error('דיאלוג אישור הקליטה לא נפתח.');

  // 0 copies — anything else opens Chrome's print dialog, which freezes CDP.
  const copies = String(input.copies ?? 0);
  await human.select('#PrintCopies', copies, { scope: closeDlg, label: 'עותקים' });
  if (copies !== '0') {
    logger.step('warn', 'עותקים > 0 יפתח את דיאלוג ההדפסה של Chrome ויתקע את הסוכן');
  }
  await human.click('#OK', { scope: closeDlg, label: 'אישור קליטת ההצעה' });
  await human.settle('quote accepted');
  logger.step('doc', `הצעה ${docNo} נקלטה`);

  const file = await savePdf(ctx, { docNo, outDir: input.outDir });
  return { docNo, pdf: file };
}

/**
 * Renders Comax's own print view for a specific document to a PDF file.
 *
 * The `FrmPr` frame is NOT read directly: with copies set to 0 Comax never
 * refreshes it, so it still holds whatever was printed last — which once meant
 * saving the previous customer's quote under the new one's name. Its URL is
 * used only as a template, with `Doc` swapped to the document we actually want,
 * and the identity is read back from the rendered page rather than assumed.
 */
async function savePdf({ page, logger }, { docNo, outDir }) {
  if (!docNo) {
    logger.step('pdf', 'לא ידוע מספר המסמך — לא נוצר PDF');
    return null;
  }

  const url = printViewUrl(page, docNo);
  if (!url) {
    logger.step('pdf', 'לא הצלחתי להרכיב כתובת לתצוגת ההדפסה — לא נוצר PDF');
    return null;
  }

  const ctxB = page.context();
  const tab = await ctxB.newPage();
  try {
    await tab.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const text = await tab.evaluate(() => document.body.innerText);

    // Verify we rendered the document we asked for before writing any file.
    const shown = /^\s*(\d{5,})\s/m.exec(text)?.[1] ?? null;
    if (shown && shown !== String(docNo)) {
      throw new Error(`תצוגת ההדפסה מציגה מסמך ${shown} ולא ${docNo} — לא שומר.`);
    }
    const customer = /לכבוד:[\s\S]*?\n\s*(.+?)\s*\(\d+\)/.exec(text)?.[1]?.trim() ?? 'לקוח';

    const dir = outDir ?? resolve(homedir(), 'Downloads');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const file = resolve(dir, `${safeName(`הצעת מחיר - ${customer} - ${docNo}`)}.pdf`);

    const cdp = await ctxB.newCDPSession(tab);
    const { data } = await cdp.send('Page.printToPDF', {
      printBackground: true,
      paperWidth: 8.27, paperHeight: 11.69, // A4
      marginTop: 0.4, marginBottom: 0.4, marginLeft: 0.4, marginRight: 0.4,
    });
    writeFileSync(file, Buffer.from(data, 'base64'));
    logger.step('pdf', `${file}  (${customer}, מסמך ${docNo})`);
    console.log(`\n  נשמר: ${file}\n`);
    return file;
  } finally {
    await tab.close().catch(() => {});
  }
}

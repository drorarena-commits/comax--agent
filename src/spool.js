/**
 * Getting a finished report out of Comax's print spool.
 *
 * Comax reports do not stream back as downloads. Pressing אישור queues the
 * report into the spool and returns nothing — which is why runs of the matrix
 * report sat for 151 seconds and produced no file. The document is then built
 * and served in two more steps, both of which we do over plain HTTP from Node.
 *
 * Doing it in the browser is not an option: every export attempt has crashed
 * Chrome (eight dumps in .chrome-profile/Crashpad/reports, six at the identical
 * address in chrome.dll, one an outright OUT_OF_MEMORY while rendering the
 * spool document as a DOM). Fetching the bytes ourselves never asks the browser
 * to render or download anything.
 *
 * The chain, read out of System/Spool/ShowDoc_G.asp:
 *
 *   אישור            -> a spool row with a serial number
 *   Spooler_Exl_EXE  -> builds the file
 *   TempLong/_<n>.*  -> the file itself, briefly
 *   SpoolerZip.asp   -> a zipped copy, which Comax forces for large files
 */
import { comaxCookies, fetchToFile, maxUrl } from './fetch-file.js';

/** `SugExl=4` asks for CSV; anything else yields the HTML-flavoured .xls. */
const CSV = '4';

/**
 * The serial Comax assigned to the report just queued.
 *
 * It arrives in the little PrintSend_RptIo frame as `<status>;<serial>`, which
 * is the only place the number appears without opening the spool screen.
 */
async function readSerial(page) {
  const frame = page.frames().find((f) => /PrintSend_RptIo/i.test(f.url()));
  if (!frame) return null;
  const body = await frame.evaluate(() => document.body?.innerText ?? '').catch(() => '');
  const m = /(\d+)\s*;\s*(\d{3,})/.exec(decodeURIComponent(body)) ?? /^\s*(\d{3,})\s*$/.exec(body);
  return m ? (m[2] ?? m[1]) : null;
}

/**
 * Read the serial before starting a report, so the wait afterwards can tell a
 * new one from the one still sitting in the frame.
 */
export const previousSerial = readSerial;

export async function waitForSerial(page, { timeoutMs = 6 * 60_000, logger = null, previous = null } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const serial = await readSerial(page);
    // The frame keeps the last report's number until the next one lands, so a
    // value that merely *exists* proves nothing. Without comparing against the
    // number that was there before the click, a second run silently adopts the
    // first run's report — which is exactly how a 2-warehouse run came back
    // holding the 5-warehouse file.
    if (serial && serial !== previous) {
      logger?.step('spool', `הדוח נכנס לספול כמספר ${serial}`);
      return serial;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return null;
}

/**
 * Everything the HTTP side needs, taken out of the live page **before** the
 * report is started.
 *
 * Grabbing this up front is what makes the rest survivable: Chrome has crashed
 * on every completed export, and once these values are in hand the build and
 * download are pure HTTP that no longer care whether the window is still there.
 */
export async function captureSession({ page, context }) {
  const S = page.frames().find((f) => f.name() === 'S');
  if (!S) throw new Error('לא נמצא frame הניווט — כנראה לא מחוברים.');
  const ids = await S.evaluate(() => ({
    SessionID: String(top.S?.SessionID ?? ''),
    SwHanita: String(top.C?.SwHanita ?? '0'),
  }));
  return { ...ids, cookie: await comaxCookies(context), referer: page.url() };
}

/**
 * Ask Comax to build the file for a spool entry.
 *
 * Replicates BuildExcel() from ShowDoc_G.asp exactly. A reply starting with "0"
 * is Comax's own failure convention — the same check its script makes — and the
 * message after it is worth surfacing, since "בעיה בהפעלה ראשונית" means the
 * report belongs to a session that no longer exists.
 */
export async function buildFile(session, serial, { csv = true, logger = null } = {}) {
  const ids = session;
  const cookie = session.cookie;
  const params = new URLSearchParams({
    SwExcel: '2',
    SugExl: csv ? CSV : '1',
    SwSum: '0',
    SwSumEnd: '0',
    RikuzGrp: '0',
    Lk: '',
    Spool: String(serial),
    CSV_SPR: ',',
    SwHanita: ids.SwHanita,
    Date: new Date().toString(),
    SsID: ids.SessionID,
  });

  const res = await fetch(`${maxUrl('System/Spool/Spooler_Exl_EXE.asp')}?${params}`, {
    headers: { cookie, referer: session.referer, 'user-agent': 'Mozilla/5.0 Chrome/152.0.0.0' },
  });
  const raw = new TextDecoder('windows-1255').decode(Buffer.from(await res.arrayBuffer()));
  const reply = decodeURIComponent(raw.replace(/%u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))));

  if (!res.ok || reply.startsWith('0')) {
    throw new Error(`בניית הקובץ נדחתה: ${reply.slice(0, 160).trim()}`);
  }
  logger?.step('spool', `הקובץ נבנה (${reply.slice(0, 60).trim()})`);
  return { cookie, reply };
}

/**
 * Build, waiting for the report to actually finish first.
 *
 * The spool serial appears within seconds of pressing אישור — it marks the
 * report as *queued*, not built. Asking for the file that early is answered
 * with "בעיה בהפעלה ראשונית", which reads like a permissions problem but only
 * means "not ready". The report itself takes around two and a half minutes.
 */
export async function buildWhenReady(session, serial, { csv = true, logger = null, timeoutMs = 8 * 60_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  let tries = 0;
  while (Date.now() < deadline) {
    try {
      return await buildFile(session, serial, { csv, logger });
    } catch (e) {
      last = e;
      if (!/הפעלה ראשונית|בעיה/.test(e.message)) throw e;
      tries += 1;
      if (tries % 4 === 1) logger?.step('spool', `הדוח עוד נבנה — ממתין (${Math.round((deadline - Date.now()) / 1000)}ש׳ נותרו)`);
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }
  throw last ?? new Error('הדוח לא הפך זמין בזמן.');
}

/**
 * Fetch a report that was run **without** the Excel checkbox.
 *
 * That version goes into the spool as an ordinary printable document, so there
 * is nothing to "build" and none of the Spooler_Exl_EXE gate. ShowDoc_G.asp
 * either carries the report itself or points at one of the Rpt_*Html viewers,
 * so follow that pointer when it appears.
 */
/**
 * Read a non-Excel spool report out of the browser.
 *
 * The HTTP route does not work for these: `ShowDoc_G.asp` returns only the
 * viewer wrapper, and the `Rpt_Html_G.asp` URL it names is assembled in JS from
 * a dozen page variables (Folder, Odbc, OdbcUserName, urlS…) that cannot be
 * reconstructed from outside — fetching the literal string gives a 500.
 *
 * Opening the report the way the UI does and reading the rendered frame is
 * simpler and proven. It costs a render, which is why the report should be kept
 * small; a huge one is what crashes Chrome
 * ([[comax-export-crashes-chrome]]).
 */
export async function readReportFromBrowser(page, serial, dest, { logger = null, timeoutMs = 90_000 } = {}) {
  const S = page.frames().find((f) => f.name() === 'S');
  if (!S) throw new Error('לא נמצא frame הניווט.');
  await S.evaluate((c) => top.C.openReport(c), Number(serial));
  logger?.step('spool', `פותח דוח ${serial} לצפייה`);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    const rpt = page.frames().find((f) => /Rpt_Html_G\.asp/i.test(f.url()));
    if (!rpt) continue;
    const rows = await rpt.evaluate(() => document.querySelectorAll('tr').length).catch(() => 0);
    if (rows > 5) {
      const html = await rpt.content();
      const { writeFile } = await import('node:fs/promises');
      await writeFile(dest, html, 'utf8');
      logger?.step('spool', `הדוח נשמר — ${rows} שורות, ${(html.length / 1024).toFixed(0)}KB`);
      return { file: dest, size: Buffer.byteLength(html, 'utf8'), rows };
    }
  }
  throw new Error('הדוח לא נפתח לצפייה בזמן.');
}

export async function fetchReportHtml(session, serial, dest, { logger = null } = {}) {
  const { cookie, referer } = session;
  const viewer = `${maxUrl('System/Spool/ShowDoc_G.asp')}?Counter=${serial}`;

  const res = await fetch(viewer, {
    headers: { cookie, referer, 'user-agent': 'Mozilla/5.0 Chrome/152.0.0.0' },
  });
  const html = new TextDecoder('windows-1255').decode(Buffer.from(await res.arrayBuffer()));
  logger?.step('spool', `ShowDoc ${res.status}, ${(html.length / 1024).toFixed(0)}KB`);

  // A real report page carries a table of rows; the wrapper carries only
  // script. Row count is the cheapest way to tell them apart.
  const rows = (html.match(/<tr[\s>]/gi) ?? []).length;
  if (rows > 20) {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(dest, html, 'utf8');
    logger?.step('spool', `הדוח נשמר ישירות (${rows} שורות)`);
    return { file: dest, size: Buffer.byteLength(html, 'utf8') };
  }

  // Otherwise follow whatever viewer the wrapper names.
  const m = /["'](Rpt_[A-Za-z_]*Html[A-Za-z_]*\.asp\?[^"']+)["']/i.exec(html);
  if (!m) throw new Error(`ShowDoc החזיר עטיפה בלבד (${rows} שורות) ובלי מצביע לדוח.`);
  const url = new URL(m[1], `${maxUrl('System/Spool/')}`).toString();
  logger?.step('spool', `עוקב אחרי ${m[1].slice(0, 80)}`);
  return fetchToFile(url, dest, { cookie, referer: viewer, logger });
}

/**
 * Download the built file.
 *
 * TempLong entries are transient — generated, served, removed — so this runs
 * right after the build and retries briefly rather than assuming the file is
 * already there. The zip route is the fallback because Comax refuses the plain
 * file above a certain size ("ניתן להוריד קובץ ZIP בלבד").
 */
export async function fetchSpoolFile(session, serial, destWithoutExt, { csv = true, logger = null } = {}) {
  const ext = csv ? 'csv' : 'xls';
  const direct = `https://www.comax.co.il/Max2000Spool/TempLong/_${serial}.${ext}`;
  const zipped = `${maxUrl('System/Spool/SpoolerZip.asp')}?pathI=${encodeURIComponent(direct)}&d=${encodeURIComponent(new Date().toString())}`;
  const { cookie, referer } = session;

  for (const [label, url, suffix] of [['ישיר', direct, `.${ext}`], ['מכווץ', zipped, '.zip']]) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await fetchToFile(url, `${destWithoutExt}${suffix}`, { cookie, referer, logger });
      } catch (e) {
        const msg = e.message.split('\n')[0];
        if (!/404/.test(msg)) throw e;
        logger?.step('spool', `${label}: עדיין לא מוכן (${attempt + 1}/5)`);
        await new Promise((r) => setTimeout(r, 4000));
      }
    }
  }
  throw new Error('הקובץ לא הופיע ב-TempLong, לא ישיר ולא מכווץ.');
}

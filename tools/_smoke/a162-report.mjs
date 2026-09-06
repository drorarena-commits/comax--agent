/**
 * Reads the a162 report that is currently open and reconciles it.
 *
 *   node tools/_smoke/a162-report.mjs           # full text
 *   node tools/_smoke/a162-report.mjs --sum     # per-employee totals only
 *
 * The whole report lives in the ReadFile_HtmlP frame at once — one employee per
 * page, but every page is already in that frame's text. Do NOT page with #Next
 * and concatenate: that returns the same full text once per page and triples
 * the employee list, which reads exactly like a report with duplicates in it.
 * Read once, then check the header count against MaxPages.
 */
import { attachBrowser } from '../../src/browser.js';
import { RunLogger } from '../../src/logger.js';

const logger = new RunLogger('a162-report');
const s = await attachBrowser({ logger });
if (!s) { console.log('אין חלון פתוח'); process.exit(1); }

const ctrl = s.page.frames().find((f) => (f.url() || '').includes('Rpt_DafHtml_G'));
const body = s.page.frames().find((f) => (f.url() || '').includes('ReadFile_HtmlP'));
if (!ctrl || !body) { console.log('הדוח לא פתוח'); process.exit(1); }

const pages = await ctrl.evaluate(() => (typeof MaxPages !== 'undefined' ? MaxPages : null));
const text = await body.evaluate(() => (document.body.innerText || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim());

const heads = [...text.matchAll(/פרוט לפי תקן:\s*(.+?)\s*\((\d+)\)/g)].map((m) => ({ name: m[1], id: m[2] }));
const totals = [...text.matchAll(/סה''כ לעובד:\s*([\d.]+)\s+([\d.]+)/g)].map((m) => m[2]);
const month = (text.match(/לחודש:\s*(\d{2}\/\d{4})/) || [])[1];

console.log(`חודש: ${month}   עמודים: ${pages}   עובדים שנמצאו: ${heads.length}`);
if (pages !== heads.length) console.log(`⛔ אי-התאמה: ${pages} עמודים מול ${heads.length} עובדים — קריאה חלקית או כפולה.`);
console.log('');
heads.forEach((h, i) => console.log(`  ${h.name} (${h.id}) — ${totals[i] ?? '?'} שעות`));

if (!process.argv.includes('--sum')) { console.log('\n────────\n'); console.log(text); }
await s.browser.close().catch(() => {});
logger.done();

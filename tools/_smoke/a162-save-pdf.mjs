/** Saves the spool PDF that a162 just produced.
 *   node tools/_smoke/a162-save-pdf.mjs "<שם קובץ>.pdf"
 */
import { attachBrowser } from '../../src/browser.js';
import { RunLogger } from '../../src/logger.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from '../../src/config.js';

const logger = new RunLogger('a162-save-pdf');
const s = await attachBrowser({ logger });
if (!s) { console.log('אין חלון פתוח'); process.exit(1); }
const { page } = s;

const pdfFrame = page.frames().find((f) => /Max2000Spool\/.*_pdf\.pdf$/.test(f.url() || ''));
if (!pdfFrame) { console.log('לא נמצא PDF פתוח — תלחץ קודם על #PDF'); process.exit(1); }
const url = pdfFrame.url();
console.log('URL:', url);

// Same-origin fetch from inside the portal page keeps the session cookies.
const host = page.frames().find((f) => (f.url() || '').includes('Max2000/System/Spool/Rpt_DafHtml_G')) || page.mainFrame();
const b64 = await host.evaluate(async (u) => {
  const r = await fetch(u, { credentials: 'include' });
  if (!r.ok) return `ERR ${r.status}`;
  const buf = new Uint8Array(await r.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return btoa(bin);
}, url);
if (typeof b64 === 'string' && b64.startsWith('ERR')) { console.log(b64); process.exit(1); }

const name = process.argv[2] || 'a162-report.pdf';
const dir = resolve(ROOT, 'runs', 'downloads');
mkdirSync(dir, { recursive: true });
const out = resolve(dir, name);
const bytes = Buffer.from(b64, 'base64');
writeFileSync(out, bytes);
console.log(`נשמר: ${out}  (${bytes.length.toLocaleString()} bytes)`);
console.log('חתימה:', bytes.subarray(0, 5).toString('latin1'));
console.log('דפים:', (bytes.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length);
await s.browser.close().catch(() => {});
logger.done();

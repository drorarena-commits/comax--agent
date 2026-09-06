/** Clicks the PDF button in the open a162 report and reports what happened. */
import { attachBrowser } from '../../src/browser.js';
import { RunLogger } from '../../src/logger.js';
const logger = new RunLogger('a162-pdf');
const s = await attachBrowser({ logger });
if (!s) { console.log('אין חלון פתוח'); process.exit(1); }
const { page, context } = s;

const before = new Set(page.frames().map((f) => f.url()));
context?.on?.('page', (p) => console.log('POPUP page:', p.url()));
page.on('popup', (p) => console.log('POPUP:', p.url()));
page.on('download', async (d) => console.log('DOWNLOAD:', d.suggestedFilename(), '→', await d.path().catch(() => '?')));
page.on('dialog', (d) => console.log('DIALOG:', d.type(), d.message().slice(0, 120)));

const frame = page.frames().find((f) => (f.url() || '').includes('Rpt_DafHtml_G'));
if (!frame) { console.log('לא נמצא frame הדוח'); process.exit(1); }
console.log('לוחץ #PDF...');
await frame.evaluate(() => document.getElementById('PDF').click());
await page.waitForTimeout(15000);

console.log('\n--- frames חדשים ---');
for (const f of page.frames()) {
  const u = f.url() || '';
  if (!before.has(u)) console.log(`${f.name() || '(anon)'}  ${u.slice(0, 220)}`);
}
console.log('\n--- pages ---');
for (const p of context?.pages?.() ?? []) console.log(p.url().slice(0, 200));
await logger.shot(page, 'after-pdf');
await s.browser.close().catch(() => {});
logger.done();

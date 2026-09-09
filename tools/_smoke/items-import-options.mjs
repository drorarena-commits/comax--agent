/**
 * מדפיס את שדות הבחירה של דיאלוג "יבוא מאקסל" (frame f1) במצב הנוכחי,
 * כולל ערכי הקומבו והסימונים — כלומר "איך היבוא יתנהג", להבדיל מ-FMiun
 * שהוא "אילו עמודות".
 *
 *   node tools/_smoke/items-import-options.mjs
 *
 * קריאה בלבד. לא לוחץ על כלום.
 */
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, loadConfig } from '../../src/config.js';

const cfg = loadConfig();
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cfg.debugPort}`, { timeout: 120_000 });
try {
  const page = browser.contexts()[0].pages().find((p) => /Max2000/i.test(p.url()));
  const f1 = page.frames().find((f) => /Prt_ImpExl_New\.asp/i.test(f.url()));
  if (!f1) throw new Error('דיאלוג היבוא לא פתוח.');

  const data = await f1.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const lbl = (el) => {
      const td = el.closest('td');
      const cand = td?.previousElementSibling ?? td?.nextElementSibling;
      return (cand?.innerText || td?.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 45);
    };
    const out = [];
    for (const el of document.querySelectorAll('input,select')) {
      if (!el.id) continue;
      out.push({
        id: el.id, tag: el.tagName.toLowerCase(), type: el.type || '',
        value: (el.value ?? '').toString().slice(0, 40),
        title: (el.title ?? '').toString().slice(0, 40),
        checked: el.type === 'checkbox' ? el.checked : undefined,
        options: el.tagName === 'SELECT' ? [...el.options].map((o) => `${o.value}=${o.text.trim()}`) : undefined,
        visible: vis(el), label: lbl(el),
      });
    }
    return out;
  });

  for (const e of data) {
    if (!e.visible && e.type === 'hidden') continue;
    const mark = e.type === 'checkbox' ? (e.checked ? '[V]' : '[ ]') : '   ';
    console.log(`${e.visible ? 'גלוי ' : 'מוסתר'} ${mark} #${e.id.padEnd(28)} ${e.type.padEnd(10)} ${(e.title ? `title="${e.title}" ` : '')}${e.value ? `= "${e.value}"` : ''}   ${e.label}`);
    if (e.options) for (const o of e.options) console.log(`             · ${o}`);
  }

  writeFileSync(resolve(ROOT, 'knowledge/screens/items-import-options.json'),
    JSON.stringify({ capturedAt: new Date().toISOString(), url: f1.url(), fields: data }, null, 2), 'utf8');
  console.log('\n→ knowledge/screens/items-import-options.json');
} finally {
  await browser.close().catch(() => {});
}

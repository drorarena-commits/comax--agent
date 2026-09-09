/**
 * ממפה את רשימת השדות של דיאלוג "יבוא מאקסל" לכל סוג יבוא שמעניין אותנו.
 *
 *   node tools/_smoke/items-import-types.mjs [0 14 19]
 *
 * קריאה בלבד — מחליף את בורר `#SwImpType`, קורא את פריים `FMiun`, ויוצא.
 * **לא לוחץ על `#ok`.** דורש שדיאלוג היבוא כבר פתוח (items-import-dialog.mjs).
 */
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, loadConfig } from '../../src/config.js';

const cfg = loadConfig();
const want = (process.argv.slice(2).length ? process.argv.slice(2) : ['0', '14', '19']).map(String);
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cfg.debugPort}`, { timeout: 120_000 });
const ctx = browser.contexts()[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const page = ctx.pages().find((p) => /comax\.co\.il\/Max2000/i.test(p.url()));
  const f1 = page.frames().find((f) => /Prt_ImpExl_New\.asp/i.test(f.url()));
  if (!f1) throw new Error('דיאלוג היבוא לא פתוח. תריץ קודם items-import-dialog.mjs');

  const out = {};
  for (const t of want) {
    // הקוד יושב ב-`title` והשם ב-`value` — כתיבה ל-value בלבד לא מזיזה כלום,
    // ורק `SwImpType_onchange()` (שקורא ל-ShowMivne) טוען מחדש את FMiun.
    await f1.evaluate((v) => {
      const el = document.getElementById('SwImpType');
      el.title = v;
      el.value = '';
      window.SwImpType_onchange?.();
    }, t).catch(() => {});
    await sleep(3000);

    const miun = page.frames().find((f) => /MiunSwImp\.asp/i.test(f.url()));
    const rows = miun ? await miun.evaluate(() => {
      const list = [];
      for (const inp of document.querySelectorAll('input[id^="chk"]')) {
        const td = inp.closest('td')?.previousElementSibling ?? inp.closest('tr')?.cells?.[0];
        list.push({ id: inp.id, col: inp.value, label: (td?.innerText || '').trim() });
      }
      return list;
    }) : [];
    const url = miun?.url() ?? '';
    console.log(`\n═══ SwImpType=${t}   ${url.replace(/^.*MiunSwImp/, 'MiunSwImp').slice(0, 110)}`);
    console.log(`    ${rows.length} שדות`);
    rows.forEach((r, i) => console.log(`  ${String(i).padStart(3)}. ${r.id.padEnd(8)} עמודה="${r.col}"  ${r.label}`));
    out[t] = { url, rows };
  }

  writeFileSync(resolve(ROOT, 'knowledge/screens/items-import-types.json'),
    JSON.stringify({ capturedAt: new Date().toISOString(), types: out }, null, 2), 'utf8');
  console.log('\n→ knowledge/screens/items-import-types.json');
} finally {
  await browser.close().catch(() => {});
}

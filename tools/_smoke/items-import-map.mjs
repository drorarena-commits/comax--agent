/**
 * ממפה את מסך הפריטים (a84) ומחפש בו את פונקציית היבוא מאקסל.
 *
 *   node tools/_smoke/items-import-map.mjs
 *
 * קריאה בלבד. פותח, מדפיס ומצלם — **לא לוחץ על שום כפתור שקולט**.
 * דורש חלון סוכן פתוח ומחובר לקומקס.
 */
import { chromium } from 'playwright-core';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, loadConfig } from '../../src/config.js';

const cfg = loadConfig();
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cfg.debugPort}`, { timeout: 120_000 });
const ctx = browser.contexts()[0];

const ITEMS = /Erp\/Prt\/PrtV/i;
const dir = resolve(ROOT, 'knowledge/screens');
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

try {
  const page = ctx.pages().find((p) => /comax\.co\.il\/Max2000/i.test(p.url()));
  if (!page) throw new Error('לא נמצא טאב של קומקס. תפתח את קומקס בחלון הסוכן.');

  const items = page.frames().find((f) => ITEMS.test(f.url()));
  if (!items) {
    console.log('מסך הפריטים לא פתוח. פותח אותו דרך שולחן העבודה...');
    const { openProgram } = await import('../../src/navigate.js');
    const { Human } = await import('../../src/human.js');
    await openProgram({ page, human: new Human(page, cfg.pace), logger: null, cfg }, 'a84', { expect: ITEMS });
  }
  const frame = page.frames().find((f) => ITEMS.test(f.url()));
  if (!frame) throw new Error('מסך הפריטים לא נפתח.');

  // כל האלמנטים הלחיצים, כולל אלה שמוסתרים מאחורי לשונית שאינה פעילה.
  const els = await frame.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    return [...document.querySelectorAll('input,button,a,img,td[onclick],div[onclick],span[onclick]')]
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        id: el.id || '',
        type: el.type ?? '',
        title: el.title || el.getAttribute('alt') || '',
        text: (el.textContent || '').trim().slice(0, 40),
        onclick: (el.getAttribute('onclick') || '').slice(0, 90),
        src: (el.getAttribute('src') || '').split('/').pop() ?? '',
        visible: vis(el),
      }))
      .filter((e) => e.id || e.title || e.onclick);
  });

  const IMPORT = /יבוא|import|קליט|excel|אקסל|טעינ|העלא/i;
  const hits = els.filter((e) => IMPORT.test(`${e.id} ${e.title} ${e.text} ${e.onclick} ${e.src}`));

  console.log(`אלמנטים במסך הפריטים: ${els.length}\n`);
  console.log('=== מועמדים ליבוא ===');
  for (const e of hits) {
    console.log(`  #${(e.id || '-').padEnd(18)} ${e.visible ? 'גלוי ' : 'מוסתר'} ${e.title.padEnd(22)} ${e.onclick}`);
  }

  console.log('\n=== כל האלמנטים עם id ===');
  for (const e of els.filter((x) => x.id)) {
    console.log(`  #${e.id.padEnd(20)} ${e.tag.padEnd(6)} ${e.visible ? 'גלוי ' : 'מוסתר'} ${(e.title || e.text).slice(0, 30).padEnd(32)} ${e.onclick.slice(0, 60)}`);
  }

  const dest = resolve(dir, 'items-screen-elements.json');
  writeFileSync(dest, JSON.stringify({ capturedAt: new Date().toISOString(), url: frame.url(), els }, null, 2), 'utf8');
  await page.screenshot({ path: resolve(dir, 'items-screen.png') }).catch(() => {});
  console.log(`\n→ ${dest}`);
} finally {
  await browser.close().catch(() => {});
}

/**
 * פותח את דיאלוג "יבוא מאקסל" במסך הפריטים (a84) וממפה אותו.
 *
 *   node tools/_smoke/items-import-dialog.mjs
 *
 * קריאה בלבד. לוחץ על לשונית "נוספים" ועל `#ImpExl` — שניהם פותחים מסך,
 * לא קולטים דבר — ואז מדפיס, מצלם ויוצא. **לא לוחץ על שום כפתור אישור.**
 * דורש חלון סוכן פתוח ומחובר לקומקס.
 */
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, loadConfig } from '../../src/config.js';

const cfg = loadConfig();
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cfg.debugPort}`, { timeout: 120_000 });
const ctx = browser.contexts()[0];
const ITEMS = /Erp\/Prt\/PrtV/i;
const dir = resolve(ROOT, 'knowledge/screens');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dump = (fr) => fr.evaluate(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  return [...document.querySelectorAll('input,button,select,textarea,a,img,td[onclick],div[onclick],span[onclick]')]
    .map((el) => ({
      tag: el.tagName.toLowerCase(),
      id: el.id || '',
      name: el.name || '',
      type: el.type ?? '',
      value: (el.value ?? '').toString().slice(0, 60),
      title: el.title || el.getAttribute('alt') || '',
      text: (el.textContent || '').trim().slice(0, 50),
      onclick: (el.getAttribute('onclick') || '').slice(0, 120),
      options: el.tagName === 'SELECT' ? [...el.options].map((o) => `${o.value}=${o.text}`.slice(0, 50)) : undefined,
      visible: vis(el),
    }))
    .filter((e) => e.id || e.name || e.title || e.onclick);
});

try {
  const page = ctx.pages().find((p) => /comax\.co\.il\/Max2000/i.test(p.url()));
  if (!page) throw new Error('לא נמצא טאב של קומקס.');

  if (!page.frames().find((f) => ITEMS.test(f.url()))) {
    console.log('פותח את מסך הפריטים (a84)...');
    const { openProgram } = await import('../../src/navigate.js');
    const { Human } = await import('../../src/human.js');
    await openProgram({ page, human: new Human(page, cfg.pace), logger: null, cfg }, 'a84', { expect: ITEMS });
  }
  const items = page.frames().find((f) => ITEMS.test(f.url()));
  if (!items) throw new Error('מסך הפריטים לא נפתח.');

  const before = new Set(page.frames().map((f) => f.url()));

  console.log('לשונית "נוספים" (#Row3)...');
  await items.locator('#Row3').click();
  await sleep(1200);
  console.log('  #ImpExl גלוי?', await items.locator('#ImpExl').isVisible());

  console.log('#ImpExl — יבוא מאקסל...');
  await items.locator('#ImpExl').click();
  await sleep(3500);

  const fresh = page.frames().filter((f) => !before.has(f.url()) && f.url() && !/about:blank/.test(f.url()));
  console.log(`\nפריימים חדשים: ${fresh.length}`);
  const out = [];
  for (const fr of fresh) {
    const els = await dump(fr).catch(() => []);
    console.log(`\n── frame "${fr.name() || '(anon)'}"  ${fr.url()}   (${els.length} אלמנטים)`);
    for (const e of els) {
      console.log(`  ${(e.id ? '#' + e.id : e.name).padEnd(24)} ${e.tag.padEnd(8)} ${e.type.padEnd(9)} ${e.visible ? 'גלוי ' : 'מוסתר'} ${(e.title || e.text || e.value).slice(0, 34).padEnd(36)} ${e.onclick.slice(0, 60)}`);
      if (e.options) for (const o of e.options) console.log(`        · ${o}`);
    }
    out.push({ name: fr.name(), url: fr.url(), els });
  }

  writeFileSync(resolve(dir, 'items-import-dialog.json'),
    JSON.stringify({ capturedAt: new Date().toISOString(), frames: out }, null, 2), 'utf8');
  await page.screenshot({ path: resolve(dir, 'items-import-dialog.png') }).catch(() => {});
  console.log(`\n→ knowledge/screens/items-import-dialog.json`);
} finally {
  await browser.close().catch(() => {});
}

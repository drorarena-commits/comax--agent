/**
 * מוריד קובץ מ-Google Drive דרך חלון הסוכן, ישירות לדיסק.
 *
 *   node tools/drive-get.js <fileId> [שם-יעד]
 *   node tools/drive-get.js --whoami        בודק לאיזה חשבון הדפדפן מחובר
 *
 * Why this exists: the Drive connector returns a file as base64 *through the
 * conversation*, so a 2 MB workbook costs hundreds of thousands of tokens to
 * receive and cannot be written back to disk at all. The browser already holds
 * a signed-in Google session, so `uc?export=download` hands the bytes straight
 * to Chrome and none of it passes through the model. Size stops mattering.
 *
 * Requires a one-time Google sign-in inside the agent's Chrome profile.
 */
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { ROOT, loadConfig } from '../src/config.js';

const args = process.argv.slice(2);
const cfg = loadConfig();

// Not `attachBrowser`: its CDP timeout is 5s, and Playwright attaches to every
// target in the browser. Once the window also holds Gmail, WhatsApp and a
// handful of service workers, that handshake takes far longer than five
// seconds and the attach fails with "no window open" — which is misleading,
// because the window is right there.
let browser;
try {
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${cfg.debugPort}`, { timeout: 120_000 });
} catch (e) {
  console.error(`לא הצלחתי להתחבר לחלון הסוכן: ${e.message.split('\n')[0]}`);
  process.exit(1);
}
const ctx = browser.contexts()[0];
if (!ctx) { console.error('אין הקשר דפדפן.'); process.exit(1); }

async function whoami(p) {
  await p.goto('https://drive.google.com/drive/my-drive', { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await p.waitForTimeout(5000);
  if (/accounts\.google\.com|ServiceLogin/i.test(p.url())) return null;
  // The account chip carries the address; fall back to the raw page text.
  return p.evaluate(() => {
    const el = [...document.querySelectorAll('[aria-label*="@"],[data-email],[title*="@"]')]
      .map((e) => e.getAttribute('aria-label') || e.getAttribute('data-email') || e.getAttribute('title'))
      .find((v) => v && v.includes('@'));
    return el ?? '(מחובר, הכתובת לא נקראה מהעמוד)';
  });
}

try {
  const p = await ctx.newPage();

  if (args[0] === '--whoami') {
    const who = await whoami(p);
    console.log(who ? `מחובר: ${who}` : 'לא מחובר לגוגל');
    await p.close();
    process.exit(who ? 0 : 2);
  }

  const [fileId, outName] = args;
  if (!fileId) { console.error('שימוש: node tools/drive-get.js <fileId> [שם-יעד]'); process.exit(1); }

  const dir = resolve(ROOT, 'data/inbox');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const dl = ctx.waitForEvent('download', { timeout: 10 * 60_000 });
  // `confirm=t` skips Drive's "cannot scan for viruses" interstitial, which
  // large files always hit and which otherwise leaves the download pending.
  await p.goto(`https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`,
    { waitUntil: 'domcontentloaded', timeout: 90_000 }).catch(() => {});

  const d = await dl;
  const dest = resolve(dir, outName ?? d.suggestedFilename());
  await d.saveAs(dest);
  const size = statSync(dest).size;
  console.log(`ירד: ${dest}`);
  console.log(`גודל: ${(size / 1024 / 1024).toFixed(2)} MB`);
  await p.close().catch(() => {});
} finally {
  await browser.close().catch(() => {}); // detaches CDP only; the window stays
}

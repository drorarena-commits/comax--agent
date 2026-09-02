/**
 * Reads every option a Max2000 combo offers.
 *
 *   npm run options -- Mhr        (מחירון)
 *   npm run options -- Store      (מחסן)
 *   npm run options -- Sochen     (סוכן)
 *
 * The field must be on screen — open the form first. The field is cleared
 * before the arrow is clicked, because the picker filters by whatever the field
 * already holds: with "מכירה ראשי" left in place it reports one price list
 * instead of three. The original value is put back afterwards.
 */
import { attachBrowser } from '../src/browser.js';
import { RunLogger } from '../src/logger.js';

const field = process.argv[2];
if (!field) {
  console.error('שימוש: npm run options -- <שם השדה>   למשל Store או Mhr');
  process.exit(1);
}

const logger = new RunLogger(`options-${field}`);
const s = await attachBrowser({ logger });
if (!s) { console.error('אין חלון סוכן פתוח. תריץ: npm run open'); process.exit(1); }
const { page, human } = s;

// Whichever visible frame actually holds this field.
let frame = null;
for (const fr of page.frames()) {
  try {
    if (await fr.locator(`#${field}`).count()) { frame = fr; break; }
  } catch { /* frame gone */ }
}
if (!frame) { console.error(`השדה #${field} לא נמצא באף frame פתוח.`); process.exit(1); }

const original = await frame.locator(`#${field}`).inputValue().catch(() => '');

await human.click(`#${field}`, { scope: frame, label: field });
await page.keyboard.press('Control+A');
await page.keyboard.press('Delete');
await human.think('field cleared');
await human.click(`#CcomboBut${field}`, { scope: frame, label: `בורר ${field}` });
await human.settle('picker open');

const picker = page.frames().find((f) => /Select_G\.htm/i.test(f.url()));
const rows = picker
  ? await picker.evaluate(() =>
      [...document.querySelectorAll('tr')]
        .map((tr) => [...tr.cells].map((c) => (c.innerText || '').trim()))
        .filter((r) => r.some(Boolean)),
    )
  : [];

console.log(`\n=== ${field} — ${rows.length} אפשרויות (ערך נוכחי: ${original || 'ריק'}) ===`);
rows.forEach((r, i) => console.log(`  ${String(i).padStart(2)}. ${r[0]}  (${r[1] ?? ''})`));

// Put the field back the way we found it.
await human.press('Escape', { label: 'סגירת הבורר' });
if (original) await human.type(`#${field}`, original, { scope: frame, label: `שחזור ${field}` });

logger.save('options.json', { field, original, options: rows.map((r) => ({ name: r[0], code: r[1] ?? null })) });
await s.browser.close().catch(() => {});
logger.done();

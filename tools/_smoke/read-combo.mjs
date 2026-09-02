import { attachBrowser } from '../../src/browser.js';
import { RunLogger } from '../../src/logger.js';
import { readPickerRows } from '../../src/navigate.js';

const field = process.argv[2];             // Store / Mhr / Sochen / SwIzur
const logger = new RunLogger(`combo-${field}`);
const s = await attachBrowser({ logger });
const { page, human } = s;
const fr = page.frames().find(f => /Doc612U/.test(f.url()));
if (!fr) { console.log('טופס הכותרת לא פתוח'); process.exit(1); }

const before = await fr.locator(`#${field}`).inputValue().catch(() => null);
await human.click(`#CcomboBut${field}`, { scope: fr, label: `בורר ${field}` });
await human.settle('picker open');

const picker = await readPickerRows(page);
console.log(`\n=== ${field} — ערך נוכחי: ${JSON.stringify(before)} ===`);
if (!picker) console.log('(לא נפתח בורר)');
else picker.rows.forEach((r, i) => console.log(`  ${String(i).padStart(2)}. ${r.join('  |  ')}`));

// Leave the field exactly as we found it.
await human.press('Escape', { label: 'סגירת הבורר' });
await human.think('closing');
const after = await fr.locator(`#${field}`).inputValue().catch(() => null);
console.log(`\nהערך אחרי: ${JSON.stringify(after)} ${after === before ? '(ללא שינוי)' : '*** השתנה ***'}`);
await s.browser.close().catch(() => {});
logger.done();

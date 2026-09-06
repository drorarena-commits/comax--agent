/**
 * Fills the a162 report e-mail envelope and (with --send) sends it.
 *
 *   node tools/_smoke/a162-send-mail.mjs <to> <שם נמען> <נושא> [--send]
 *
 * Without --send it fills, verifies and screenshots, and stops — CLAUDE.md
 * rule 2. Rule 14 is enforced through src/documents/recipient.js: the field is
 * cleared before writing, read back immediately, and re-checked live at the
 * send button against exact equality.
 */
import { attachBrowser } from '../../src/browser.js';
import { RunLogger } from '../../src/logger.js';
import { requireRecipient, takeOverRecipient, assertRecipient } from '../../src/documents/recipient.js';

const [to, name, subject] = process.argv.slice(2);
const send = process.argv.includes('--send');
const addr = requireRecipient(to, { what: 'דוח הנוכחות' });

const logger = new RunLogger('a162-send-mail');
const s = await attachBrowser({ logger });
const frame = s.page.frames().find((x) => (x.url() || '').includes('SendSpoolToEmail_PDF'));
if (!frame) { console.log('מסך המעטפה לא פתוח'); process.exit(1); }

const { prefilled } = await takeOverRecipient({ frame, human: s.human, logger, to: addr, field: '#Email' });
console.log(`קומקס מילא מראש: ${prefilled ? `"${prefilled}"` : '(ריק)'}`);

if (name) await s.human.type('#SentToEmail', name, { scope: frame, label: 'שם הנמען' });
if (subject) await s.human.type('#Subject', subject, { scope: frame, label: 'נושא' });

const state = await frame.evaluate(() => ({
  email: Email.value, name: SentToEmail.value, subject: Subject.value,
  remark: Remark.value, sender: EmailUsr.value.trim(),
}));
console.log('\n--- המעטפה ---');
console.log(JSON.stringify(state, null, 1));

await logger.shot(s.page, 'envelope');

if (!send) {
  console.log('\nמולא ולא נשלח. להוספת שליחה: --send');
  await s.browser.close().catch(() => {});
  logger.done();
  process.exit(0);
}

const live = await assertRecipient(frame, addr, { field: '#Email' });
console.log(`\n✓ הנמען אומת ברגע השליחה: ${live}`);
await s.human.click('#OK', { scope: frame, label: 'שליחה' });
await s.human.settle('sending');
await s.human.think('after send');
await logger.shot(s.page, 'after-send');
console.log('נשלח.');
await s.browser.close().catch(() => {});
logger.done();

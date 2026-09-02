/**
 * מציג וסוגר תוכניות פתוחות בקומקס, דרך פאנל "תוכניות בעבודה" של המערכת.
 *
 *   npm run close -- list        רק מציג מה פתוח
 *   npm run close -- all         סוגר הכל
 *   npm run close -- פריטים      סוגר לפי שם
 */
import { attachBrowser } from '../src/browser.js';
import { RunLogger } from '../src/logger.js';
import { listPrograms, closePrograms } from '../src/navigate.js';

const args = process.argv.slice(2);
const logger = new RunLogger('close-windows');
const s = await attachBrowser({ logger });
if (!s) { console.error('אין חלון סוכן פתוח.'); process.exit(1); }
const ctx = { ...s, logger };

const show = async (title) => {
  const rows = await listPrograms(s.page);
  console.log(`\n${title}`);
  if (!rows.length) console.log('  (אין תוכניות פתוחות)');
  rows.forEach((r) => console.log(`  ${r.index}. ${r.name}${r.frameName ? `   [${r.frameName}]` : ''}`));
  return rows;
};

if (args[0] === 'list' || !args.length) {
  const { navFrame } = await import('../src/session.js');
  await s.human.click('#Run', { scope: navFrame(s.page, s.cfg), label: 'תוכניות בעבודה' });
  await s.human.settle('panel');
  await show('תוכניות פתוחות:');
} else {
  await closePrograms(ctx, args[0] === 'all' ? [/./] : args);
  await show('נשארו פתוחות:');
}

await s.browser.close().catch(() => {});
logger.done();

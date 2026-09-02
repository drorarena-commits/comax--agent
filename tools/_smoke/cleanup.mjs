import { attachBrowser } from '../../src/browser.js';
import { RunLogger } from '../../src/logger.js';

const logger = new RunLogger('cleanup');
const s = await attachBrowser({ logger });
const { page, human } = s;

// Close, innermost first: remarks popup, then the new-quote dialog.
for (const name of ['f3', 'f2']) {
  const fr = page.frames().find(f => f.name() === name);
  if (!fr) { logger.step('skip', `${name} לא קיים`); continue; }
  try {
    const cancel = fr.locator('#Cancel').first();
    if (await cancel.isVisible({ timeout: 3000 })) {
      await human.click(cancel, { label: `ביטול ב-${name}` });
      await human.settle(`${name} closed`);
      continue;
    }
  } catch {}
  logger.step('skip', `${name}: לא נמצא כפתור ביטול`);
}

console.log('\nframes פעילים אחרי הניקוי:');
for (const fr of page.frames()) {
  if (/^f\d+$/.test(fr.name() || '')) console.log('  ', fr.name(), fr.url().replace('https://www.comax.co.il/','').split('?')[0]);
}
await logger.shot(page, 'after-cleanup');
await s.browser.close().catch(()=>{});
logger.done();

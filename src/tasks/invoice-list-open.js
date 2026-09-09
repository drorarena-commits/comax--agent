/**
 * פותח את רשימת החשבוניות, מסנן למספר אחד, ועוצר שם.
 *
 * This is the "set the screen up for me" task: it does not read the document,
 * does not print it and does not leave. It exists so a person can take over a
 * live screen — to photograph a route the agent has not learned yet, or to
 * click the step that only a person may click.
 *
 * Run it against a window `npm run open` is holding. The dispatcher signs off
 * and closes any window it opened itself, which would shut the screen the
 * moment it was ready; attached to someone else's window it merely detaches,
 * and the screen stays up.
 */
import { ensureLoggedIn } from '../session.js';
import { openProgram } from '../navigate.js';

export const meta = {
  name: 'invoice-list-open',
  description: 'פותח את רשימת חשבוניות המס, מסנן למספר חשבונית, ומשאיר את המסך פתוח',
  writes: false,
  input: {
    docNo: 'string, אופציונלי — מספר חשבונית לסינון. בלעדיו נפתחת הרשימה המלאה',
    customer: 'string, אופציונלי — שם הלקוח, לבחירת השורה',
  },
};

export async function run(ctx) {
  const { page, human, logger, cfg, input } = ctx;

  await ensureLoggedIn({ page, human, logger, cfg });
  const { frame: list } = await openProgram(ctx, 'a157', { expect: /Doc650V\.asp/i });

  if (input.docNo) {
    // Typing filters. `#Find` opens the advanced-search dialog and leaves it
    // sitting on top of the screen — the opposite of handing over a clean one.
    await human.type('#wFindDocNo', String(input.docNo), { scope: list, label: 'מספר חשבונית' });
    await human.press('Enter', { label: 'החלת הסינון' });
    await human.settle('filtered');
  }

  if (input.customer) {
    // The grid paints the name into more than one cell, so an exact-text match
    // is not unique; the docNo filter has already narrowed it to the right row.
    await human.click(list.locator(`td:text-is(${JSON.stringify(input.customer)})`).first(), {
      label: `בחירת השורה של ${input.customer}`,
    });
    await human.think('row selected');
  }

  const row = await list
    .evaluate(() => {
      const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
      const cells = [...document.querySelectorAll('td[onclick*="onClickTable"]')]
        .map((t) => norm(t.textContent))
        .filter(Boolean);
      return cells.slice(0, 10);
    })
    .catch(() => []);

  await logger.shot(page, 'ready-for-handover');
  logger.step('handover', `המסך מוכן — ${row.join(' · ')}`);
  console.log('\n─────────────────────────────────────────────────────────────');
  console.log('  רשימת החשבוניות פתוחה והמסך מסונן. החלון נשאר פתוח.');
  console.log(`  ${row.join('  ·  ')}`);
  console.log('─────────────────────────────────────────────────────────────\n');

  return { docNo: input.docNo ?? null, row };
}

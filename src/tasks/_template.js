/**
 * Task template — copy this when we add a new Comax action.
 *
 * Every task gets: `human` (paced interaction), `page`, `logger`, `input`
 * (the JSON from the caller) and `dryRun`. Anything irreversible goes behind
 * the dryRun check at the bottom.
 */

export const meta = {
  name: '_template',
  description: 'תבנית למשימה חדשה',
  writes: true, // set false for read-only tasks (reports) so they never dry-run
  input: {
    // example: 'string, required'
  },
};

export async function run({ page, human, logger, input, dryRun }) {
  // 1. Make sure we are logged in and on the right screen.
  //    const { ensureLoggedIn } = await import('../session.js');
  //    await ensureLoggedIn({ page, human, logger });

  // 2. Navigate. Use the selectors recorded in knowledge/screens/*.json.
  //    await human.click('getByRole(...)', { label: 'תפריט לקוחות' });
  //    await human.settle('customer screen');

  // 3. Fill the form.
  //    await human.type('#txtName', input.name, { label: 'שם לקוח' });

  // 4. Show what is about to happen, always.
  await logger.shot(page, 'before-submit');

  if (dryRun) {
    logger.step('dryrun', 'עוצר לפני השמירה. להרצה אמיתית: הוסף --confirm');
    return { dryRun: true };
  }

  // 5. The irreversible step lives here and only here.
  //    await human.click('#btnSave', { label: 'שמור' });
  //    await human.settle('after save');
  //    await logger.shot(page, 'after-submit');

  return { ok: true };
}

/**
 * נקודת הכניסה לסוכני המסמכים.
 *
 * משימה אחת שמדברת עם סוכן־העל, במקום משימה נפרדת לכל מסמך. הסוכן־על מנתב,
 * בודק מוכנות לפני הקליק הראשון, ויודע לשרשר מסמכים.
 *
 *   node tools/run.js document --json '{"list":true}'
 *   node tools/run.js document --json '{"document":"חשבונית מס","customer":"429028","items":[...]}'
 *   node tools/run.js document --json '{"chain":[{...},{...}]}' --confirm
 */
import { ensureLoggedIn } from '../session.js';
import { closePrograms } from '../navigate.js';
import * as registry from '../documents/registry.js';

export const meta = {
  name: 'document',
  description: 'סוכני המסמכים — חשבונית, הצעה, תעודת העברה, דרך סוכן־על אחד',
  writes: true,
  input: {
    list: 'boolean — רק להציג את הסוכנים ומצב המיפוי שלהם, בלי להתחבר',
    document: 'string — שם המסמך או התווית בעברית. למשל "חשבונית מס"',
    customer: 'string — קוד או שם לקוח',
    store: 'string, אופציונלי — מחסן',
    priceList: 'string, אופציונלי — מחירון',
    date: 'string dd/mm/yyyy, אופציונלי',
    agent: 'string, אופציונלי — סוכן',
    details: 'string, אופציונלי — שדה פרטים',
    items: 'array — [{ code, qty, price, discount, remark }]',
    chain: 'array, אופציונלי — [{ document, input, items }] לשרשור מסמכים',
  },
};

export async function run(ctx) {
  const { page, human, logger, cfg, input, dryRun } = ctx;

  // מצב הסוכנים לא דורש דפדפן בכלל.
  if (input.list) {
    const agents = registry.list();
    console.log('\n  סוכני המסמכים:\n');
    for (const a of agents) {
      const missing = Object.entries(a.mapped).filter(([, v]) => !v).map(([k]) => k);
      console.log(
        `    ${a.name.padEnd(16)} ${a.label.padEnd(18)} ${a.shortcut.padEnd(6)} ` +
        `${a.movesStock ? 'מזיז מלאי' : '         '}  ` +
        `${a.ready ? '✅ מוכן' : `⚠️  חסר מיפוי: ${missing.join(', ')}`}`,
      );
    }
    console.log('');
    return { agents };
  }

  // שרשרת: המוכנות של כל השלבים נבדקת לפני שהראשון מתחיל.
  if (input.chain?.length) {
    await ensureLoggedIn({ page, human, logger, cfg });
    await closePrograms(ctx).catch(() => {});
    const steps = input.chain.map((s) => ({ ...s, confirm: !dryRun }));
    const done = await registry.chain(ctx, steps);
    return { chain: done };
  }

  if (!input.document) {
    throw new Error(
      'חסר שדה document. להצגת הסוכנים: --json \'{"list":true}\'',
    );
  }

  const agent = registry.get(input.document);
  // אם אין שורות, מסך השורות לא נחוץ — בדיקה מדויקת במקום גורפת.
  registry.assertReady(agent, { needLines: !!input.items?.length });

  await ensureLoggedIn({ page, human, logger, cfg });
  await closePrograms(ctx).catch(() => {});

  const created = await agent.create(ctx, input);
  if (created.dryRun) {
    console.log(`\n  DRY RUN — ${agent.profile.label} לא נוצר. להרצה אמיתית: --confirm\n`);
    return created;
  }

  const lines = input.items?.length ? await agent.addLines(ctx, input.items) : [];
  // The lines go to `finalize` so an agent can check the money it is about to
  // commit against them — a sum that matches the wrong side of the VAT line is
  // the one error the totals alone cannot show.
  const filed = await agent.finalize(ctx, { confirm: !dryRun, lines });

  const totals = filed.totals ?? {};
  console.log(`\n  ${agent.profile.label} ${created.docNo ?? ''}`);
  for (const l of lines) console.log(`    ${l.item}  ×${l.qty}  @${l.price}  -${l.discount ?? 0}%  = ${l.amount ?? '?'}`);
  console.log(`\n  לפני מע"מ: ${totals.beforeVat ?? '?'}   מע"מ: ${totals.vat ?? '?'}   סה"כ: ${totals.total ?? '?'}`);
  console.log(filed.filed ? '\n  המסמך נקלט.\n' : '\n  המסמך פתוח על המסך ולא נקלט.\n');

  return { document: agent.profile.name, ...created, lines, ...filed };
}

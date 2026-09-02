/**
 * סוכן־העל — the one that talks to all the document agents.
 *
 * It does three things and deliberately nothing else:
 *
 *   1. **Routing.** Hands back the right specialist for a document, by name or
 *      by Hebrew label, and refuses a name it does not know instead of picking
 *      the closest match.
 *   2. **Readiness.** Every agent declares which of its screens are mapped.
 *      A flow that needs an unmapped screen is stopped *before* the first click,
 *      with the mapping command printed — never halfway through a document.
 *   3. **Chaining.** Runs one document after another and stops the chain the
 *      moment a step fails, so a broken second document cannot leave the first
 *      half-filed. This is what makes "חשבונית ואז תעודת העברה" one operation.
 *
 * It does not know how any individual document behaves. That knowledge belongs
 * to the agent — a tax invoice moves stock the instant it is filed, a quote can
 * be abandoned, a transfer has no customer at all — and pulling it up to here
 * is what would turn four specialists back into one mediocre generalist.
 */
import * as invoice from './agents/invoice/index.js';
import * as invoiceReceipt from './agents/invoice-receipt/index.js';
import * as quote from './agents/quote/index.js';
import * as transfer from './agents/transfer/index.js';

/** Every document agent, keyed by its short name. */
const AGENTS = {
  [invoice.profile.name]: invoice,
  [invoiceReceipt.profile.name]: invoiceReceipt,
  [quote.profile.name]: quote,
  [transfer.profile.name]: transfer,
};

/** Hebrew labels and common aliases, so callers can say what they mean. */
const ALIASES = {
  'חשבונית': 'invoice',
  'חשבונית מס': 'invoice',
  'tax-invoice': 'invoice',
  'חשבונית מס/קבלה': 'invoice-receipt',
  'חשבונית קבלה': 'invoice-receipt',
  'הצעה': 'quote',
  'הצעת מחיר': 'quote',
  'תעודת העברה': 'transfer',
  'העברה': 'transfer',
  'העברת מלאי': 'transfer',
};

export function list() {
  return Object.values(AGENTS).map((a) => ({
    name: a.profile.name,
    label: a.profile.label,
    shortcut: a.profile.shortcut,
    movesStock: !!a.profile.movesStock,
    ready: isReady(a),
    mapped: a.profile.mapped,
  }));
}

const isReady = (agent) => Object.values(agent.profile.mapped ?? {}).every(Boolean);

/** The specialist for a document. Throws with the full menu on an unknown name. */
export function get(nameOrLabel) {
  const key = ALIASES[String(nameOrLabel ?? '').trim()] ?? String(nameOrLabel ?? '').trim();
  const agent = AGENTS[key];
  if (agent) return agent;
  throw new Error(
    `אין סוכן למסמך "${nameOrLabel}". הקיימים:\n` +
    list().map((a) => `  ${a.name.padEnd(10)} ${a.label.padEnd(16)} ${a.ready ? 'מוכן' : 'לא ממופה'}`).join('\n'),
  );
}

/**
 * Stop before the first click if a document cannot be driven end to end.
 *
 * Checked up front on purpose: discovering an unmapped lines screen *after* the
 * header is committed leaves a real document open in Comax with nothing in it.
 */
export function assertReady(agent, { needLines = true } = {}) {
  const m = agent.profile.mapped ?? {};
  const missing = ['list', 'header', ...(needLines ? ['lines'] : [])].filter((s) => !m[s]);
  if (!missing.length) return;
  throw new Error(
    `${agent.profile.label}: המסכים ${missing.join(', ')} לא מופו — עוצר לפני הקליק הראשון.\n` +
    `  למפות: npm run open-program -- ${agent.profile.shortcut}  ואז  npm run snapshot -- ${agent.profile.name}-<מסך>`,
  );
}

/**
 * Run several documents in order, stopping at the first failure.
 *
 * `steps` is `[{ document, input, items, confirm }]`. Readiness for *all* of
 * them is checked before any of them starts — a chain that cannot finish should
 * not begin, or the invoice gets filed and the transfer that was supposed to
 * balance it never happens.
 */
export async function chain(ctx, steps) {
  const agents = steps.map((s) => get(s.document));
  agents.forEach((a) => assertReady(a));

  const done = [];
  for (const [i, step] of steps.entries()) {
    const agent = agents[i];
    ctx.logger.step('chain', `${i + 1}/${steps.length} — ${agent.profile.label}`);
    try {
      const created = await agent.create(ctx, step.input ?? {});

      // A dry run stops at the header, so there is no lines dialog for the next
      // call to type into and no filed document for the next step to build on.
      // Walking on regardless threw "דיאלוג הוספת שורה לא פתוח" from step 1 and
      // read as a broken chain rather than as the rehearsal it was asked to be.
      if (created.dryRun) {
        await agent.backOut(ctx).catch(() => {});
        done.push({ document: agent.profile.name, ...created, dryRun: true });
        ctx.logger.step('chain', `DRY RUN — נעצר אחרי הכותרת של ${agent.profile.label}. ${steps.length - i - 1} שלבים לא נוסו.`);
        break;
      }

      const lines = step.items?.length ? await agent.addLines(ctx, step.items) : [];
      // `items` and `allowShort` ride along for the agents that gate on them —
      // a transfer checks the source warehouse against the codes as asked for,
      // and the sales agents ignore keys they do not use.
      const filed = await agent.finalize(ctx, {
        confirm: !!step.confirm, lines, items: step.items ?? [], allowShort: !!step.allowShort,
      });
      done.push({ document: agent.profile.name, ...created, lines, ...filed });
    } catch (e) {
      await agent.backOut(ctx).catch(() => {});
      throw new Error(
        `השרשרת נעצרה בשלב ${i + 1}/${steps.length} (${agent.profile.label}): ${e.message}\n` +
        (done.length ? `  הושלמו לפני כן: ${done.map((d) => `${d.document} ${d.docNo ?? ''}`).join(', ')}` : '  שום מסמך לא נוצר.'),
      );
    }
  }
  return done;
}

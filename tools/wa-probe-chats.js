#!/usr/bin/env node
/**
 * Find out WHY `getChats` fails.
 *
 * The injected implementation is:
 *   Chat.getModelsArray().map(getChatModel)  →  Promise.all(...)
 *
 * `Promise.all` rejects on the FIRST failure, so a single unmappable chat takes
 * the entire call down and reports one minified `r`. This probe runs the same
 * work with `allSettled` and counts, which separates two very different
 * diagnoses: "the Store moved and nothing maps" vs "3 chats out of 400 are odd".
 *
 * The second is fixable without touching the served WhatsApp Web version.
 */

import { makeClient, connect, shutdown } from '../src/whatsapp/client.js';

const client = makeClient({});

try {
  await connect(client, { timeoutMs: 180000 });
  console.log('✅ ready');

  const result = await client.pupPage.evaluate(async () => {
    const out = { total: 0, ok: 0, failed: 0, errors: [], samples: [] };
    let models;
    try {
      models = window.require('WAWebCollections').Chat.getModelsArray();
    } catch (e) {
      return { fatal: `Chat.getModelsArray נכשל: ${e?.message || e}` };
    }
    out.total = models.length;

    const settled = await Promise.allSettled(
      models.map((m) => window.WWebJS.getChatModel(m)),
    );

    settled.forEach((s, i) => {
      if (s.status === 'fulfilled') {
        out.ok += 1;
        if (out.samples.length < 3) {
          out.samples.push({
            id: s.value?.id?._serialized,
            name: s.value?.name || s.value?.formattedTitle,
          });
        }
      } else {
        out.failed += 1;
        const msg = String(s.reason?.message || s.reason);
        if (out.errors.length < 8) {
          out.errors.push({
            index: i,
            id: models[i]?.id?._serialized ?? '(אין id)',
            isGroup: !!models[i]?.isGroup,
            error: msg,
          });
        }
      }
    });
    return out;
  });

  console.log('');
  console.log(JSON.stringify(result, null, 2));
  console.log('');
  if (result.fatal) {
    console.log('⛔ כשל שורשי — ה-Store זז. נדרשת נעיצת גרסת Web.');
  } else if (result.failed === 0) {
    console.log('🤔 כל השיחות מופו בהצלחה — הכשל אינו כאן.');
  } else if (result.ok > 0) {
    console.log(
      `✅ ${result.ok} שיחות מופו · ${result.failed} נכשלו — ניתן לעקוף ב-allSettled, בלי לגעת בגרסת ה-Web.`,
    );
  } else {
    console.log('⛔ אף שיחה לא מופתה — נדרשת נעיצת גרסת Web.');
  }
} catch (e) {
  console.log('❌', e?.message);
  console.log(e?.stack);
} finally {
  await shutdown(client);
}

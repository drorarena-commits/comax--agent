/**
 * Reading chats without letting one bad chat hide all of them.
 *
 * THE BUG THIS EXISTS FOR (measured 14/09/2026)
 * ---------------------------------------------
 * `client.getChats()` is, inside the page:
 *
 *   Chat.getModelsArray().map(getChatModel)  →  Promise.all(...)
 *
 * `Promise.all` rejects on the first failure. On Dror's account 21 of 899 chats
 * throw `DataError: Failed to execute 'get' on 'IDBObjectStore'` — `@lid`
 * identities and groups whose metadata is not in the local cache. So the whole
 * call died and reported a single minified `r`, which read like "the library is
 * incompatible with this WhatsApp Web version" and was nothing of the kind.
 *
 * `allSettled` keeps the 878 that map fine.
 *
 * ⚠️ AND THE COUNT IS REPORTED, NEVER SWALLOWED. Rule 16 of this project: a
 * partial read looks exactly like a complete one. "878 chats" presented as
 * everything would be a quiet lie in the one place it matters — a customer
 * whose chat is among the 21 would simply not exist as far as any summary is
 * concerned.
 *
 * ⚠️ DO NOT TRUST THE FAILED CHATS' OWN FIELDS. The probe printed
 * `isGroup: false` for ids ending in `@g.us`, which are groups beyond doubt:
 * a model that fails to map also fails to answer questions about itself. Counts
 * are reliable; the identity of a failed row is not.
 */

/**
 * Normalise one raw chat model into the shape the rest of the code reads.
 *
 * WHY THIS LAYER EXISTS — MEASURED, NOT GUESSED (14/09/2026)
 * The model comes from `chat.serialize()`, so its field names are WhatsApp
 * Web's and they move between versions. On 2.3000.1047451014 the last-activity
 * timestamp is **`t`**; `timestamp` and `sortTimestamp` do not exist at all.
 *
 * Reading `c.timestamp` therefore yielded `undefined` for all 899 chats — and
 * the damage was silent: the listing rendered with blank dates in an unsorted
 * order and looked like a working listing. Nothing threw.
 *
 * That is the same class of trap as rule 14 (desktop shortcut ids drift, so
 * find by text). The answer is the same: measure the field, then normalise it
 * in ONE place so the next drift is a single fix rather than a hunt.
 *
 * `isGroup` is derived from the JID suffix rather than the model, because a
 * model whose `groupMetadata.update()` failed also answers `isGroup` wrongly —
 * the probe printed `isGroup: false` for ids ending in `@g.us`.
 */
function normalise(c) {
  const jid = c?.id?._serialized ?? null;
  return {
    ...c,
    jid,
    // `t` is the measured field; the others are kept as fallbacks in case a
    // future version renames it back rather than away.
    timestamp: c?.t ?? c?.timestamp ?? c?.sortTimestamp ?? null,
    isGroup: jid ? /@g\.us$/.test(jid) : !!c?.isGroup,
    isChannel: jid ? /@newsletter$/.test(jid) : false,
    unreadCount: c?.unreadCount ?? 0,
    title: c?.formattedTitle || c?.name || null,
  };
}

/**
 * @returns {Promise<{chats: object[], total: number, failed: number}>}
 */
export async function safeGetChats(client) {
  const raw = await client.pupPage.evaluate(async () => {
    const models = window.require('WAWebCollections').Chat.getModelsArray();
    const settled = await Promise.allSettled(
      models.map((m) => window.WWebJS.getChatModel(m)),
    );
    const chats = [];
    let failed = 0;
    for (const s of settled) {
      if (s.status === 'fulfilled' && s.value) chats.push(s.value);
      else failed += 1;
    }
    return { chats, total: models.length, failed };
  });

  return {
    chats: raw.chats.map(normalise),
    total: raw.total,
    failed: raw.failed,
  };
}

/**
 * One line stating the completeness of a chat listing, or null when it was
 * complete. Callers print it; they do not decide whether it is worth printing.
 */
export function completenessNote(total, failed) {
  if (!failed) return null;
  // The count is NOT stable between runs — measured 21, then 42 on the next
// connection. It depends on what group metadata happens to be in the local
// IndexedDB cache, so it is reported as "in this run" and never as a property
// of the account.
  return (
    `⚠️ ${failed} מתוך ${total} השיחות לא נקראו בהרצה הזאת ` +
    `(זהויות @lid וקבוצות שאין להן מטא-דאטה מקומי; המספר משתנה בין הרצות). ` +
    `הן אינן בתשובה — כולל, אם זה המצב, שיחה שחיפשת.`
  );
}

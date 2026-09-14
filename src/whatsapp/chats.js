/**
 * Reading chats — and reading ALL of them.
 *
 * THE BUG, AND TWO WRONG DIAGNOSES ON THE WAY TO IT (14/09/2026)
 * -------------------------------------------------------------
 * `client.getChats()` is, inside the page:
 *
 *   Chat.getModelsArray().map(getChatModel)  →  Promise.all(...)
 *
 * Two separate faults sat in that one line.
 *
 * `Promise.all` rejects on the FIRST failure, so a handful of odd chats killed
 * the whole call and reported a single minified `r` — which read like "the
 * library does not support this WhatsApp Web version" and was nothing of the
 * kind. `allSettled` fixed that, and revealed the second fault.
 *
 * `getChatModel` is HEAVY: it calls `groupMetadata.update()`, which hits
 * IndexedDB. Across 899 chats at once, a large and RANDOM share failed — the
 * unreadable count measured 21, then 42, then 23, then 67, then 584, depending
 * only on what happened to be cached.
 *
 * ⚠️ I BLAMED THE WRONG THING TWICE, AND BOTH GUESSES WENT INTO THE DOCS
 * BEFORE BEING TESTED: first "groups without local metadata", then "@lid
 * identities". The measurement that was meant to size the hole disproved both —
 * 289 `@lid` chats read perfectly in the same run. The tell I should have
 * followed was not the id suffix but the INSTABILITY: a count that swings
 * 21→42→23→67→584 is load or a race, never a property of the data.
 *
 * The fix is to stop doing unnecessary work. A chat listing needs four fields —
 * id, title, time, unread — and all four are plain getters on the model. Result:
 * 899 of 899, stable across runs.
 *
 * ⚠️ THE COUNT IS STILL REPORTED, NEVER SWALLOWED. Rule 16: a partial read
 * looks exactly like a complete one. "878 chats" presented as everything hid a
 * real contact — "מאיר מיזונו" was invisible at 315/899 and found immediately at
 * 899/899. Without that line the answer would have been a confident "no such
 * conversation".
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
    const chats = [];
    let failed = 0;

    for (const m of models) {
      // ⚠️ READ THE FIELDS DIRECTLY — DO NOT CALL getChatModel HERE.
      //
      // Measured 14/09/2026, and this was the real bug behind every "N chats
      // could not be read" figure. `getChatModel` is heavy: it calls
      // `groupMetadata.update()`, which hits IndexedDB. Running it across 899
      // chats at once made a large and RANDOM share of them fail — the count
      // came out 21, then 42, then 23, then 67, then 584, depending only on
      // what happened to be cached.
      //
      // A chat listing needs four fields: id, title, time, unread. All four are
      // plain getters on the model and need no async work at all. The earlier
      // diagnosis blamed `@lid` identities; that was wrong — 289 `@lid` chats
      // read fine in the same run. The cause was the unnecessary heavy call.
      try {
        const jid = m?.id?._serialized;
        if (!jid) {
          failed += 1;
          continue;
        }
        chats.push({
          id: { _serialized: jid },
          t: m.t ?? null,
          unreadCount: m.unreadCount ?? 0,
          name: m.name ?? null,
          formattedTitle: m.formattedTitle ?? null,
        });
      } catch {
        failed += 1;
      }
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
  // Deliberately does NOT name a cause. The two causes I named before were both
  // wrong ("groups without metadata", then "@lid identities"), and a confident
  // wrong reason in every answer is worse than a plain count.
  return (
    `⚠️ ${failed} מתוך ${total} השיחות לא נקראו בהרצה הזאת. ` +
    `הן אינן בתשובה — כולל, אם זה המצב, שיחה שחיפשת. ` +
    `אחרי התיקון של 14/09 הצפוי הוא 0; מספר גדול מאפס הוא רגרסיה שכדאי לחקור.`
  );
}

/**
 * Read one chat's messages without going through `getChatById`.
 *
 * WHY — MEASURED 14/09/2026
 * `client.getChatById('31512258990110@lid')` fails with a minified `r`, while
 * that same chat's name and timestamp read perfectly. The wrapper builds a
 * `Wid` and looks the chat up through it, and that path does not handle LID
 * identities in whatsapp-web.js 1.34.7.
 *
 * This is the SECOND time the same shape of bug appeared: the heavy wrapper
 * breaks, the underlying model is fine. So the fix is the same one — find the
 * model directly in the collection by its serialized id, and read the fields
 * off it. `loadEarlierMsgs({chat})` is the one call that must stay, because it
 * is what pulls older messages into the model; measured working, and note the
 * object wrapper — passing the chat bare throws.
 *
 * @returns {Promise<{title, jid, read, requested, mayHaveOlder, rows}>}
 */
export async function readChatDirect(client, jid, limit = 60) {
  const out = await client.pupPage.evaluate(
    async (targetJid, want) => {
      const models = window.require('WAWebCollections').Chat.getModelsArray();
      const chat = models.find((m) => m?.id?._serialized === targetJid);
      if (!chat) return { error: `לא נמצאה שיחה עם המזהה ${targetJid}` };

      const title = chat.formattedTitle || chat.name || null;

      // Pull older messages until we have enough or WhatsApp has no more.
      // The loop is bounded twice over: by `want`, and by a hard iteration cap
      // so a version that always returns a non-empty array cannot spin here.
      let guard = 0;
      const have = () => chat.msgs?.getModelsArray?.() ?? [];
      while (have().length < want && guard < 40) {
        guard += 1;
        let loaded;
        try {
          loaded = await window
            .require('WAWebChatLoadMessages')
            .loadEarlierMsgs({ chat });
        } catch (e) {
          // Report rather than swallow: `fetchMessages` treats a throw here as
          // "no messages", which is how a broken loader looked like an empty
          // conversation for most of this build.
          return { error: `loadEarlierMsgs נכשל: ${e?.message || e}`, title };
        }
        if (!loaded || loaded.length === 0) break;
      }

      const msgs = have()
        .filter((m) => !m.isNotification)
        .map((m) => ({
          fromMe: !!(m.id?.fromMe ?? m.fromMe),
          t: m.t ?? null,
          type: m.type ?? null,
          body: m.body ?? m.caption ?? null,
        }))
        .sort((a, b) => (a.t || 0) - (b.t || 0));

      return {
        title,
        jid: targetJid,
        read: msgs.length,
        requested: want,
        noEarlier: !!chat.noEarlierMsgs,
        rows: msgs.slice(-want),
      };
    },
    jid,
    limit,
  );

  if (out?.error) throw new Error(out.error);

  // Rule 16: state completeness rather than implying it. `noEarlier` is
  // WhatsApp's own claim that nothing older exists — the only honest basis for
  // saying a read was complete.
  return {
    ...out,
    mayHaveOlder: out.read >= limit && !out.noEarlier,
  };
}

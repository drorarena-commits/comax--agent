#!/usr/bin/env node
/**
 * Does requesting history from the phone actually populate a chat?
 *
 * THE PROBLEM THIS SETTLES
 * ------------------------
 * `fetchMessages` returned 0 for five of six busy chats and 14 for the sixth.
 * Since one chat worked, the mechanism is fine — what is missing is the history
 * itself. `client.syncHistory(chatId)` asks the PHONE to push it, gated on
 * `endOfHistoryTransferType === 0`, and the push arrives asynchronously.
 *
 * So this measures three things that a single `fetchMessages` call conflates:
 *   1. the flags before   — is this chat even a candidate for syncing?
 *   2. whether the request was accepted
 *   3. the count after waiting — did anything actually arrive?
 *
 * Answering "does it work" without step 3 would be verifying the mechanism
 * instead of the outcome.
 */

import { makeClient, connect, shutdown } from '../src/whatsapp/client.js';
import { safeGetChats } from '../src/whatsapp/chats.js';

const WAIT_SECONDS = Number(process.argv[2] || 45);
const SAMPLE = 4;

const client = makeClient({});

const flagsFor = (c, jid) =>
  client.pupPage.evaluate((id) => {
    const wid = window.require('WAWebWidFactory').createWid(id);
    const chat = window.require('WAWebCollections').Chat.get(wid);
    if (!chat) return { found: false };
    return {
      found: true,
      endOfHistoryTransferType: chat.endOfHistoryTransferType ?? null,
      endOfHistoryTransfer: chat.endOfHistoryTransfer ?? null,
      pendingInitialLoading: chat.pendingInitialLoading ?? null,
      noEarlierMsgs: chat.noEarlierMsgs ?? null,
      hasChatBeenOpened: chat.hasChatBeenOpened ?? null,
      msgsInModel: chat.msgs?.getModelsArray?.().length ?? null,
    };
  }, jid);

const countMessages = async (jid, limit = 200) => {
  try {
    const chat = await client.getChatById(jid);
    const msgs = await chat.fetchMessages({ limit });
    return { count: msgs.length, error: null };
  } catch (e) {
    return { count: null, error: e?.message || String(e) };
  }
};

try {
  await connect(client, { timeoutMs: 240000 });
  console.log('✅ ready');

  const { chats } = await safeGetChats(client);
  const busy = chats
    .filter((c) => c.timestamp && c.jid && !c.isChannel)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, SAMPLE);

  const rows = [];
  for (const c of busy) {
    const before = await flagsFor(c, c.jid);
    const countBefore = await countMessages(c.jid);
    let requested = null;
    let reqError = null;
    try {
      requested = await client.syncHistory(c.jid);
    } catch (e) {
      reqError = e?.message || String(e);
    }
    rows.push({ chat: c, before, countBefore, requested, reqError });
    console.log(
      `· ${c.title || c.jid} — לפני: ${countBefore.count ?? 'ERR'} הודעות · ` +
        `transferType=${before.endOfHistoryTransferType} · בקשה=${requested}${reqError ? ` (${reqError})` : ''}`,
    );
  }

  console.log('');
  console.log(`ממתין ${WAIT_SECONDS} שניות שהטלפון ידחוף...`);
  await new Promise((r) => setTimeout(r, WAIT_SECONDS * 1000));

  console.log('');
  console.log('═══ אחרי ההמתנה ═══');
  let improved = 0;
  for (const r of rows) {
    const after = await countMessages(r.chat.jid);
    const afterFlags = await flagsFor(r.chat, r.chat.jid);
    const delta =
      after.count !== null && r.countBefore.count !== null
        ? after.count - r.countBefore.count
        : null;
    if (delta && delta > 0) improved += 1;
    console.log(
      `${r.chat.title || r.chat.jid}: ${r.countBefore.count ?? 'ERR'} → ${after.count ?? 'ERR'}` +
        (delta ? `  (+${delta})` : '') +
        ` · msgsInModel=${afterFlags.msgsInModel} · noEarlier=${afterFlags.noEarlierMsgs}`,
    );
  }

  console.log('');
  console.log('═══ הכרעה ═══');
  if (improved > 0) {
    console.log(
      `✅ ${improved} מתוך ${rows.length} שיחות התמלאו — בקשת היסטוריה מהטלפון עובדת. צריך שלב סנכרון.`,
    );
  } else {
    console.log(
      '⛔ אף שיחה לא התמלאה. הבקשה לבדה אינה מספיקה — נדרש מסלול אחר (או המתנה ארוכה בהרבה).',
    );
  }
  console.log('');
} catch (e) {
  console.log('❌', e?.message);
  console.log(e?.stack);
  process.exitCode = 1;
} finally {
  await shutdown(client);
}

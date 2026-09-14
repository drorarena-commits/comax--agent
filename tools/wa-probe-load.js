#!/usr/bin/env node
/**
 * Why does `loadEarlierMsgs` return nothing?
 *
 * State measured so far: `endOfHistoryTransferType === 2` (WhatsApp considers
 * the transfer done, so `syncHistory` refuses to ask), `noEarlierMsgs === false`
 * (it knows older messages exist), and `msgs` is empty. So the loader is the
 * link that fails — and `fetchMessages` swallows it, because its loop is
 * `if (!loaded || !loaded.length) break`, which turns an exception-free empty
 * return into a silent 0.
 *
 * This probe tries each hypothesis separately and prints what each one did:
 *   A. call loadEarlierMsgs directly and catch the error it may be throwing
 *   B. list what the module actually exports (the signature may have moved)
 *   C. open/activate the chat first, the way the real UI does, then load
 *
 * The point is to find which of these produces messages, not to prove a theory.
 */

import { makeClient, connect, shutdown } from '../src/whatsapp/client.js';
import { safeGetChats } from '../src/whatsapp/chats.js';

const client = makeClient({});

try {
  await connect(client, { timeoutMs: 240000 });
  console.log('✅ ready');

  const { chats } = await safeGetChats(client);
  const target = chats
    .filter((c) => c.timestamp && c.jid && !c.isChannel && !c.isGroup)
    .sort((a, b) => b.timestamp - a.timestamp)[0];

  if (!target) {
    console.log('לא נמצאה שיחה אישית לבדיקה');
    process.exit(0);
  }
  console.log(`שיחת מבחן: ${target.title || target.jid}  (${target.jid})`);
  console.log('');

  const out = await client.pupPage.evaluate(async (jid) => {
    const res = {};
    const wid = window.require('WAWebWidFactory').createWid(jid);
    const chat = window.require('WAWebCollections').Chat.get(wid);
    res.chatFound = !!chat;
    if (!chat) return res;

    res.before = chat.msgs?.getModelsArray?.().length ?? null;

    // ── B: what does the module export?
    try {
      const mod = window.require('WAWebChatLoadMessages');
      res.moduleKeys = Object.keys(mod);
    } catch (e) {
      res.moduleError = String(e?.message || e);
    }

    // ── A: direct call, with the error surfaced instead of swallowed
    try {
      const loaded = await window
        .require('WAWebChatLoadMessages')
        .loadEarlierMsgs({ chat });
      res.loadEarlier = {
        type: typeof loaded,
        isArray: Array.isArray(loaded),
        length: Array.isArray(loaded) ? loaded.length : null,
        value: loaded === null ? 'null' : loaded === undefined ? 'undefined' : 'other',
      };
    } catch (e) {
      res.loadEarlierError = String(e?.message || e);
    }

    // Some versions take the chat directly rather than wrapped in an object.
    try {
      const loaded2 = await window
        .require('WAWebChatLoadMessages')
        .loadEarlierMsgs(chat);
      res.loadEarlierBare = Array.isArray(loaded2) ? loaded2.length : typeof loaded2;
    } catch (e) {
      res.loadEarlierBareError = String(e?.message || e);
    }

    // ── C: activate the chat the way opening it in the UI does
    try {
      const cmd = window.require('WAWebCmd').Cmd;
      res.cmdKeys = Object.keys(cmd).filter((k) => /open|chat/i.test(k)).slice(0, 20);
      await cmd.openChatAt({ chat, msgContextId: null });
      res.opened = true;
    } catch (e) {
      res.openError = String(e?.message || e);
    }

    await new Promise((r) => setTimeout(r, 4000));
    res.afterOpen = chat.msgs?.getModelsArray?.().length ?? null;

    // ── and load again now that it is active
    try {
      const loaded3 = await window
        .require('WAWebChatLoadMessages')
        .loadEarlierMsgs({ chat });
      res.loadAfterOpen = Array.isArray(loaded3) ? loaded3.length : typeof loaded3;
    } catch (e) {
      res.loadAfterOpenError = String(e?.message || e);
    }

    res.finalMsgs = chat.msgs?.getModelsArray?.().length ?? null;
    return res;
  }, target.jid);

  console.log(JSON.stringify(out, null, 2));

  console.log('');
  console.log('═══ הכרעה ═══');
  if (out.finalMsgs > 0) {
    console.log(`✅ יש ${out.finalMsgs} הודעות במודל — מצאנו מסלול שעובד.`);
    if (out.afterOpen > 0 && out.before === 0) {
      console.log('   הגורם: פתיחת השיחה. צריך להפעיל אותה לפני הקריאה.');
    }
    if (out.loadAfterOpen > 0) {
      console.log('   loadEarlierMsgs עובד אחרי הפעלת השיחה.');
    }
  } else {
    console.log('⛔ עדיין 0 הודעות. הסיבות שנמדדו מודפסות למעלה.');
  }
  console.log('');
} catch (e) {
  console.log('❌', e?.message);
  console.log(e?.stack);
  process.exitCode = 1;
} finally {
  await shutdown(client);
}

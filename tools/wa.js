#!/usr/bin/env node
/**
 * WhatsApp bridge — the CLI. Reading is the whole point; sending is the guarded
 * exception.
 *
 * Commands:
 *   npm run wa -- status
 *   npm run wa -- chats [--limit 30] [--unread] [--json]
 *   npm run wa -- read <number|jid> [--limit 50] [--json]
 *   npm run wa -- search "<query>" [--limit 30] [--json]
 *   npm run wa -- send <number|jid> "<text>" [--confirm]
 *
 * ON PARTIAL READS
 * ----------------
 * Rule 16 of this project exists because a truncated read looks exactly like a
 * complete one. `fetchMessages({limit})` returns the most recent N with no
 * indication that older ones exist, so every read here states how many it got
 * and says outright when there are probably more. A summary built on a silent
 * truncation is worse than no summary.
 */

import {
  makeClient,
  connect,
  hasProfile,
  selfJid,
  shutdown,
} from '../src/whatsapp/client.js';
import { guardedSend, toJid, jidToNumber } from '../src/whatsapp/guard.js';
import { safeGetChats, completenessNote } from '../src/whatsapp/chats.js';
import {
  pending as queuePending,
  all as queueAll,
  byId as queueById,
  queueAnswer,
  markSkipped,
  requestRead,
} from '../src/whatsapp/queue.js';

const argv = process.argv.slice(2);
const cmd = (argv[0] || '').toLowerCase();
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const positional = argv.slice(1).filter((a) => !a.startsWith('--'));

function flagValue(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = argv[i + 1];
  return v && !v.startsWith('--') ? v : fallback;
}

const asJson = flags.has('--json');
const limit = Number(flagValue('limit', cmd === 'read' ? 50 : 30));

function when(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function bodyOf(m) {
  if (m.body) return m.body;
  // Media with no caption would otherwise read as an empty line, which looks
  // like a message that was never sent.
  if (m.hasMedia) return `[${m.type || 'מדיה'}]`;
  return `[${m.type || 'ללא תוכן'}]`;
}

async function withClient(fn) {
  if (!hasProfile()) {
    console.error('לא מקושר לוואטסאפ. להתחיל: npm run wa-link -- 05XXXXXXXX');
    process.exitCode = 2;
    return;
  }
  const client = makeClient({ headed: flags.has('--headed') });
  try {
    await connect(client, {
      onProgress: (p, m) => process.stderr.write(`   טוען WhatsApp Web… ${p}% ${m}   `),
    });
    console.error('');
    await fn(client);
  } finally {
    await shutdown(client);
  }
}

async function cmdStatus() {
  await withClient(async (client) => {
    const me = selfJid(client);
    const { chats, total, failed } = await safeGetChats(client);
    const unread = chats.filter((c) => c.unreadCount > 0);
    if (asJson) {
      console.log(
        JSON.stringify(
          {
            linked: true,
            self: jidToNumber(me),
            chats: chats.length,
            chatsTotal: total,
            chatsUnreadable: failed,
            unread: unread.length,
          },
          null,
          2,
        ),
      );
      return;
    }
    console.log(`✅ מקושר כ-${jidToNumber(me)}`);
    console.log(`   ${chats.length} שיחות · ${unread.length} עם הודעות שלא נקראו`);
    const note = completenessNote(total, failed);
    if (note) console.log(`   ${note}`);
  });
}

async function cmdChats() {
  await withClient(async (client) => {
    const listing = await safeGetChats(client);
    let chats = listing.chats;
    if (flags.has('--unread')) chats = chats.filter((c) => c.unreadCount > 0);
    chats.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    const shown = chats.slice(0, limit);

    const rows = shown.map((c) => ({
      name: c.title || (c.jid ? jidToNumber(c.jid) : '(ללא זיהוי)'),
      jid: c.jid,
      number: c.isGroup || c.isChannel || !c.jid ? null : jidToNumber(c.jid),
      group: c.isGroup,
      channel: c.isChannel,
      unread: c.unreadCount,
      last: when(c.timestamp),
    }));

    if (asJson) {
      console.log(
        JSON.stringify(
          {
            total: chats.length,
            chatsTotal: listing.total,
            chatsUnreadable: listing.failed,
            shown: rows.length,
            rows,
          },
          null,
          2,
        ),
      );
      return;
    }
    console.log(`${rows.length} שיחות (מתוך ${chats.length}):`);
    console.log('');
    for (const r of rows) {
      const mark = r.unread ? ` [${r.unread} חדשות]` : '';
      const kind = r.group ? ' (קבוצה)' : r.channel ? ' (ערוץ)' : '';
      console.log(`${r.last}  ${r.name}${kind}${mark}`);
      if (r.number) console.log(`         ${r.number}`);
    }
    if (chats.length > rows.length) {
      console.log('');
      console.log(`— עוד ${chats.length - rows.length} שיחות לא הוצגו. --limit להרחבה.`);
    }
    const note = completenessNote(listing.total, listing.failed);
    if (note) {
      console.log('');
      console.log(note);
    }
  });
}

async function cmdRead() {
  const target = positional[0];
  if (!target) {
    console.error('חסר נמען. למשל: npm run wa -- read 0501234567');
    process.exitCode = 2;
    return;
  }
  await withClient(async (client) => {
    const jid = toJid(target);
    const chat = await client.getChatById(jid).catch(() => null);
    if (!chat) {
      console.error(`אין שיחה עם ${jidToNumber(jid)}`);
      process.exitCode = 1;
      return;
    }
    const msgs = await chat.fetchMessages({ limit });
    const rows = msgs.map((m) => ({
      at: when(m.timestamp),
      fromMe: !!m.fromMe,
      author: m.fromMe ? 'אני' : chat.name || jidToNumber(jid),
      body: bodyOf(m),
    }));

    // Rule 16: say what was read, and say when it is probably not everything.
    const maybeMore = msgs.length >= limit;

    if (asJson) {
      console.log(
        JSON.stringify(
          {
            chat: chat.name || jidToNumber(jid),
            jid,
            read: rows.length,
            limit,
            mayHaveOlder: maybeMore,
            rows,
          },
          null,
          2,
        ),
      );
      return;
    }
    console.log(`שיחה: ${chat.name || jidToNumber(jid)}  (${jidToNumber(jid)})`);
    console.log(`נקראו ${rows.length} ההודעות האחרונות.`);
    if (maybeMore) {
      console.log(
        `⚠️ הגעתי לתקרת ה-limit (${limit}) — כמעט בוודאי יש הודעות ישנות יותר שלא נקראו.`,
      );
    }
    console.log('');
    for (const r of rows) {
      console.log(`[${r.at}] ${r.author}: ${r.body}`);
    }
  });
}

async function cmdSearch() {
  const query = positional[0];
  if (!query) {
    console.error('חסרה מחרוזת חיפוש. למשל: npm run wa -- search "הזמנה"');
    process.exitCode = 2;
    return;
  }
  await withClient(async (client) => {
    const msgs = await client.searchMessages(query, { limit });
    const rows = msgs.map((m) => ({
      at: when(m.timestamp),
      chat: m.id?.remote ? jidToNumber(m.id.remote) : '',
      fromMe: !!m.fromMe,
      body: bodyOf(m),
    }));
    if (asJson) {
      console.log(
        JSON.stringify(
          { query, found: rows.length, limit, mayHaveMore: rows.length >= limit, rows },
          null,
          2,
        ),
      );
      return;
    }
    console.log(`"${query}" — ${rows.length} תוצאות:`);
    if (rows.length >= limit) {
      console.log(`⚠️ הגעתי לתקרת ה-limit (${limit}) — ייתכן שיש עוד.`);
    }
    console.log('');
    for (const r of rows) {
      console.log(`[${r.at}] ${r.fromMe ? 'אני' : r.chat}: ${r.body}`);
    }
  });
}

async function cmdSend() {
  const [target, text] = positional;
  if (!target || !text) {
    console.error('שימוש: npm run wa -- send <מספר> "<טקסט>" [--confirm]');
    process.exitCode = 2;
    return;
  }
  await withClient(async (client) => {
    try {
      const r = await guardedSend(client, {
        to: target,
        body: text,
        confirmed: flags.has('--confirm'),
      });
      console.log(`✅ נשלח ל-${r.name} (${r.number})`);
      if (r.warning) console.log(r.warning);
    } catch (e) {
      // A refusal is the expected outcome without --confirm, so show the
      // preview that WOULD have gone out rather than only the error.
      console.log(`⛔ לא נשלח: ${e.message}`);
      console.log('');
      console.log(`נמען מבוקש: ${target}`);
      console.log(`הטקסט:      ${text}`);
      process.exitCode = 1;
    }
  });
}

async function cmdQueue() {
  const items = flags.has('--all') ? queueAll() : queuePending();
  if (asJson) {
    console.log(JSON.stringify({ count: items.length, items }, null, 2));
    return;
  }
  if (items.length === 0) {
    console.log('התור ריק.');
    return;
  }
  console.log(`${items.length} פריטים${flags.has('--all') ? ' (הכל)' : ' ממתינים'}:`);
  console.log('');
  for (const i of items) {
    const when = new Date(i.at).toLocaleString('he-IL');
    const mark = i.status === 'needs-approval' ? ' ⚠️ דורש אישור' : '';
    console.log(`[${i.id}] ${when} · ${i.principal}${mark}`);
    console.log(`        "${i.instruction}"`);
    if (i.note) console.log(`        ${i.note}`);
    if (i.status === 'send-failed') console.log(`        ⛔ שליחה נדחתה: ${i.sendError}`);
    if (i.status === 'answered') console.log(`        ✓ נענה: ${i.answer}`);
  }
  console.log('');
  console.log('לענות:  npm run wa -- answer <id> "התשובה"');
}

async function cmdAnswer() {
  const [id, text] = positional;
  if (!id || !text) {
    console.error('שימוש: npm run wa -- answer <id> "התשובה"');
    process.exitCode = 2;
    return;
  }
  const item = queueById(id);
  if (!item) {
    console.error(`אין פריט בתור עם מזהה ${id}. לראות: npm run wa -- queue`);
    process.exitCode = 1;
    return;
  }
  try {
    queueAnswer(id, text);
    console.log(`✓ התשובה נרשמה ל-${id}.`);
    console.log('  הדמון ישלח אותה — הוא מחזיק את החיבור.');
    console.log('  אם הדמון אינו רץ, היא תישלח כשיעלה:  npm run wa-daemon');
  } catch (e) {
    console.error(`נכשל: ${e.message}`);
    process.exitCode = 1;
  }
}

async function cmdSkip() {
  const [id, why] = positional;
  if (!id) {
    console.error('שימוש: npm run wa -- skip <id> [סיבה]');
    process.exitCode = 2;
    return;
  }
  try {
    markSkipped(id, why ?? 'ללא סיבה');
    console.log(`${id} סומן כמדולג — לא תישלח תשובה.`);
  } catch (e) {
    console.error(`נכשל: ${e.message}`);
    process.exitCode = 1;
  }
}

/**
 * Ask the daemon to look something up.
 *
 * Does not connect: the daemon holds the profile, and opening a second
 * connection is what forced the daemon to be stopped earlier — during which an
 * instruction Dror sent was silently never captured.
 */
async function cmdAsk() {
  const [kind, target] = positional;
  const kinds = ['chats', 'find', 'read', 'search'];
  if (!kind || !kinds.includes(kind)) {
    console.error(`שימוש: npm run wa -- ask <${kinds.join('|')}> [ערך] [--limit N]`);
    console.error('  npm run wa -- ask find "מאיר"');
    console.error('  npm run wa -- ask search "הזמנה"');
    console.error('  npm run wa -- ask read 0501234567 --limit 80');
    process.exitCode = 2;
    return;
  }
  if (kind !== 'chats' && !target) {
    console.error(`${kind} דורש ערך`);
    process.exitCode = 2;
    return;
  }
  const item = requestRead({ kind, target, limit: Number(flagValue('limit', 0)) || null });
  console.log(`בקשה נרשמה: ${item.id}`);
  console.log('  הדמון יבצע אותה — לראות את התוצאה:');
  console.log(`  npm run wa -- result ${item.id}`);
}

async function cmdResult() {
  const id = positional[0];
  if (!id) {
    console.error('שימוש: npm run wa -- result <id>');
    process.exitCode = 2;
    return;
  }
  const item = queueById(id);
  if (!item) {
    console.error(`אין פריט עם מזהה ${id}`);
    process.exitCode = 1;
    return;
  }
  if (item.status === 'read-pending') {
    console.log('עוד לא בוצע. הדמון רץ?  npm run wa-daemon');
    return;
  }
  if (item.status === 'read-failed') {
    console.log(`❌ נכשל: ${item.error}`);
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify(item.result, null, 2));
}

const COMMANDS = {
  ask: cmdAsk,
  result: cmdResult,
  queue: cmdQueue,
  answer: cmdAnswer,
  skip: cmdSkip,
  status: cmdStatus,
  chats: cmdChats,
  read: cmdRead,
  search: cmdSearch,
  send: cmdSend,
};

const run = COMMANDS[cmd];
if (!run) {
  console.error('פקודות: status · chats · read · search · send · queue · answer · skip');
  console.error('  npm run wa -- chats --unread');
  console.error('  npm run wa -- read 0501234567 --limit 80');
  console.error('  npm run wa -- search "חשבונית"');
  console.error('  npm run wa -- queue                 (לא דורש חיבור)');
  console.error('  npm run wa -- answer <id> "תשובה"   (הדמון שולח)');
  process.exitCode = 2;
} else {
  run().catch((e) => {
    console.error(`נכשל: ${e.message}`);
    process.exitCode = 1;
  });
}

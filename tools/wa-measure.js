#!/usr/bin/env node
/**
 * Measure how far back the bridge can actually read — the one promise that was
 * deliberately NOT made when this was built.
 *
 * `syncFullHistory: true` ASKS WhatsApp for everything. What arrives is
 * WhatsApp's decision, not ours, and the difference matters: Dror's stated goal
 * is "to see messages back in seconds", so a bridge that only holds three weeks
 * is a different product from one that holds three years. Guessing either way
 * would be the "unknown is a refusal, not a guess" failure.
 *
 * Reads nothing destructive and writes nothing. One connection, because the
 * profile is a single seat.
 *
 *   npm run wa-measure
 */

import { makeClient, connect, shutdown } from '../src/whatsapp/client.js';
import { safeGetChats, completenessNote } from '../src/whatsapp/chats.js';
import { jidToNumber } from '../src/whatsapp/guard.js';

const DEEP_SAMPLE = 6; // busiest chats to dig into
const DEEP_LIMIT = 1000;

const fmt = (ts) => {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};

const daysAgo = (ts) =>
  ts ? Math.round((Date.now() / 1000 - ts) / 86400) : null;

const client = makeClient({});

try {
  await connect(client, {
      onProgress: (p, m) => process.stderr.write(`   טוען WhatsApp Web… ${p}% ${m}   `),
    });
    console.error('');

  const { chats, total, failed } = await safeGetChats(client);
  const withTs = chats.filter((c) => c.timestamp);
  withTs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  const oldestChat = withTs[withTs.length - 1];
  const newestChat = withTs[0];

  console.log('');
  console.log('═══ היקף ההיסטוריה בגשר ═══');
  console.log('');
  console.log(`שיחות קריאות:        ${chats.length} (מתוך ${total})`);
  console.log(`עם חותמת זמן:        ${withTs.length}`);
  console.log(
    `השיחה העדכנית ביותר: ${fmt(newestChat?.timestamp)} (${daysAgo(newestChat?.timestamp)} ימים)`,
  );
  console.log(
    `השיחה הישנה ביותר:   ${fmt(oldestChat?.timestamp)} (${daysAgo(oldestChat?.timestamp)} ימים)`,
  );

  const note = completenessNote(total, failed);
  if (note) console.log(note);

  // Per-chat depth. The chat list timestamp is only the LAST message; how far
  // back the messages themselves go is a separate question and the real one.
  console.log('');
  console.log(`═══ עומק הודעות ב-${DEEP_SAMPLE} השיחות הפעילות ═══`);
  console.log('');

  const privates = withTs.filter((c) => !c.isGroup && !c.isChannel);
  const groups = withTs.filter((c) => c.isGroup);
  console.log('');
  console.log(`פילוח: ${privates.length} שיחות אישיות · ${groups.length} קבוצות`);

  const sample = [...privates.slice(0, DEEP_SAMPLE), ...groups.slice(0, 2)];
  const deep = [];
  for (const c of sample) {
    const jid = c.jid;
    if (!jid) continue;
    let msgs = [];
    let error = null;
    try {
      const chat = await client.getChatById(jid);
      msgs = await chat.fetchMessages({ limit: DEEP_LIMIT });
    } catch (e) {
      error = e?.message || String(e);
    }
    const stamps = msgs.map((m) => m.timestamp).filter(Boolean);
    const oldest = stamps.length ? Math.min(...stamps) : null;
    deep.push({
      name: c.title || jidToNumber(jid),
      jid,
      count: msgs.length,
      oldest,
      hitCeiling: msgs.length >= DEEP_LIMIT,
      kind: c.isGroup ? 'קבוצה' : 'אישית',
      error,
    });
  }

  for (const d of deep) {
    if (d.error) {
      console.log(`❌ ${d.name} — ${d.error}`);
      continue;
    }
    const ceiling = d.hitCeiling ? ' ⚠️ הגיע לתקרה — יש עוד' : '';
    console.log(
      `${d.count.toString().padStart(4)} הודעות · עד ${fmt(d.oldest)} (${daysAgo(d.oldest)} ימים) · ${d.kind.padEnd(6)} ${d.name}${ceiling}`,
    );
  }

  const readable = deep.filter((d) => !d.error && d.oldest && d.kind === 'אישית');
  if (readable.length) {
    const deepest = readable.reduce((a, b) => (a.oldest < b.oldest ? a : b));
    console.log('');
    console.log('═══ השורה התחתונה ═══');
    console.log(
      `העומק הגדול שנמדד: ${fmt(deepest.oldest)} — ${daysAgo(deepest.oldest)} ימים אחורה (${deepest.name})`,
    );
    if (readable.some((d) => d.hitCeiling)) {
      console.log(
        `⚠️ חלק מהשיחות הגיעו לתקרת ה-${DEEP_LIMIT} — העומק האמיתי גדול מהמדווח.`,
      );
    }
  }
  console.log('');
} catch (e) {
  console.log(`❌ ${e?.message}`);
  console.log(e?.stack);
  process.exitCode = 1;
} finally {
  await shutdown(client);
}

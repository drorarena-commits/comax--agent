#!/usr/bin/env node
/**
 * Find chats whose name matches a term, and read the newest one.
 *
 * Built for the first real instruction: "תסכם לי את ההתכתבות האחרונה עם מאיר".
 *
 * ⚠️ AMBIGUITY IS A STOP, NOT A GUESS. "מאיר" can match several contacts, and
 * summarising the wrong person's conversation under the right heading looks
 * correct at every step — the same failure rule 18 of CLAUDE.md exists for
 * (document numbers repeat across customers and years). So every match is
 * printed, and only an unambiguous single match is read automatically.
 *
 *   node tools/wa-find.js "מאיר" [--read <jid>] [--limit 60]
 */

import { makeClient, connect, shutdown } from '../src/whatsapp/client.js';
import { safeGetChats, completenessNote } from '../src/whatsapp/chats.js';
import { jidToNumber } from '../src/whatsapp/guard.js';
import { parseFlags, flagProblems } from '../src/cli-args.js';

// `Number(argv[i + 1]) || 60` בלע כל ערך לא-מספרי אל ברירת המחדל: `--limit abc`
// ו-`--limit` בסוף השורה חזרו שניהם 60, כלומר בקשה שגויה נראתה כמו הצלחה.
const flags = parseFlags(process.argv.slice(2), {
  skipFirst: false,
  booleans: [],
  valued: ['read'],
  numbers: ['limit'],
});
const problems = flagProblems(flags);
if (flags._.length > 1) problems.push(`יותר ממונח חיפוש אחד: "${flags._.join('", "')}".`);
if (problems.length) {
  console.error('\n' + problems.join('\n')
    + '\n\nשימוש: node tools/wa-find.js "שם" [--read <jid>] [--limit <מספר>]\n');
  process.exit(1);
}
const term = flags._[0];
const readJid = flags.input.read ?? null;
const limit = flags.input.limit ?? 60;

if (!term && !readJid) {
  console.error('שימוש: node tools/wa-find.js "שם" [--read <jid>]');
  process.exit(2);
}

const fmt = (ts) => {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const client = makeClient({});

try {
  await connect(client, { onProgress: (p) => process.stderr.write(`\r  ${p}%  `) });
  console.error('');

  const { chats, total, failed } = await safeGetChats(client);

  let target = readJid;

  if (!target) {
    const needle = term.trim();
    const matches = chats.filter((c) => (c.title || '').includes(needle));
    matches.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    console.log(`"${needle}" — ${matches.length} שיחות תואמות:`);
    console.log('');
    for (const m of matches) {
      const kind = m.isGroup ? 'קבוצה' : m.isChannel ? 'ערוץ' : 'אישית';
      console.log(
        `${fmt(m.timestamp)}  ${kind.padEnd(6)} ${m.title}  ${m.isGroup ? '' : jidToNumber(m.jid)}`,
      );
      console.log(`        ${m.jid}`);
    }
    const note = completenessNote(total, failed);
    if (note) {
      console.log('');
      console.log(note);
    }

    const individuals = matches.filter((m) => !m.isGroup && !m.isChannel);
    if (individuals.length === 0) {
      console.log('');
      console.log('אין שיחה אישית תואמת — לא קורא.');
      process.exit(0);
    }
    if (individuals.length > 1) {
      console.log('');
      console.log(
        `⚠️ ${individuals.length} שיחות אישיות תואמות — לא בוחר לבד. להריץ עם --read <jid>.`,
      );
      process.exit(0);
    }
    target = individuals[0].jid;
    console.log('');
    console.log(`התאמה חד-משמעית → קורא: ${individuals[0].title}`);
  }

  const chat = await client.getChatById(target);
  const msgs = await chat.fetchMessages({ limit });
  console.log('');
  console.log(`═══ ${chat.name || jidToNumber(target)} (${jidToNumber(target)}) ═══`);
  console.log(`נקראו ${msgs.length} הודעות${msgs.length >= limit ? ' — הגיע לתקרה, יש עוד' : ''}`);
  console.log('');
  for (const m of msgs) {
    const who = m.fromMe ? 'דרור' : chat.name || jidToNumber(target);
    const body = m.body || `[${m.type || 'מדיה'}]`;
    console.log(`[${fmt(m.timestamp)}] ${who}: ${body}`);
  }
  console.log('');
} catch (e) {
  console.error(`נכשל: ${e.message}`);
  process.exitCode = 1;
} finally {
  await shutdown(client);
}

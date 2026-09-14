#!/usr/bin/env node
/**
 * Self-test for the WhatsApp send gates.
 *
 * Runs entirely offline against a fake client — no link, no session, no traffic.
 * That is the point: these gates are what protect Dror's business number, and
 * "the code was written" is not evidence that they refuse. Each case asserts a
 * REFUSAL, because a gate that fails open looks identical to a gate that works
 * until the day it matters.
 *
 *   npm run wa-test
 */

import {
  toJid,
  jidToNumber,
  requireConfirm,
  assertSingleIndividual,
  assertAuthoredBody,
  assertExistingConversation,
  guardedSend,
} from '../src/whatsapp/guard.js';

let pass = 0;
const failures = [];

function ok(name, cond) {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗ ${name}`);
  }
}

async function refuses(name, fn, expectFragment) {
  try {
    await fn();
    failures.push(`${name} — לא סירב!`);
    console.log(`  ✗ ${name} — עבר במקום להיחסם`);
  } catch (e) {
    const matched = !expectFragment || e.message.includes(expectFragment);
    if (matched) {
      pass += 1;
      console.log(`  ✓ ${name}`);
    } else {
      failures.push(`${name} — סירב מסיבה אחרת: ${e.message}`);
      console.log(`  ✗ ${name} — הסיבה לא צפויה: ${e.message}`);
    }
  }
}

/**
 * A fake client. `sendMessage` on any chat records the call and is expected
 * NEVER to fire in the refusal cases — a gate that throws only after sending
 * would pass a naive test.
 */
function fakeClient({ chats = {} } = {}) {
  const sent = [];
  return {
    sent,
    async getChatById(jid) {
      const spec = chats[jid];
      if (!spec) throw new Error('no such chat');
      return {
        name: spec.name || jid,
        id: { _serialized: jid },
        async fetchMessages() {
          return spec.messages || [];
        },
        async sendMessage(text) {
          sent.push({ jid, text });
        },
      };
    },
  };
}

const KNOWN = '972501111111@c.us';
const EMPTY = '972502222222@c.us';
const OUTBOUND_ONLY = '972503333333@c.us';

const chats = {
  [KNOWN]: {
    name: 'לקוח מוכר',
    messages: [
      { fromMe: false, body: 'שלום' },
      { fromMe: true, body: 'היי' },
    ],
  },
  [EMPTY]: { name: 'שיחה ריקה', messages: [] },
  [OUTBOUND_ONLY]: {
    name: 'מעולם לא ענה',
    messages: [
      { fromMe: true, body: 'הצעה' },
      { fromMe: true, body: 'עוד הצעה' },
    ],
  },
};

console.log('');
console.log('נרמול מספרים');
ok('0501111111 → JID ישראלי', toJid('0501111111') === '972501111111@c.us');
ok('מקף ורווחים לא משנים', toJid('050-111 1111') === '972501111111@c.us');
ok('+972 מתקבל', toJid('+972501111111') === '972501111111@c.us');
ok('JID עובר כמו שהוא', toJid(KNOWN) === KNOWN);
ok('חזרה לתצוגה', jidToNumber(KNOWN) === '0501111111');
await refuses('מספר קצר מדי נחסם', async () => toJid('0501'), 'לא צפוי');
await refuses('טקסט אינו מספר', async () => toJid('שלום'), 'לא תקין');
await refuses('נמען ריק', async () => toJid(''), 'לא נמסר');

console.log('');
console.log('שער 1 — אישור מפורש');
await refuses('בלי confirmed נחסם', async () => requireConfirm(false), '--confirm');
await refuses('undefined נחסם', async () => requireConfirm(undefined), '--confirm');
await refuses('"true" כמחרוזת נחסם', async () => requireConfirm('true'), '--confirm');
ok('true עובר', (() => { requireConfirm(true); return true; })());

console.log('');
console.log('שער 2 — נמען בודד ואישי');
await refuses(
  'מערך נמענים נחסם',
  async () => assertSingleIndividual(['0501111111', '0502222222']),
  'מרובת נמענים',
);
await refuses(
  'קבוצה נחסמת',
  async () => assertSingleIndividual('123456-789@g.us'),
  'שאינו שיחה אישית',
);
await refuses(
  'ערוץ נחסם',
  async () => assertSingleIndividual('123@newsletter'),
  'שאינו שיחה אישית',
);
await refuses(
  'ברודקאסט נחסם',
  async () => assertSingleIndividual('status@broadcast'),
  'שאינו שיחה אישית',
);
ok('יחיד עובר', assertSingleIndividual('0501111111') === KNOWN);

console.log('');
console.log('שער 3 — שיחה קיימת ולא ריקה');
const client = fakeClient({ chats });
await refuses(
  'מספר בלי שיחה נחסם',
  async () => assertExistingConversation(client, '972509999999@c.us'),
  'אין שיחה קיימת',
);
await refuses(
  'שיחה ריקה נחסמת',
  async () => assertExistingConversation(client, EMPTY),
  'ריקה',
);
const known = await assertExistingConversation(client, KNOWN);
ok('שיחה קיימת עוברת', known.chat && known.warning === null);
const oneSided = await assertExistingConversation(client, OUTBOUND_ONLY);
ok('שיחה חד-צדדית עוברת עם אזהרה', !!oneSided.warning);

console.log('');
console.log('שער 4 — התוכן הוכתב');
await refuses('הודעה ריקה נחסמת', async () => assertAuthoredBody('   '), 'ריקה');
await refuses(
  'תוכן ארוך חשוד נחסם',
  async () => assertAuthoredBody('x'.repeat(4001)),
  'הועתק',
);
ok('טקסט רגיל עובר', assertAuthoredBody('שלום') === 'שלום');

console.log('');
console.log('השער המשולב — ושאף הודעה לא יצאה בסירוב');
const c1 = fakeClient({ chats });
await refuses(
  'בלי confirm — לא נשלח',
  async () => guardedSend(c1, { to: '0501111111', body: 'בדיקה' }),
  '--confirm',
);
ok('ובאמת לא נשלחה הודעה', c1.sent.length === 0);

const c2 = fakeClient({ chats });
await refuses(
  'מספר לא מוכר גם עם confirm — לא נשלח',
  async () =>
    guardedSend(c2, { to: '0509999999', body: 'בדיקה', confirmed: true }),
  'אין שיחה קיימת',
);
ok('ובאמת לא נשלחה הודעה', c2.sent.length === 0);

const c3 = fakeClient({ chats });
await refuses(
  'קבוצה גם עם confirm — לא נשלח',
  async () =>
    guardedSend(c3, { to: '123456-789@g.us', body: 'בדיקה', confirmed: true }),
  'שאינו שיחה אישית',
);
ok('ובאמת לא נשלחה הודעה', c3.sent.length === 0);

const c4 = fakeClient({ chats });
const sentOk = await guardedSend(c4, {
  to: '0501111111',
  body: 'שלום',
  confirmed: true,
});
ok('שיחה מוכרת + confirm → נשלח', sentOk.sent === true && c4.sent.length === 1);
ok('והתוכן הוא מה שנמסר', c4.sent[0].text === 'שלום');

console.log('');
console.log('─'.repeat(46));
if (failures.length === 0) {
  console.log(`✅ ${pass} בדיקות עברו. כל השערים חוסמים.`);
} else {
  console.log(`❌ ${failures.length} כשלונות מתוך ${pass + failures.length}:`);
  for (const f of failures) console.log(`   · ${f}`);
  process.exitCode = 1;
}
console.log('');

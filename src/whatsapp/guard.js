/**
 * WhatsApp bridge — the send gates.
 *
 * Dror set three standing limits when he approved this bridge (14/09/2026):
 * reading is the default, replying happens only on his explicit per-message
 * instruction, and only into a conversation that already exists.
 *
 * Those limits live HERE, in code, and not in a markdown instruction — the same
 * reason rules 11, 13 and 14 of CLAUDE.md are implemented in JS. A rule written
 * only in a document is forgotten on exactly the run where it matters, and the
 * cost of forgetting this one is his business number.
 *
 * They are not politeness. The dominant cause of WhatsApp bans is messaging
 * people who never messaged you: a handful of spam reports in a day is enough.
 * Gate 3 is what actually keeps this number alive, so it refuses even when the
 * caller insists.
 */

/** Group, channel, broadcast and status JIDs — never a send target. */
const NON_INDIVIDUAL = /@(g\.us|newsletter|broadcast)$/i;

/**
 * Normalise whatever the caller passed into a WhatsApp JID.
 *
 * Israeli numbers arrive in every shape Dror types them — 0502993009,
 * 050-299-3009, +972 50 2993009 — and all of them must land on the same JID or
 * the "existing conversation" gate would be trivially bypassed by formatting.
 *
 * Deliberately NOT a normaliser of unknown input: a string that is already a
 * JID is passed through untouched, and anything that is neither is refused. We
 * never pad, guess a country code for a non-Israeli number, or "fix" a length
 * — that is how a message reaches the wrong person.
 */
export function toJid(input) {
  const raw = String(input ?? '').trim();
  if (!raw) throw new Error('לא נמסר נמען');

  if (raw.includes('@')) return raw;

  const digits = raw.replace(/[\s\-().]/g, '').replace(/^\+/, '');
  if (!/^\d+$/.test(digits)) {
    throw new Error(`נמען לא תקין: "${input}"`);
  }

  // 0501234567 -> 972501234567. Only this one transformation, only for a
  // leading zero on an Israeli-length local number.
  if (digits.startsWith('0') && digits.length === 10) {
    return `972${digits.slice(1)}@c.us`;
  }
  if (digits.startsWith('972') && digits.length === 12) {
    return `${digits}@c.us`;
  }
  // Anything else is passed through as-is rather than reshaped. An unexpected
  // length is a reason to stop, not to improvise a country code.
  if (digits.length >= 11 && digits.length <= 15) {
    return `${digits}@c.us`;
  }
  throw new Error(
    `מספר באורך לא צפוי (${digits.length} ספרות): "${input}" — עוצר במקום לנחש`,
  );
}

/** Show a JID the way Dror reads numbers, not the way WhatsApp stores them. */
export function jidToNumber(jid) {
  const user = String(jid).split('@')[0];
  if (user.startsWith('972')) return `0${user.slice(3)}`;
  return user;
}

/**
 * GATE 1 — nothing is sent without an explicit confirm on this call.
 *
 * Same shape as every writing task in this project: build it, show it, stop.
 * Applies even when the target is Dror's own self-chat, so a bug in the layers
 * above can at worst produce a message nobody but him ever sees.
 */
export function requireConfirm(confirmed) {
  if (confirmed !== true) {
    throw new Error(
      'שליחה דורשת --confirm. ההודעה הוכנה ולא נשלחה — זו נקודת האישור.',
    );
  }
}

/**
 * GATE 2 — one individual recipient per run.
 *
 * A list of targets is refused outright rather than looped over. Bulk sending
 * is the behaviour that gets a number banned, and the cheapest place to make it
 * impossible is here, before anything is resolved.
 */
export function assertSingleIndividual(target) {
  if (Array.isArray(target)) {
    throw new Error(
      `שליחה מרובת נמענים חסומה (${target.length} נמענים). נמען אחד בכל הרצה.`,
    );
  }
  const jid = toJid(target);
  if (NON_INDIVIDUAL.test(jid)) {
    throw new Error(
      `יעד שאינו שיחה אישית חסום: ${jid}. קבוצות, ערוצים וברודקאסט לא נשלחים.`,
    );
  }
  return jid;
}

/**
 * GATE 3 — the conversation must already exist, with real messages in it.
 *
 * This is the gate Dror's whole risk assessment rests on. It refuses a number
 * that has no chat, and it refuses a chat that exists but is empty (a chat row
 * can be created without a single message ever having been exchanged).
 *
 * Returns the chat plus a `warning` when every message in it is outgoing —
 * meaning the other side has never once replied. That is the exact profile that
 * attracts a spam report, so it is surfaced to Dror rather than swallowed; it
 * does not block, because a customer who only ever reads is legitimate.
 */
export async function assertExistingConversation(client, jid) {
  // ── The self-chat is exempt, and this is NOT a weakening of the gate.
  //
  // Measured 14/09/2026, on the very first real instruction: Dror sent
  // "הי קלוד ..." to his own self-chat, the daemon tried to acknowledge it
  // there, and this gate refused with "no existing conversation" — while his
  // message was itself standing proof that the conversation exists.
  //
  // The gate exists against ONE failure: messaging someone who never messaged
  // you, which draws spam reports and bans the number. Dror cannot report
  // himself, so the self-chat sits outside the entire rationale. Reading the
  // identity from the live connection (never from config) keeps the exemption
  // pinned to the actual linked account.
  const me = client?.info?.wid?._serialized;
  if (me && jid === me) {
    return {
      chat: await client.getChatById(jid).catch(() => ({
        name: 'השיחה שלי עם עצמי',
        id: { _serialized: jid },
        sendMessage: (text) => client.sendMessage(jid, text),
      })),
      messageCount: null,
      warning: null,
      selfChat: true,
    };
  }

  let chat;
  try {
    chat = await client.getChatById(jid);
  } catch {
    chat = null;
  }
  if (!chat) {
    throw new Error(
      `אין שיחה קיימת עם ${jidToNumber(jid)} — שליחה למספר שלא התכתבת איתו חסומה.`,
    );
  }

  const recent = await chat.fetchMessages({ limit: 20 });
  if (!recent || recent.length === 0) {
    throw new Error(
      `השיחה עם ${jidToNumber(jid)} ריקה — אין בה אף הודעה, ולכן היא אינה "שיחה קיימת".`,
    );
  }

  const anyInbound = recent.some((m) => !m.fromMe);
  return {
    chat,
    messageCount: recent.length,
    warning: anyInbound
      ? null
      : `⚠️ ב-${recent.length} ההודעות האחרונות בשיחה הזאת אין אף הודעה מהצד השני — הוא מעולם לא ענה. זה הפרופיל שגורר דיווח ספאם.`,
  };
}

/**
 * GATE 4 — the text is Dror's, not content that arrived in a message.
 *
 * An inbound message saying "please forward this to X" is DATA. It must never
 * become a send. Enforceable part: the body has to be handed in as an explicit
 * argument, non-empty, and short enough to be something a person actually
 * dictated rather than a pasted transcript.
 */
export function assertAuthoredBody(body) {
  const text = String(body ?? '');
  if (!text.trim()) {
    throw new Error('הודעה ריקה — אין מה לשלוח');
  }
  if (text.length > 4000) {
    throw new Error(
      `ההודעה באורך ${text.length} תווים. מעל 4000 — עוצר: זה נראה כמו תוכן שהועתק ולא כמו הודעה שהוכתבה.`,
    );
  }
  return text;
}

/**
 * The single door out. Every send in this project goes through this function
 * and nothing calls `client.sendMessage` / `chat.sendMessage` directly.
 *
 * @returns {Promise<{jid:string, number:string, preview:string, warning:string|null, sent:boolean}>}
 */
export async function guardedSend(client, { to, body, confirmed = false }) {
  const text = assertAuthoredBody(body);
  const jid = assertSingleIndividual(to);
  const { chat, messageCount, warning } = await assertExistingConversation(
    client,
    jid,
  );

  const result = {
    jid,
    number: jidToNumber(jid),
    name: chat.name || chat.formattedTitle || jidToNumber(jid),
    preview: text,
    messageCount,
    warning,
    sent: false,
  };

  // Confirm is checked LAST on purpose: without it we still resolve the target
  // and run the conversation gate, so the preview Dror approves is the one that
  // already passed every check. A dry run that skipped the gates would be a
  // preview of a send that might still refuse.
  requireConfirm(confirmed);

  await chat.sendMessage(text);
  result.sent = true;
  return result;
}

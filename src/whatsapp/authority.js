/**
 * Who may instruct the bridge, and what they may do.
 *
 * Dror set this on 14/09/2026. Two numbers activate the agent, with EQUAL
 * permissions — he began with "only I send to customers" and corrected himself
 * immediately: the shop number is the business's own channel and Noa operates
 * it, so sending to customers is her job rather than an expansion of it.
 *
 *   Dror — his private number, speaking in his own self-chat
 *   Noa   — 050-2993009, the shop's business number she sits on
 *
 * ⚠️ TWO THINGS THIS FILE DOES NOT PRETEND TO DO
 *
 * 1. It authenticates a NUMBER, never a person. Whoever holds the shop phone is
 *    "Noa" here, and 050-2993009 is a shared business line rather than a
 *    personal one — so the trust circle is wider than a single name suggests.
 *    Worth knowing; not a reason to refuse, since Dror decided it knowingly.
 *
 * 2. It does not change WHO THE MESSAGE COMES FROM. The bridge is linked to
 *    Dror's private number, so everything it sends leaves as Dror — including
 *    a send Noa asked for. Sending as 050-2993009 would need a second bridge
 *    linked to that number, i.e. a second number exposed to a ban. Flagged to
 *    Dror; not assumed.
 *
 * THE CODE WORD IS NOT A SECURITY MECHANISM. Dror was explicit that a customer
 * writing "הי קלוד" is fine, because a customer's chat carries no permission to
 * begin with. What protects is the CHANNEL. The word only prevents a stray note
 * to self from being read as an instruction.
 */

import { toJid, jidToNumber } from './guard.js';

/** The trigger. Not a secret — a deliberate opener. */
export const CODE_WORD = 'הי קלוד';

/**
 * Noa's line — the shop's business number.
 *
 * Kept in code rather than `.env` on purpose: `.env` is not in git, so a number
 * that lives only there would silently vanish on the second machine and the
 * allowlist would quietly shrink to one entry. An allowlist that fails CLOSED
 * on a sync gap is safe; one that changes without anyone noticing is not.
 * `WA_ALLOW_NOA` can still override for testing.
 */
const NOA_NUMBER = process.env.WA_ALLOW_NOA || '0502993009';

/** Everything an authorised requester may do. Both principals get all of it. */
const FULL = Object.freeze({
  read: true,
  search: true,
  summarise: true,
  replyToRequester: true,
  sendToCustomer: true,
});

const NONE = Object.freeze({
  read: false,
  search: false,
  summarise: false,
  replyToRequester: false,
  sendToCustomer: false,
});

/**
 * Resolve who is speaking and what they may do.
 *
 * @param {object} msg        A whatsapp-web.js message (or the shape of one).
 * @param {string} selfJid    The linked account's own JID, from the live client.
 * @returns {{principal: string|null, allowed: object, channel: string,
 *            isAuthorised: boolean, reason: string|null}}
 */
export function identify(msg, selfJid) {
  const self = String(selfJid || '');
  const from = String(msg?.from || '');
  const author = String(msg?.author || '');
  const fromMe = !!msg?.fromMe;

  // ── Dror: his own message, inside his own self-chat.
  //
  // Both conditions are required. `fromMe` alone is true for every message the
  // account sends ANYWHERE — including replies the bridge itself just sent to a
  // customer — and treating those as instructions would let the bridge trigger
  // itself in a loop.
  if (fromMe && from === self) {
    return {
      principal: 'dror',
      allowed: FULL,
      channel: 'self-chat',
      isAuthorised: true,
      reason: null,
    };
  }

  // ── Noa: an incoming message from the shop number.
  let noaJid;
  try {
    noaJid = toJid(NOA_NUMBER);
  } catch {
    noaJid = null;
  }
  // `author` carries the real sender inside a group; `from` is the chat. Only
  // a direct chat counts, so both must point at her and neither may be a group.
  const isGroupish = /@(g\.us|newsletter|broadcast)$/i.test(from);
  if (!fromMe && noaJid && from === noaJid && !isGroupish && !author) {
    return {
      principal: 'noa',
      allowed: FULL,
      channel: 'noa-direct',
      isAuthorised: true,
      reason: null,
    };
  }

  return {
    principal: null,
    allowed: NONE,
    channel: isGroupish ? 'group' : fromMe ? 'own-outgoing' : 'other-chat',
    isAuthorised: false,
    reason: `ערוץ לא מורשה: ${from || '(ללא מקור)'}`,
  };
}

/** Does this text open with the code word? Case- and space-tolerant. */
export function hasCodeWord(body) {
  const text = String(body ?? '').trim();
  const normalised = text.replace(/\s+/g, ' ');
  return normalised.toLowerCase().startsWith(CODE_WORD.toLowerCase());
}

/** The instruction with the code word stripped off. */
export function stripCodeWord(body) {
  const text = String(body ?? '').trim().replace(/\s+/g, ' ');
  if (!hasCodeWord(text)) return text;
  return text.slice(CODE_WORD.length).replace(/^[\s,،:\-–—]+/, '').trim();
}

/**
 * Should this message be acted on?
 *
 * Returns a decision object rather than a boolean, because "ignore silently"
 * and "authorised but forwarded, so ask first" are different outcomes that a
 * boolean would flatten into one.
 */
export function decide(msg, selfJid) {
  const who = identify(msg, selfJid);
  const body = msg?.body ?? '';

  if (!who.isAuthorised) {
    // Not an error and not worth reporting: the overwhelming majority of
    // traffic is ordinary chat. Silence here is correct.
    return { act: false, quiet: true, who, instruction: null, note: null };
  }

  if (!hasCodeWord(body)) {
    // An authorised person talking normally. Dror's own notes to self land
    // here, which is exactly why the code word exists.
    return { act: false, quiet: true, who, instruction: null, note: null };
  }

  // ── Forwarded content: authorised channel, foreign words.
  //
  // This is the one place the forward check earns its keep. Dror was right that
  // a customer writing the code word in their own chat is harmless — no
  // permission there. But a message FORWARDED into an authorised channel
  // carries a stranger's text through a trusted door, and the code word in it
  // was typed by that stranger.
  if (msg?.isForwarded || (msg?.forwardingScore ?? 0) > 0) {
    return {
      act: false,
      quiet: false,
      who,
      instruction: stripCodeWord(body),
      note:
        'ההודעה מועברת (forwarded) — הטקסט נכתב על ידי מישהו אחר, ולכן ' +
        'מילת הקוד שבתוכה אינה הוראה ממך. מצטט ושואל במקום לבצע.',
    };
  }

  return {
    act: true,
    quiet: false,
    who,
    instruction: stripCodeWord(body),
    note: null,
  };
}

/** Human-readable summary of the allowlist, for status output. */
export function describeAllowlist(selfJid) {
  return [
    `דרור — ${selfJid ? jidToNumber(selfJid) : '(מהחיבור)'} · בשיחה עם עצמו`,
    `נועה — ${NOA_NUMBER} · המספר העסקי של החנות`,
    `מילת ההפעלה: "${CODE_WORD}"`,
  ];
}

export const ALLOWLIST_NUMBERS = Object.freeze({
  noa: NOA_NUMBER,
});

/**
 * The instruction queue — how a WhatsApp message reaches a Claude session.
 *
 * WHY A QUEUE AND NOT A LIVE ANSWER
 * ---------------------------------
 * Dror chose the "smart and free" route (14/09/2026): the daemon cannot
 * understand "תסכם לי את היום" — it is a Node process, not a model — and
 * paying an API call per message was the alternative he declined. So the daemon
 * captures instructions and a Claude session answers them.
 *
 * ⚠️ THE COST IS LATENCY, AND IT MUST BE VISIBLE. An instruction sits here
 * until a session reads it. Silence is indistinguishable from "working on it",
 * so the daemon acknowledges receipt in WhatsApp immediately and this file
 * keeps the state that makes the acknowledgement honest.
 *
 * Storage is `runs/whatsapp/queue.json` — under `runs/`, which is NOT in git.
 * That is deliberate: these are real messages from real customers, and syncing
 * them to a shared repo would publish Dror's correspondence to every machine
 * that clones it.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ROOT } from '../config.js';

export const QUEUE_PATH = resolve(ROOT, 'runs', 'whatsapp', 'queue.json');

const EMPTY = { version: 1, items: [] };

function load() {
  if (!existsSync(QUEUE_PATH)) return structuredClone(EMPTY);
  try {
    const parsed = JSON.parse(readFileSync(QUEUE_PATH, 'utf8'));
    if (!parsed || !Array.isArray(parsed.items)) return structuredClone(EMPTY);
    return parsed;
  } catch {
    // A corrupt queue must not take the daemon down, and must not be silently
    // replaced either — the old file is kept aside so nothing is lost.
    const backup = `${QUEUE_PATH}.corrupt-${Date.now()}`;
    try {
      renameSync(QUEUE_PATH, backup);
      console.error(`תור פגום — הועבר ל-${backup}`);
    } catch {
      /* nothing more to do */
    }
    return structuredClone(EMPTY);
  }
}

/**
 * Write atomically: a temp file plus a rename.
 *
 * The daemon writes on every inbound instruction while a session may be reading
 * at the same moment. A partial write would be read as a corrupt queue and
 * quarantined by the loader above — losing instructions that were captured
 * correctly.
 */
function save(state) {
  mkdirSync(dirname(QUEUE_PATH), { recursive: true });
  const tmp = `${QUEUE_PATH}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  renameSync(tmp, QUEUE_PATH);
}

/** Short, human-quotable id. Dror may read it aloud off his phone. */
function shortId() {
  return randomUUID().split('-')[0];
}

/**
 * Record an instruction.
 *
 * @param {object} entry
 * @param {string} entry.principal   'dror' | 'noa'
 * @param {string} entry.channel     where it came from
 * @param {string} entry.jid         chat to answer into
 * @param {string} entry.instruction the text with the code word stripped
 * @param {string} [entry.raw]       the original message body
 * @param {string} [entry.note]      e.g. the forwarded-message warning
 * @param {boolean} [entry.needsApproval] true when it must be shown, not acted on
 */
export function enqueue(entry) {
  const state = load();
  const item = {
    id: shortId(),
    at: new Date().toISOString(),
    status: entry.needsApproval ? 'needs-approval' : 'pending',
    principal: entry.principal,
    channel: entry.channel,
    jid: entry.jid,
    instruction: entry.instruction,
    raw: entry.raw ?? entry.instruction,
    note: entry.note ?? null,
    answer: null,
    answeredAt: null,
  };
  state.items.push(item);
  save(state);
  return item;
}

/** Everything still waiting, oldest first. */
export function pending() {
  return load().items.filter(
    (i) => i.status === 'pending' || i.status === 'needs-approval',
  );
}

/** Full history, newest first — for `queue --all`. */
export function all() {
  return [...load().items].reverse();
}

export function byId(id) {
  return load().items.find((i) => i.id === id) ?? null;
}

/**
 * Mark an item answered and store what was said.
 *
 * Does NOT send anything: sending goes through `guardedSend` like every other
 * outbound message, so the gates apply to an answer exactly as they do to a
 * reply Dror dictates directly.
 */
export function markAnswered(id, answer) {
  const state = load();
  const item = state.items.find((i) => i.id === id);
  if (!item) throw new Error(`אין פריט בתור עם מזהה ${id}`);
  item.status = 'answered';
  item.answer = answer;
  item.answeredAt = new Date().toISOString();
  save(state);
  return item;
}

export function markSkipped(id, why) {
  const state = load();
  const item = state.items.find((i) => i.id === id);
  if (!item) throw new Error(`אין פריט בתור עם מזהה ${id}`);
  item.status = 'skipped';
  item.answer = why ?? null;
  item.answeredAt = new Date().toISOString();
  save(state);
  return item;
}

/** Has the daemon already acknowledged this message in WhatsApp? */
export function markAcked(id) {
  const state = load();
  const item = state.items.find((i) => i.id === id);
  if (item) {
    item.acked = true;
    save(state);
  }
  return item;
}

/**
 * Guard against the same message being queued twice.
 *
 * The daemon can see one message through both `message` and `message_create`
 * depending on direction, and a reconnect can replay recent history. A double
 * entry would make a session answer the same question twice — into WhatsApp,
 * to a real person.
 */
export function alreadyQueued(messageId) {
  if (!messageId) return false;
  return load().items.some((i) => i.messageId === messageId);
}

export function enqueueOnce(messageId, entry) {
  if (alreadyQueued(messageId)) return null;
  const state = load();
  const item = {
    id: shortId(),
    messageId,
    at: new Date().toISOString(),
    status: entry.needsApproval ? 'needs-approval' : 'pending',
    principal: entry.principal,
    channel: entry.channel,
    jid: entry.jid,
    instruction: entry.instruction,
    raw: entry.raw ?? entry.instruction,
    note: entry.note ?? null,
    acked: false,
    answer: null,
    answeredAt: null,
  };
  state.items.push(item);
  save(state);
  return item;
}

/**
 * Stage an answer for the daemon to send.
 *
 * ⚠️ WHY THE SESSION DOES NOT SEND IT ITSELF
 * The daemon holds the Chrome profile, and a profile is a single seat — exactly
 * like Comax's. A second process trying to connect in order to send an answer
 * would collide with the daemon and fail on the profile lock.
 *
 * So the queue file is the channel: a session writes `to-send`, the daemon
 * notices and sends. No HTTP, no IPC, no second connection — and the send still
 * goes through `guardedSend`, so the four gates apply to an answer exactly as
 * they do to a message Dror dictates.
 */
export function queueAnswer(id, text) {
  const body = String(text ?? '').trim();
  if (!body) throw new Error('תשובה ריקה');
  const state = load();
  const item = state.items.find((i) => i.id === id);
  if (!item) throw new Error(`אין פריט בתור עם מזהה ${id}`);
  if (item.status === 'answered') {
    throw new Error(`${id} כבר נענה ב-${item.answeredAt} — לא שולח שוב`);
  }
  item.status = 'to-send';
  item.answer = body;
  item.stagedAt = new Date().toISOString();
  save(state);
  return item;
}

/** Items the daemon should send now. */
export function toSend() {
  return load().items.filter((i) => i.status === 'to-send');
}

/** Called by the daemon once the message actually left. */
export function markSent(id) {
  const state = load();
  const item = state.items.find((i) => i.id === id);
  if (!item) return null;
  item.status = 'answered';
  item.answeredAt = new Date().toISOString();
  // Clear a failure from an earlier attempt: an answered item that still
  // carries sendError reads as "sent but broken", which is not what happened.
  delete item.sendError;
  save(state);
  return item;
}

/** Called by the daemon when the gates refused the answer. */
export function markSendFailed(id, why) {
  const state = load();
  const item = state.items.find((i) => i.id === id);
  if (!item) return null;
  item.status = 'send-failed';
  item.sendError = why;
  save(state);
  return item;
}

// ═══════════════════════════════════════════════════════════════════════════
// Read requests — a session asking the daemon to look something up.
//
// WHY THIS EXISTS, AND WHAT IT COST TO LEARN
// The daemon holds the Chrome profile, so a session cannot open its own
// connection to read anything. On 14/09/2026 that meant stopping the daemon in
// order to answer one question — and while it was down, an instruction Dror
// sent from the shop number was never captured. Nothing failed loudly: the
// listener simply was not there.
//
// So reads go the same way answers do: a session writes a request, the daemon
// performs it and writes the result back. One connection, never interrupted.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @param {object} req
 * @param {'chats'|'find'|'read'|'search'} req.kind
 * @param {string} [req.target]  a JID/number for `read`, a term for find/search
 * @param {number} [req.limit]
 */
export function requestRead(req) {
  const state = load();
  const item = {
    id: shortId(),
    at: new Date().toISOString(),
    type: 'read-request',
    status: 'read-pending',
    kind: req.kind,
    target: req.target ?? null,
    limit: req.limit ?? null,
    result: null,
    error: null,
    doneAt: null,
  };
  state.items.push(item);
  save(state);
  return item;
}

/** Read requests the daemon should perform. */
export function pendingReads() {
  return load().items.filter((i) => i.status === 'read-pending');
}

export function completeRead(id, result) {
  const state = load();
  const item = state.items.find((i) => i.id === id);
  if (!item) return null;
  item.status = 'read-done';
  item.result = result;
  item.doneAt = new Date().toISOString();
  save(state);
  return item;
}

export function failRead(id, error) {
  const state = load();
  const item = state.items.find((i) => i.id === id);
  if (!item) return null;
  item.status = 'read-failed';
  item.error = String(error);
  item.doneAt = new Date().toISOString();
  save(state);
  return item;
}

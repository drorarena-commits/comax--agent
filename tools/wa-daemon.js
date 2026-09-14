#!/usr/bin/env node
/**
 * The WhatsApp daemon — one long-lived connection, and the listener for
 * "הי קלוד".
 *
 * WHY THIS REPLACES THE PER-COMMAND DESIGN
 * ----------------------------------------
 * The first design opened Chrome, loaded WhatsApp Web, ran one command and
 * quit. Measured 14/09/2026, that failed three ways at once:
 *
 *   slow      — 40 seconds per command at best
 *   fragile   — the load pinned at 99% and `ready` never fired, and NOT
 *               reproducibly: early runs succeeded, later ones stalled past 7
 *               minutes with no setting changed
 *   dangerous — frequent connect/disconnect is the third-strongest trigger for
 *               getting a number banned, which this project documented as a
 *               warning and then did twenty times an hour
 *
 * One process that stays up removes all three. It is also the prerequisite for
 * the code word, since listening needs a listener.
 *
 * ⛔ NOT A CONTRADICTION OF RULE 1. That rule forbids periodic polling that
 * pushes Comax's activity stamp forward and prevents the single seat from being
 * released. This holds a WhatsApp connection, touches no Comax stamp, and a
 * STABLE connection is what lowers ban risk rather than raising it.
 *
 *   npm run wa-daemon           start
 *   npm run wa-daemon -- --once  connect, report, exit (health check)
 */

import { writeFileSync, existsSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from '../src/config.js';
import {
  makeClient,
  connect,
  hasProfile,
  selfJid,
  shutdown,
} from '../src/whatsapp/client.js';
import {
  safeGetChats,
  completenessNote,
  readChatDirect,
} from '../src/whatsapp/chats.js';
import { guardedSend, jidToNumber, toJid } from '../src/whatsapp/guard.js';
import { decide, describeAllowlist, CODE_WORD } from '../src/whatsapp/authority.js';
import {
  enqueueOnce,
  markAcked,
  pending,
  toSend,
  markSent,
  markSendFailed,
  pendingReads,
  completeRead,
  failRead,
  QUEUE_PATH,
} from '../src/whatsapp/queue.js';
import { watch } from 'node:fs';

const STATE_DIR = resolve(ROOT, 'runs', 'whatsapp');
const PID_FILE = resolve(STATE_DIR, 'daemon.pid');
const STATUS_FILE = resolve(STATE_DIR, 'daemon-status.json');

const once = process.argv.includes('--once');
const headed = process.argv.includes('--headed');

const log = (...a) => {
  const t = new Date().toLocaleTimeString('he-IL');
  console.log(`[${t}]`, ...a);
};

function writeStatus(patch) {
  mkdirSync(STATE_DIR, { recursive: true });
  let prev = {};
  if (existsSync(STATUS_FILE)) {
    try {
      prev = JSON.parse(readFileSync(STATUS_FILE, 'utf8'));
    } catch {
      prev = {};
    }
  }
  writeFileSync(
    STATUS_FILE,
    `${JSON.stringify({ ...prev, ...patch, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    'utf8',
  );
}

/**
 * Refuse to start twice.
 *
 * Two daemons on one Chrome profile is the same single-seat collision as Comax:
 * the second would fail on the profile lock, and worse, both could answer the
 * same instruction — sending two replies to a real person.
 */
function claimPid() {
  mkdirSync(STATE_DIR, { recursive: true });
  if (existsSync(PID_FILE)) {
    const old = Number(readFileSync(PID_FILE, 'utf8').trim());
    if (old && old !== process.pid) {
      let alive = false;
      try {
        process.kill(old, 0);
        alive = true;
      } catch {
        alive = false;
      }
      if (alive) {
        throw new Error(
          `דמון כבר רץ (PID ${old}). לעצור אותו קודם, או: npm run wa-kill`,
        );
      }
      log(`נמצא PID ישן (${old}) שאינו רץ — מתעלם.`);
    }
  }
  writeFileSync(PID_FILE, String(process.pid), 'utf8');
}

function releasePid() {
  try {
    rmSync(PID_FILE, { force: true });
  } catch {
    /* nothing to reclaim */
  }
}

/**
 * Acknowledge receipt, so waiting is never blind.
 *
 * Goes through `guardedSend` like every other outbound message — the ack is a
 * real WhatsApp message and gets the same four gates. It lands in the chat the
 * instruction came from, which for Dror is his own self-chat and for Noa is her
 * existing conversation, so gate 3 is satisfied by construction.
 */
async function acknowledge(client, item) {
  const lines = [
    `✓ קיבלתי (${item.id})`,
    item.note ? `⚠️ ${item.note}` : null,
    item.note
      ? 'לא אבצע — אציג לך את מה שכתוב ואשאל.'
      : 'אענה כשאתחבר לסשן.',
  ].filter(Boolean);

  try {
    await guardedSend(client, {
      to: item.jid,
      body: lines.join('\n'),
      confirmed: true, // the ack is the daemon's own words, not a customer-bound message
    });
    markAcked(item.id);
    log(`אישור קבלה נשלח — ${item.id}`);
  } catch (e) {
    // An ack that fails must not lose the instruction: it is already queued.
    log(`⚠️ אישור הקבלה נכשל (${item.id}): ${e.message} — ההוראה נשמרה בתור`);
  }
}

async function handle(client, msg, self) {
  let verdict;
  try {
    verdict = decide(msg, self);
  } catch (e) {
    log(`שגיאה בהכרעה: ${e.message}`);
    return;
  }

  if (verdict.quiet) return; // ordinary traffic — silence is correct

  const item = enqueueOnce(msg.id?._serialized ?? msg.id?.id ?? null, {
    principal: verdict.who.principal,
    channel: verdict.who.channel,
    jid: msg.from,
    instruction: verdict.instruction,
    raw: msg.body,
    note: verdict.note,
    needsApproval: !verdict.act,
  });

  if (!item) {
    log('הודעה שכבר בתור — מדלג (הגנה מכפילות)');
    return;
  }

  log(
    `📥 ${verdict.who.principal} → "${verdict.instruction}"` +
      (verdict.note ? '  [מועברת — לאישור]' : ''),
  );
  writeStatus({ queued: pending().length });
  await acknowledge(client, item);
}

async function main() {
  if (!hasProfile()) {
    console.error('לא מקושר. הרץ קודם: npm run wa-link -- 05XXXXXXXX');
    process.exitCode = 2;
    return;
  }

  claimPid();
  writeStatus({ pid: process.pid, state: 'connecting' });

  const client = makeClient({ headed });

  let closing = false;
  const stop = async (why) => {
    if (closing) return;
    closing = true;
    log(`נעצר (${why})`);
    writeStatus({ state: 'stopped', reason: why });
    await shutdown(client);
    releasePid();
    process.exit(0);
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  log('מתחבר לוואטסאפ...');
  await connect(client, {
    onProgress: (p, m) => log(`  טוען… ${p}% ${m}`),
  });

  const self = selfJid(client);
  log(`✅ מחובר כ-${jidToNumber(self)}`);
  for (const line of describeAllowlist(self)) log(`   ${line}`);

  const { chats, total, failed } = await safeGetChats(client);
  const unread = chats.filter((c) => c.unreadCount > 0).length;
  log(`   ${chats.length} שיחות (מתוך ${total}) · ${unread} עם הודעות שלא נקראו`);
  const note = completenessNote(total, failed);
  if (note) log(`   ${note}`);

  writeStatus({
    state: 'listening',
    self: jidToNumber(self),
    chats: chats.length,
    chatsTotal: total,
    unread,
    queued: pending().length,
    codeWord: CODE_WORD,
  });

  if (once) {
    log('--once — מסיים.');
    await stop('once');
    return;
  }

  // Both events are needed and they cover different directions:
  //   message        — incoming, i.e. Noa
  //   message_create — anything this account creates, i.e. Dror's self-chat
  // `authority.js` decides which is authorised; the daemon does not guess.
  client.on('message', (m) => handle(client, m, self).catch((e) => log('❌', e.message)));
  client.on('message_create', (m) =>
    handle(client, m, self).catch((e) => log('❌', e.message)),
  );

  client.on('disconnected', (reason) => {
    log(`⚠️ נותק: ${reason}`);
    writeStatus({ state: 'disconnected', reason });
    // Deliberately NOT auto-reconnecting in a loop: repeated reconnects are a
    // ban trigger. Exit and let whoever started the daemon decide.
    stop(`disconnected: ${reason}`);
  });

  // ── Outbound: answers a session staged in the queue.
  //
  // The session cannot send them itself — this process holds the Chrome profile
  // and a profile is a single seat. So it writes `to-send` to the queue file and
  // we pick it up. fs.watch rather than a poll loop: no timer, nothing periodic.
  const fmtTs = (ts) => (ts ? new Date(ts * 1000).toISOString() : null);

  /**
   * Perform one read request.
   *
   * Ambiguity is returned as data, never resolved here: `find` reports every
   * match and lets the session decide. Picking the first match would summarise
   * the wrong person's conversation under the right heading — invisible at
   * every step, which is the failure rule 18 exists for.
   */
  async function performRead(req) {
    const { chats, total, failed } = await safeGetChats(client);
    const note = completenessNote(total, failed);

    if (req.kind === 'chats') {
      const rows = [...chats]
        .filter((c) => c.timestamp)
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, req.limit || 40)
        .map((c) => ({
          jid: c.jid,
          title: c.title,
          isGroup: c.isGroup,
          unread: c.unreadCount,
          at: fmtTs(c.timestamp),
        }));
      return { note, total, unreadable: failed, rows };
    }

    if (req.kind === 'find') {
      const needle = String(req.target || '').trim();
      const rows = chats
        .filter((c) => (c.title || '').includes(needle))
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
        .map((c) => ({
          jid: c.jid,
          title: c.title,
          isGroup: c.isGroup,
          isChannel: c.isChannel,
          number: c.isGroup || c.isChannel ? null : jidToNumber(c.jid),
          at: fmtTs(c.timestamp),
        }));
      return {
        note,
        term: needle,
        matches: rows.length,
        individuals: rows.filter((r) => !r.isGroup && !r.isChannel).length,
        rows,
      };
    }

    if (req.kind === 'search') {
      // Searches message CONTENT, not chat names. Needed because a contact who
      // is not saved in the phone book has no name to match — the chat title is
      // just a number, so "מאיר" finds nothing by title even when he exists.
      const msgs = await client.searchMessages(String(req.target || ''), {
        limit: req.limit || 40,
      });
      return {
        note,
        term: req.target,
        found: msgs.length,
        rows: msgs.map((m) => ({
          chat: m.id?.remote ?? null,
          number: m.id?.remote ? jidToNumber(m.id.remote) : null,
          fromMe: !!m.fromMe,
          at: fmtTs(m.timestamp),
          body: m.body || `[${m.type || 'מדיה'}]`,
        })),
      };
    }

    if (req.kind === 'read') {
      // readChatDirect, not getChatById: the wrapper fails on LID identities
      // with a minified `r` while the model itself reads fine.
      const jid = toJid(req.target);
      const r = await readChatDirect(client, jid, req.limit || 60);
      return {
        note,
        jid,
        title: r.title || jidToNumber(jid),
        read: r.read,
        limit: r.requested,
        mayHaveOlder: r.mayHaveOlder,
        noEarlier: r.noEarlier,
        rows: r.rows.map((m) => ({
          fromMe: m.fromMe,
          at: fmtTs(m.t),
          body: m.body || `[${m.type || 'מדיה'}]`,
        })),
      };
    }

    throw new Error(`סוג בקשה לא מוכר: ${req.kind}`);
  }

  let draining = false;
  async function drain() {
    if (draining) return;
    draining = true;
    try {
      for (const req of pendingReads()) {
        try {
          const result = await performRead(req);
          completeRead(req.id, result);
          log(`🔎 בקשת קריאה בוצעה — ${req.id} (${req.kind}${req.target ? ` "${req.target}"` : ''})`);
        } catch (e) {
          failRead(req.id, e.message);
          log(`❌ בקשת קריאה נכשלה — ${req.id}: ${e.message}`);
        }
      }
      for (const item of toSend()) {
        try {
          const r = await guardedSend(client, {
            to: item.jid,
            body: item.answer,
            confirmed: true, // staging an answer IS the approval; a session wrote it
          });
          markSent(item.id);
          log(`📤 תשובה נשלחה — ${item.id} → ${r.name}`);
          if (r.warning) log(`   ${r.warning}`);
        } catch (e) {
          // A refused answer must be visible, not retried forever.
          markSendFailed(item.id, e.message);
          log(`⛔ תשובה נדחתה — ${item.id}: ${e.message}`);
        }
      }
    } finally {
      draining = false;
      writeStatus({ queued: pending().length });
    }
  }

  try {
    watch(QUEUE_PATH, { persistent: false }, () => {
      drain().catch((e) => log('❌ drain:', e.message));
    });
  } catch {
    log('(התור עוד לא קיים — ייווצר בהוראה הראשונה)');
  }
  await drain();

  log('');
  log(`👂 מאזין. לשלוח מהטלפון: "${CODE_WORD} ..." בשיחה עם עצמך.`);
  log('   לראות את התור:  npm run wa -- queue');
  log('   לעצור:          Ctrl+C');

  // Heartbeat to the status file only — no WhatsApp traffic, no Comax stamp.
  setInterval(() => {
    writeStatus({ queued: pending().length });
    // Also a safety net for answers staged before the watch could be armed —
    // the queue file does not exist until the first instruction arrives.
    drain().catch(() => {});
  }, 60000);
}

main().catch(async (e) => {
  console.error(`נכשל: ${e.message}`);
  writeStatus({ state: 'failed', error: e.message });
  releasePid();
  process.exitCode = 1;
});

#!/usr/bin/env node
/**
 * Step-by-step probe of the bridge connection, printing the full stack.
 *
 * Exists because `npm run wa -- status` failed with `נכשל: r` — a minified
 * error message carrying no information. The CLI logs `e.message` only, which
 * is right for normal operation and useless here, so this prints every stage
 * and the whole error object.
 *
 * Not a production path. Run it when something breaks and the message is thin.
 */

import { makeClient, connect, shutdown } from '../src/whatsapp/client.js';
import { safeGetChats } from '../src/whatsapp/chats.js';

const stage = (s) => console.log(`── ${s}`);

const client = makeClient({ headed: process.argv.includes('--headed') });

client.on('loading_screen', (p, m) => console.log(`   [loading] ${p}% ${m || ''}`));
client.on('authenticated', () => console.log('   [authenticated]'));
client.on('change_state', (s) => console.log(`   [state] ${s}`));
client.on('qr', () => console.log('   [qr] ⚠️ ביקש QR — הקישור לא נשמר!'));

try {
  stage('connect');
  await connect(client, { timeoutMs: 180000 });
  console.log('   ✅ ready');

  stage('client.info');
  console.log('   ', JSON.stringify(client.info?.wid ?? null));
  console.log('    pushname:', client.info?.pushname ?? '(אין)');

  stage('getWWebVersion');
  console.log('   ', await client.getWWebVersion().catch((e) => `שגיאה: ${e.message}`));

  stage('getState');
  console.log('   ', await client.getState().catch((e) => `שגיאה: ${e.message}`));

  stage('getChats');
  try {
    const { chats, total, failed } = await safeGetChats(client);
    console.log(`   ✅ ${chats.length} שיחות (מתוך ${total}, ${failed} לא נקראו)`);
    const first = chats[0];
    if (first) {
      console.log(
        `    ראשונה: ${first.name || first.id?._serialized} · unread=${first.unreadCount}`,
      );
    }
  } catch (e) {
    console.log('   ❌ getChats נכשל');
    console.log('    message:', JSON.stringify(e?.message));
    console.log('    name:', e?.name);
    console.log('    stack:', e?.stack);
    console.log('    raw:', require('node:util').inspect(e, { depth: 3 }));
  }
} catch (e) {
  console.log('❌ נפל לפני getChats');
  console.log('  message:', JSON.stringify(e?.message));
  console.log('  name:', e?.name);
  console.log('  stack:', e?.stack);
} finally {
  await shutdown(client);
}

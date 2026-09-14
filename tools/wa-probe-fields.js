import { makeClient, connect, shutdown } from '../src/whatsapp/client.js';
const client = makeClient({});
try {
  await connect(client, { timeoutMs: 180000 });
  const r = await client.pupPage.evaluate(async () => {
    const models = window.require('WAWebCollections').Chat.getModelsArray();
    const out = { count: models.length, rawKeys: null, serializedKeys: null, samples: [] };
    const m = models[0];
    out.rawKeys = Object.keys(m).slice(0, 60);
    try { out.serializedKeys = Object.keys(m.serialize()).sort(); } catch (e) { out.serializedKeys = 'ERR ' + e.message; }
    // candidate timestamp fields, measured not guessed
    for (const mm of models.slice(0, 5)) {
      let s = {};
      try { s = mm.serialize(); } catch {}
      out.samples.push({
        id: mm.id?._serialized,
        t: s.t, timestamp: s.timestamp, sortTimestamp: s.sortTimestamp,
        modelT: mm.t, modelSort: mm.sortTimestamp,
        unread: s.unreadCount,
        hasMsgs: !!(s.msgs && s.msgs.length),
        lastMsgT: mm.lastReceivedKey?.t ?? null,
      });
    }
    return out;
  });
  console.log(JSON.stringify(r, null, 2));
} catch (e) { console.log('❌', e.message); } finally { await shutdown(client); }

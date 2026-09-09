/**
 * מאזין לתעבורה שהעמוד יוזם מעצמו, בלי שאף אחד נוגע בו.
 * אם הפריים-סט מתשאל את השרת בעצמו, סשן פתוח לעולם לא ייחשב "לא פעיל" —
 * והמושב לא ישוחרר כל עוד החלון פתוח.
 */
import { attachBrowser } from '../../src/browser.js';
const s = await attachBrowser({});
if (!s) { console.log('אין חלון'); process.exit(1); }
const seen = new Map();
s.page.on('request', (r) => {
  const u = r.url().replace(/^https:\/\/www\.comax\.co\.il\//,'').split('?')[0];
  seen.set(u, (seen.get(u) ?? 0) + 1);
});
const SECS = Number(process.argv[2] ?? 180);
console.log(`מאזין ${SECS} שניות בלי לגעת בכלום...`);
await new Promise(r => setTimeout(r, SECS * 1000));
if (!seen.size) console.log('\nאפס בקשות. העמוד שקט לחלוטין.');
else { console.log('\nבקשות שהעמוד יזם מעצמו:'); for (const [u,n] of [...seen].sort((a,b)=>b[1]-a[1])) console.log(`  ${String(n).padStart(3)}×  ${u}`); }
await s.browser.close().catch(()=>{});

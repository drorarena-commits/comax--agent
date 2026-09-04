import { attachBrowser } from '../../src/browser.js';

const session = await attachBrowser();
if (!session) { console.error('אין חלון פתוח'); process.exit(1); }
const { page, human, browser } = session;

const frame = page.frames().find(f => /Erp\/Prt\/PrtV\.aspx/i.test(f.url()));
if (!frame) { console.error('לא נמצא frame של פריטים'); process.exit(1); }

// Double-click the row holding the item name to open its detail.
await human.doubleClick("td:text-is(\"WOMEN'S TEAM SWIMSUIT WATERPOLO S\")", { scope: frame, label: 'פתיחת שורת הפריט' });
await human.think('item detail opening');

console.log('frames now:', page.frames().map(f => f.name() + ' ' + f.url()).join('\n'));

await browser.close().catch(() => {});

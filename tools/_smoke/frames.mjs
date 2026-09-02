import { attachBrowser } from '../../src/browser.js';
const s = await attachBrowser();
for (const f of s.page.frames()) {
  const u = f.url();
  if (/Doc650|Lines|Prt/i.test(u)) console.log((f.name()||'(anon)').padEnd(14), u.slice(0,150));
}
await s.browser.close().catch(()=>{});

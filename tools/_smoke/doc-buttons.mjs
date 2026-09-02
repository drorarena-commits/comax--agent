import { attachBrowser } from '../../src/browser.js';
const s = await attachBrowser();
const re = new RegExp(process.argv[2] || 'Doc650U');
const fr = s.page.frames().find(f => re.test(f.url()));
if (!fr) { console.log('אין frame כזה'); process.exit(1); }
const els = await fr.evaluate(() =>
  [...document.querySelectorAll('img,input[type=button],input[type=submit],button,a')]
    .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
    .map(e => ({ tag: e.tagName, id: e.id, title: e.title || e.alt || '', src: (e.src||'').split('/').pop(),
                 onclick: (e.getAttribute('onclick')||'').slice(0,90), text: (e.innerText||e.value||'').trim().slice(0,30) })));
els.forEach(e => console.log(`${e.tag.padEnd(6)} #${(e.id||'').padEnd(16)} ${(e.title||e.text).padEnd(22)} ${e.src.padEnd(18)} ${e.onclick}`));
await s.browser.close().catch(()=>{});

import { attachBrowser } from '../../src/browser.js';
import { RunLogger } from '../../src/logger.js';
import { navFrame, isLoggedIn } from '../../src/session.js';

const logger = new RunLogger('probe-menu');
const s = await attachBrowser({ logger });
if (!s) { console.log('אין חלון פתוח'); process.exit(1); }
const { page, human, cfg } = s;

if (!(await isLoggedIn(page, cfg))) { console.log('לא מחובר'); process.exit(1); }

const nav = navFrame(page, cfg);
await human.click(cfg.app.menuButton, { scope: nav, label: 'תפריט תוכניות (#Start)' });
await human.settle('menu open');

// Report every frame that gained content once the menu opened.
for (const fr of page.frames()) {
  const name = fr.name();
  if (!name) continue;
  let data;
  try {
    data = await fr.evaluate(() => {
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        return (r.width > 0 || r.height > 0) && getComputedStyle(el).visibility !== 'hidden';
      };
      const items = [...document.querySelectorAll('td,a,div,li,span')]
        .filter((el) => vis(el) && el.children.length === 0)
        .map((el) => ({
          text: (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' '),
          id: el.id || null,
          onclick: (el.getAttribute('onclick') || '').slice(0, 100) || null,
          tag: el.tagName.toLowerCase(),
        }))
        .filter((x) => x.text && x.text.length < 60);
      return { url: location.href, count: items.length, items: items.slice(0, 60) };
    });
  } catch { continue; }
  if (!data.count) continue;
  console.log(`\n── frame "${name}"  ${data.url.replace('https://www.comax.co.il/Max2000/', '')}`);
  for (const it of data.items) {
    console.log(`   ${it.tag.padEnd(5)} ${(it.id || '-').padEnd(18)} ${it.text}${it.onclick ? '   onclick=' + it.onclick : ''}`);
  }
}

await logger.shot(page, 'menu-open');
await s.browser.close().catch(() => {});
logger.done();

import { attachBrowser } from '../src/browser.js';
import { RunLogger } from '../src/logger.js';
import { ensureLoggedIn } from '../src/session.js';
import { openProgram } from '../src/navigate.js';

const target = process.argv[2];
const logger = new RunLogger(`open-${target}`);
const s = await attachBrowser({ logger });
if (!s) { console.log('אין חלון פתוח'); process.exit(1); }
await ensureLoggedIn({ ...s, logger });
const r = await openProgram({ ...s, logger }, target);
console.log('\nframe התוכנית:', r.frameName);
console.log('frames שנפתחו:', r.opened.map(f => `${f.name}(${f.elements})`).join(', ') || 'אף אחד');
await logger.shot(s.page, 'program');
await s.browser.close().catch(() => {});
logger.done();

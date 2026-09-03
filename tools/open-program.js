import { attachBrowser } from '../src/browser.js';
import { RunLogger } from '../src/logger.js';
import { ensureLoggedIn } from '../src/session.js';
import { openProgram } from '../src/navigate.js';

/**
 *   node tools/open-program.js <shortcut> [program path]
 *
 * The optional path is the fallback for a shortcut Comax has taken off the
 * desktop — `a146` went that way on 03/09/2026 — and without it the icon is
 * waited out for the full actionTimeoutMs before failing.
 */
const target = process.argv[2];
const program = process.argv[3] ?? null;
const logger = new RunLogger(`open-${target}`);
const s = await attachBrowser({ logger });
if (!s) { console.log('אין חלון פתוח'); process.exit(1); }
await ensureLoggedIn({ ...s, logger });
const r = await openProgram({ ...s, logger }, target, { program });
console.log('\nframe התוכנית:', r.frameName);
console.log('frames שנפתחו:', r.opened.map(f => `${f.name}(${f.elements})`).join(', ') || 'אף אחד');
await logger.shot(s.page, 'program');
await s.browser.close().catch(() => {});
logger.done();

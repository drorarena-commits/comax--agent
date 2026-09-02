import { attachBrowser } from '../../src/browser.js';
import { RunLogger } from '../../src/logger.js';
const logger = new RunLogger('shot');
const s = await attachBrowser({ logger });
await logger.shot(s.page, process.argv[2] || 'now');
await s.browser.close().catch(()=>{});
logger.done();

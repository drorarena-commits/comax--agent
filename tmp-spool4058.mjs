import { getBrowser } from './src/browser.js';
import { captureSession, buildWhenReady, fetchSpoolFile } from './src/spool.js';
import { resolve } from 'node:path';
import { ROOT } from './src/config.js';

const logger = { step: (t, m) => console.log(`  ${t}\t${m}`) };
const { page, context } = await getBrowser({ logger });
const session = await captureSession({ page, context });
console.log('session:', session.SessionID);
const base = resolve(ROOT, 'data/exports/מטריצת-מחסנים-2026-09-13');
await buildWhenReady(session, 4058, { logger, timeoutMs: 6 * 60_000 });
const { file, size } = await fetchSpoolFile(session, 4058, base, { logger });
console.log('\nהורד:', file, (size / 1024 / 1024).toFixed(2), 'MB');
process.exit(0);

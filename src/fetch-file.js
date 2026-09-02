/**
 * Pulling files out of Comax without letting Chrome touch them.
 *
 * Comax's exports are 19–31 MB of HTML served under an Excel content type.
 * Handing that to the browser is what has been killing the agent: eight crash
 * dumps in .chrome-profile/Crashpad/reports, every one of them landing on an
 * export. Seven are access violations at the identical address
 * (chrome.dll+0x261e8f, 152.0.7977.65) — a code path that breaks the same way
 * every time, not random memory pressure — and the eighth is an outright
 * OUT_OF_MEMORY whose dump is the only one containing Comax URLs
 * (System/Spool/ShowDoc_G.asp). That one was a process rendering the report as
 * a DOM.
 *
 * A manual download works because nothing renders it and nothing holds it: the
 * bytes go straight to disk. This module does the same thing from Node — take
 * the session cookies out of the live browser, fetch over plain HTTP, stream to
 * a file. No renderer, no download machinery, no page that Comax can close
 * mid-transfer.
 */
import { createWriteStream } from 'node:fs';
import { rename, mkdir, stat, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * The Cookie header for a Comax request, read from the live browser context.
 * The session lives in cookies, so a fetch carrying them is the same session
 * the window is looking at — no second login, no extra seat taken.
 */
export async function comaxCookies(context, url = 'https://www.comax.co.il/') {
  const cookies = await context.cookies(url);
  if (!cookies.length) throw new Error('אין cookies לקומקס — הדפדפן כנראה לא מחובר.');
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

/**
 * Stream a URL to disk.
 *
 * Streaming rather than buffering is the point: `res.arrayBuffer()` would hold
 * the whole 31 MB export in memory before writing a byte, which is the very
 * thing that has been crashing on the browser side.
 *
 * Writes to `<dest>.part` and renames on success, so a failed or truncated
 * transfer never leaves something that looks like a finished export.
 */
export async function fetchToFile(url, dest, { cookie, referer = null, timeoutMs = 5 * 60_000, logger = null } = {}) {
  await mkdir(dirname(dest), { recursive: true });
  const part = `${dest}.part`;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        cookie,
        // Comax's ASP pages check where the request came from and answer
        // "ERROR1" to anything that looks like it arrived out of context.
        ...(referer ? { referer } : {}),
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
        accept: '*/*',
      },
      redirect: 'follow',
      signal: ac.signal,
    });

    const type = res.headers.get('content-type') ?? '';
    const len = res.headers.get('content-length');
    const disp = res.headers.get('content-disposition') ?? '';
    logger?.step('fetch', `${res.status} ${type}${len ? ` ${(len / 1024 / 1024).toFixed(1)}MB` : ''}${disp ? ` ${disp}` : ''}`);

    if (!res.ok) throw new Error(`השרת החזיר ${res.status} ${res.statusText}`);
    if (!res.body) throw new Error('התשובה ריקה.');

    await pipeline(Readable.fromWeb(res.body), createWriteStream(part));

    const { size } = await stat(part);
    if (size === 0) throw new Error('התקבל קובץ ריק.');

    await rename(part, dest);
    return { file: dest, size, contentType: type, contentDisposition: disp };
  } catch (e) {
    await unlink(part).catch(() => {});
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Absolute URL for a path under the Max2000 app. */
export const maxUrl = (path) => new URL(path, 'https://www.comax.co.il/Max2000/').toString();

/** Where a run's downloads belong. */
export const exportPath = (root, dir, name) => resolve(root, dir, name);

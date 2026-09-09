/**
 * איפה יושבים קיצורי שולחן העבודה, ולמה קיצור מסוים לא נמצא.
 *
 * `openProgram` aims `#<id>` at the nav frame, on the strength of a snapshot
 * that recorded `id="a157"` on the desktop anchors. On 09/09/2026 that lookup
 * timed out — the icon is plainly on screen, the id is not found — and the
 * previous attempt to work out why was a throwaway script in `.tmp/` that died
 * mid-flight and left the seat held. This is that probe, written as a task so
 * it goes through the dispatcher, releases the seat on the way out, and is
 * still here the next time a shortcut moves.
 *
 * Reads only. Opens no program: it stops at the desktop and reports.
 */
import { ensureLoggedIn } from '../session.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from '../config.js';
import { showDesktop } from '../navigate.js';

export const meta = {
  name: 'desktop-probe',
  description: 'מאתר קיצור בשולחן העבודה ומדווח באיזה frame הוא יושב ואיך לתפוס אותו',
  writes: false,
  input: {
    id: 'string, אופציונלי — מזהה הקיצור לחיפוש. ברירת מחדל a157',
    label: 'string, אופציונלי — הטקסט המדויק של הקיצור, לחיפוש מקביל לפי טקסט',
    catalog: 'true — לקרוא את כל הקיצורים ואת נתיב התוכנית שלהם, ולכתוב את הקטלוג',
    learn: 'true — לפתוח כל מסך ולקרוא את הנתיב מה-URL. הדרך היחידה לקבל אותו',
    only: 'string|array, אופציונלי — ללמוד רק את הקיצורים האלה',
    inspect: 'true — לפרק אייקון אחד: attributes, HTML, וטבלאות JS',
    write: 'true — לכתוב בפועל ל-knowledge/desktop-shortcuts.json. בלעדיו רק מדווח',
  },
};

/**
 * Every desktop anchor, with the program path hiding in its `onclick`.
 *
 * The path is what `openProgram`'s fast route needs — `top.S.runProgram(path)`
 * opens the screen without raising the desktop or hunting for an icon. Until
 * 09/09/2026 the catalogue held only `id`, `label` and `selector`, so every
 * caller that wanted a path had to hard-code one, and the seven tasks that
 * never did were one desktop reshuffle away from failing.
 *
 * That reshuffle is not hypothetical: at 18:20 that day the desktop came up on
 * the "לקוחות" category, where `a157` is not present at all, and `invoice-email`
 * died on an icon that had been there forty minutes earlier.
 *
 * The onclick text is captured verbatim alongside the parsed path — when a
 * pattern here fails to match, the raw string is what says why, and guessing a
 * path is worse than having none (a wrong one fails over to the desktop and
 * costs the wait twice, silently).
 */
const READ_CATALOG = () => {
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const out = [];
  for (const a of document.querySelectorAll('a')) {
    const id = a.id || '';
    if (!/^a\d+$/.test(id)) continue;
    const onclick = norm(a.getAttribute('onclick') || '');
    const href = norm(a.getAttribute('href') || '');
    const hay = `${onclick} ${href}`;
    // Any quoted string that looks like a Max2000 screen path.
    const m = hay.match(/['"]([A-Za-z][A-Za-z0-9_\-/]*\/[A-Za-z0-9_\-/]*\.as[px]+[^'"]*)['"]/);
    out.push({
      id,
      label: norm(a.textContent),
      program: m ? m[1] : null,
      onclick: onclick.slice(0, 200) || null,
    });
  }
  return out;
};

export async function run({ page, human, logger, cfg, input }) {
  const id = input.id ?? 'a157';
  const label = input.label ?? 'חשבוניות מס ( מכירות )';

  await ensureLoggedIn({ page, human, logger, cfg });
  await showDesktop({ page, human, logger, cfg });

  /**
   * What an icon actually carries, when the obvious places came back empty.
   *
   * The first catalogue pass read `onclick` and `href` and found neither on any
   * of 51 icons: Max2000 binds them in JS, so the path is somewhere else. This
   * dumps one icon whole — every attribute, its outerHTML, and the globals that
   * look like a program table — rather than guessing a second pattern blind.
   */
  if (input.inspect) {
    const dumps = [];
    for (const fr of page.frames()) {
      const d = await fr.evaluate((want) => {
        const a = document.getElementById(want) ?? document.querySelector('a[id^="a"]');
        if (!a) return null;
        const attrs = {};
        for (const at of a.attributes) attrs[at.name] = at.value.slice(0, 300);
        const globals = Object.keys(window).filter((k) => /prog|menu|short|desk|icon/i.test(k)).slice(0, 40);

        /**
         * Hunt the id→path table.
         *
         * The icon carries only `id` and `style`, and `runProgram(s1)` takes the
         * path as an argument — so something in JS maps one to the other. Rather
         * than guess its name, walk the globals for any array or object whose
         * values look like Max2000 screen paths, and report where it was found.
         */
        const pathish = /[A-Za-z][A-Za-z0-9_\-/]*\/[A-Za-z0-9_\-/]+\.as[px]+/;
        const tables = [];
        for (const k of Object.keys(window)) {
          let v;
          try { v = window[k]; } catch { continue; }
          if (!v || typeof v !== 'object') continue;
          let hits = 0, sample = null;
          try {
            const entries = Array.isArray(v) ? v.entries() : Object.entries(v).slice(0, 400);
            for (const [kk, vv] of entries) {
              const s = typeof vv === 'string' ? vv : (vv && typeof vv === 'object' ? JSON.stringify(vv).slice(0, 200) : '');
              if (s && pathish.test(s)) { hits++; sample ??= `${kk} → ${s.slice(0, 90)}`; }
              if (hits > 3) break;
            }
          } catch { /* exotic host object */ }
          if (hits) tables.push({ global: k, hits, sample });
          if (tables.length > 12) break;
        }
        const S = window.top?.S;
        return {
          id: a.id,
          text: (a.textContent || '').replace(/\s+/g, ' ').trim(),
          attrs,
          outerHTML: a.outerHTML.slice(0, 600),
          parentHTML: a.parentElement?.outerHTML.slice(0, 600) ?? null,
          globals,
          tables,
          sKeys: S ? Object.keys(S).slice(0, 60) : null,
          runProgramSrc: typeof S?.runProgram === 'function' ? String(S.runProgram).slice(0, 500) : null,
        };
      }, id).catch(() => null);
      if (d) dumps.push({ frame: fr.name() || '(anon)', url: fr.url().slice(-60), ...d });
    }
    logger.save('inspect.json', dumps);
    for (const d of dumps) {
      logger.step('inspect', `${d.frame} — #${d.id} "${d.text}"`);
      logger.step('attrs', JSON.stringify(d.attrs));
      if (d.sKeys) logger.step('S', d.sKeys.join(', ').slice(0, 300));
      if (d.runProgramSrc) logger.step('runProgram', d.runProgramSrc.replace(/\s+/g, ' ').slice(0, 300));
    }
    console.log(JSON.stringify(dumps, null, 1).slice(0, 6000));
    return { dumps: dumps.length };
  }

  /**
   * Learn program paths the only way Comax will give them up: open the screen
   * and read the frame's URL.
   *
   * The path is not in the DOM and not in JS — icons carry `id` and `style` and
   * nothing else, and a sweep of the globals on 09/09/2026 turned up no id→path
   * table. Comax resolves it server-side on the click. So the path is *measured*
   * rather than derived, which also makes it the trustworthy kind: a value read
   * off a URL that actually opened cannot be a plausible-looking guess that
   * silently fails over to the desktop later.
   *
   * Read-only — these are list screens, opened and closed. It never enters a
   * document, so `#OK`-means-קליטה (rule 4) is never in reach.
   */
  if (input.learn) {
    const { openProgram, closePrograms, shortcuts } = await import('../navigate.js');
    const wanted = input.only
      ? [].concat(input.only)
      : shortcuts().shortcuts.filter((s) => !s.program).map((s) => s.id);
    logger.step('learn', `${wanted.length} קיצורים ללמוד`);

    const learned = [];
    for (const want of wanted) {
      try {
        const { frame } = await openProgram({ page, human, logger, cfg }, want, {});
        const url = frame?.url() ?? '';
        const m = url.match(/comax\.co\.il\/(?:Max2000[^/]*)\/(.+?)(?:\?|$)/i);
        learned.push({ id: want, program: m ? m[1] : null, url: url.slice(0, 120) });
        logger.step('learn', `${want} → ${m ? m[1] : 'לא זוהה נתיב'}`);
      } catch (e) {
        learned.push({ id: want, program: null, error: e.message.split('\n')[0] });
        logger.step('learn', `${want} — נכשל: ${e.message.split('\n')[0].slice(0, 90)}`);
      }
      await closePrograms({ page, human, logger, cfg }).catch(() => {});
    }

    const file = resolve(ROOT, 'knowledge/desktop-shortcuts.json');
    const cat = JSON.parse(readFileSync(file, 'utf8'));
    let added = 0;
    for (const l of learned) {
      if (!l.program) continue;
      const sc = cat.shortcuts.find((s) => s.id === l.id);
      if (sc && !sc.program) { sc.program = l.program; added++; }
    }
    logger.save('learned.json', learned);
    logger.step('learn', `${added} נתיבים חדשים · ${learned.filter((l) => !l.program).length} לא נלמדו`);
    if (input.write && added) {
      writeFileSync(file, `${JSON.stringify(cat, null, 2)}\n`, 'utf8');
      logger.step('learn', `נכתב: ${file}`);
    } else if (!input.write) {
      logger.step('learn', 'לא נכתב (אין --write). זו הרצת דיווח.');
    }
    return { learned, added, wrote: Boolean(input.write && added) };
  }

  if (input.catalog) {
    const found = new Map();
    for (const fr of page.frames()) {
      for (const s of (await fr.evaluate(READ_CATALOG).catch(() => [])) ?? []) {
        if (s.label && !found.has(s.id)) found.set(s.id, s);
      }
    }
    const rows = [...found.values()];
    const withPath = rows.filter((r) => r.program);
    logger.step('catalog', `${rows.length} קיצורים · ${withPath.length} עם נתיב`);
    await logger.shot(page, 'desktop-catalog');
    logger.save('catalog-raw.json', rows);

    // The existing catalogue is the base: this desktop shows one category, so
    // shortcuts that live under another are absent here and must NOT be dropped.
    const file = resolve(ROOT, 'knowledge/desktop-shortcuts.json');
    const cat = JSON.parse(readFileSync(file, 'utf8'));
    const byLabel = new Map(rows.map((r) => [r.label, r]));
    let added = 0, changed = 0, conflict = 0;
    for (const sc of cat.shortcuts) {
      const hit = byLabel.get(sc.label);
      if (!hit?.program) continue;
      if (!sc.program) { sc.program = hit.program; added++; }
      else if (sc.program !== hit.program) {
        // Never overwrite silently — a differing path is a finding, not a fix.
        logger.step('conflict', `${sc.label}: קטלוג="${sc.program}" · מסך="${hit.program}"`);
        conflict++;
      } else changed++;
      // The id moves between snapshots; refresh it while we are here.
      if (hit.id && sc.id !== hit.id) logger.step('id', `${sc.label}: ${sc.id} → ${hit.id}`);
    }
    const missing = cat.shortcuts.filter((s) => !s.program).map((s) => `${s.label} (${s.id})`);
    const unknown = rows.filter((r) => !cat.shortcuts.some((s) => s.label === r.label)).map((r) => `${r.label} (${r.id})`);

    logger.step('catalog', `נוספו ${added} נתיבים · ${changed} כבר תאמו · ${conflict} סתירות`);
    if (unknown.length) logger.step('catalog', `${unknown.length} קיצורים על המסך שאינם בקטלוג`);
    logger.step('catalog', `${missing.length} קיצורים בקטלוג עדיין בלי נתיב`);

    if (input.write && added && !conflict) {
      writeFileSync(file, `${JSON.stringify(cat, null, 2)}\n`, 'utf8');
      logger.step('catalog', `נכתב: ${file}`);
    } else if (conflict) {
      logger.step('catalog', 'לא נכתב — יש סתירות. תבדוק אותן קודם.');
    } else if (!input.write) {
      logger.step('catalog', 'לא נכתב (אין --write). זו הרצת דיווח.');
    }

    return {
      onScreen: rows.length, withPath: withPath.length,
      added, conflict, stillMissing: missing, notInCatalogue: unknown,
      wrote: Boolean(input.write && added && !conflict),
    };
  }

  const report = [];
  for (const fr of page.frames()) {
    const name = fr.name() || '(anon)';
    // A frame can be torn down while we walk the list; that is not a finding.
    const found = await fr
      .evaluate(
        ({ id, label }) => {
          const seen = (el) => {
            const r = el.getBoundingClientRect();
            const st = getComputedStyle(el);
            return {
              w: Math.round(r.width),
              h: Math.round(r.height),
              x: Math.round(r.x),
              y: Math.round(r.y),
              display: st.display,
              visibility: st.visibility,
              // Playwright calls an element visible when it has a non-empty box
              // and is not `visibility: hidden` — this is that same question.
              playwrightVisible: r.width > 0 && r.height > 0 && st.visibility !== 'hidden',
            };
          };
          const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
          const byId = document.getElementById(id);
          const anchors = [...document.querySelectorAll('a')];
          const byText = anchors.filter((a) => norm(a.textContent) === norm(label));
          return {
            anchors: anchors.length,
            withProgramId: anchors.filter((a) => /^a\d+$/.test(a.id)).length,
            byId: byId ? { tag: byId.tagName, text: norm(byId.textContent).slice(0, 60), ...seen(byId) } : null,
            byText: byText.map((a) => ({ id: a.id || null, text: norm(a.textContent).slice(0, 60), ...seen(a) })),
            // When neither hits, the nearest labels say whether we are even on
            // the right frame or just looking at the wrong screen entirely.
            nearby: anchors
              .filter((a) => norm(a.textContent).includes('חשבונית'))
              .slice(0, 8)
              .map((a) => ({ id: a.id || null, text: norm(a.textContent).slice(0, 60) })),
          };
        },
        { id, label },
      )
      .catch(() => null);

    if (!found) continue;
    if (!found.anchors) continue;
    report.push({ frame: name, url: fr.url(), ...found });
  }

  await logger.shot(page, 'desktop');

  for (const f of report) {
    const bits = [`${f.anchors} <a>`, `${f.withProgramId} עם id של תוכנית`];
    logger.step('frame', `${f.frame} — ${bits.join(' · ')} — ${f.url.slice(-70)}`);
    if (f.byId) logger.step('byId', `#${id} → ${JSON.stringify(f.byId)}`);
    for (const t of f.byText) logger.step('byText', `"${label}" → ${JSON.stringify(t)}`);
  }
  console.log(JSON.stringify(report, null, 1));

  return { id, label, frames: report };
}

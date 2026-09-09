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
import { showDesktop } from '../navigate.js';

export const meta = {
  name: 'desktop-probe',
  description: 'מאתר קיצור בשולחן העבודה ומדווח באיזה frame הוא יושב ואיך לתפוס אותו',
  writes: false,
  input: {
    id: 'string, אופציונלי — מזהה הקיצור לחיפוש. ברירת מחדל a157',
    label: 'string, אופציונלי — הטקסט המדויק של הקיצור, לחיפוש מקביל לפי טקסט',
  },
};

export async function run({ page, human, logger, cfg, input }) {
  const id = input.id ?? 'a157';
  const label = input.label ?? 'חשבוניות מס ( מכירות )';

  await ensureLoggedIn({ page, human, logger, cfg });
  await showDesktop({ page, human, logger, cfg });

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

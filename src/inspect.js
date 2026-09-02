/**
 * Screen inspection: turns whatever is on screen right now into a durable
 * "recipe" — the interactive elements, their Hebrew labels, and a ranked
 * selector for each. This is what lets a task script target Comax reliably
 * instead of guessing.
 *
 * Comax is an ASP.NET portal, so ids like `ctl00_ContentPlaceHolder1_txtName`
 * are common and semi-stable, and content often lives inside iframes. Both are
 * handled here.
 */

/** Runs inside the page. Collects every interactive/labelled element. */
const COLLECT = () => {
  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
  };

  const text = (el) => (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120);

  // Best human-readable label for a control.
  const labelFor = (el) => {
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label').trim();
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const t = labelledBy.split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean).map(text).join(' ');
      if (t) return t;
    }
    if (el.id) {
      const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lab) return text(lab);
    }
    const wrap = el.closest('label');
    if (wrap) return text(wrap);
    if (el.placeholder) return el.placeholder.trim();
    if (el.title) return el.title.trim();
    if (el.value && el.tagName === 'INPUT' && ['button', 'submit', 'reset'].includes(el.type)) {
      return el.value.trim();
    }
    // ASP.NET tables: the cell to the right is usually the Hebrew caption (RTL).
    const td = el.closest('td');
    if (td) {
      for (const sib of [td.previousElementSibling, td.nextElementSibling]) {
        if (sib && !sib.querySelector('input,select,textarea,button')) {
          const t = text(sib);
          if (t && t.length < 60) return t;
        }
      }
    }
    return text(el);
  };

  // A stable id is one without dynamic-looking numeric noise at the tail.
  const idLooksStable = (id) => !!id && !/^[0-9a-f-]{16,}$/i.test(id) && !/_\d{3,}$/.test(id);

  // Ranked selector suggestion. Playwright syntax, best-first.
  const selectorsFor = (el, label) => {
    const out = [];
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role');
    const name = el.getAttribute('name');
    const testId = el.getAttribute('data-testid') || el.getAttribute('data-test');

    if (testId) out.push(`[data-testid="${testId}"]`);
    if (label && ['input', 'select', 'textarea'].includes(tag)) {
      out.push(`getByLabel(${JSON.stringify(label)})`);
    }
    if (label && (tag === 'button' || role === 'button' || (tag === 'input' && ['button', 'submit'].includes(el.type)))) {
      out.push(`getByRole('button', { name: ${JSON.stringify(label)} })`);
    }
    // An <a> without href has no link role, so target it by exact text instead.
    if (label && tag === 'a') {
      out.push(el.hasAttribute('href')
        ? `getByRole('link', { name: ${JSON.stringify(label)} })`
        : `a:text-is(${JSON.stringify(label)})`);
    }
    if (label && el.hasAttribute('onclick') && !['a', 'button', 'input'].includes(tag)) {
      out.push(`${tag}:text-is(${JSON.stringify(label)})`);
    }
    if (name) out.push(`${tag}[name="${name}"]`);
    if (idLooksStable(el.id)) out.push(`#${el.id.replace(/([:.\[\]])/g, '\\$1')}`);
    if (el.id && !idLooksStable(el.id)) out.push(`[id$="${el.id.split('_').pop()}"]`);
    const cls = (el.className && typeof el.className === 'string' ? el.className : '')
      .split(/\s+/).filter((c) => c && !/^(ng-|is-|css-)/.test(c)).slice(0, 2);
    if (cls.length) out.push(`${tag}.${cls.join('.')}`);
    return out;
  };

  // Max2000 drives most navigation from <a> and <td> with an onclick handler and
  // no href, so anchors are matched bare and onclick carriers are included.
  const SEL = 'input, select, textarea, button, a, [role="button"], [role="tab"], [role="menuitem"], [onclick]';
  const elements = [];
  let n = 0;
  for (const el of document.querySelectorAll(SEL)) {
    if (!isVisible(el)) continue;
    if (el.type === 'hidden') continue;
    const label = labelFor(el);
    const r = el.getBoundingClientRect();
    elements.push({
      n: ++n,
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || null,
      role: el.getAttribute('role') || null,
      label,
      id: el.id || null,
      name: el.getAttribute('name') || null,
      href: el.tagName === 'A' ? (el.getAttribute('href') || '').slice(0, 120) : null,
      onclick: (el.getAttribute('onclick') || '').slice(0, 140) || null,
      value: ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) && el.type !== 'password'
        ? String(el.value ?? '').slice(0, 60) : null,
      options: el.tagName === 'SELECT'
        ? [...el.options].slice(0, 40).map((o) => ({ value: o.value, text: o.text.trim() }))
        : null,
      disabled: !!el.disabled,
      box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      selectors: selectorsFor(el, label),
    });
    if (n >= 400) break;
  }

  // Data tables — the shape of report output.
  const tables = [...document.querySelectorAll('table')]
    .filter((t) => isVisible(t) && t.rows.length > 1)
    .slice(0, 10)
    .map((t) => ({
      id: t.id || null,
      className: typeof t.className === 'string' ? t.className.slice(0, 80) : null,
      rows: t.rows.length,
      cols: t.rows[0]?.cells.length ?? 0,
      headers: [...(t.rows[0]?.cells ?? [])].map((c) => text(c)).slice(0, 20),
      firstDataRow: [...(t.rows[1]?.cells ?? [])].map((c) => text(c)).slice(0, 20),
    }));

  const headings = [...document.querySelectorAll('h1,h2,h3,legend,.title,[class*="header"]')]
    .filter(isVisible).slice(0, 25).map(text).filter(Boolean);

  return {
    url: location.href,
    title: document.title,
    headings: [...new Set(headings)],
    elementCount: elements.length,
    elements,
    tables,
  };
};

/** Inspect a page and every frame in it. */
export async function inspectPage(page) {
  const frames = [];
  for (const frame of page.frames()) {
    let data;
    try {
      data = await frame.evaluate(COLLECT);
    } catch (e) {
      frames.push({ name: frame.name(), url: frame.url(), error: e.message });
      continue;
    }
    frames.push({
      name: frame.name() || null,
      isMain: frame === page.mainFrame(),
      frameUrl: frame.url(),
      ...data,
    });
  }

  return {
    capturedAt: new Date().toISOString(),
    pageUrl: page.url(),
    pageTitle: await page.title().catch(() => null),
    frameCount: frames.length,
    frames,
  };
}

/** Compact, human-readable digest for reading in the terminal / in chat. */
export function digest(snap) {
  const lines = [];
  lines.push(`URL:   ${snap.pageUrl}`);
  lines.push(`Title: ${snap.pageTitle}`);
  lines.push(`Frames: ${snap.frameCount}`);
  for (const f of snap.frames) {
    if (f.error) {
      lines.push(`\n── frame ${f.name ?? '(anon)'} — unreadable: ${f.error}`);
      continue;
    }
    if (!f.elementCount && !f.tables?.length) continue;
    lines.push(`\n── ${f.isMain ? 'MAIN' : `frame "${f.name ?? '(anon)'}"`}  ${f.frameUrl}`);
    if (f.headings?.length) lines.push(`   headings: ${f.headings.join(' | ')}`);
    for (const e of f.elements) {
      const kind = e.tag === 'input' ? `input:${e.type ?? 'text'}` : e.tag;
      const val = e.value ? `  = "${e.value}"` : '';
      const opts = e.options?.length ? `  [${e.options.length} options]` : '';
      lines.push(`   ${String(e.n).padStart(3)}. ${kind.padEnd(14)} ${(e.label || '(no label)').slice(0, 45).padEnd(45)} ${e.selectors[0] ?? ''}${val}${opts}`);
    }
    for (const t of f.tables) {
      lines.push(`   TABLE ${t.id ?? ''} ${t.rows}x${t.cols}: ${t.headers.join(' | ')}`);
    }
  }
  return lines.join('\n');
}

/**
 * Human-paced interaction layer.
 *
 * Every meaningful action against Comax goes through here. Two guarantees:
 *   1. `gate()` enforces a hard floor between consecutive actions (default 2s),
 *      so even if the calling code runs instantly, the browser never does.
 *   2. Typing, clicking and scrolling carry randomised, human-shaped timing.
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (min, max) => min + Math.random() * (max - min);

export class Human {
  constructor(page, pace, logger = null) {
    this.page = page;
    this.pace = pace;
    this.logger = logger;
    this.lastActionAt = 0;
  }

  /** Never let two actions land closer together than pace.minGapMs. */
  async gate() {
    const since = Date.now() - this.lastActionAt;
    if (this.lastActionAt && since < this.pace.minGapMs) {
      await sleep(this.pace.minGapMs - since);
    }
    this.lastActionAt = Date.now();
  }

  /** A pause that reads as "the person is looking at the screen". */
  async think(label = null) {
    const ms = Math.round(rand(this.pace.thinkMinMs, this.pace.thinkMaxMs));
    this.logger?.step('think', label ? `${label} (${ms}ms)` : `${ms}ms`);
    await sleep(ms);
    this.lastActionAt = Date.now();
  }

  /** Resolve a locator-or-selector against a page/frame. */
  #loc(target, scope = null) {
    if (typeof target === 'string') return (scope ?? this.page).locator(target);
    return target;
  }

  async goto(url) {
    await this.gate();
    this.logger?.step('goto', url);
    await this.page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: this.pace.navTimeoutMs,
    });
    await this.think('after navigation');
  }

  async click(target, { scope = null, label = null } = {}) {
    const el = this.#loc(target, scope);
    await this.gate();
    await el.waitFor({ state: 'visible', timeout: this.pace.actionTimeoutMs });
    await el.scrollIntoViewIfNeeded();
    await sleep(rand(200, 500));

    // Move the mouse there in a few steps, hover briefly, then click.
    const box = await el.boundingBox();
    if (box) {
      const x = box.x + box.width * rand(0.35, 0.65);
      const y = box.y + box.height * rand(0.35, 0.65);
      await this.page.mouse.move(x, y, { steps: Math.round(rand(8, 18)) });
      await sleep(rand(this.pace.hoverMinMs, this.pace.hoverMaxMs));
      await this.page.mouse.click(x, y);
    } else {
      await el.click({ timeout: this.pace.actionTimeoutMs });
    }

    this.logger?.step('click', label ?? String(target));
    this.lastActionAt = Date.now();
  }

  /** Max2000's desktop icons select on a single click and open on a double. */
  async doubleClick(target, { scope = null, label = null } = {}) {
    const el = this.#loc(target, scope);
    await this.gate();
    await el.waitFor({ state: 'visible', timeout: this.pace.actionTimeoutMs });
    await el.scrollIntoViewIfNeeded();
    await sleep(rand(200, 500));

    const box = await el.boundingBox();
    if (box) {
      const x = box.x + box.width * rand(0.4, 0.6);
      const y = box.y + box.height * rand(0.4, 0.6);
      await this.page.mouse.move(x, y, { steps: Math.round(rand(8, 18)) });
      await sleep(rand(this.pace.hoverMinMs, this.pace.hoverMaxMs));
      await this.page.mouse.dblclick(x, y);
    } else {
      await el.dblclick({ timeout: this.pace.actionTimeoutMs });
    }

    this.logger?.step('dblclick', label ?? String(target));
    this.lastActionAt = Date.now();
  }

  /**
   * @param {object} [opts]
   * @param {boolean} [opts.secret] Log a mask instead of the value. Required for
   *   the password field — the run log is a plain file kept on disk.
   */
  async type(target, text, { scope = null, label = null, clear = true, secret = false } = {}) {
    const el = this.#loc(target, scope);
    await this.gate();
    await el.waitFor({ state: 'visible', timeout: this.pace.actionTimeoutMs });
    await el.scrollIntoViewIfNeeded();
    await el.click();
    await sleep(rand(150, 400));

    if (clear) {
      await this.page.keyboard.press('Control+A');
      await sleep(rand(80, 200));
      await this.page.keyboard.press('Delete');
      await sleep(rand(150, 350));
    }

    for (const ch of String(text)) {
      await this.page.keyboard.type(ch);
      const base = rand(this.pace.typeMinMs, this.pace.typeMaxMs);
      const extra = this.pace.typePauseChars.includes(ch)
        ? rand(this.pace.typePauseMinMs, this.pace.typePauseMaxMs)
        : 0;
      await sleep(base + extra);
    }

    const shown = secret ? '•'.repeat(Math.min(String(text).length, 8)) : `"${text}"`;
    this.logger?.step('type', `${label ?? String(target)} = ${shown}`);
    this.lastActionAt = Date.now();
  }

  async select(target, value, { scope = null, label = null } = {}) {
    const el = this.#loc(target, scope);
    await this.gate();
    await el.waitFor({ state: 'visible', timeout: this.pace.actionTimeoutMs });
    await el.scrollIntoViewIfNeeded();
    await sleep(rand(200, 500));
    await el.selectOption(value);
    this.logger?.step('select', `${label ?? String(target)} = ${JSON.stringify(value)}`);
    this.lastActionAt = Date.now();
  }

  async press(key, { label = null } = {}) {
    await this.gate();
    await this.page.keyboard.press(key);
    this.logger?.step('press', label ?? key);
    this.lastActionAt = Date.now();
  }

  async scroll(deltaY = 400) {
    await this.gate();
    const steps = Math.round(rand(3, 6));
    for (let i = 0; i < steps; i++) {
      await this.page.mouse.wheel(0, deltaY / steps);
      await sleep(rand(80, 220));
    }
    this.logger?.step('scroll', `${deltaY}px`);
    this.lastActionAt = Date.now();
  }

  /** Wait for the page to settle after a postback, then take a human beat. */
  async settle(label = null) {
    try {
      await this.page.waitForLoadState('networkidle', { timeout: 15000 });
    } catch {
      /* Comax polls in the background; networkidle may never arrive. */
    }
    await this.think(label ?? 'settling');
  }
}

export { sleep, rand };

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

  /**
   * Never let two actions land closer together than pace.minGapMs.
   *
   * `free` marks a field Comax does not have to think about. Dror's distinction,
   * 09/09/2026:
   *
   *   "על מה שהוא 'הקלדה חופשית' — תאריך, פרטים, הערה בשורה, מחיר, כמות —
   *    שאין בהם שום צורך לקומקס למשוך נתון משלים ממסד הנתונים שלו, אלו פעולות
   *    שלא צריכות כמעט בכלל זמן המתנה."
   *
   * A barcode in `#Prt` sends Comax to the catalogue and the answer comes back
   * into the form; a quantity of "2" is stored as typed. Both used to pay the
   * same two seconds. Measured on quote 6120056: 15 of 22 filled fields were
   * free ones, so the flat gate spent ~30s waiting for a lookup that never
   * happened.
   *
   * ⚠️ This is only about the pause **before** typing. The pause **after**
   * leaving a field stays untouched — Dror was explicit that Comax does take
   * time on transitions ("לוקח לו זמן לעבד לפעמים מעברים, בזה לא ניגע"), and
   * the price/amount recalculations after quantity and price are exactly that.
   */
  async gate({ free = false } = {}) {
    const min = free ? (this.pace.minGapFreeMs ?? 250) : this.pace.minGapMs;
    const since = Date.now() - this.lastActionAt;
    if (this.lastActionAt && since < min) {
      await sleep(min - since);
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

    // Move the mouse there, hover briefly, then click. The step count stays at
    // 1-2 on purpose: Max2000 is a frameset with dozens of frames, and Playwright
    // dispatches every intermediate mousemove into all of them, so each step costs
    // ~1 second on a live page (measured 10/09/2026: steps:1 = 0.7s, steps:18 =
    // 18.2s, at 61 frames). The human pace lives in hoverMinMs/hoverMaxMs and in
    // gate(), not in the interpolation — raising steps buys no realism, only dead
    // time, and the cost grows as Max2000 accumulates frames during a flow.
    const box = await el.boundingBox();
    if (box) {
      const x = box.x + box.width * rand(0.35, 0.65);
      const y = box.y + box.height * rand(0.35, 0.65);
      await this.page.mouse.move(x, y, { steps: Math.round(rand(1, 2)) });
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
      await this.page.mouse.move(x, y, { steps: Math.round(rand(1, 2)) });
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
  /**
   * `paste` defaults to true — see the block below. Pass `paste: false` to force
   * real key-by-key typing for a field that genuinely needs key events.
   *
   * `free: true` marks a field Comax stores as typed, with no lookup behind it
   * (quantity, price, discount, remark, details, date) — it skips the two-second
   * gate. See `gate()` for the rule and why the pause *after* the field stays.
   */
  async type(target, text, { scope = null, label = null, clear = true, secret = false, paste = true, free = false } = {}) {
    const el = this.#loc(target, scope);
    await this.gate({ free });
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

    // A person filling a form does not always type. Dror pointed this out:
    // copy-paste is human too, and it is one input event instead of dozens of
    // key events. `insertText` is exactly that shape.
    //
    // Since 09/09/2026 this is the **default**, on Dror's instruction: "רק
    // בהקלדה האנושית ובמקומה נדביק מהיר את התאים... נצא מנקודת הנחה שלקומקס
    // אין סיבה ואין מנגנון בדיקה לזה. הדבר היחיד הוא שלוקח לו זמן לעבד לפעמים
    // מעברים — בזה לא ניגע." So the per-character delay goes and the pacing
    // around actions (`minGapMs`, `think`) stays exactly as it was.
    //
    // ⚠️ The old warning was right and is now handled here instead of being
    // pushed onto callers: a field rebuilt by an onkeypress handler — Comax
    // reformats dates as you type — can hold something other than what was
    // pasted. So every paste is **read back and compared**, and a mismatch
    // falls back to real typing rather than being reported as success. That is
    // the one failure mode that looks identical to success, which is exactly
    // the kind this codebase refuses to leave silent.
    const want = String(text);
    const typeOut = async () => {
      for (const ch of want) {
        await this.page.keyboard.type(ch);
        const base = rand(this.pace.typeMinMs, this.pace.typeMaxMs);
        const extra = this.pace.typePauseChars.includes(ch)
          ? rand(this.pace.typePauseMinMs, this.pace.typePauseMaxMs)
          : 0;
        await sleep(base + extra);
      }
    };

    const t0 = Date.now();
    let how = 'paste';
    if (paste === false) {
      how = 'type';
      await typeOut();
    } else {
      await this.page.keyboard.insertText(want);
      await sleep(rand(120, 280));
      // `inputValue` only works on real form controls; anything else (a
      // contenteditable, a div) reports nothing and must not be treated as a
      // mismatch — we simply cannot verify it, so we say so.
      const got = await el.inputValue().catch(() => null);
      if (got === null) {
        how = 'paste?';
      } else if (got.trim() !== want.trim()) {
        // ⚠️ `secret` must hold here too. The first version of this message
        // printed both values raw, and on 09/09/2026 it wrote the Comax
        // password into runs/*/steps.log in clear text. The mismatch is worth
        // reporting; the value is not.
        const mine = secret ? '•'.repeat(Math.min(want.length, 8)) : `"${want}"`;
        const theirs = secret ? `(${got.length} תווים)` : `"${got}"`;
        this.logger?.step(
          'paste',
          `${label ?? String(target)}: ההדבקה נתנה ${theirs} במקום ${mine} — מקליד במקום`,
        );
        await this.page.keyboard.press('Control+A');
        await sleep(rand(80, 200));
        await this.page.keyboard.press('Delete');
        await sleep(rand(150, 350));
        how = 'type↩';
        await typeOut();
      }
    }
    // ⛔ 💣 **השלמה אוטומטית של הדפדפן מצרפת לתוכן קיים — ואף אחד לא רואה.**
    // נמדד 13/09/2026 במסך ההתחברות: שדה הארגון יצא `דרורספורטדרורספורט`
    // וקומקס החזיר "ארגון שגוי". `Control+A`+`Delete` אינם מספיקים — כרום
    // ממלא מחדש **אחרי** הניקוי, ורשימת ההצעות שנפתחת בזמן ההקלדה מתחייבת
    // על הפעולה הבאה. לכן: Escape לסגירת הרשימה, ואז **קריאה חוזרת של השדה**
    // בשני המסלולים (הדבקה והקלדה כאחד), ותיקון ב-`fill` אם לא תואם.
    // ⚠️ מסלול ההקלדה לא אומת עד היום — רק מסלול ההדבקה — וזו בדיוק הדלת
    // שדרכה נכנסה התקלה, כי ההתחברות מקלידה עם `paste: false`.
    await this.page.keyboard.press('Escape').catch(() => {});
    await sleep(rand(80, 180));
    const after = await el.inputValue().catch(() => null);
    if (after !== null && after.trim() !== want.trim()) {
      const theirs = secret ? `(${after.length} \u05ea\u05d5\u05d5\u05d9\u05dd)` : `"${after}"`;
      const mine = secret ? '\u2022'.repeat(Math.min(want.length, 8)) : `"${want}"`;
      this.logger?.step('fix', `${label ?? String(target)}: \u05d4\u05e9\u05d3\u05d4 \u05d4\u05d7\u05d6\u05d9\u05e7 ${theirs} \u05d1\u05de\u05e7\u05d5\u05dd ${mine} \u2014 \u05db\u05d5\u05ea\u05d1 \u05de\u05d7\u05d3\u05e9`);
      await el.fill('');
      await sleep(rand(80, 180));
      await el.fill(want);
      await sleep(rand(120, 250));
      const again = await el.inputValue().catch(() => null);
      if (again !== null && again.trim() !== want.trim()) {
        throw new Error(`${label ?? String(target)}: \u05d4\u05e9\u05d3\u05d4 \u05dc\u05d0 \u05de\u05e7\u05d1\u05dc \u05d0\u05ea \u05d4\u05e2\u05e8\u05da \u05e9\u05e0\u05e9\u05dc\u05d7 \u05d0\u05dc\u05d9\u05d5. \u05e2\u05d5\u05e6\u05e8.`);
      }
      how = how + '+fill';
    }
    const took = Date.now() - t0;

    const shown = secret ? '•'.repeat(Math.min(want.length, 8)) : `"${text}"`;
    this.logger?.step(how, `${label ?? String(target)} = ${shown} (${took}ms)`);
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

  /**
   * Wait for the page to settle after a postback, then take a human beat.
   *
   * `networkidle` never arrives here — Comax keeps a heartbeat and a chat widget
   * polling — so this wait always runs to its deadline. That deadline used to be
   * 15s, and measuring the invoice-email flow (09/09/2026) showed six of them
   * burning 90 of the run's 235 seconds waiting for something that cannot
   * happen. The budget is therefore small on purpose: it catches a postback that
   * does go quiet, and gives up quickly on the ones that never will.
   *
   * What actually makes this safe is that nothing relies on it. Every step that
   * needs a screen waits for that screen — `waitFor({state:'visible'})` before a
   * click, `waitForFrameWith` for a dialog — and those have their own generous
   * timeouts. `settle` is a beat, not a barrier.
   */
  async settle(label = null) {
    try {
      await this.page.waitForLoadState('networkidle', { timeout: this.pace.settleTimeoutMs ?? 2500 });
    } catch {
      /* Expected: Comax polls in the background, so idle never comes. */
    }
    await this.think(label ?? 'settling');
  }
}

export { sleep, rand };

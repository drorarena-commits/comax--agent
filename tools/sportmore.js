/**
 * ספורט אנד מור — הקמות וקליטה. CLI.
 *
 *   npm run sm -- card
 *   npm run sm -- plan   --invoice <file> --season FW26 [--round x99|int] [--confirm]
 *   npm run sm -- intake --invoice <file> --warehouse SHIP|DROR [--confirm]
 *
 * Nothing here touches Comax. Sport & More run Priority, we have no access to
 * it, and the only channel between us is the Excel each side emails the other.
 *
 * No `--confirm`, no file — the same rule every writing task in this project
 * follows.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { ROOT } from '../src/config.js';
import { loadItemCard } from '../src/sportmore/item-card.js';
import { readArenaInvoice, childSku } from '../src/sportmore/arena-invoice.js';
import { loadCodes, loadProfile, OVERRIDES_PATH } from '../src/sportmore/classify.js';
import { buildQuestions, renderQuestions, codeTable } from '../src/sportmore/questions.js';
import { planBatch } from '../src/sportmore/plan.js';
import { buildSetupFile } from '../src/sportmore/build-setup.js';
import { buildIntakeFile, WAREHOUSES } from '../src/sportmore/build-intake.js';
import { buildReport } from '../src/sportmore/report.js';
import { cardStatus, recordSetup } from '../src/sportmore/card-status.js';
import {
  parentLine, childLine, parentFromInvoice, parentFromOrphan, childFromInvoice,
  loadComaxAltCodes, enrichmentNotice,
} from '../src/sportmore/item-display.js';

/** שורת בן לתצוגה. מק"ט = מה שנכתב לקובץ; שאר השדות — ראה item-display.js. */
const showChild = (row, barcode) => childLine(childFromInvoice(row, { sku: childSku(row), barcode }));
import { ROUNDING } from '../src/sportmore/pricing.js';

const OUT_DIR = resolve(ROOT, 'sportmore/out');

/**
 * Flags that never take a value. Without this list a bare flag swallows the
 * next token: `--self-barcode 1=00610` read the answer as the flag's value and
 * quietly dropped question 1 from the round — the answer was accepted, written
 * nowhere, and the question stayed open with nothing saying so.
 */
const BOOLEAN_FLAGS = new Set(['confirm', 'self-barcode', 'force', 'help']);

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (BOOLEAN_FLAGS.has(key) || next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

const pad = (s, n) => String(s ?? '').padEnd(n);
const money = (v) => (v === null || v === undefined ? '—' : Number(v).toFixed(2));
const today = () => new Date().toISOString().slice(0, 10);
const base = (f) => basename(String(f));

/**
 * מצב הכרטיס, כשורות מוכנות להדפסה. מודפס בראש ההרצה.
 *
 *   **עדכניות** — לפי אירוע ולא לפי זמן. כרטיס שתאריכו אחרי קובץ ההקמה האחרון
 *   עדכני, נקודה; אין כאן שאלה לדרור ואין "בן 40 יום, אולי תבדוק".
 *
 *   **"תזכיר להם"** — הופק קובץ הקמה, אחריו הגיע כרטיס טרי, והפריטים מהקובץ
 *   עדיין לא בו. זו האזהרה היחידה שכרטיס בלי פריטים חדשים מצדיק, והיא אומרת
 *   שהם טרם ביצעו — לא שמשהו שבור.
 *
 * כל פריט בשורה משלו: מק"ט · חלופי · תיאור — שדה חסר נכתב "חסר".
 */
function statusLines(card) {
  const out = [];
  const st = cardStatus(card);

  if (!st.current) {
    out.push('            ⚠  ' + st.why);
  } else if (st.lastSetup) {
    out.push('            ✓  ' + st.why);
  }

  if (st.pendingParents.length) {
    out.push('            ⚠  ' + st.pendingParents.length + ' אבות מקובץ ההקמה של '
      + st.lastSetup.date + ' עדיין לא בכרטיס — כנראה טרם הקימו. לתזכר אותם:');
    for (const p of st.pendingParents) out.push('               ' + parentLine(p));
  }

  return out;
}

/**
 * השאלות הפתוחות שהכרטיס עצמו מעלה — מודפסות **בסוף** ההרצה, ליד שאלות הסיווג.
 *
 * אב יתום: בנים בכרטיס בלי שורת אב. **נתון, לא מסקנה** — כמה בנים ומה חסר.
 * הוא נגזר מהבנים אבל אינו נספר כקיים, וההרצה ממשיכה. הניסוח בעובדות ולא
 * במסקנה, כי שתיהן אפשריות: שהייצוא פספס שורה, או שאצלם מחקו אב פגום ולא
 * הקימו אותו מחדש (כך קרה ל-`*AR010810509`).
 */
function openQuestionLines(card) {
  const out = [];
  for (const [sku, kids] of card.orphanParents ?? []) {
    out.push('   ❓ ' + parentLine(parentFromOrphan(sku, kids)));
    out.push('      ' + kids.length + ' בנים בכרטיס, אין שורת אב. ייתכן שהאב נמחק אצלם ולא הוקם מחדש. לברר לפני הקמה');
  }
  return out;
}

function die(msg) {
  console.error('\n' + msg + '\n');
  process.exit(1);
}

const [cmd = 'help', ...rest] = process.argv.slice(2);
const args = parseArgs(rest);

if (cmd === 'help' || args.help) {
  console.log([
    '',
    'ספורט אנד מור — הקמות וקליטה',
    '',
    '  npm run sm -- card',
    '      מה יש בכרטיס הפריט האחרון וכמה הוא ישן',
    '',
    '  npm run sm -- plan --invoice <קובץ> --season FW26 [--round x99|int] [--confirm]',
    '      קורא חשבונית מארנה, בודק מה כבר קיים, ומכין דוח + קובץ הקמות.',
    '      בלי --confirm לא נכתב שום קובץ.',
    '',
    '  npm run sm -- intake --invoice <קובץ> --warehouse SHIP|DROR [--confirm]',
    '      קובץ קליטת חשבוניות. רץ רק אחרי שספורט אנד מור הקימו הכל',
    '      ושלחו כרטיס פריט מעודכן — כל שורה נבדקת מולו.',
    '',
    '  npm run sm -- answer --invoice <אותו קובץ> 1=<ערך> 2=<ערך> ...',
    '      כותב בבת אחת את התשובות לשאלות הסיווג ש-plan הציג, ל-overrides.json',
    '      לפי קוד דגם. המספרים הם של אותה הרצת plan, ולכן צריך אותו --invoice',
    '      ואותם --profile / --self-barcode.',
    '',
    '  --profile caps       פרופיל סיווג למנה שלמה. לכובעים קוסטומייז אין',
    '                        אח מאותו דגם, אז הסיווג האוטומטי תמיד יסרב.',
    '  --self-barcode       מתיר שורות בלי ברקוד. הברקוד יהיה המקט הבן בלי AR.',
    '                        רק למוצרים קוסטומייז — ראה KNOWLEDGE.md.',
    '',
    '  --item-card <קובץ>   כרטיס פריט מפורש.',
    '                        ברירת המחדל: החדש ביותר ב-sportmore/reference/',
    '',
  ].join('\n'));
  process.exit(0);
}

if (cmd === 'card') {
  const card = await loadItemCard(args['item-card']);
  console.log('\nכרטיס פריט: ' + base(card.file));
  console.log('  גיל: ' + card.ageDays + ' ימים');
  console.log('  שורות: ' + card.rows + '   ·   אבות: ' + card.parents.size + '   ·   ברקודים: ' + card.byBarcode.size);
  for (const line of statusLines(card)) console.log(line);
  const questions = openQuestionLines(card);
  if (questions.length) {
    console.log('\nשאלות פתוחות:');
    for (const line of questions) console.log(line);
  }
  console.log('');
  process.exit(0);
}

if (!['plan', 'intake', 'answer'].includes(cmd)) {
  die('פקודה לא מוכרת: ' + cmd + '   (card / plan / intake / answer)');
}
if (!args.invoice) die('חסר --invoice <קובץ חשבונית של ארנה>');

const card = await loadItemCard(args['item-card']);
const invoice = await readArenaInvoice(args.invoice);
// ⚠️ קריאה מקומקס — **לתצוגה בלבד**, ואינה זורקת לעולם. חריגה מוצהרת לגבול של
// הסוכן הזה; הנימוק והתנאים ב-src/sportmore/item-display.js.
await loadComaxAltCodes();
// פעם אחת, מיד — ולא בסוף: לכל פקודה יש כמה נקודות יציאה, והודעה שיושבת רק
// באחת מהן פשוט לא מודפסת בשאר.
const enrichment = enrichmentNotice();
if (enrichment) console.log(enrichment);
const codes = loadCodes();

console.log('\nחשבונית:    ' + base(invoice.file) + '   —   ' + invoice.rows.length + ' שורות');
console.log('כרטיס פריט: ' + base(card.file) + '   —   ' + card.parents.size + ' אבות, בן ' + card.ageDays + ' ימים');
for (const line of statusLines(card)) console.log(line);
if (invoice.problems.length) {
  console.log('\n⚠  ' + invoice.problems.length + ' שורות בעייתיות בחשבונית:');
  for (const p of invoice.problems.slice(0, 5)) {
    console.log('      שורה ' + p.row + ': ' + p.articleNumber + ' — ' + p.why);
  }
}

/* ── plan ──────────────────────────────────────────────────────────────── */

if (cmd === 'plan') {
  const rounding = args.round || 'x99';
  if (!ROUNDING[rounding]) die('--round חייב להיות x99 או int, לא ' + rounding);

  const profile = loadProfile(codes, args.profile === true ? null : args.profile);
  if (args.profile === true) die('--profile דורש שם, למשל --profile caps');
  if (profile) {
    console.log('');
    console.log('פרופיל: ' + args.profile + '  ->  ' + Object.entries(profile).map(([k, v]) => k + '=' + v).join('  '));
  }

  const plan = planBatch({ invoice, card, codes, rounding, selfBarcodes: !!args['self-barcode'], profile });
  const c = plan.counts;

  console.log('\nמה יש כאן');
  console.log('  קיים כבר:        ' + c.exists);
  console.log('  בן חדש:          ' + c.newChild);
  console.log('  אב + בן חדשים:   ' + c.newBoth);
  console.log('  חסום:            ' + c.blocked);
  console.log('  אבות להקמה:      ' + c.newParents);
  if (c.selfCoded) {
    console.log('');
    console.log('  ' + c.selfCoded + ' שורות בלי ברקוד מארנה — הברקוד נגזר מהמקט.');
    console.log('  אם ארנה תנפיק EAN אחר כך, יהיו שני פריטים לאותו מוצר בפריוריטי.');
  }

  if (plan.blocked.length) {
    console.log('\n⛔ שורות חסומות — לא ייכנסו לקובץ ההקמה:');
    for (const b of plan.blocked) {
      console.log('      שורה ' + b.row.row + '  ' + showChild(b.row, b.row.ean));
      console.log('         ' + b.why);
    }
  }

  if (plan.parents.length) {
    if (!args.season) {
      die('חסר --season (למשל FW26). ארנה משאירה את העמודה הזאת ריקה בייצוא, אז היא שלך.');
    }
    console.log('\nאבות חדשים — סיווג ומחיר   (עיגול: ' + rounding + ')\n');
    console.log('  ' + pad('מקט אב', 15) + pad('משפחה', 8) + pad('סרגל', 8) + pad('דויזן', 7)
      + pad('מגדר', 7) + pad('עלות €', 9) + pad('בסיס', 9) + pad('מחירון 1', 10) + 'תיאור');
    console.log('  ' + '-'.repeat(112));
    for (const p of plan.parents) {
      const k = p.classification;
      const mark = (f) => (k[f].value === null || k[f].value === undefined ? '!!' : k[f].value)
        + (k[f].confidence === 'medium' ? '?' : '');
      console.log('  ' + pad(p.sku, 15) + pad(mark('family'), 8) + pad(mark('sizeScale'), 8)
        + pad(mark('division'), 7) + pad(mark('gender'), 7)
        + pad(money(p.price?.costEur), 9) + pad(money(p.price?.base), 9) + pad(money(p.price?.wholesale), 10)
        + String(p.row.styleDesc || p.row.articleDesc).slice(0, 40));
    }
    console.log('\n  !! = לא הוכרע   ·   ? = רוב, לא פה אחד   ·   מחירון 3 = מחיר הבסיס');
  }

  // כל הסירובים של המנה, ממוספרים פעם אחת ונשאלים יחד — ראה
  // src/sportmore/questions.js: מספר אחד הוא שדה אחד, לא אב אחד.
  if (plan.needsDecision.length) {
    for (const line of renderQuestions(buildQuestions(plan), codes)) console.log(line);
  }
  // השאלות שהכרטיס עצמו מעלה — בסוף, יחד עם שאלות הסיווג. לא עוצרות דבר.
  const cardQuestions = openQuestionLines(card);
  if (cardQuestions.length) {
    console.log('\nשאלות פתוחות מהכרטיס — לא עוצרות את ההרצה:');
    for (const line of cardQuestions) console.log(line);
  }


  if (!args.confirm) {
    console.log('\nלא נכתב שום קובץ. להוסיף --confirm כדי לכתוב את הדוח ואת קובץ ההקמה.\n');
    process.exit(0);
  }
  if (plan.needsDecision.length) die('לא נכתב קובץ הקמה — יש אבות בלי סיווג מלא (ראה למעלה).');

  mkdirSync(OUT_DIR, { recursive: true });
  const report = await buildReport({
    plan, invoice, card,
    out: resolve(OUT_DIR, 'דוח קיום ' + today() + '.xlsx'),
  });
  console.log('\n✓ דוח קיום:   ' + base(report.file));

  if (plan.parents.length || plan.children.length) {
    const setup = await buildSetupFile({
      parents: plan.parents,
      children: plan.children,
      seasonYear: args.season,
      codes,
      out: resolve(OUT_DIR, 'הקמה ארנה ' + args.season + ' ' + today() + ' - מוצרי אב ובנים.xlsx'),
    });
    console.log('✓ קובץ הקמה:  ' + base(setup.file) + '   (' + setup.parents + ' אבות, ' + setup.children + ' בנים)');
    // ⬅ האירוע שמיישן את הכרטיס. נרשם רק כאן, אחרי שהקובץ באמת נכתב: קובץ
    // שלא הופק לא נשלח, ולא ביקשנו מהם להקים דבר.
    const rec = recordSetup({
      file: setup.file,
      season: args.season,
      cardFile: card.file,
      parents: plan.parents.map((p) => parentFromInvoice(p.row, p.sku)),
      barcodes: plan.children.map((c) => c.barcode),
    });
    console.log('  נרשם ב-last-setup.json — הכרטיס הבא ייחשב עדכני רק אם תאריכו אחרי ' + rec.date + '.');
  } else {
    console.log('  אין אבות או בנים חדשים — לא נוצר קובץ הקמה.');
  }
  console.log('\nהקבצים ב-sportmore/out/. הקליטה רצה רק אחרי שהם הקימו ושלחו כרטיס פריט מעודכן.\n');
  process.exit(0);
}

/* ── answer ────────────────────────────────────────────────────────────── */

/**
 * The other half of the batched question round: `plan` numbers every refusal,
 * Dror answers them all in one message, and this writes them together.
 *
 * The numbers are not stored anywhere — they are rebuilt from the same invoice
 * and the same card, which is why the flags that change which parents need a
 * decision (`--profile`, `--self-barcode`) have to match the `plan` that asked.
 * A number that does not exist is refused rather than guessed at.
 *
 * Answers are keyed by Arena style code, not by parent מק"ט: the next colour of
 * the same model needs the same answer, and keying by style is what stops the
 * question coming back in a month.
 */
if (cmd === 'answer') {
  if (args.profile === true) die('--profile דורש שם, למשל --profile caps');
  const profile = loadProfile(codes, args.profile === true ? null : args.profile);
  const plan = planBatch({ invoice, card, codes, selfBarcodes: !!args['self-barcode'], profile });
  const questions = buildQuestions(plan);

  if (!questions.length) {
    die('אין שאלות סיווג פתוחות במנה הזאת — אין מה לכתוב.\n'
      + 'אם plan כן שאל, ודא שאותם --profile / --self-barcode הועברו גם כאן.');
  }

  const tokens = args._.join(' ').split(/[\s,;]+/).filter(Boolean);
  if (!tokens.length) die('לא נמסרו תשובות. הצורה: 1=00616 2=74');

  const answers = [];
  for (const token of tokens) {
    const m = /^(\d+)\s*=\s*(.+)$/.exec(token);
    if (!m) die('תשובה לא מובנת: "' + token + '".  הצורה היא <מספר>=<ערך>, למשל 1=00616');
    const n = Number(m[1]);
    const q = questions.find((x) => x.n === n);
    if (!q) {
      die('אין שאלה מספר ' + n + ' — יש ' + questions.length + ' שאלות.\n'
        + 'להריץ את plan שוב עם אותם דגלים כדי לראות את הרשימה הנוכחית.');
    }
    if (answers.some((a) => a.q.n === n)) die('שאלה ' + n + ' נענתה פעמיים.');

    const value = m[2].trim();
    const known = codeTable(codes, q.field).find((c) => c.value.toUpperCase() === value.toUpperCase());
    // A code that is not in the table is either a typo or a genuinely new code.
    // Both happen, and they are not the same thing, so the typo is refused and
    // the new code needs saying out loud.
    if (!known && !args.force) {
      die('הערך "' + value + '" לא קיים בטבלת ' + q.label + ' ב-codes.json (שאלה ' + n + ').\n'
        + 'אם זו טעות הקלדה — לתקן. אם זה קוד חדש שקיים בפריוריטי — להוסיף --force.');
    }
    if (known?.placeholder) {
      die('הערך "' + value + '" הוא ערך דמה (' + known.name + ') ולא סיווג. שאלה ' + n + ' עדיין פתוחה.');
    }
    answers.push({ q, value: known ? known.value : value, isNew: !known });
  }

  const overrides = JSON.parse(readFileSync(OVERRIDES_PATH, 'utf8'));
  const changed = [];
  for (const a of answers) {
    // Style code when Arena gave us one — that is what makes the next colour of
    // the same model inherit the answer. The parent מק"ט is the fallback for a
    // row with no style to key on.
    const key = a.q.style || a.q.skus[0];
    if (!overrides[key] || typeof overrides[key] !== 'object') overrides[key] = {};
    const before = overrides[key][a.q.field];
    overrides[key][a.q.field] = a.value;
    changed.push({ key, field: a.q.field, label: a.q.label, before, after: a.value, q: a.q, isNew: a.isNew });
  }

  console.log('\n' + (args.confirm ? 'נכתב' : 'ייכתב') + ' ל-' + base(OVERRIDES_PATH) + ':\n');
  for (const c of changed) {
    console.log('  ' + pad(c.key, 14) + pad(c.label, 12) + pad(c.after, 9)
      + (codes[c.field]?.[c.after]?.name || (c.isNew ? '(קוד חדש — לא בטבלה)' : ''))
      + (c.before !== undefined && c.before !== c.after ? '   (היה ' + c.before + ')' : ''));
  }

  if (!args.confirm) {
    console.log('\nלא נכתב שום קובץ. להוסיף --confirm כדי לשמור את התשובות.\n');
    process.exit(0);
  }

  writeFileSync(OVERRIDES_PATH, JSON.stringify(overrides, null, 2) + '\n', 'utf8');
  const left = questions.filter((q) => !answers.some((a) => a.q.n === q.n));
  console.log('\n✓ נשמר ב-' + base(OVERRIDES_PATH) + '.');
  if (left.length) {
    console.log('\n⚠  ' + left.length + ' שאלות עדיין פתוחות: ' + left.map((q) => q.n).join(', '));
  }
  console.log('\nלהריץ שוב את plan כדי לראות את הסיווג המלא לפני --confirm.\n');
  process.exit(0);
}

/* ── intake ────────────────────────────────────────────────────────────── */

if (cmd === 'intake') {
  const warehouse = args.warehouse;
  if (!warehouse || !WAREHOUSES.includes(warehouse)) {
    die('חסר --warehouse. צריך ' + WAREHOUSES.join(' או ') + ' — זו החלטה שלך בכל מנה, אין ברירת מחדל.');
  }

  const plan = planBatch({ invoice, card, codes, selfBarcodes: !!args['self-barcode'] });
  const pending = plan.rows.filter((r) => r.status === 'newChild' || r.status === 'newBoth');
  const blocked = plan.rows.filter((r) => r.status === 'blocked');
  console.log('\nאימות מול כרטיס הפריט');
  console.log('  בכרטיס:     ' + plan.counts.exists + ' מתוך ' + plan.counts.total);
  console.log('  בקובץ ההקמה בלבד: ' + pending.length + (pending.length ? '   ← ייכתבו ויסומנו באדום' : ''));
  console.log('  חסומות:     ' + blocked.length);

  // ⛔ חסומה עוצרת. היא אינה בכרטיס ואינה בקובץ ההקמה — איש לא יקים אותה.
  if (blocked.length) {
    console.log('\n⛔ קובץ הקליטה לא ייכתב — יש שורות חסומות:');
    for (const r of blocked) {
      console.log('      שורה ' + r.row.row + '  ' + showChild(r.row, r.row.ean) + '  —  ' + r.why);
    }
    console.log('\n   שורה חסומה דורשת אדם: ראה "מתי לעצור ולשאול את דרור".\n');
    process.exit(1);
  }

  // שורה שטרם בכרטיס אך נמצאת בקובץ ההקמה **אינה** עוצרת: הבקרה אצלם אנושית,
  // מי שמקים מאשר, ולכן המנה רצה עד הסוף בפעם אחת והשורות מסומנות באדום.
  if (pending.length) {
    console.log('\n🔴 ' + pending.length + ' שורות ייכתבו מסומנות באדום — הן בקובץ ההקמה וטרם בכרטיס:');
    // כל שורה עם מק"ט, חלופי, תיאור ותיאור צבע — לא ברקוד. ⚠️ ההעשרה היא של
    // **הפלט הזה**, ולא של הקובץ: עמודות קובץ חשבונית הרכש הן תבנית היבוא של
    // פריוריטי, ועמודה נוספת שם הייתה שוברת להם את הקליטה.
    for (const r of pending) {
      console.log('      שורה ' + r.row.row + '  ' + showChild(r.row, r.barcode)
        + '  —  ' + r.why);
    }
    console.log('\n   לומר להם במפורש: את השורות האדומות צריך להקים ולאשר לפני הרצת הרכש.');
  }

  console.log('\n  מחסן: ' + warehouse + '   ·   סניף: ' + codes.constants.branch
    + '   ·   ספק: ' + codes.constants.supplier);
  const sample = invoice.rows[0];
  console.log('  דוגמה: ' + showChild(sample, sample.ean));

  if (!args.confirm) {
    console.log('\nלא נכתב שום קובץ. להוסיף --confirm כדי לכתוב את קובץ הקליטה.\n');
    process.exit(0);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const res = await buildIntakeFile({
    planRows: plan.rows,
    warehouse,
    codes,
    out: resolve(OUT_DIR, 'קליטת חשבוניות ' + today() + ' ' + warehouse + '.xls'),
  });
  console.log('\n✓ קובץ חשבונית רכש: ' + base(res.file) + '   (' + res.rows + ' שורות, מחסן ' + res.warehouse + ')');
  if (res.flagged.length) {
    console.log('  🔴 ' + res.flagged.length + ' שורות מסומנות באדום — להקים ולאשר לפני הרצת הרכש:');
    for (const p of pending) {
      console.log('     ' + showChild(p.row, p.barcode));
    }
  }

  console.log('');
  process.exit(0);
}

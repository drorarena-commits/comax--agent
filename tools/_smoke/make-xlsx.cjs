/**
 * בונה .xlsx בלי שום תלות — הקובץ הוא ZIP של קבצי XML, וזה כל מה שצריך.
 *
 *   node tools/_smoke/make-xlsx.cjs <result.json> <out.xlsx>
 *
 * במחשב הזה אין Python, אין LibreOffice ואין ספריית אקסל ב-npm, ולפרויקט יש
 * בכוונה תלות אחת בלבד (playwright-core). לכן החלקים נכתבים כאן והדחיסה
 * נעשית ב-PowerShell עם System.IO.Compression.
 *
 * ⚠️ נכתבים **ערכים ולא נוסחאות**: בלי LibreOffice אין דרך לאמת שנוסחה
 * מתחשבת נכון, ולשלוח גיליון עם נוסחאות שלא נבדקו גרוע מלשלוח מספרים.
 */
const fs = require('fs');
const path = require('path');

const [SRC, OUT] = process.argv.slice(2);
if (!SRC || !OUT) {
  console.log('שימוש: node tools/_smoke/make-xlsx.cjs <result.json> <out.xlsx>');
  process.exit(1);
}
const r = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const DIR = path.resolve('.xlsxtmp');
fs.rmSync(DIR, { recursive: true, force: true });
for (const d of ['_rels', 'xl/_rels', 'xl/worksheets']) fs.mkdirSync(path.join(DIR, d), { recursive: true });

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const colL = (n) => {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = (n - m - 1) / 26;
  }
  return s;
};

/** אינדקסי סגנון: 1 כותרת · 2 מספר · 3 כסף · 4 אחוז · 5 כותרת-על · 6 סיכום */
const S = { hdr: 1, num: 2, money: 3, pct: 4, title: 5, sum: 6 };

function sheetXml(rows, widths, freeze) {
  const cols = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
  const body = rows
    .map((cells, ri) => {
      const r1 = ri + 1;
      const cs = cells
        .map((c, ci) => {
          if (c === null || c === undefined || c === '') return '';
          const ref = colL(ci + 1) + r1;
          const st = c.s ? ` s="${c.s}"` : '';
          return typeof c.v === 'number'
            ? `<c r="${ref}"${st}><v>${c.v}</v></c>`
            : `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${esc(c.v)}</t></is></c>`;
        })
        .join('');
      return `<row r="${r1}">${cs}</row>`;
    })
    .join('');
  const pane = freeze
    ? `<pane ySplit="${freeze}" topLeftCell="A${freeze + 1}" activePane="bottomLeft" state="frozen"/>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView rightToLeft="1" workbookViewId="0">${pane}</sheetView></sheetViews><cols>${cols}</cols><sheetData>${body}</sheetData></worksheet>`;
}

// ── גיליון 1: פריטים מרוכזים ───────────────────────────────────────────────
const items = [...r.items].sort((a, b) => (b.total || 0) - (a.total || 0));
const rows1 = [];
rows1.push([{ v: `שחייני על בע"מ (${r.customer}) — רכישות ${r.from} עד ${r.to}`, s: S.title }]);
rows1.push([{ v: 'מקור: דו"ח תנועות מכירה ללקוח (a224) בקומקס. "שולם ליחידה" = סכום חלקי כמות, כלומר אחרי הנחה.' }]);
rows1.push([]);
rows1.push(['מק"ט', 'ברקוד', 'שם פריט', 'כמות', 'מחירון', 'שולם ליחידה', '% הנחה', 'סה"כ', 'מסמכים'].map((v) => ({ v, s: S.hdr })));

let qty = 0;
let tot = 0;
for (const it of items) {
  const prices = it.docs.map((d) => d.price).filter(Boolean);
  const list = prices.length ? Math.max(...prices) : null;
  const paid = it.paidAvg;
  const disc = list && paid ? Math.round((1 - paid / list) * 10000) / 10000 : null;
  qty += it.qty;
  tot += it.total || 0;
  rows1.push([
    { v: it.altCode || it.barcode },
    { v: it.barcode },
    { v: it.name },
    { v: it.qty, s: S.num },
    list ? { v: list, s: S.money } : '',
    paid ? { v: paid, s: S.money } : '',
    disc !== null ? { v: disc, s: S.pct } : '',
    { v: Math.round((it.total || 0) * 100) / 100, s: S.money },
    { v: it.docs.length, s: S.num },
  ]);
}

const blank = { v: '', s: S.sum };
rows1.push(['', '', { v: 'סה"כ', s: S.sum }, { v: Math.round(qty * 1000) / 1000, s: S.sum }, blank, blank, blank, { v: Math.round(tot * 100) / 100, s: S.sum }, blank]);
rows1.push([]);
rows1.push([{ v: 'ביקורת מול הדוח בקומקס' }, '', '', { v: r.totals.qty, s: S.num }, '', '', '', { v: r.totals.total, s: S.money }]);
rows1.push([{ v: 'הפרש (חייב להיות 0)' }, '', '', { v: Math.round((qty - r.totals.qty) * 1000) / 1000, s: S.num }, '', '', '', { v: Math.round((tot - r.totals.total) * 100) / 100, s: S.money }]);

// ── גיליון 2: שורות התנועה הגולמיות ────────────────────────────────────────
const rows2 = [
  ['ברקוד', 'שם פריט', 'תאריך', 'מסמך', 'כמות', 'מחירון', '% הנחה', 'שולם ליחידה', 'סכום', 'פרטים'].map((v) => ({ v, s: S.hdr })),
];
for (const it of r.items) {
  for (const d of it.docs) {
    rows2.push([
      { v: it.barcode },
      { v: it.name },
      { v: d.date },
      { v: d.doc },
      { v: d.qty, s: S.num },
      d.price ? { v: d.price, s: S.money } : '',
      d.discount != null ? { v: Math.round((d.discount / 100) * 10000) / 10000, s: S.pct } : '',
      d.paid != null ? { v: d.paid, s: S.money } : '',
      { v: d.total, s: S.money },
      { v: d.note || '' },
    ]);
  }
}

fs.writeFileSync(path.join(DIR, 'xl/worksheets/sheet1.xml'), sheetXml(rows1, [22, 16, 34, 9, 11, 13, 10, 13, 10], 4));
fs.writeFileSync(path.join(DIR, 'xl/worksheets/sheet2.xml'), sheetXml(rows2, [16, 30, 12, 11, 8, 11, 10, 13, 12, 22], 1));

const CT = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>';

const RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';

const WB = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="פריטים" sheetId="1" r:id="rId1"/><sheet name="תנועות" sheetId="2" r:id="rId2"/></sheets></workbook>';

const WBRELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';

const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="0%"/></numFmts><fonts count="4"><font><sz val="10"/><name val="Arial"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Arial"/></font><font><b/><sz val="14"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F3864"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9E2F3"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right><top style="thin"><color rgb="FFBFBFBF"/></top><bottom style="thin"><color rgb="FFBFBFBF"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="3" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

fs.writeFileSync(path.join(DIR, '[Content_Types].xml'), CT);
fs.writeFileSync(path.join(DIR, '_rels/.rels'), RELS);
fs.writeFileSync(path.join(DIR, 'xl/workbook.xml'), WB);
fs.writeFileSync(path.join(DIR, 'xl/_rels/workbook.xml.rels'), WBRELS);
fs.writeFileSync(path.join(DIR, 'xl/styles.xml'), STYLES);

console.log(`חלקי XML נכתבו ל-${DIR}`);
console.log(`  ${items.length} פריטים · ${rows2.length - 1} תנועות · סה"כ ${Math.round(tot * 100) / 100}`);
console.log(`  הפרש מול קומקס: כמות ${Math.round((qty - r.totals.qty) * 1000) / 1000} · סכום ${Math.round((tot - r.totals.total) * 100) / 100}`);
console.log(`  יעד: ${OUT}`);

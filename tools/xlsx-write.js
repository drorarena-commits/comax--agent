/**
 * כותב קובץ xlsx אמיתי, עם אפשרות לצבוע שורות.
 *
 *   import { writeXlsx } from './tools/xlsx-write.js';
 *   writeXlsx('out.xlsx', rows, { highlight: new Set([3, 7]), sheetName: 'גיליון' });
 *
 * Why hand-rolled: the project depends on playwright-core and nothing else, and
 * an xlsx is a zip of XML. The alternative — an HTML table saved as .xls, which
 * is what Comax itself hands back — makes Excel warn that the extension does
 * not match the content, and it does not survive a round trip through
 * `tools/xlsx.js`. A real xlsx does both.
 *
 * Everything is written as inline strings: no sharedStrings table to keep in
 * sync, at the cost of a larger file. For the report-sized outputs this project
 * produces that trade is free.
 */
import { deflateRawSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  // Excel rejects most control characters outright; strip rather than emit.
  .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

/** 1 -> "A", 27 -> "AA" */
function colName(n) {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - r - 1) / 26; }
  return s;
}

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return (buf) => {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

/** Minimal zip writer — deflate, no data descriptors, no zip64. */
function zip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const body = deflateRawSync(data, { level: 9 });
    const crc = CRC(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);      // version needed
    local.writeUInt16LE(0x0800, 6);  // UTF-8 filenames
    local.writeUInt16LE(8, 8);       // deflate
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    chunks.push(local, nameBuf, body);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }

  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...chunks, cdBuf, end]);
}

/** XML של גיליון בודד. */
function sheetXml(rows, highlight) {
  const width = Math.max(...rows.map((r) => r.length), 1);

  const body = rows.map((row, i) => {
    // style 1 = bold header, 2 = yellow fill, 0 = plain
    const s = i === 0 ? 1 : (highlight.has(i - 1) ? 2 : 0);
    const cells = [];
    for (let c = 0; c < width; c++) {
      const v = row[c] ?? '';
      if (v === '') continue;
      const ref = `${colName(c + 1)}${i + 1}`;
      // Numbers stay numbers so Excel can sum and sort them — but a string of
      // digits is not always a number, and two shapes of it must stay text:
      //
      //   1. **אפס מוביל** (`002507`, `075`). זה מזהה, לא כמות, והאפס נושא
      //      משמעות. נמדד 07/09/2026: כל 175 שורות ההקמה נכתבו עם דגם כמו
      //      `002507` בתא מספרי, אקסל הציג `2507`, ובקומקס הדגם הוא `002507` —
      //      כלומר כל שורה הייתה נקלטת על דגם שאינו קיים. שער המאסטר לא תפס
      //      את זה כי הוא רץ על המחרוזות **לפני** הכתיבה לקובץ.
      //   2. **מספר שלם ארוך מ-11 ספרות** (ברקוד בן 13). הערך עצמו נשמר
      //      במלואו, אבל אקסל **מציג** `3.46834E+12`, וכל צרכן שקורא את הטקסט
      //      המוצג ולא את הערך הגולמי מקבל את זה.
      //
      // בשני המקרים אין מה להפסיד: אף אחד לא מסכם ברקודים ולא ממיין קודי דגם
      // כמספרים, והנזק מהכיוון השני הוא שקט ומוחלט.
      const t = String(v).trim();
      const looksNumeric = typeof v === 'number' || (/^-?\d+(\.\d+)?$/.test(t) && t !== '');
      const isIdentifier = /^0\d/.test(t) || /^\d{12,}$/.test(t);
      const num = looksNumeric && !isIdentifier;
      cells.push(num
        ? `<c r="${ref}" s="${s}"><v>${esc(v)}</v></c>`
        : `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`);
    }
    return `<row r="${i + 1}"${s ? ` s="${s}" customFormat="1"` : ''}>${cells.join('')}</row>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><outlinePr summaryBelow="1" summaryRight="1"/></sheetPr><dimension ref="A1:${colName(width)}${rows.length}"/><sheetViews><sheetView rightToLeft="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><sheetData>${body}</sheetData><autoFilter ref="A1:${colName(width)}${rows.length}"/></worksheet>`;
}

/**
 * כותב חוברת עם גיליון אחד או יותר.
 * @param {string} file
 * @param {{name:string, rows:string[][], highlight?:Set<number>}[]} sheets
 *   `highlight` מונה שורות **נתונים** — 0 היא הראשונה אחרי הכותרת.
 */
export function writeXlsxSheets(file, sheets) {
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

  const B = (s) => Buffer.from(s, 'utf8');
  const n = sheets.length;
  const idx = Array.from({ length: n }, (_, i) => i + 1);

  writeFileSync(file, zip([
    { name: '[Content_Types].xml', data: B(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${idx.map((i) => `<Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`) },
    { name: '_rels/.rels', data: B(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
    { name: 'xl/workbook.xml', data: B(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name).slice(0, 31)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`) },
    // Styles must come last in the rel ids, after every sheet.
    { name: 'xl/_rels/workbook.xml.rels', data: B(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${idx.map((i) => `<Relationship Id="rId${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i}.xml"/>`).join('')}<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`) },
    { name: 'xl/styles.xml', data: B(styles) },
    ...sheets.map((s, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: B(sheetXml(s.rows, s.highlight ?? new Set())),
    })),
  ]));

  return {
    file,
    sheets: sheets.map((s) => ({ name: s.name, rows: s.rows.length - 1, highlighted: (s.highlight ?? new Set()).size })),
  };
}

/** גיליון בודד — עטיפה על `writeXlsxSheets`. */
export function writeXlsx(file, rows, { highlight = new Set(), sheetName = 'Sheet1' } = {}) {
  const r = writeXlsxSheets(file, [{ name: sheetName, rows, highlight }]);
  return { file, rows: r.sheets[0].rows, highlighted: r.sheets[0].highlighted };
}

/**
 * The "what already exists" report — produced before anything is set up, and
 * the thing Dror actually reads.
 *
 * One row per invoice line, in invoice order, so it can be laid next to the
 * original file. Sorting blocked lines to the top would scatter that alignment;
 * a status column is enough, and the alignment is worth more.
 */
import ExcelJS from 'exceljs';
import { basename, resolve } from 'node:path';
import { ROOT } from '../config.js';

const STATUS = {
  exists: 'קיים',
  newChild: 'בן חדש',
  newBoth: 'אב + בן חדשים',
  blocked: 'חסום',
};

const base = (f) => basename(String(f));

export async function buildReport({ plan, invoice, card, out }) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('דוח קיום', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });

  ws.columns = [
    { header: 'שורה', key: 'row', width: 7 },
    { header: 'סטטוס', key: 'status', width: 15 },
    { header: 'ברקוד', key: 'ean', width: 16 },
    { header: 'מקור הברקוד', key: 'barcodeSource', width: 14 },
    { header: 'מקט ארנה', key: 'article', width: 18 },
    { header: 'מקט אב', key: 'parent', width: 16 },
    { header: 'תיאור', key: 'desc', width: 42 },
    { header: 'מידה', key: 'size', width: 8 },
    { header: 'כמות', key: 'qty', width: 8 },
    { header: 'עלות EUR', key: 'cost', width: 11 },
    { header: 'למה', key: 'why', width: 46 },
  ];
  ws.getRow(1).font = { bold: true };

  for (const r of plan.rows) {
    const row = ws.addRow({
      row: r.row.row,
      status: STATUS[r.status],
      ean: String(r.barcode || r.row.ean || ''),
      barcodeSource: r.selfCoded ? 'מקודד־עצמית' : r.row.hasBarcode ? 'ארנה' : '—',
      article: r.row.articleNumber,
      parent: r.parent || '',
      desc: r.row.styleDesc || r.row.articleDesc,
      size: String(r.row.size).toUpperCase(),
      qty: r.row.qty,
      cost: r.row.price,
      why: r.why,
    });
    row.getCell('ean').numFmt = '@';
    if (r.status === 'blocked') row.getCell('status').font = { bold: true, color: { argb: 'FFB00000' } };
    // A barcode we invented has to be visible at a glance, not one column of
    // sameness among a hundred real EANs.
    if (r.selfCoded) row.getCell('barcodeSource').font = { bold: true, color: { argb: 'FFB00000' } };
  }

  const ws2 = wb.addWorksheet('אבות חדשים', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
  ws2.columns = [
    { header: 'מקט אב', key: 'sku', width: 16 },
    { header: 'תיאור', key: 'desc', width: 42 },
    { header: 'משפחה', key: 'family', width: 10 },
    { header: 'סרגל', key: 'scale', width: 10 },
    { header: 'דויזן', key: 'division', width: 8 },
    { header: 'מגדר', key: 'gender', width: 8 },
    { header: 'עלות EUR', key: 'cost', width: 11 },
    { header: 'מחיר בסיס', key: 'base', width: 11 },
    { header: 'מחירון 1', key: 'wholesale', width: 11 },
    { header: 'ביטחון', key: 'confidence', width: 16 },
    { header: 'לפי מה', key: 'why', width: 50 },
  ];
  ws2.getRow(1).font = { bold: true };
  for (const p of plan.parents) {
    const c = p.classification;
    ws2.addRow({
      sku: p.sku,
      desc: p.row.styleDesc || p.row.articleDesc,
      family: c.family.value ?? '—',
      scale: c.sizeScale.value ?? '—',
      division: c.division.value ?? '—',
      gender: c.gender.value ?? '—',
      cost: p.price?.costEur,
      base: p.price?.base,
      wholesale: p.price?.wholesale,
      confidence: p.unresolved.length ? 'חסר: ' + p.unresolved.join(', ') : c.family.confidence,
      why: c.family.why,
    });
  }

  const ws3 = wb.addWorksheet('מקורות', { views: [{ rightToLeft: true }] });
  [
    ['חשבונית', base(invoice.file)],
    ['כרטיס פריט', base(card.file)],
    ['גיל כרטיס הפריט (ימים)', card.ageDays],
    ['שורות בחשבונית', plan.counts.total],
    ['קיימות', plan.counts.exists],
    ['בן חדש', plan.counts.newChild],
    ['אב + בן חדשים', plan.counts.newBoth],
    ['חסומות', plan.counts.blocked],
    ['אבות חדשים להקמה', plan.counts.newParents],
    ['שורות בברקוד מקודד־עצמית', plan.counts.selfCoded || 0],
    ['נוצר בתאריך', new Date().toISOString().slice(0, 16).replace('T', ' ')],
  ].forEach((pair) => ws3.addRow(pair));
  ws3.getColumn(1).width = 26;
  ws3.getColumn(2).width = 46;

  const file = resolve(ROOT, out);
  await wb.xlsx.writeFile(file);
  return { file };
}

/**
 * Reading and writing the old `.xls` Sport & More send us (`קובץ טעינת חן זיווה`).
 *
 * That file is OLE2/BIFF8, not a zip — exceljs cannot open it and there is no
 * Python or xls library in this environment. Excel itself is installed (16.0),
 * so the template is driven through COM from a short PowerShell script.
 *
 * Two things the script must never get wrong:
 *
 *   The workbook is saved back as BIFF8 (`FileFormat = 56`). Letting Excel pick
 *   would hand Sport & More an `.xls` that is really an `.xlsx`, and their
 *   loader rejects it without saying why.
 *
 *   Excel is quit in a `finally`. A COM process left running holds a lock on
 *   the template, and the next run fails on a file that looks perfectly fine in
 *   Explorer.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

/** Run a PowerShell script from a temp file — avoids every quoting problem. */
function powershell(script) {
  const dir = mkdtempSync(join(tmpdir(), 'sm-xls-'));
  const file = join(dir, 'run.ps1');
  // UTF-8 with BOM, or PowerShell reads the Hebrew in the script as 1252.
  writeFileSync(file, '\uFEFF' + script, 'utf8');
  try {
    return execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file],
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Excel does not reliably exit on Quit() — a single lingering COM reference is
 * enough to leave the process alive, holding a lock on the template so the next
 * run fails on a file that looks perfectly fine in Explorer.
 *
 * Killing every EXCEL.EXE is not an option: Dror has his own workbooks open, and
 * they would go down with unsaved changes. So the PIDs present before we start
 * are recorded, and only a process that appeared in between is forced down.
 */
const PREAMBLE = `
$ErrorActionPreference = 'Stop'
# Without this PowerShell emits stdout in the console codepage and every
# Hebrew header comes back as mojibake on the Node side.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false
$xl.DisplayAlerts = $false
`;

const EPILOGUE = `
if ($wb) {
  try { $wb.Close($false) } catch {}
  try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($wb) } catch {}
}
if ($ws) { try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($ws) } catch {} }
try { $xl.Quit() } catch {}
try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($xl) } catch {}
[GC]::Collect(); [GC]::WaitForPendingFinalizers(); [GC]::Collect()
Start-Sleep -Milliseconds 250
Get-Process EXCEL -ErrorAction SilentlyContinue |
  Where-Object { $before -notcontains $_.Id } |
  ForEach-Object { try { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue } catch {} }
`;

/** Read a sheet as an array of arrays. Values, not display text. */
export function readXls(path, { sheet = 1, maxRows = 0 } = {}) {
  const file = resolve(path);
  const out = powershell(`${PREAMBLE}
$wb = $null
try {
  $wb = $xl.Workbooks.Open('${file.replace(/'/g, "''")}', 0, $true)
  $ws = $wb.Worksheets.Item(${sheet})
  $ur = $ws.UsedRange
  $rows = $ur.Rows.Count
  $cols = $ur.Columns.Count
  ${maxRows ? `if ($rows -gt ${maxRows}) { $rows = ${maxRows} }` : ''}
  $vals = $ur.Value2
  $lines = New-Object System.Collections.ArrayList
  for ($r = 1; $r -le $rows; $r++) {
    $cells = @()
    for ($c = 1; $c -le $cols; $c++) {
      $v = $vals.GetValue($r, $c)
      $cells += ,("" + $v)
    }
    [void]$lines.Add(($cells -join "\`t"))
  }
  Write-Output ("SHEET" + $ws.Name)
  $lines | ForEach-Object { Write-Output $_ }
} finally {${EPILOGUE}}
`);
  const lines = out.split(/\r?\n/);
  const head = lines.findIndex((l) => l.startsWith('SHEET'));
  const name = head >= 0 ? lines[head].slice(5) : '';
  const rows = lines.slice(head + 1).filter((l) => l !== '').map((l) => l.split('\t'));
  return { name, rows };
}

/**
 * Copy `template` to `out` and write `rows` starting at `startRow`.
 *
 * `rows` is an array of `{ [columnNumber]: value }` — sparse on purpose, so a
 * column the batch does not fill keeps whatever the template already had there
 * (מחסן, מספר סניף and תאריך all come pre-filled down all 765 rows).
 *
 * Every value is written as text with a leading apostrophe when `textCols`
 * names its column, which is how a 13-digit barcode or a size like `08` keeps
 * its shape instead of becoming 3.46834E+12 or 8.
 */
export function writeXlsFromTemplate({ template, out, rows, startRow = 2, sheet = 1, textCols = [] }) {
  const tpl = resolve(template);
  const dst = resolve(out);
  const text = new Set(textCols);
  const sets = [];
  rows.forEach((cells, i) => {
    const r = startRow + i;
    for (const [col, value] of Object.entries(cells)) {
      if (value === null || value === undefined || value === '') continue;
      const c = Number(col);
      const v = text.has(c)
        ? `"'" + '${String(value).replace(/'/g, "''")}'`
        : typeof value === 'number'
          ? String(value)
          : `'${String(value).replace(/'/g, "''")}'`;
      sets.push(`$ws.Cells.Item(${r}, ${c}).Value2 = ${v}`);
    }
  });

  powershell(`${PREAMBLE}
$wb = $null
try {
  Copy-Item -LiteralPath '${tpl.replace(/'/g, "''")}' -Destination '${dst.replace(/'/g, "''")}' -Force
  $wb = $xl.Workbooks.Open('${dst.replace(/'/g, "''")}')
  $ws = $wb.Worksheets.Item(${sheet})
${sets.join('\n')}
  $wb.SaveAs('${dst.replace(/'/g, "''")}', 56)
  Write-Output 'SAVED'
} finally {${EPILOGUE}}
`);
  return { file: dst, rows: rows.length };
}

/** No Excel, no intake file — say so before a batch is half-built. */
export function assertExcelAvailable() {
  try {
    const v = powershell(`${PREAMBLE}
try { Write-Output $xl.Version } finally {${EPILOGUE}}
`).trim().split(/\r?\n/).pop();
    return v;
  } catch (e) {
    throw new Error(
      'אקסל לא זמין דרך COM, ובלעדיו אי אפשר לכתוב את קובץ הקליטה (.xls ישן).\n' +
        `הודעת השגיאה: ${String(e.message).split('\n')[0]}`
    );
  }
}

/* export.js — builds the styled XLSX / CSV deliverables from chunked storage data.
 * XLSX styling mirrors the reference workbook: RTL views, frozen header row,
 * status/type colored data rows (green invoices / blue credit notes / amber debit
 * notes / red non-valid), thin borders, Calibri 11, exact column widths, and
 * hyperlinks on تفاصيل (internal jump to line items) + الرابط الخارجى (share URL). */
'use strict';

const M = window.__ETA_MAP;
const msgEl = document.getElementById('msg');
const titleEl = document.getElementById('title');
const say = (t) => { msgEl.textContent = t; };

// Exact column widths extracted from the reference workbook
const WIDTHS1 = [10, 10, 12, 13, 10, 13, 13, 13, 13, 13, 12, 12, 18, 7, 18, 7, 18, 7, 22, 7, 22, 7, 30, 7, 18, 7, 22, 7, 30, 7, 18, 7, 12, 7, 12, 13, 13, 13, 14, 23, 32, 17, 32, 32, 17, 32, 32, 32, 32, 32, 32, 32, 120, 13, 13, 13, 13, 32];
const WIDTHS2 = [12, 13, 10, 23, 13, 13, 14, 14, 14, 25, 12, 20, 10, 10, 10, 10, 18, 7, 18, 7, 18, 7, 22, 7, 22, 7, 30, 7, 18, 7, 22, 7, 30, 7, 18, 7, 12, 7, 12, 10, 20, 15, 10, 10, 12, 10, 10, 17, 32, 32, 17, 32, 32, 32, 32, 32, 32, 32, 32, 13, 13, 13, 13, 32];

const COLOR_GREEN = 'FFC6EFCE', COLOR_BLUE = 'FFD9E1F2', COLOR_AMBER = 'FFFFE699', COLOR_RED = 'FFFFC7CE';
const THIN = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
const FONT = { name: 'Calibri', size: 11 };
const FONT_BOLD = { name: 'Calibri', size: 11, bold: true };

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function concatChunks(all, prefix) {
  const keys = Object.keys(all).filter(k => k.startsWith(prefix))
    .sort((a, b) => parseInt(a.slice(prefix.length), 10) - parseInt(b.slice(prefix.length), 10));
  const out = [];
  for (const k of keys) for (const v of all[k] || []) out.push(v);
  return out;
}

function cleanRow(row) {
  return row.map(v => (v === '' || v === undefined) ? null : v);
}

function downloadBlob(blob, filename) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename, conflictAction: 'uniquify' }, (id) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else { setTimeout(() => URL.revokeObjectURL(url), 60000); resolve(id); }
    });
  });
}

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function toCsv(headers, rows) {
  const lines = [headers.map(csvEscape).join(',')];
  for (const r of rows) lines.push(r.map(csvEscape).join(','));
  return '\uFEFF' + lines.join('\r\n');
}

function cfRule(priority, formula, color) {
  return {
    type: 'expression', priority, formulae: [formula],
    style: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: color }, bgColor: { argb: color } } }
  };
}

async function buildXlsx(rows, itemRows, base) {
  say(`Building styled workbook — ${rows.length.toLocaleString()} invoices, ${itemRows.length.toLocaleString()} line items…`);
  await sleep(60);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'ETA eInvoicing Exporter';

  // ---------- Sheet 1: جميع الفواتير ----------
  const ws1 = wb.addWorksheet('جميع الفواتير', {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 1, topLeftCell: 'A2' }]
  });
  ws1.getRow(1).values = M.HEADERS1;
  for (let c = 1; c <= M.HEADERS1.length; c++) ws1.getColumn(c).width = WIDTHS1[c - 1] || 10;

  if (rows.length) {
    ws1.addConditionalFormatting({
      ref: 'A2:BF' + (rows.length + 1),
      rules: [
        cfRule(1, 'OR($E2="Invalid",$E2="Rejected",$E2="Cancelled")', COLOR_RED),
        cfRule(2, 'AND($E2="Valid",OR($C2="فاتورة",$C2="فاتورة استيراد",$C2="فاتورة تصدير"))', COLOR_GREEN),
        cfRule(3, 'AND($E2="Valid",OR($C2="اشعار دائن",$C2="اشعار دائن تصدير"))', COLOR_BLUE),
        cfRule(4, 'AND($E2="Valid",OR($C2="اشعار مدين",$C2="اشعار مدين تصدير"))', COLOR_AMBER)
      ]
    });
  }

  // first line-item row per invoice (sheet2 col 58 = الرقم الإلكترونى)
  const firstItemRow = {};
  for (let i = itemRows.length - 1; i >= 0; i--) {
    const eid = itemRows[i][57];
    if (eid) firstItemRow[eid] = i + 2;
  }

  for (let i = 0; i < rows.length; i++) {
    const row = ws1.addRow(cleanRow(rows[i]));
    for (let c = 1; c <= M.HEADERS1.length; c++) {
      const cell = row.getCell(c);
      cell.border = THIN;
      cell.font = FONT;
    }
    const eid = rows[i][40];
    const internal = eid && firstItemRow[eid] ? "#'بيانات الفواتير'!A" + firstItemRow[eid] : null;
    const external = rows[i][52] || (eid ? 'https://invoicing.eta.gov.eg/documents/' + eid : null);
    row.getCell(2).value = internal ? { text: 'عرض', hyperlink: internal } : (external ? { text: 'عرض', hyperlink: external } : 'عرض');
    if (external) row.getCell(53).value = { text: external, hyperlink: external };
    if (i % 400 === 0) { say(`Invoices: ${i.toLocaleString()}/${rows.length.toLocaleString()}…`); await sleep(0); }
  }

  // ---------- Sheet 2: بيانات الفواتير ----------
  const ws2 = wb.addWorksheet('بيانات الفواتير', {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 1, topLeftCell: 'A2' }]
  });
  ws2.getRow(1).values = M.HEADERS2;
  for (let c = 1; c <= M.HEADERS2.length; c++) ws2.getColumn(c).width = WIDTHS2[c - 1] || 10;

  if (itemRows.length) {
    ws2.addConditionalFormatting({
      ref: 'A2:BL' + (itemRows.length + 1),
      rules: [
        cfRule(1, 'OR($C2="Invalid",$C2="Rejected",$C2="Cancelled")', COLOR_RED),
        cfRule(2, 'AND($C2="Valid",OR($A2="فاتورة",$A2="فاتورة استيراد",$A2="فاتورة تصدير"))', COLOR_GREEN),
        cfRule(3, 'AND($C2="Valid",OR($A2="اشعار دائن",$A2="اشعار دائن تصدير"))', COLOR_BLUE),
        cfRule(4, 'AND($C2="Valid",OR($A2="اشعار مدين",$A2="اشعار مدين تصدير"))', COLOR_AMBER)
      ]
    });
  }

  for (let i = 0; i < itemRows.length; i++) {
    const row = ws2.addRow(cleanRow(itemRows[i]));
    for (let c = 1; c <= M.HEADERS2.length; c++) {
      const cell = row.getCell(c);
      cell.border = THIN;
      cell.font = c === 1 ? FONT_BOLD : FONT;
    }
    if (i % 400 === 0) { say(`Line items: ${i.toLocaleString()}/${itemRows.length.toLocaleString()}…`); await sleep(0); }
  }

  say('Writing .xlsx (compressing — can take a minute for large ranges)…');
  await sleep(60);
  const buf = await wb.xlsx.writeBuffer();
  await downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), base + '.xlsx');
}

async function buildCodesXlsx(rows, cols, base) {
  say(`Building codes workbook \u2014 ${rows.length.toLocaleString()} rows\u2026`);
  await sleep(60);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ETA eInvoicing Exporter';
  const ws = wb.addWorksheet((meta && meta.headers && meta.headers.sheet) || 'الأكواد المسجلة', {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 1, topLeftCell: 'A2' }]
  });
  ws.getRow(1).values = cols;
  for (let c = 1; c <= cols.length; c++) {
    ws.getColumn(c).width = Math.max(12, Math.min(40, String(cols[c - 1]).length + 8));
    ws.getColumn(c).style = { font: FONT };
  }
  for (let i = 0; i < rows.length; i++) {
    const row = ws.addRow(cleanRow(rows[i]));
    for (let c = 1; c <= cols.length; c++) row.getCell(c).font = FONT;
    if (i % 400 === 0) { say(`Rows: ${i.toLocaleString()}/${rows.length.toLocaleString()}\u2026`); await sleep(0); }
  }
  if (rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: cols.length } };
  say('Writing .xlsx\u2026');
  await sleep(60);
  const buf = await wb.xlsx.writeBuffer();
  await downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), base + '_codes.xlsx');
}

async function buildCodesCsv(rows, cols, base) {
  const c1 = new Blob(['\uFEFF' + toCsv(cols, rows)], { type: 'text/csv;charset=utf-8' });
  await downloadBlob(c1, base + '_codes.csv');
}

async function buildCsv(rows, itemRows, base) {
  say(`Building CSVs — ${rows.length.toLocaleString()} invoices, ${itemRows.length.toLocaleString()} line items…`);
  await sleep(60);
  const c1 = new Blob([toCsv(M.HEADERS1, rows)], { type: 'text/csv;charset=utf-8' });
  await downloadBlob(c1, base + '_all_invoices.csv');
  const c2 = new Blob([toCsv(M.HEADERS2, itemRows)], { type: 'text/csv;charset=utf-8' });
  await downloadBlob(c2, base + '_line_items.csv');
}

(async () => {
  try {
    const kind = new URLSearchParams(location.search).get('kind') || 'xlsx';
    titleEl.textContent = kind === 'csv' ? 'ETA Export — CSV' : 'ETA Export — Excel (.xlsx)';
    const all = await chrome.storage.local.get(null);
    const rows = concatChunks(all, 'eta_rows_c');
    const itemRows = concatChunks(all, 'eta_items_c');
    if (!rows.length) { say('No data collected yet.\nRun an export from the extension popup first.'); return; }
    const opts = all.eta_opts || {};
    const meta = all.eta_meta || {};
    if ((opts.mode || 'documents') === 'codes') {
      const cols = (meta.headers && meta.headers.cols) || [];
      const base = 'ETA_Codes_' + new Date().toISOString().slice(0, 10);
      if (kind === 'csv') await buildCodesCsv(rows, cols, base);
      else await buildCodesXlsx(rows, cols, base);
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      say(`\u2714 File downloaded.\n\nRows: ${rows.length.toLocaleString()}\nTime: ${secs}s`);
      msgEl.className = 'done';
      return;
    }
    const base = 'eInvoices_' + (opts.from || 'range') + '_' + (opts.to || '');
    const t0 = Date.now();
    if (kind === 'csv') await buildCsv(rows, itemRows, base);
    else await buildXlsx(rows, itemRows, base);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    say(`✔ File downloaded.\n\nInvoices: ${rows.length.toLocaleString()}\nLine items: ${itemRows.length.toLocaleString()}\nTime: ${secs}s`);
    msgEl.className = 'done';
  } catch (e) {
    say('Export failed: ' + ((e && e.message) || e));
    msgEl.className = 'bad';
  }
})();

document.getElementById('close').addEventListener('click', () => window.close());

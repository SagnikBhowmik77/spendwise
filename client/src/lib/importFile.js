// Reading a statement file in the browser: CSV, Excel (.xlsx, .xls) or OpenDocument.
// The file never leaves the device as a file; only its rows are sent to the API for the preview.

import { t } from './i18n.js';

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_COLUMNS = 60;
const HEADER_SCAN = 40;
const pad = (n) => String(n).padStart(2, '0');

// Excel stores dates as numbers with a date format; turn those into "YYYY-MM-DD" (plus the time if any)
// so day and month never get swapped. Everything else is kept as the text the bank wrote.
function cellText(cell, XLSX) {
  if (!cell) return '';
  if (cell.t === 'n' && cell.z && XLSX.SSF.is_date(cell.z)) {
    const d = XLSX.SSF.parse_date_code(cell.v);
    const day = `${d.y}-${pad(d.m)}-${pad(d.d)}`;
    return d.H || d.M ? `${day} ${pad(d.H)}:${pad(d.M)}` : day;
  }
  if (cell.t === 'd') return cell.v.toISOString().slice(0, 16).replace('T', ' ').replace(/ 00:00$/, '');
  if (cell.t === 'n') return String(cell.v);
  if (cell.t === 'b') return cell.v ? 'TRUE' : 'FALSE';
  return String(cell.w ?? cell.v ?? '').trim();
}

function sheetRows(sheet, XLSX) {
  if (!sheet['!ref']) return [];
  const range = XLSX.utils.decode_range(sheet['!ref']);
  const lastCol = Math.min(range.e.c, range.s.c + MAX_COLUMNS - 1);
  const rows = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const cells = [];
    for (let c = range.s.c; c <= lastCol; c++) cells.push(cellText(sheet[XLSX.utils.encode_cell({ r, c })], XLSX));
    while (cells.length && !cells.at(-1)) cells.pop();
    rows.push(cells);
  }
  return rows;
}

// -> [{ name, rows: string[][] }]. CSVs are read as plain text: no guessing at dates or numbers.
export async function readStatement(data, fileName) {
  const XLSX = await import('xlsx');
  const csv = /\.(csv|txt|tsv)$/i.test(fileName);
  let book;
  try {
    book = XLSX.read(data, { type: 'array', raw: csv, cellNF: true, cellText: false, cellDates: false });
  } catch (err) {
    if (/password/i.test(err.message)) throw new Error(t('This file is password-protected. Save an unprotected copy and try again.'));
    throw new Error(t('This file couldn’t be read. Export the statement as CSV or Excel and try again.'));
  }
  return book.SheetNames.map((name) => ({ name, rows: sheetRows(book.Sheets[name], XLSX) }))
    .filter((s) => s.rows.some((r) => r.length));
}

const DATE_HEAD = /date/i;
const MONEY_HEAD = /amount|amt|debit|credit|withdrawal|deposit|^dr\b|^cr\b/i;

// Statements often start with a few lines about the account; the header is the first line naming
// both a date and an amount column.
export function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, HEADER_SCAN); i++) {
    if (rows[i].some((c) => DATE_HEAD.test(c)) && rows[i].some((c) => MONEY_HEAD.test(c))) return i;
  }
  const i = rows.findIndex((r) => r.filter(Boolean).length >= 2);
  return i === -1 ? 0 : i;
}

const pick = (header, ...patterns) => {
  for (const re of patterns) {
    const i = header.findIndex((h) => re.test(String(h).trim()));
    if (i !== -1) return i;
  }
  return null;
};

// A first guess at which column is which, from the header names.
export function guessMapping(header, { card = false } = {}) {
  const date = pick(header, /^(txn|tran|transaction|posting|post)\.?\s*date/i, /^date$/i, /^date\b/i, /(?<!value\s)date/i, /date/i);
  const description = pick(header, /narration/i, /description/i, /particulars/i, /details/i, /remarks/i, /merchant/i);
  const drcr = pick(header, /dr\s*\/\s*cr|cr\s*\/\s*dr|debit\s*\/\s*credit/i, /^type$/i);
  const debit = pick(header, /withdrawal/i, /^debit/i, /debit amount/i, /^dr\.?$/i, /money out|paid out/i);
  const credit = pick(header, /deposit/i, /^credit/i, /credit amount/i, /^cr\.?$/i, /money in|paid in/i);
  const split = debit !== null && credit !== null && debit !== drcr && credit !== drcr;
  const amount = split ? null : pick(header, /^amount/i, /amount|amt/i);
  const time = pick(header, /^time$/i, /txn time|transaction time/i);
  return {
    date: date ?? 0,
    description: description ?? (header.length > 1 ? 1 : 0),
    time,
    amount: split ? null : amount ?? debit ?? credit,
    debit: split ? debit : null,
    credit: split ? credit : null,
    drcr: drcr !== null && drcr !== debit && drcr !== credit ? drcr : null,
    sign: card ? 'positive-is-spending' : 'negative-is-spending',
    dateFormat: 'auto',
  };
}

// Same as the API's: the header names that identify a bank's layout.
export const headerSignature = (header) => header.map((h) => String(h ?? '').trim().toLowerCase().replace(/\s+/g, ' ')).join('|');

// A saved layout whose header appears near the top of this file: { layout, headerIndex } or null.
export function matchLayout(rows, layouts) {
  for (let i = 0; i < Math.min(rows.length, HEADER_SCAN); i++) {
    const sig = headerSignature(rows[i]);
    const layout = layouts.find((l) => l.signature === sig);
    if (layout) return { layout, headerIndex: i };
  }
  return null;
}

// The rows under the header, with their line numbers in the file (1-based, as a spreadsheet shows them).
export const bodyRows = (rows, headerIndex) =>
  rows.slice(headerIndex + 1).map((cells, i) => ({ line: headerIndex + i + 2, cells })).filter((r) => r.cells.some(Boolean));

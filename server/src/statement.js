// Reading bank and card statements: amounts, dates and rows, without floating-point maths.
// Everything here is pure, so each bank's quirks can be tested on their own.
import { MAX_AMOUNT_PAISE } from './models/Transaction.js';
import { latestAllowedDay, parseDay } from './money.js';

export const DATE_FORMATS = ['auto', 'DMY', 'MDY', 'YMD'];
export const SIGN_STYLES = ['negative-is-spending', 'positive-is-spending'];

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};
const pad = (n) => String(n).padStart(2, '0');

// "₹1,23,456.78", "1234.5 Dr", "(250.00)", "-99", "CR 10" -> { paise (signed), marker: 'dr' | 'cr' | null }.
// Empty cells give null; text that isn't an amount gives { invalid: true }.
export function parseAmount(cell) {
  let s = String(cell ?? '').trim();
  if (!s) return null;
  let marker = null;
  const m = s.match(/\s*\b(dr|cr)\.?$/i) || s.match(/^(dr|cr)\.?\s*/i);
  if (m) {
    marker = m[1].toLowerCase();
    s = s.replace(m[0], '');
  }
  s = s.replace(/₹|\brs\.?|\binr\b/gi, '').replace(/[\s,]/g, '');
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith('-') || s.endsWith('-')) {
    negative = !negative;
    s = s.replace(/^-|-$/g, '');
  } else if (s.startsWith('+')) s = s.slice(1);
  if (!/^\d+(\.\d+)?$/.test(s)) return { invalid: true };
  const [whole, fraction = ''] = s.split('.');
  // Spreadsheet numbers can carry float tails (1234.5600000001): round on the third decimal.
  let paise = Number(whole) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2));
  if (fraction.length > 2 && Number(fraction[2]) >= 5) paise += 1;
  return { paise: negative ? -paise : paise, marker };
}

// Splits a date cell into its parts: { nums: [a, b, c] } for 12/10/2026, { y, m, d } when unambiguous,
// plus the time of day if the cell has one ("23/10/2026 21:05", "10:30 PM").
function dateParts(cell) {
  let s = String(cell ?? '').trim();
  if (!s) return null;
  let time = null;
  const t = s.match(/\b(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*(am|pm)?\b/i);
  if (t) {
    let h = Number(t[1]);
    if (t[3]) h = (h % 12) + (t[3].toLowerCase() === 'pm' ? 12 : 0);
    if (h < 24 && Number(t[2]) < 60) time = `${pad(h)}:${t[2]}`;
    s = s.replace(t[0], ' ').trim();
  }
  s = s.replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+/i, ''); // "Fri, 23 Oct 2026"
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:T.*)?$/);
  if (m) return { y: +m[1], m: +m[2], d: +m[3], time };
  m = s.match(/^(\d{1,2})[\s\-/.]*([a-z]{3,9})[\s\-/.,']*(\d{2}|\d{4})$/i);
  if (m && MONTHS[m[2].toLowerCase()]) return { y: +m[3], m: MONTHS[m[2].toLowerCase()], d: +m[1], time };
  m = s.match(/^([a-z]{3,9})[\s\-/.]*(\d{1,2}),?[\s\-/.]*(\d{2}|\d{4})$/i);
  if (m && MONTHS[m[1].toLowerCase()]) return { y: +m[3], m: MONTHS[m[1].toLowerCase()], d: +m[2], time };
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (m) return { nums: [+m[1], +m[2], +m[3]], time };
  return null;
}

// Which order numeric dates use, judged from every row: a first number above 12 means day first,
// a second above 12 means month first. Indian statements are day first, so that's the default.
export function detectDateFormat(cells) {
  let dmy = false;
  let mdy = false;
  for (const cell of cells) {
    const p = dateParts(cell);
    if (!p?.nums) continue;
    if (p.nums[0] > 12) dmy = true;
    if (p.nums[1] > 12) mdy = true;
  }
  return mdy && !dmy ? 'MDY' : 'DMY';
}

// -> { day: "YYYY-MM-DD", time: "HH:MM" | null } or null when it isn't a real date.
export function parseDateCell(cell, format = 'DMY') {
  const p = dateParts(cell);
  if (!p) return null;
  let { y, m, d } = p;
  if (p.nums) {
    const [a, b, c] = p.nums;
    if (format === 'MDY') [m, d, y] = [a, b, c];
    else if (format === 'YMD') [y, m, d] = [a, b, c];
    else [d, m, y] = [a, b, c];
  }
  if (y < 100) y += 2000;
  const day = `${y}-${pad(m)}-${pad(d)}`;
  return parseDay(day) ? { day, time: p.time } : null;
}

const DEBIT_WORDS = /^(dr|d|debit|withdrawal|withdraw|paid|out)$/i;
const CREDIT_WORDS = /^(cr|c|credit|deposit|received|in)$/i;
const cellAt = (cells, i) => (i === null || i === undefined ? '' : String(cells[i] ?? '').trim());

// Statement rows -> entries. `mapping` says which column holds what:
//   { date, description, time?, amount? | debit? + credit?, drcr?, sign, dateFormat }
// Lines without a readable date or amount (headers, opening balances, totals) come back with `error`.
export function normaliseRows(rows, mapping, { now = new Date() } = {}) {
  const format = mapping.dateFormat && mapping.dateFormat !== 'auto'
    ? mapping.dateFormat
    : detectDateFormat(rows.map((r) => cellAt(r.cells, mapping.date)));
  const latest = latestAllowedDay(now);
  const out = [];
  for (const { line, cells } of rows) {
    if (cells.every((c) => !String(c ?? '').trim())) continue;
    const description = cellAt(cells, mapping.description).replace(/\s+/g, ' ').slice(0, 500);
    const entry = { line, cells, description, date: null, time: null, type: null, amountPaise: null, error: null };
    out.push(entry);

    const date = parseDateCell(cellAt(cells, mapping.date), format);
    if (!date) { entry.error = 'No date that can be read'; continue; }
    if (date.day < '2000-01-01') { entry.error = 'Date is before 2000'; continue; }
    if (date.day > latest) { entry.error = 'Date is in the future'; continue; }
    entry.date = date.day;
    const timeCell = mapping.time !== undefined && mapping.time !== null ? parseDateCell(`2000-01-01 ${cellAt(cells, mapping.time)}`) : null;
    entry.time = timeCell?.time ?? date.time;

    let type = null;
    let paise = null;
    if (mapping.debit !== undefined && mapping.debit !== null) {
      const debit = parseAmount(cellAt(cells, mapping.debit));
      const credit = parseAmount(cellAt(cells, mapping.credit));
      if (debit?.invalid || credit?.invalid) { entry.error = 'Amount is not a number'; continue; }
      const out_ = debit && debit.paise !== 0;
      const in_ = credit && credit.paise !== 0;
      if (out_ && in_) { entry.error = 'Both a debit and a credit on one line'; continue; }
      if (out_) { type = debit.paise < 0 ? 'income' : 'expense'; paise = Math.abs(debit.paise); }
      if (in_) { type = credit.paise < 0 ? 'expense' : 'income'; paise = Math.abs(credit.paise); }
    } else {
      const a = parseAmount(cellAt(cells, mapping.amount));
      if (a?.invalid) { entry.error = 'Amount is not a number'; continue; }
      if (a && a.paise !== 0) {
        paise = Math.abs(a.paise);
        const word = cellAt(cells, mapping.drcr);
        if (a.marker) type = a.marker === 'dr' ? 'expense' : 'income';
        else if (DEBIT_WORDS.test(word)) type = 'expense';
        else if (CREDIT_WORDS.test(word)) type = 'income';
        else if (mapping.sign === 'positive-is-spending') type = a.paise > 0 ? 'expense' : 'income';
        else type = a.paise < 0 ? 'expense' : 'income';
      }
    }
    if (!paise) { entry.error = 'No amount'; continue; }
    if (paise > MAX_AMOUNT_PAISE) { entry.error = 'Amount is over ₹1,00,00,000'; continue; }
    entry.type = type;
    entry.amountPaise = paise;
  }
  return { rows: out, dateFormat: format };
}

// The column headers that identify a bank's layout, so a saved mapping can be found again.
export const headerSignature = (header) => header.map((h) => String(h ?? '').trim().toLowerCase().replace(/\s+/g, ' ')).join('|');

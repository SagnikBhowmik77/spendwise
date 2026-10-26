// Rupee amounts and calendar days, parsed without floating-point maths.

const AMOUNT_RE = /^\d+(\.\d{1,2})?$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// "1,250.5" | 1250.5 -> 125050 paise. Returns null when it isn't a plain amount with at most 2 decimals.
export function rupeesToPaise(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    value = String(value);
  }
  if (typeof value !== 'string') return null;
  const s = value.trim().replace(/,/g, '');
  if (!AMOUNT_RE.test(s)) return null;
  const [rupees, fraction = ''] = s.split('.');
  return Number(rupees) * 100 + Number(fraction.padEnd(2, '0'));
}

// Like rupeesToPaise but allows a leading minus and zero (opening balances; a card may start in debt).
export function signedRupeesToPaise(value) {
  const s = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : null;
  if (s === null) return null;
  const negative = s.startsWith('-');
  const paise = rupeesToPaise(negative ? s.slice(1) : s);
  return paise === null ? null : negative ? -paise : paise;
}

// "2026-10-23" -> Date at UTC midnight, or null for malformed or impossible days like 2026-02-30.
export function parseDay(value) {
  if (typeof value !== 'string' || !DAY_RE.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

export const dayString = (date) => date.toISOString().slice(0, 10);

// 12345050 -> "1,23,450.50" (Indian digit grouping), built from integers so it is always exact.
export function formatPaise(paise, { grouping = true } = {}) {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  const rupees = Math.trunc(abs / 100);
  const fraction = String(abs % 100).padStart(2, '0');
  const whole = grouping ? rupees.toLocaleString('en-IN') : String(rupees);
  return `${sign}${whole}.${fraction}`;
}

// Calendar months as "YYYY-MM".
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const isMonth = (value) => typeof value === 'string' && MONTH_RE.test(value);
export const currentMonth = (now = new Date()) => dayString(now).slice(0, 7);
export function shiftMonth(month, n) {
  const [y, m] = month.split('-').map(Number);
  return dayString(new Date(Date.UTC(y, m - 1 + n, 1))).slice(0, 7);
}
// First and last day of a month, as UTC-midnight Dates (the same form transaction dates use).
export function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 0)) };
}

// Latest day an entry may have: tomorrow in UTC, which covers "today" in every Indian time zone.
export const latestAllowedDay = (now = new Date()) => dayString(new Date(now.getTime() + 24 * 60 * 60 * 1000));

// Calendar helpers on "YYYY-MM-DD" / "YYYY-MM" strings, using the device's local date.
import { t } from './i18n.js';

const pad = (n) => String(n).padStart(2, '0');
const toDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const today = () => toDay(new Date());
export const currentMonth = () => today().slice(0, 7);

export function shiftMonth(month, n) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function monthBounds(month) {
  const [y, m] = month.split('-').map(Number);
  return { from: `${month}-01`, to: toDay(new Date(y, m, 0)) };
}

export function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  return toDay(new Date(y, m - 1, d + n));
}

// India's financial year runs April to March: "2026-27" for 1 Apr 2026 to 31 Mar 2027.
export function fyOf(day) {
  const [y, m] = day.split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${pad((start + 1) % 100)}`;
}
export const fyBounds = (fy) => ({ from: `${fy.slice(0, 4)}-04-01`, to: `${Number(fy.slice(0, 4)) + 1}-03-31` });
const lastFy = () => fyOf(addDays(fyBounds(fyOf(today())).from, -1));

// Date-range shortcuts for the transaction filters.
export const DATE_PRESETS = [
  { id: 'this-month', label: t('This month'), range: () => monthBounds(currentMonth()) },
  { id: 'last-month', label: t('Last month'), range: () => monthBounds(shiftMonth(currentMonth(), -1)) },
  { id: 'last-3-months', label: t('Last 3 months'), range: () => ({ from: monthBounds(shiftMonth(currentMonth(), -2)).from, to: today() }) },
  { id: 'this-year', label: t('This year'), range: () => ({ from: `${today().slice(0, 4)}-01-01`, to: today() }) },
  { id: 'this-fy', label: t('This financial year ({fy})', { fy: fyOf(today()) }), range: () => ({ from: fyBounds(fyOf(today())).from, to: today() }) },
  { id: 'last-fy', label: t('Last financial year ({fy})', { fy: lastFy() }), range: () => fyBounds(lastFy()) },
  { id: 'all', label: t('All time'), range: () => ({ from: '', to: '' }) },
  { id: 'custom', label: t('Custom range'), range: null },
];

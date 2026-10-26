// Date maths for recurring rules. Every occurrence is computed from the start date and its index,
// never from the previous occurrence, so "monthly on the 31st" stays on the 31st after a short month.
import { parseDay } from './money.js';

export const FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'];

// Day `d` of month `m` (any integer; 12 = next January), clamped to the month's last day.
function clampedDay(y, m, d) {
  const first = new Date(Date.UTC(y, m, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last)));
}

export function occurrenceDate(startDate, frequency, interval, index) {
  const y = startDate.getUTCFullYear();
  const m = startDate.getUTCMonth();
  const d = startDate.getUTCDate();
  const step = index * interval;
  switch (frequency) {
    case 'daily': return new Date(Date.UTC(y, m, d + step));
    case 'weekly': return new Date(Date.UTC(y, m, d + 7 * step));
    case 'monthly': return clampedDay(y, m + step, d);
    case 'yearly': return clampedDay(y + step, m, d);
    default: throw new Error(`Unknown frequency ${frequency}`);
  }
}

// Today's calendar day in the app's time zone, as a UTC-midnight Date like every stored date.
export function todayIn(timeZone, now = new Date()) {
  // en-CA formats as YYYY-MM-DD.
  return parseDay(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now));
}

export const addDays = (date, days) => new Date(date.getTime() + days * 24 * 60 * 60 * 1000);

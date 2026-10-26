// Display formatting with the Intl API: Indian grouping (₹1,23,456.00, ₹1.2L) or, if chosen in Settings,
// international grouping (₹123,456.00, ₹1.2M). Dates follow the app's language (12 अक्टू॰ 2026 in Hindi).
import { numberStyle } from './prefs.js';
import { k, language, localeTag, t } from './i18n.js';

const locale = numberStyle() === 'international' ? 'en-US' : 'en-IN';
const inr = new Intl.NumberFormat(locale, { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inrWhole = new Intl.NumberFormat(locale, { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 });
// Other currencies (foreign entries): "$12.50", "€10.00".
export const formatMoney = (amount, currency) =>
  new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);

export const formatINR = (paise) => inr.format(paise / 100);
export const formatINRWhole = (paise) => inrWhole.format(Math.round(paise / 100));
// Chart axes: ₹1.2L, ₹3Cr.
export const formatINRCompact = (rupees) => `₹${compact.format(rupees)}`;

const dateLocale = localeTag();
const dayFmt = new Intl.DateTimeFormat(dateLocale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const dayShortFmt = new Intl.DateTimeFormat(dateLocale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
const monthFmt = new Intl.DateTimeFormat(dateLocale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
const monthShortFmt = new Intl.DateTimeFormat(dateLocale, { month: 'short', timeZone: 'UTC' });

// API days are "YYYY-MM-DD"; formatting in UTC keeps the same calendar day everywhere.
const asDate = (day) => new Date(`${day}T00:00:00Z`);
export const formatDay = (day) => dayFmt.format(asDate(day));
export const formatDayShort = (day) => dayShortFmt.format(asDate(day));
export const formatMonth = (month) => monthFmt.format(asDate(`${month}-01`));
export const formatMonthShort = (month) => monthShortFmt.format(asDate(`${month}-01`));
// A moment in time ("25 Oct 2026, 1:33 am"), in the app's language.
export const formatWhen = (d) => new Intl.DateTimeFormat(dateLocale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(d));

// "15th" in English; just "15" in Hindi, where the sentence says तारीख़.
export const ordinal = (n) => {
  if (language() === 'hi') return String(n);
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

const EVERY_ONE = { day: k('Every day'), week: k('Every week'), month: k('Every month'), year: k('Every year') };
const EVERY_MANY = { day: k('Every {n} days'), week: k('Every {n} weeks'), month: k('Every {n} months'), year: k('Every {n} years') };

// "Every month on the 31st", "Every 2 weeks on Thursday".
export function describeSchedule({ frequency, interval, startDate }) {
  const start = asDate(startDate);
  const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[frequency];
  const every = interval === 1 ? t(EVERY_ONE[unit]) : t(EVERY_MANY[unit], { n: interval });
  if (frequency === 'weekly') return t('{every} on {day}', { every, day: start.toLocaleDateString(dateLocale, { weekday: 'long', timeZone: 'UTC' }) });
  if (frequency === 'monthly') return t('{every} on the {nth}', { every, nth: ordinal(start.getUTCDate()) });
  if (frequency === 'yearly') return t('{every} on {day}', { every, day: dayShortFmt.format(start) });
  return every;
}

export function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 12) return t('Good morning');
  if (h < 17) return t('Good afternoon');
  return t('Good evening');
}

// Batch 12F: insights computed from a space's real entries. Nothing here is stored or estimated from
// outside data except the official CPI (cpi.service). Amounts are integer paise throughout.
import mongoose from 'mongoose';
import { HttpError } from '../errors.js';
import { config } from '../config.js';
import { Bill, Loan, RecurringRule, Transaction } from '../models/index.js';
import { currentMonth, dayString, monthRange, shiftMonth } from '../money.js';
import { addDays, occurrenceDate, todayIn } from '../schedule.js';
import { list as listBills } from './bill.service.js';
import { list as listLoans } from './loan.service.js';
import { list as monthBudgets } from './budget.service.js';
import { upcoming as upcomingRecurring } from './recurring.service.js';
import { cpiTable } from './cpi.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const money = (paise) => (paise === null || paise === undefined ? null : { paise, rupees: paise / 100 });
const sum = (rows) => rows.reduce((s, t) => s + t.amountPaise, 0);
const today = () => todayIn(config.timeZone);
const daysBetween = (a, b) => Math.round((b - a) / DAY_MS);
const pct = (part, whole) => (whole ? Math.round((part * 1000) / whole) / 10 : null);
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const weekdayOf = (d) => (d.getUTCDay() + 6) % 7;
const MAX_RANGE_DAYS = 3 * 366;

function checkRange(from, to) {
  if (to < from) throw new HttpError(400, 'validation_failed', 'Some fields are missing or invalid', [{ field: 'to', message: 'The end date must be on or after the start date' }]);
  if (daysBetween(from, to) > MAX_RANGE_DAYS) throw new HttpError(400, 'validation_failed', 'Some fields are missing or invalid', [{ field: 'from', message: 'Pick a range of at most 3 years' }]);
}

// Live expenses between two days (inclusive), each split bill broken into its parts.
export async function expenses(spaceId, from, to) {
  const docs = await Transaction.find(
    { space: spaceId, deletedAt: null, type: 'expense', date: { $gte: from, $lte: to } },
    { date: 1, time: 1, amountPaise: 1, category: 1, splits: 1, merchant: 1, note: 1, recurringRule: 1, worth: 1, account: 1, tags: 1, paymentMethod: 1, user: 1 },
  ).lean();
  return docs.flatMap((t) => (t.splits?.length ? t.splits.map((s) => ({ ...t, category: s.category, amountPaise: s.amountPaise })) : [t]));
}

// Fixed costs: entries made by recurring rules, or recorded when a bill or an EMI was paid.
// Forecasts, streaks and challenges look at the rest (day-to-day spending).
export async function fixedIds(spaceId) {
  const [bills, loans] = await Promise.all([
    Bill.find({ space: spaceId }, { 'payments.transaction': 1 }).lean(),
    Loan.find({ space: spaceId }, { 'payments.transaction': 1 }).lean(),
  ]);
  return new Set([...bills, ...loans].flatMap((x) => x.payments.map((p) => p.transaction).filter(Boolean).map(String)));
}
export const isFixed = (t, fixed) => Boolean(t.recurringRule) || fixed.has(String(t._id));

async function firstEntryDate(spaceId) {
  return (await Transaction.findOne({ space: spaceId, deletedAt: null }, { date: 1 }).sort({ date: 1 }).lean())?.date ?? null;
}

// Monthly or yearly lump payments aren't day-to-day spending: averaging them into a daily rate would make
// every future day look expensive. They belong on the calendar as bills or recurring entries.
export const LUMP_CATEGORIES = new Set(['Rent', 'EMI & Loans', 'Insurance', 'Investments', 'Bills & Utilities']);
export const ONE_OFF_FROM = 1_000_000; // ₹10,000 or more in one go counts as a one-off
const isDayToDay = (t, fixed) => !isFixed(t, fixed) && !LUMP_CATEGORIES.has(t.category) && t.amountPaise < ONE_OFF_FROM;

// Usual day-to-day spending per day (paise): the last 3 complete months (from the first entry, if that's
// later), leaving out fixed costs, lump payments and one-offs; with under 2 weeks of history, this month so far.
export async function dayToDayRate(spaceId, known = {}) {
  const now = known.now ?? today();
  const month = currentMonth(now);
  const from = monthRange(month).from;
  const [fixed, first] = await Promise.all([known.fixed ?? fixedIds(spaceId), known.first !== undefined ? known.first : firstEntryDate(spaceId)]);
  const histTo = addDays(from, -1);
  const histFrom = first && first > monthRange(shiftMonth(month, -3)).from ? first : monthRange(shiftMonth(month, -3)).from;
  const histDays = daysBetween(histFrom, histTo) + 1;
  if (histDays >= 14) {
    const hist = (await expenses(spaceId, histFrom, histTo)).filter((t) => isDayToDay(t, fixed));
    return { method: 'history', days: histDays, from: dayString(histFrom), to: dayString(histTo), perDay: Math.round(sum(hist) / histDays) };
  }
  const thisMonth = known.thisMonth ?? await expenses(spaceId, from, now);
  const variable = thisMonth.filter((t) => isDayToDay(t, fixed));
  return { method: 'this-month', days: now.getUTCDate(), perDay: Math.round(sum(variable) / now.getUTCDate()) };
}

// Where this month is heading: spent so far, plus day-to-day spending at your usual daily rate for the
// days left, plus recurring entries, bills and EMIs still due this month.
export async function forecast(spaceId) {
  const now = today();
  const month = currentMonth(now);
  const { from, to } = monthRange(month);
  const daysInMonth = to.getUTCDate();
  const dayOfMonth = now.getUTCDate();
  const daysLeft = daysInMonth - dayOfMonth;
  const [fixed, thisMonth, first] = await Promise.all([fixedIds(spaceId), expenses(spaceId, from, now), firstEntryDate(spaceId)]);
  const spent = sum(thisMonth);

  const basis = await dayToDayRate(spaceId, { now, fixed, first, thisMonth });
  const expectedVariable = basis.perDay * daysLeft;

  const end = dayString(to);
  const [recurring, bills, loans] = await Promise.all([
    upcomingRecurring(spaceId, { days: daysLeft }),
    listBills(spaceId),
    listLoans(spaceId),
  ]);
  const scheduled = [
    ...recurring.items.filter((r) => r.type === 'expense' && r.date <= end && r.date > dayString(now))
      .map((r) => ({ kind: 'recurring', name: r.note || r.category, date: r.date, amount: money(r.amountPaise) })),
    ...bills.filter((b) => b.active && b.nextDue && b.nextDue <= end)
      .map((b) => ({ kind: 'bill', name: b.name, date: b.nextDue, amount: b.amount ?? (b.payments.find((p) => !p.skipped)?.amount ?? null) })),
    ...loans.filter((l) => !l.closed && l.nextEmiDate && l.nextEmiDate <= end)
      .map((l) => ({ kind: 'emi', name: l.name, date: l.nextEmiDate, amount: l.emi })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const scheduledTotal = scheduled.reduce((s, x) => s + (x.amount?.paise ?? 0), 0);
  const total = spent + expectedVariable + scheduledTotal;

  const [lastMonth, budgets] = await Promise.all([
    expenses(spaceId, monthRange(shiftMonth(month, -1)).from, monthRange(shiftMonth(month, -1)).to),
    monthBudgets(spaceId, { month }),
  ]);
  const budget = budgets.overall?.limit.paise ?? null;
  return {
    month,
    daysLeft,
    spent: money(spent),
    expectedDayToDay: money(expectedVariable),
    scheduled,
    scheduledTotal: money(scheduledTotal),
    forecast: money(total),
    basis: { ...basis, perDay: money(basis.perDay) },
    lastMonth: money(sum(lastMonth)),
    budget: money(budget),
    // Positive when the month is heading past the overall budget.
    overBudgetBy: budget === null ? null : money(total - budget),
  };
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2)) : 0;
};

// Categories running well above your 3-month average (by pace, so mid-month counts fairly), and single
// expenses far bigger than usual for their category.
export async function unusual(spaceId, { month } = {}) {
  const now = today();
  const m = month ?? currentMonth(now);
  const { from, to } = monthRange(m);
  const end = to < now ? to : now;
  const daysInMonth = to.getUTCDate();
  const elapsed = daysBetween(from, end) + 1;
  const [rows, base] = await Promise.all([
    expenses(spaceId, from, end),
    expenses(spaceId, monthRange(shiftMonth(m, -3)).from, addDays(from, -1)),
  ]);
  const baseMonths = new Set(base.map((t) => dayString(t.date).slice(0, 7)));
  const months = baseMonths.size;
  const totals = (list) => list.reduce((map, t) => map.set(t.category, (map.get(t.category) ?? 0) + t.amountPaise), new Map());
  const now_ = totals(rows);
  const before = totals(base);
  const categories = [];
  for (const [category, spent] of now_) {
    const average = months ? Math.round((before.get(category) ?? 0) / months) : null;
    const pace = elapsed >= 7 && end < to ? Math.round((spent / elapsed) * daysInMonth) : spent;
    if (average === null) continue;
    const isNew = average === 0;
    if ((isNew && spent >= 200_000) || (!isNew && pace >= average * 1.5 && pace - average >= 100_000)) {
      categories.push({ category, spent: money(spent), average: money(average), pace: money(pace), ratio: isNew ? null : Math.round((pace / average) * 10) / 10, isNew });
    }
  }
  categories.sort((a, b) => (b.pace.paise - (b.average.paise)) - (a.pace.paise - a.average.paise));

  const history = await expenses(spaceId, monthRange(shiftMonth(m, -6)).from, addDays(from, -1));
  const byCat = history.reduce((map, t) => map.set(t.category, [...(map.get(t.category) ?? []), t.amountPaise]), new Map());
  const transactions = rows
    .filter((t) => (byCat.get(t.category)?.length ?? 0) >= 3 && t.amountPaise >= Math.max(200_000, 3 * median(byCat.get(t.category))))
    .sort((a, b) => b.amountPaise - a.amountPaise)
    .slice(0, 10)
    .map((t) => ({ id: String(t._id), date: dayString(t.date), category: t.category, note: t.note, merchant: t.merchant ?? null, amount: money(t.amountPaise), usual: money(median(byCat.get(t.category))) }));
  return { month: m, baselineMonths: months, categories, transactions };
}

// Income, spending and the share of income kept, month by month.
export async function savingsRate(spaceId, { months = 12 } = {}) {
  const now = today();
  const last = currentMonth(now);
  const first = shiftMonth(last, -(months - 1));
  const rows = await Transaction.aggregate([
    { $match: { space: new mongoose.Types.ObjectId(String(spaceId)), deletedAt: null, type: { $in: ['income', 'expense'] }, date: { $gte: monthRange(first).from, $lte: monthRange(last).to } } },
    { $group: { _id: { m: { $dateToString: { format: '%Y-%m', date: '$date' } }, t: '$type' }, total: { $sum: '$amountPaise' } } },
  ]);
  const get = (m, t) => rows.find((r) => r._id.m === m && r._id.t === t)?.total ?? 0;
  const series = Array.from({ length: months }, (_, i) => {
    const m = shiftMonth(first, i);
    const income = get(m, 'income');
    const expense = get(m, 'expense');
    return { month: m, income: money(income), expense: money(expense), saved: money(income - expense), rate: pct(income - expense, income), partial: m === last };
  });
  const complete = series.filter((s) => !s.partial && s.rate !== null);
  const avg = (xs) => (xs.length ? Math.round((xs.reduce((s, x) => s + x.rate, 0) / xs.length) * 10) / 10 : null);
  const recent = avg(complete.slice(-3));
  const earlier = avg(complete.slice(-6, -3));
  return { months: series, averageRate: avg(complete), recentRate: recent, earlierRate: earlier, trend: recent !== null && earlier !== null ? Math.round((recent - earlier) * 10) / 10 : null };
}

// When money goes out: by day of the week, and by time of day for entries that have a time.
export async function patterns(spaceId, { from, to }) {
  checkRange(from, to);
  const rows = await expenses(spaceId, from, to);
  const occurrences = Array(7).fill(0);
  for (let d = from; d <= to; d = addDays(d, 1)) occurrences[weekdayOf(d)] += 1;
  const byDay = Array.from({ length: 7 }, () => ({ total: 0, count: 0 }));
  for (const t of rows) { const w = weekdayOf(t.date); byDay[w].total += t.amountPaise; byDay[w].count += 1; }
  const total = sum(rows);
  const weekend = byDay[5].total + byDay[6].total;
  const timed = rows.filter((t) => t.time);
  const hours = Array.from({ length: 24 }, () => 0);
  for (const t of timed) hours[Number(t.time.slice(0, 2))] += t.amountPaise;
  const buckets = [['Morning', 5, 12], ['Afternoon', 12, 17], ['Evening', 17, 21], ['Night', 21, 29]].map(([name, a, b]) => {
    const inBucket = timed.filter((t) => { const h = Number(t.time.slice(0, 2)); const hh = h < 5 ? h + 24 : h; return hh >= a && hh < b; });
    return { name, total: money(sum(inBucket)), count: inBucket.length, share: pct(sum(inBucket), sum(timed)) };
  });
  return {
    from: dayString(from), to: dayString(to), total: money(total),
    weekdays: byDay.map((d, i) => ({ day: WEEKDAYS[i], total: money(d.total), count: d.count, perDay: money(occurrences[i] ? Math.round(d.total / occurrences[i]) : 0), share: pct(d.total, total) })),
    weekendShare: pct(weekend, total),
    timeOfDay: { entriesWithTime: timed.length, entries: rows.length, buckets, hours: hours.map((p, h) => ({ hour: h, total: money(p) })) },
  };
}

// Two periods side by side, overall and per category.
export async function compare(spaceId, { aFrom, aTo, bFrom, bTo }) {
  checkRange(aFrom, aTo);
  checkRange(bFrom, bTo);
  const totalsOf = async (from, to) => {
    const rows = await Transaction.aggregate([
      { $match: { space: new mongoose.Types.ObjectId(String(spaceId)), deletedAt: null, type: { $in: ['income', 'expense'] }, date: { $gte: from, $lte: to } } },
      { $group: { _id: '$type', total: { $sum: '$amountPaise' } } },
    ]);
    const cats = (await expenses(spaceId, from, to)).reduce((m, t) => m.set(t.category, (m.get(t.category) ?? 0) + t.amountPaise), new Map());
    return { income: rows.find((r) => r._id === 'income')?.total ?? 0, expense: rows.find((r) => r._id === 'expense')?.total ?? 0, cats, days: daysBetween(from, to) + 1 };
  };
  const [a, b] = await Promise.all([totalsOf(aFrom, aTo), totalsOf(bFrom, bTo)]);
  const names = new Set([...a.cats.keys(), ...b.cats.keys()]);
  const categories = [...names].map((c) => {
    const x = a.cats.get(c) ?? 0;
    const y = b.cats.get(c) ?? 0;
    return { category: c, a: money(x), b: money(y), change: money(y - x), changePct: x ? pct(y - x, x) : null };
  }).sort((p, q) => Math.abs(q.change.paise) - Math.abs(p.change.paise));
  const side = (s, from, to) => ({ from: dayString(from), to: dayString(to), days: s.days, income: money(s.income), expense: money(s.expense), perDay: money(Math.round(s.expense / s.days)) });
  return { a: side(a, aFrom, aTo), b: side(b, bFrom, bTo), expenseChange: money(b.expense - a.expense), expenseChangePct: a.expense ? pct(b.expense - a.expense, a.expense) : null, categories };
}

// Spending per merchant (from imported statements, or typed in the Merchant field).
export async function merchants(spaceId, { from, to }) {
  checkRange(from, to);
  const rows = await expenses(spaceId, from, to);
  // Oldest first, so a merchant is shown with the spelling first used for it.
  const named = rows.filter((t) => t.merchant).sort((a, b) => a.date - b.date);
  const map = new Map();
  for (const t of named) {
    const key = t.merchant.toLowerCase();
    const m = map.get(key) ?? { merchant: t.merchant, total: 0, count: 0, last: t.date, categories: new Map() };
    m.total += t.amountPaise;
    m.count += 1;
    if (t.date > m.last) m.last = t.date;
    m.categories.set(t.category, (m.categories.get(t.category) ?? 0) + t.amountPaise);
    map.set(key, m);
  }
  const total = sum(named);
  return {
    from: dayString(from), to: dayString(to),
    merchants: [...map.values()].sort((a, b) => b.total - a.total).map((m) => ({
      merchant: m.merchant, total: money(m.total), count: m.count, average: money(Math.round(m.total / m.count)), share: pct(m.total, total),
      lastDate: dayString(m.last), category: [...m.categories.entries()].sort((a, b) => b[1] - a[1])[0][0],
    })),
    withoutMerchant: { count: rows.length - named.length, total: money(sum(rows) - total) },
  };
}

// One merchant: month by month for a year, and its latest entries.
export async function merchant(spaceId, name) {
  const now = today();
  const first = shiftMonth(currentMonth(now), -11);
  const rows = (await expenses(spaceId, monthRange(first).from, now)).filter((t) => t.merchant?.toLowerCase() === name.toLowerCase());
  if (!rows.length) throw new HttpError(404, 'merchant_not_found', 'No spending with this merchant in the last year');
  return {
    merchant: rows[0].merchant,
    total: money(sum(rows)),
    months: Array.from({ length: 12 }, (_, i) => {
      const m = shiftMonth(first, i);
      return { month: m, total: money(sum(rows.filter((t) => dayString(t.date).startsWith(m)))) };
    }),
    recent: rows.sort((a, b) => b.date - a.date).slice(0, 20).map((t) => ({ id: String(t._id), date: dayString(t.date), category: t.category, note: t.note, amount: money(t.amountPaise) })),
  };
}

// Repeating charges: the same merchant or note at about the same price every month (or every year).
const subKey = (t) => (t.merchant
  ? t.merchant.toLowerCase()
  : (t.note ?? '').toLowerCase().replace(/[0-9]+/g, ' ').replace(/[^a-z& ]+/g, ' ').trim().split(/\s+/).slice(0, 3).join(' '));

export async function subscriptions(spaceId) {
  const now = today();
  const rows = (await Transaction.find(
    { space: spaceId, deletedAt: null, type: 'expense', date: { $gte: addDays(now, -400), $lte: now } },
    { date: 1, amountPaise: 1, category: 1, merchant: 1, note: 1 },
  ).lean()).filter((t) => subKey(t).length >= 3);
  const groups = rows.reduce((map, t) => map.set(subKey(t), [...(map.get(subKey(t)) ?? []), t]), new Map());
  const [rules, bills] = await Promise.all([RecurringRule.find({ space: spaceId, active: true }).lean(), Bill.find({ space: spaceId, active: true }).lean()]);
  const found = [];
  for (const [, all] of groups) {
    all.sort((a, b) => a.date - b.date);
    // Subscriptions keep one price: take the latest run of charges within 3% of the newest one
    // (a price rise starts a new run). Groceries or rides with varying bills never qualify.
    const latest = all.at(-1).amountPaise;
    let start = all.length - 1;
    while (start > 0 && Math.abs(all[start - 1].amountPaise - latest) <= latest * 0.03) start -= 1;
    const list = all.slice(start);
    if (list.length < 2) continue;
    const gaps = list.slice(1).map((t, i) => daysBetween(list[i].date, t.date));
    const gap = median(gaps);
    let cadence = null;
    if (list.length >= 3 && gap >= 26 && gap <= 35 && gaps.filter((g) => g >= 20 && g <= 40).length >= gaps.length * 0.7) cadence = 'monthly';
    else if (gap >= 350 && gap <= 380) cadence = 'yearly';
    if (!cadence) continue;
    const last = list.at(-1);
    const next = occurrenceDate(last.date, cadence === 'monthly' ? 'monthly' : 'yearly', 1, 1);
    const amount = last.amountPaise;
    const similar = (x) => x.category === last.category && Math.abs(x.amountPaise - amount) <= amount * 0.05;
    found.push({
      name: last.merchant ?? (last.note || last.category),
      category: last.category,
      cadence,
      amount: money(amount),
      count: list.length,
      firstDate: dayString(list[0].date),
      lastDate: dayString(last.date),
      nextExpected: dayString(next),
      yearlyCost: money(cadence === 'monthly' ? amount * 12 : amount),
      // Still being charged, judged by whether the next charge is overdue by more than a little.
      active: daysBetween(next, now) <= (cadence === 'monthly' ? 10 : 30),
      tracked: rules.some(similar) || bills.some((b) => b.category === last.category && b.amountPaise && Math.abs(b.amountPaise - amount) <= amount * 0.05),
    });
  }
  found.sort((a, b) => Number(b.active) - Number(a.active) || b.yearlyCost.paise - a.yearlyCost.paise);
  const active = found.filter((s) => s.active);
  return { subscriptions: found, activeYearlyCost: money(active.reduce((s, x) => s + x.yearlyCost.paise, 0)), activeMonthlyCost: money(Math.round(active.reduce((s, x) => s + x.yearlyCost.paise, 0) / 12)) };
}

// A year at a glance, compared with the year before.
export async function yearReview(spaceId, { year }) {
  const now = today();
  const from = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year, 11, 31));
  if (from > now) throw new HttpError(400, 'validation_failed', 'Some fields are missing or invalid', [{ field: 'year', message: 'That year has not started yet' }]);
  const to = yearEnd < now ? yearEnd : now;
  const totals = async (a, b) => {
    const r = await Transaction.aggregate([
      { $match: { space: new mongoose.Types.ObjectId(String(spaceId)), deletedAt: null, type: { $in: ['income', 'expense'] }, date: { $gte: a, $lte: b } } },
      { $group: { _id: '$type', total: { $sum: '$amountPaise' }, count: { $sum: 1 } } },
    ]);
    return { income: r.find((x) => x._id === 'income')?.total ?? 0, expense: r.find((x) => x._id === 'expense')?.total ?? 0, count: r.reduce((s, x) => s + x.count, 0) };
  };
  const [rows, fixed, cur, prev] = await Promise.all([
    expenses(spaceId, from, to), fixedIds(spaceId), totals(from, to),
    totals(new Date(Date.UTC(year - 1, 0, 1)), new Date(Date.UTC(year - 1, 11, 31))),
  ]);
  const byMonth = Array.from({ length: 12 }, (_, i) => sum(rows.filter((t) => t.date.getUTCMonth() === i)));
  const monthsSoFar = to.getUTCMonth() + 1;
  const active = byMonth.slice(0, monthsSoFar).map((total, i) => ({ month: `${year}-${String(i + 1).padStart(2, '0')}`, total })).filter((m) => m.total > 0);
  const cats = [...rows.reduce((m, t) => m.set(t.category, (m.get(t.category) ?? 0) + t.amountPaise), new Map())].sort((a, b) => b[1] - a[1]);
  const merch = [...rows.filter((t) => t.merchant).reduce((m, t) => m.set(t.merchant, (m.get(t.merchant) ?? 0) + t.amountPaise), new Map())].sort((a, b) => b[1] - a[1]);
  const spendDays = new Set(rows.filter((t) => !isFixed(t, fixed)).map((t) => dayString(t.date)));
  const days = daysBetween(from, to) + 1;
  const biggest = rows.reduce((b, t) => (!b || t.amountPaise > b.amountPaise ? t : b), null);
  return {
    year, from: dayString(from), to: dayString(to), complete: to.getTime() === yearEnd.getTime(),
    income: money(cur.income), expense: money(cur.expense), saved: money(cur.income - cur.expense), savingsRate: pct(cur.income - cur.expense, cur.income), entries: cur.count,
    previous: { income: money(prev.income), expense: money(prev.expense), expenseChangePct: prev.expense ? pct(cur.expense - prev.expense, prev.expense) : null },
    months: byMonth.map((total, i) => ({ month: `${year}-${String(i + 1).padStart(2, '0')}`, total: money(total) })),
    busiestMonth: active.length ? { month: active.reduce((a, b) => (b.total > a.total ? b : a)).month, total: money(Math.max(...active.map((m) => m.total))) } : null,
    lightestMonth: active.length ? { month: active.reduce((a, b) => (b.total < a.total ? b : a)).month, total: money(Math.min(...active.map((m) => m.total))) } : null,
    perDay: money(Math.round(cur.expense / days)),
    topCategories: cats.slice(0, 5).map(([category, total]) => ({ category, total: money(total), share: pct(total, cur.expense) })),
    topMerchants: merch.slice(0, 5).map(([name, total]) => ({ merchant: name, total: money(total) })),
    biggest: biggest ? { date: dayString(biggest.date), category: biggest.category, note: biggest.note, amount: money(biggest.amountPaise) } : null,
    noSpendDays: days - spendDays.size,
  };
}

// Monthly spending in today's prices, using India's official CPI: an amount spent in month m is
// worth amount × CPI(latest) / CPI(m) now. Months newer than the latest published CPI use it as is.
export async function inflation(spaceId, { months = 24 } = {}) {
  const now = today();
  const last = currentMonth(now);
  const first = shiftMonth(last, -(months - 1));
  const [rows, cpi] = await Promise.all([expenses(spaceId, monthRange(first).from, now), cpiTable()]);
  const latest = cpi.index.get(cpi.latestMonth);
  const series = Array.from({ length: months }, (_, i) => {
    const m = shiftMonth(first, i);
    const nominal = sum(rows.filter((t) => dayString(t.date).startsWith(m)));
    const idx = cpi.index.get(m) ?? null;
    const factor = idx ? latest / idx : 1;
    return { month: m, spent: money(nominal), cpi: idx, inTodaysPrices: money(Math.round(nominal * factor)), published: Boolean(idx) };
  });
  const yoy = cpi.index.get(cpi.latestMonth) && cpi.index.get(shiftMonth(cpi.latestMonth, -12))
    ? Math.round((cpi.index.get(cpi.latestMonth) / cpi.index.get(shiftMonth(cpi.latestMonth, -12)) - 1) * 1000) / 10 : null;
  return {
    months: series,
    priceMonth: cpi.latestMonth,
    inflationLastYear: yoy,
    source: cpi.source,
    fetchedAt: cpi.fetchedAt,
  };
}

// "Was it worth it?": how much of the rated spending you'd rather not have spent, and where.
export async function regret(spaceId, { months = 3 } = {}) {
  const now = today();
  const from = monthRange(shiftMonth(currentMonth(now), -(months - 1))).from;
  const rows = await expenses(spaceId, from, now);
  const rated = rows.filter((t) => t.worth);
  const no = rated.filter((t) => t.worth === 'no');
  const group = (list, key) => [...list.reduce((m, t) => m.set(key(t), (m.get(key(t)) ?? 0) + t.amountPaise), new Map())]
    .sort((a, b) => b[1] - a[1]).slice(0, 5);
  const regretShareBy = (cat) => {
    const ratedCat = sum(rated.filter((t) => t.category === cat));
    return pct(sum(no.filter((t) => t.category === cat)), ratedCat);
  };
  return {
    from: dayString(from), to: dayString(now),
    entries: rows.length,
    rated: rated.length,
    counts: { yes: rated.filter((t) => t.worth === 'yes').length, meh: rated.filter((t) => t.worth === 'meh').length, no: no.length },
    notWorthIt: money(sum(no)),
    notWorthItShare: pct(sum(no), sum(rated)),
    categories: group(no, (t) => t.category).map(([category, total]) => ({ category, total: money(total), shareOfRated: regretShareBy(category) })),
    merchants: group(no.filter((t) => t.merchant || t.note), (t) => t.merchant || t.note).map(([name, total]) => ({ name, total: money(total) })),
    examples: no.sort((a, b) => b.amountPaise - a.amountPaise).slice(0, 5).map((t) => ({ id: String(t._id), date: dayString(t.date), category: t.category, note: t.note, merchant: t.merchant ?? null, amount: money(t.amountPaise) })),
  };
}

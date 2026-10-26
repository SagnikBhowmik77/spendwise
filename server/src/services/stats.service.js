import { HttpError } from '../errors.js';
import { Transaction } from '../models/index.js';
import { dayString, parseDay } from '../money.js';
import { buildFilter, explodeSplits } from './transaction.service.js';

// Match the filters; split entries are broken into their parts when grouping by category,
// or when a category filter should count only the matching part of a split.
const matchStages = (spaceId, query, { byCategory = false } = {}) => [
  { $match: buildFilter(spaceId, query) },
  ...(byCategory || query.category?.length ? explodeSplits(query.category) : []),
];

// All totals are summed as integer paise inside MongoDB; rupee values are derived only for display.
// Transfers between your own accounts are never part of these totals (buildFilter leaves them out).
export const MAX_MONTHS = 60;
export const MAX_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;

const withRupees = (paise) => ({ paise, rupees: paise / 100 });

export async function summary(spaceId, query) {
  const rows = await Transaction.aggregate([
    ...matchStages(spaceId, query),
    { $group: { _id: '$type', total: { $sum: '$amountPaise' }, count: { $sum: 1 } } },
  ]);
  const totals = { income: 0, expense: 0 };
  for (const r of rows) totals[r._id] = r.total;
  return {
    income: withRupees(totals.income),
    expense: withRupees(totals.expense),
    balance: withRupees(totals.income - totals.expense),
    count: rows.reduce((n, r) => n + r.count, 0),
  };
}

async function shares(spaceId, query, groupBy, label) {
  const rows = await Transaction.aggregate([
    ...matchStages(spaceId, query, { byCategory: groupBy === '$category' }),
    { $group: { _id: groupBy, total: { $sum: '$amountPaise' }, count: { $sum: 1 } } },
    { $sort: { total: -1, _id: 1 } },
  ]);
  const grand = rows.reduce((sum, r) => sum + r.total, 0);
  return {
    type: query.type,
    total: withRupees(grand),
    rows: rows.map((r) => ({
      [label]: r._id,
      total: withRupees(r.total),
      count: r.count,
      // Percentage of this type's total, to one decimal place.
      share: grand ? Math.round((r.total * 1000) / grand) / 10 : 0,
    })),
  };
}

export async function byCategory(spaceId, query) {
  const { rows, ...rest } = await shares(spaceId, query, '$category', 'category');
  return { ...rest, categories: rows };
}

// UPI vs card vs cash vs net banking. Entries without a method are grouped as "unspecified".
export async function byPaymentMethod(spaceId, query) {
  const { rows, ...rest } = await shares(spaceId, query, { $ifNull: ['$paymentMethod', 'unspecified'] }, 'method');
  return { ...rest, methods: rows };
}

const monthKey = (date) => dayString(date).slice(0, 7);
const firstOfMonth = (date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
const addMonths = (date, n) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + n, 1));
const today = () => parseDay(dayString(new Date()));

// Income vs expense per calendar month. Default: the last 12 months up to this month.
export async function monthly(spaceId, query) {
  const to = query.to ?? today();
  const from = query.from ?? addMonths(firstOfMonth(to), -11);
  const months = [];
  for (let m = firstOfMonth(from); m <= to; m = addMonths(m, 1)) {
    months.push(monthKey(m));
    if (months.length > MAX_MONTHS) {
      throw new HttpError(400, 'range_too_large', `Monthly trends cover at most ${MAX_MONTHS} months`);
    }
  }
  const rows = await Transaction.aggregate([
    ...matchStages(spaceId, { ...query, from, to }),
    {
      $group: {
        _id: { key: { $dateToString: { format: '%Y-%m', date: '$date' } }, type: '$type' },
        total: { $sum: '$amountPaise' },
      },
    },
  ]);
  return { from: dayString(from), to: dayString(to), months: fillSeries(months, rows, 'month') };
}

// Income vs expense per day, for line charts. Default: the last 30 days.
export async function daily(spaceId, query) {
  const to = query.to ?? today();
  const from = query.from ?? new Date(to.getTime() - 29 * DAY_MS);
  const days = [];
  for (let d = from; d <= to; d = new Date(d.getTime() + DAY_MS)) {
    days.push(dayString(d));
    if (days.length > MAX_DAYS) throw new HttpError(400, 'range_too_large', `Daily trends cover at most ${MAX_DAYS} days`);
  }
  const rows = await Transaction.aggregate([
    ...matchStages(spaceId, { ...query, from, to }),
    {
      $group: {
        _id: { key: { $dateToString: { format: '%Y-%m-%d', date: '$date' } }, type: '$type' },
        total: { $sum: '$amountPaise' },
      },
    },
  ]);
  return { from: dayString(from), to: dayString(to), days: fillSeries(days, rows, 'date') };
}

// Every period appears, including ones with no entries (they really are ₹0).
function fillSeries(keys, rows, label) {
  const byKey = new Map(keys.map((k) => [k, { income: 0, expense: 0 }]));
  for (const r of rows) byKey.get(r._id.key)[r._id.type] += r.total;
  return keys.map((k) => {
    const { income, expense } = byKey.get(k);
    return {
      [label]: k,
      income: withRupees(income),
      expense: withRupees(expense),
      balance: withRupees(income - expense),
    };
  });
}

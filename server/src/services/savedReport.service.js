// Custom reports: filters + a grouping + a period, saved by name and run on demand.
import mongoose from 'mongoose';
import { HttpError } from '../errors.js';
import { config } from '../config.js';
import { Account, SavedReport, Transaction } from '../models/index.js';
import { currentMonth, dayString, monthRange, shiftMonth } from '../money.js';
import { addDays, todayIn } from '../schedule.js';
import { fyOf, fyRange } from '../tax.js';
import { buildFilter, explodeSplits } from './transaction.service.js';

const NOT_FOUND = () => new HttpError(404, 'report_not_found', 'Report not found');
const money = (paise) => ({ paise, rupees: paise / 100 });
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function periodRange(period, { from, to } = {}, now = todayIn(config.timeZone)) {
  const month = currentMonth(now);
  switch (period) {
    case 'this-month': return { from: monthRange(month).from, to: now };
    case 'last-month': return monthRange(shiftMonth(month, -1));
    case 'last-3-months': return { from: monthRange(shiftMonth(month, -2)).from, to: now };
    case 'last-6-months': return { from: monthRange(shiftMonth(month, -5)).from, to: now };
    case 'this-year': return { from: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)), to: now };
    case 'last-12-months': return { from: monthRange(shiftMonth(month, -11)).from, to: now };
    // Indian financial year, April to March.
    case 'this-fy': return { from: fyRange(fyOf(now)).from, to: now };
    case 'last-fy': return fyRange(fyOf(addDays(fyRange(fyOf(now)).from, -1)));
    default: return { from, to };
  }
}

const GROUP_KEYS = {
  category: '$category',
  month: { $dateToString: { format: '%Y-%m', date: '$date' } },
  merchant: { $ifNull: ['$merchant', '(no merchant)'] },
  tag: '$tags',
  account: '$account',
  paymentMethod: { $ifNull: ['$paymentMethod', 'unspecified'] },
  weekday: { $isoDayOfWeek: '$date' },
};

// Runs a report (saved or not yet saved): rows of { key, label, total, count, share }.
export async function run(spaceId, { groupBy, period, from, to, filters = {} }) {
  const range = periodRange(period, { from, to });
  if (!range.from || !range.to || range.to < range.from) {
    throw new HttpError(400, 'validation_failed', 'Some fields are missing or invalid', [{ field: 'to', message: 'Pick a start and end date, the end on or after the start' }]);
  }
  const match = buildFilter(spaceId, { ...filters, type: filters.type ?? undefined, account: filters.account ? String(filters.account) : undefined, from: range.from, to: range.to });
  const rows = await Transaction.aggregate([
    { $match: match },
    ...(groupBy === 'category' || filters.category?.length ? explodeSplits(filters.category) : []),
    ...(groupBy === 'tag' ? [{ $unwind: { path: '$tags', preserveNullAndEmptyArrays: true } }, { $set: { tags: { $ifNull: ['$tags', '(no tag)'] } } }] : []),
    { $group: { _id: GROUP_KEYS[groupBy], total: { $sum: '$amountPaise' }, count: { $sum: 1 } } },
  ]);
  const names = groupBy === 'account'
    ? new Map((await Account.find({ space: spaceId }, { name: 1 }).lean()).map((a) => [String(a._id), a.name])) : null;
  const label = (k) => {
    if (groupBy === 'account') return names.get(String(k)) ?? 'Deleted account';
    if (groupBy === 'weekday') return WEEKDAYS[k - 1];
    if (groupBy === 'tag' && k !== '(no tag)') return `#${k}`;
    return String(k);
  };
  const total = rows.reduce((s, r) => s + r.total, 0);
  const ordered = groupBy === 'month' || groupBy === 'weekday'
    ? rows.sort((a, b) => (a._id < b._id ? -1 : 1))
    : rows.sort((a, b) => b.total - a.total);
  return {
    from: dayString(range.from), to: dayString(range.to), total: money(total),
    rows: ordered.map((r) => ({ key: String(r._id), label: label(r._id), total: money(r.total), count: r.count, share: total ? Math.round((r.total * 1000) / total) / 10 : 0 })),
  };
}

const serialize = (r) => ({
  id: String(r._id), name: r.name, groupBy: r.groupBy, period: r.period,
  from: r.from ? dayString(r.from) : null, to: r.to ? dayString(r.to) : null,
  filters: { type: r.filters?.type ?? null, category: r.filters?.category ?? [], account: r.filters?.account ? String(r.filters.account) : null, tag: r.filters?.tag ?? null, paymentMethod: r.filters?.paymentMethod ?? null, q: r.filters?.q ?? null },
  updatedAt: r.updatedAt,
});

export async function list(spaceId) {
  return (await SavedReport.find({ space: spaceId }).sort({ name: 1 }).lean()).map(serialize);
}

async function owned(spaceId, id) {
  if (!mongoose.isValidObjectId(id)) throw NOT_FOUND();
  const r = await SavedReport.findOne({ _id: id, space: spaceId });
  if (!r) throw NOT_FOUND();
  return r;
}

export async function create({ space, user }, body) {
  await run(space._id, body); // checks the period and filters before saving
  return serialize(await SavedReport.create({ ...body, space: space._id, createdBy: user._id }));
}

export async function update(spaceId, id, body) {
  const r = await owned(spaceId, id);
  Object.assign(r, body);
  await run(spaceId, r.toObject());
  await r.save();
  return serialize(r);
}

export async function remove(spaceId, id) {
  await SavedReport.deleteOne({ _id: (await owned(spaceId, id))._id });
}

export async function runSaved(spaceId, id) {
  const r = (await owned(spaceId, id)).toObject();
  return { report: serialize(r), ...(await run(spaceId, r)) };
}

// Batch 12O: envelopes, sinking funds and the wishlist. Spending and income come from the space's real entries.
import mongoose from 'mongoose';
import { HttpError } from '../errors.js';
import { config } from '../config.js';
import { EnvelopePlan, SinkingFund, Transaction, WishItem } from '../models/index.js';
import { addMonths } from '../invest.js';
import { monthsUntil } from '../finance.js';
import { dayString, monthRange, shiftMonth } from '../money.js';
import { addDays, todayIn } from '../schedule.js';
import { create as createTx, explodeSplits } from './transaction.service.js';

const money = (paise) => ({ paise, rupees: paise / 100 });
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const fieldError = (field, message) => new HttpError(400, 'validation_failed', 'Some fields are missing or invalid', [{ field, message }]);
const today = () => todayIn(config.timeZone);

// ── Envelopes ──

// Income and spending per category in a month (splits counted by their parts; transfers left out).
async function monthFlows(spaceId, month) {
  const { from, to } = monthRange(month);
  const rows = await Transaction.aggregate([
    { $match: { space: oid(spaceId), deletedAt: null, type: { $in: ['income', 'expense'] }, date: { $gte: from, $lte: to } } },
    ...explodeSplits(),
    { $group: { _id: { type: '$type', category: '$category' }, total: { $sum: '$amountPaise' } } },
  ]);
  const income = rows.filter((r) => r._id.type === 'income').reduce((s, r) => s + r.total, 0);
  const spent = new Map(rows.filter((r) => r._id.type === 'expense').map((r) => [r._id.category, r.total]));
  return { income, spent };
}

export async function envelopes(spaceId, { month }) {
  const [plan, flows] = await Promise.all([EnvelopePlan.findOne({ space: spaceId, month }).lean(), monthFlows(spaceId, month)]);
  const list = plan?.envelopes ?? [];
  const covered = new Set(list.flatMap((e) => e.categories));
  const items = list.map((e) => {
    const spent = e.categories.reduce((s, c) => s + (flows.spent.get(c) ?? 0), 0);
    return {
      id: String(e._id), name: e.name, categories: e.categories, amount: money(e.amountPaise), spent: money(spent),
      left: money(e.amountPaise - spent), percent: e.amountPaise ? Math.round((spent * 1000) / e.amountPaise) / 10 : null,
      status: spent > e.amountPaise ? 'over' : e.amountPaise && spent >= e.amountPaise * 0.8 ? 'warning' : 'ok',
    };
  });
  const assigned = list.reduce((s, e) => s + e.amountPaise, 0);
  const available = plan?.incomePaise ?? flows.income;
  const outside = [...flows.spent].filter(([c]) => !covered.has(c)).sort((a, b) => b[1] - a[1]);
  return {
    month,
    hasPlan: Boolean(plan),
    incomeRecorded: money(flows.income),
    incomePlanned: plan?.incomePaise === null || plan?.incomePaise === undefined ? null : money(plan.incomePaise),
    available: money(available),
    assigned: money(assigned),
    toAssign: money(available - assigned),
    envelopes: items,
    spentOutside: money(outside.reduce((s, [, v]) => s + v, 0)),
    outsideCategories: outside.map(([category, v]) => ({ category, spent: money(v) })),
  };
}

export async function saveEnvelopes(spaceId, { month, income, envelopes: list }) {
  const seen = new Map();
  list.forEach((e, i) => e.categories.forEach((c) => {
    if (seen.has(c)) throw fieldError(`envelopes.${i}.categories`, `“${c}” is already in “${list[seen.get(c)].name}”`);
    seen.set(c, i);
  }));
  await EnvelopePlan.findOneAndUpdate(
    { space: spaceId, month },
    { $set: { incomePaise: income ?? null, envelopes: list.map((e) => ({ name: e.name, categories: e.categories, amountPaise: e.amount })) } },
    { upsert: true, runValidators: true },
  );
  return envelopes(spaceId, { month });
}

// Starts a month with last month's envelopes (and planned income), if it has none yet.
export async function copyEnvelopes(spaceId, { month }) {
  if (await EnvelopePlan.exists({ space: spaceId, month })) throw new HttpError(409, 'envelopes_exist', 'This month already has envelopes');
  const prev = await EnvelopePlan.findOne({ space: spaceId, month: shiftMonth(month, -1) }).lean();
  if (!prev) throw new HttpError(404, 'nothing_to_copy', 'Last month has no envelopes to copy');
  await EnvelopePlan.create({ space: spaceId, month, incomePaise: prev.incomePaise, envelopes: prev.envelopes.map(({ name, categories, amountPaise }) => ({ name, categories, amountPaise })) });
  return envelopes(spaceId, { month });
}

export async function deleteEnvelopes(spaceId, { month }) {
  await EnvelopePlan.deleteOne({ space: spaceId, month });
}

// ── Sinking funds ──

const FUND_NOT_FOUND = () => new HttpError(404, 'fund_not_found', 'Sinking fund not found');

function serializeFund(f, on = today()) {
  const saved = f.contributions.reduce((s, c) => s + c.amountPaise, 0);
  const left = Math.max(0, f.amountPaise - saved);
  const overdue = f.nextDue < on;
  const months = monthsUntil(on, f.nextDue);
  return {
    id: String(f._id), name: f.name, amount: money(f.amountPaise), nextDue: dayString(f.nextDue), everyMonths: f.everyMonths,
    category: f.category, saved: money(saved), left: money(left),
    percent: Math.min(100, Math.round((saved * 1000) / f.amountPaise) / 10),
    // What to put aside each month from now until it's due.
    monthly: money(left === 0 ? 0 : overdue ? left : Math.ceil(left / months)),
    monthsLeft: overdue ? 0 : months,
    status: saved >= f.amountPaise ? 'ready' : overdue ? 'overdue' : f.nextDue <= addDays(on, 30) ? 'soon' : 'saving',
    contributions: [...f.contributions].sort((a, b) => b.date - a.date).map((c) => ({ id: String(c._id), date: dayString(c.date), amount: money(c.amountPaise) })),
    paid: [...f.paid].sort((a, b) => b.date - a.date).map((p) => ({ id: String(p._id), date: dayString(p.date), amount: money(p.amountPaise), transactionId: p.transaction ? String(p.transaction) : null })),
  };
}

async function ownedFund(spaceId, id) {
  const f = mongoose.isValidObjectId(id) ? await SinkingFund.findOne({ _id: id, space: spaceId }) : null;
  if (!f) throw FUND_NOT_FOUND();
  return f;
}

export async function listFunds(spaceId) {
  const funds = (await SinkingFund.find({ space: spaceId }).sort({ nextDue: 1 }).lean()).map((f) => serializeFund(f));
  return {
    funds,
    monthly: money(funds.reduce((s, f) => s + f.monthly.paise, 0)),
    saved: money(funds.reduce((s, f) => s + f.saved.paise, 0)),
  };
}

export async function createFund({ space, user }, b) {
  const f = await SinkingFund.create({ space: space._id, name: b.name, amountPaise: b.amount, nextDue: b.nextDue, everyMonths: b.everyMonths, category: b.category ?? '', createdBy: user._id });
  return serializeFund(f);
}

export async function updateFund(spaceId, id, b) {
  const f = await ownedFund(spaceId, id);
  for (const [k, field] of [['name', 'name'], ['amount', 'amountPaise'], ['nextDue', 'nextDue'], ['everyMonths', 'everyMonths'], ['category', 'category']]) {
    if (b[k] !== undefined) f[field] = b[k];
  }
  await f.save();
  return serializeFund(f);
}

export async function deleteFund(spaceId, id) {
  await SinkingFund.deleteOne({ _id: (await ownedFund(spaceId, id))._id });
}

export async function addContribution(spaceId, id, { direction, amount, date }) {
  const f = await ownedFund(spaceId, id);
  const saved = f.contributions.reduce((s, c) => s + c.amountPaise, 0);
  if (direction === 'withdraw' && amount > saved) throw fieldError('amount', 'That is more than this fund has put aside');
  f.contributions.push({ date: date ?? today(), amountPaise: direction === 'withdraw' ? -amount : amount });
  await f.save();
  return serializeFund(f);
}

// Paid: the cost is recorded (as an expense, if an account is given), what was put aside starts again (anything
// left over carries on) and the next due date moves on by its interval.
export async function payFund({ space, user }, id, { amount, date, account = null }) {
  const f = await ownedFund(space._id, id);
  const paidOn = date ?? today();
  const cost = amount ?? f.amountPaise;
  let tx = null;
  if (account) {
    tx = await createTx({ space, user }, { type: 'expense', amount: cost, category: f.category || 'Other', date: paidOn, note: f.name.slice(0, 500), account });
  }
  const saved = f.contributions.reduce((s, c) => s + c.amountPaise, 0);
  f.contributions = saved > cost ? [{ date: paidOn, amountPaise: saved - cost }] : [];
  f.paid.push({ date: paidOn, amountPaise: cost, transaction: tx?.id ?? null });
  let next = f.nextDue;
  while (next <= paidOn) next = addMonths(next, f.everyMonths);
  f.nextDue = next;
  await f.save();
  return serializeFund(f);
}

// ── Wishlist ──

const WISH_NOT_FOUND = () => new HttpError(404, 'wish_not_found', 'Wishlist item not found');

// The day it was added counts in the app's time zone, like "today" does; the UTC day is a day early before 5:30 am IST.
export function serializeWish(w, on = today()) {
  const added = todayIn(config.timeZone, w.createdAt);
  const readyOn = addDays(added, w.coolDays);
  const daysLeft = Math.max(0, Math.round((readyOn - on) / 86_400_000));
  return {
    id: String(w._id), name: w.name, price: money(w.pricePaise), url: w.url, note: w.note, coolDays: w.coolDays,
    addedOn: dayString(added), readyOn: dayString(readyOn), daysLeft,
    ready: w.status === 'waiting' && daysLeft === 0,
    status: w.status, decidedAt: w.decidedAt ? dayString(w.decidedAt) : null,
    transactionId: w.transaction ? String(w.transaction) : null,
  };
}

async function ownedWish(spaceId, id) {
  const w = mongoose.isValidObjectId(id) ? await WishItem.findOne({ _id: id, space: spaceId }) : null;
  if (!w) throw WISH_NOT_FOUND();
  return w;
}

export async function listWishes(spaceId) {
  const items = (await WishItem.find({ space: spaceId }).sort({ createdAt: -1 }).lean()).map((w) => serializeWish(w));
  const waiting = items.filter((w) => w.status === 'waiting');
  return {
    items,
    waitingTotal: money(waiting.reduce((s, w) => s + w.price.paise, 0)),
    // What the cooling-off period has kept you from buying: things you decided not to buy after all.
    droppedTotal: money(items.filter((w) => w.status === 'dropped').reduce((s, w) => s + w.price.paise, 0)),
  };
}

export async function createWish({ space, user }, b) {
  const w = await WishItem.create({ space: space._id, name: b.name, pricePaise: b.price, url: b.url ?? '', note: b.note ?? '', coolDays: b.coolDays ?? 30, createdBy: user._id });
  return serializeWish(w);
}

export async function updateWish(spaceId, id, b) {
  const w = await ownedWish(spaceId, id);
  for (const [k, field] of [['name', 'name'], ['price', 'pricePaise'], ['url', 'url'], ['note', 'note'], ['coolDays', 'coolDays']]) {
    if (b[k] !== undefined) w[field] = b[k];
  }
  await w.save();
  return serializeWish(w);
}

export async function deleteWish(spaceId, id) {
  await WishItem.deleteOne({ _id: (await ownedWish(spaceId, id))._id });
}

// Bought (optionally recorded as an expense) or dropped. Buying before the cooling-off ends needs `early: true`.
export async function decideWish({ space, user }, id, { decision, early = false, amount, date, account = null, category = 'Shopping' }) {
  const w = await ownedWish(space._id, id);
  if (w.status !== 'waiting') throw new HttpError(409, 'already_decided', 'This item was already bought or dropped');
  if (decision === 'bought' && !serializeWish(w).ready && !early) {
    throw new HttpError(409, 'still_cooling_off', `Still cooling off: ready to buy on ${serializeWish(w).readyOn}`);
  }
  w.status = decision;
  w.decidedAt = date ?? today();
  if (decision === 'bought' && account) {
    const tx = await createTx({ space, user }, { type: 'expense', amount: amount ?? w.pricePaise, category, date: w.decidedAt, note: w.name.slice(0, 500), account });
    w.transaction = tx.id;
  }
  await w.save();
  return serializeWish(w);
}

import mongoose from 'mongoose';
import { HttpError } from '../errors.js';
import { config } from '../config.js';
import { Budget, Transaction, WeeklyBudget } from '../models/index.js';
import { currentMonth, dayString, shiftMonth, monthRange } from '../money.js';
import { addDays, todayIn } from '../schedule.js';
import { explodeSplits } from './transaction.service.js';

// A budget turns "warning" once this share of it is spent, and "over" once spending passes the limit.
export const WARN_AT_PERCENT = 80;
// Rollover looks back at most this many months for unspent money.
const ROLLOVER_MONTHS = 24;

const NOT_FOUND = () => new HttpError(404, 'budget_not_found', 'Budget not found');
const withRupees = (paise) => ({ paise, rupees: paise / 100 });
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const sum = (values) => [...values].reduce((a, b) => a + b, 0);
const keyOf = (category) => category ?? '\u0000overall';

function usage(limitPaise, spentPaise) {
  const percentUsed = Math.round((spentPaise * 1000) / limitPaise) / 10;
  let status = 'ok';
  if (spentPaise > limitPaise) status = 'over';
  else if (percentUsed >= WARN_AT_PERCENT) status = 'warning';
  return {
    limit: withRupees(limitPaise),
    spent: withRupees(spentPaise),
    // Negative once over budget.
    remaining: withRupees(limitPaise - spentPaise),
    percentUsed,
    status,
  };
}

// `limit` is what can be spent this month: the budget set plus anything rolled over from last month.
function serialize(budget, spentPaise, carryPaise = 0) {
  return {
    id: String(budget._id),
    month: budget.month,
    category: budget.category,
    rollover: Boolean(budget.rollover),
    baseLimit: withRupees(budget.limitPaise),
    carriedOver: withRupees(carryPaise),
    ...usage(budget.limitPaise + carryPaise, spentPaise),
  };
}

// Expense totals per month and category: Map("YYYY-MM" -> Map(category -> paise)).
async function spending(spaceId, fromMonth, toMonth) {
  const rows = await Transaction.aggregate([
    {
      $match: {
        space: oid(spaceId),
        deletedAt: null,
        type: 'expense',
        date: { $gte: monthRange(fromMonth).from, $lte: monthRange(toMonth).to },
      },
    },
    // A split bill counts towards each of its categories' budgets.
    ...explodeSplits(),
    {
      $group: {
        _id: { month: { $dateToString: { format: '%Y-%m', date: '$date' } }, category: '$category' },
        total: { $sum: '$amountPaise' },
      },
    },
  ]);
  const out = new Map();
  for (const { _id, total } of rows) {
    if (!out.has(_id.month)) out.set(_id.month, new Map());
    out.get(_id.month).set(_id.category, total);
  }
  return out;
}

// Expense totals per category between two days (inclusive): Map(category -> paise).
async function spendingBetween(spaceId, from, to) {
  const rows = await Transaction.aggregate([
    { $match: { space: oid(spaceId), deletedAt: null, type: 'expense', date: { $gte: from, $lte: to } } },
    ...explodeSplits(),
    { $group: { _id: '$category', total: { $sum: '$amountPaise' } } },
  ]);
  return new Map(rows.map((r) => [r._id, r.total]));
}

const spentFor = (budget, spent) => (budget.category === null ? sum(spent.values()) : spent.get(budget.category) ?? 0);

// Rolled-over money for every budget in [fromMonth, toMonth]: Map(month -> Map(category key -> paise)).
// A rollover budget gets what was left of last month's budget for the same category, and last month's
// limit itself may include an earlier rollover, so unspent money keeps carrying forward.
async function carries(spaceId, fromMonth, toMonth, budgets) {
  const out = new Map();
  if (!budgets.some((b) => b.rollover)) return out;
  const start = shiftMonth(fromMonth, -ROLLOVER_MONTHS);
  const [all, spent] = await Promise.all([
    Budget.find({ space: spaceId, month: { $gte: start, $lte: toMonth } }).lean(),
    spending(spaceId, start, shiftMonth(toMonth, -1)),
  ]);
  const byKey = new Map(all.map((b) => [`${b.month}|${keyOf(b.category)}`, b]));
  const effective = new Map();
  for (let m = start; m <= toMonth; m = shiftMonth(m, 1)) {
    const prevMonth = shiftMonth(m, -1);
    for (const b of all.filter((x) => x.month === m)) {
      const key = keyOf(b.category);
      const prev = byKey.get(`${prevMonth}|${key}`);
      const carry = b.rollover && prev
        ? Math.max(0, effective.get(`${prevMonth}|${key}`) - spentFor(prev, spent.get(prevMonth) ?? new Map()))
        : 0;
      effective.set(`${m}|${key}`, b.limitPaise + carry);
      if (m >= fromMonth) {
        if (!out.has(m)) out.set(m, new Map());
        out.get(m).set(key, carry);
      }
    }
  }
  return out;
}

const carryFor = (carry, budget) => carry.get(budget.month)?.get(keyOf(budget.category)) ?? 0;

function monthView(month, budgets, spent = new Map(), carry = new Map()) {
  const overall = budgets.find((b) => b.category === null);
  const categories = budgets
    .filter((b) => b.category !== null)
    .sort((a, b) => a.category.localeCompare(b.category))
    .map((b) => serialize(b, spentFor(b, spent), carryFor(carry, b)));
  const budgeted = new Set(categories.map((c) => c.category));
  const unbudgeted = [...spent.entries()]
    .filter(([cat]) => !budgeted.has(cat))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([cat, total]) => ({ category: cat, spent: withRupees(total) }));
  return {
    month,
    overall: overall ? serialize(overall, spentFor(overall, spent), carryFor(carry, overall)) : null,
    categories,
    unbudgeted,
    totals: {
      budgeted: withRupees(sum(categories.map((c) => c.limit.paise))),
      spentInBudgeted: withRupees(sum(categories.map((c) => c.spent.paise))),
      spentTotal: withRupees(sum(spent.values())),
    },
  };
}

export async function list(spaceId, { month = currentMonth() } = {}) {
  const [budgets, spent] = await Promise.all([
    Budget.find({ space: spaceId, month }).lean(),
    spending(spaceId, month, month),
  ]);
  return monthView(month, budgets, spent.get(month), await carries(spaceId, month, month, budgets));
}

async function serializeOne(spaceId, budget) {
  const spent = (await spending(spaceId, budget.month, budget.month)).get(budget.month) ?? new Map();
  const carry = await carries(spaceId, budget.month, budget.month, [budget]);
  return serialize(budget, spentFor(budget, spent), carryFor(carry, budget));
}

// Creates the budget for (month, category), or changes its limit if it already exists.
export async function upsert(spaceId, { month, category, limit, rollover }, userId) {
  const existed = await Budget.exists({ space: spaceId, month, category });
  const budget = await Budget.findOneAndUpdate(
    { space: spaceId, month, category },
    { $set: { limitPaise: limit, ...(rollover !== undefined && { rollover }) }, $setOnInsert: { user: userId } },
    { upsert: true, returnDocument: 'after', runValidators: true, lean: true },
  );
  return { created: !existed, budget: await serializeOne(spaceId, budget) };
}

export async function update(spaceId, id, { limit, rollover }) {
  if (!mongoose.isValidObjectId(id)) throw NOT_FOUND();
  const budget = await Budget.findOneAndUpdate(
    { _id: id, space: spaceId },
    { $set: { ...(limit !== undefined && { limitPaise: limit }), ...(rollover !== undefined && { rollover }) } },
    { returnDocument: 'after', runValidators: true, lean: true },
  );
  if (!budget) throw NOT_FOUND();
  return serializeOne(spaceId, budget);
}

export async function remove(spaceId, id) {
  if (!mongoose.isValidObjectId(id)) throw NOT_FOUND();
  const { deletedCount } = await Budget.deleteOne({ _id: id, space: spaceId });
  if (!deletedCount) throw NOT_FOUND();
}

// Copies one month's budgets (and their rollover setting) into another. Budgets already set there stay as they are.
export async function copy(spaceId, { from, to }, userId) {
  const [source, existing] = await Promise.all([
    Budget.find({ space: spaceId, month: from }).lean(),
    Budget.find({ space: spaceId, month: to }).lean(),
  ]);
  if (!source.length) throw new HttpError(404, 'no_budgets', `There are no budgets in ${from} to copy`);
  const taken = new Set(existing.map((b) => b.category));
  const toInsert = source
    .filter((b) => !taken.has(b.category))
    .map((b) => ({ space: spaceId, user: userId, month: to, category: b.category, limitPaise: b.limitPaise, rollover: b.rollover }));
  if (toInsert.length) await Budget.insertMany(toInsert);
  return { copied: toInsert.length, skipped: source.length - toInsert.length, month: await list(spaceId, { month: to }) };
}

// How budgets went over several months, oldest first. Optionally one category only.
export async function history(spaceId, { to = currentMonth(), months = 6, category } = {}) {
  const from = shiftMonth(to, -(months - 1));
  const monthKeys = Array.from({ length: months }, (_, i) => shiftMonth(from, i));
  const filter = { space: spaceId, month: { $gte: from, $lte: to } };
  if (category) filter.category = category;
  const [budgets, spent] = await Promise.all([Budget.find(filter).lean(), spending(spaceId, from, to)]);
  const carry = await carries(spaceId, from, to, budgets);
  return {
    from,
    to,
    months: monthKeys.map((m) => {
      const monthSpent = spent.get(m) ?? new Map();
      if (category) {
        const budget = budgets.find((b) => b.month === m);
        return {
          month: m,
          budget: budget ? serialize(budget, spentFor(budget, monthSpent), carryFor(carry, budget)) : null,
          spent: withRupees(monthSpent.get(category) ?? 0),
        };
      }
      return monthView(m, budgets.filter((b) => b.month === m), monthSpent, carry);
    }),
  };
}

// Weeks run Monday to Sunday.
export function weekOf(day) {
  const from = addDays(day, -((day.getUTCDay() + 6) % 7));
  return { from, to: addDays(from, 6) };
}

const serializeWeekly = (b, spentPaise) => ({ id: String(b._id), category: b.category, ...usage(b.limitPaise, spentPaise) });

// The week containing `date` (default: today in the app's time zone), with last week's spending to compare.
export async function weekly(spaceId, { date } = {}) {
  const { from, to } = weekOf(date ?? todayIn(config.timeZone));
  const prev = weekOf(addDays(from, -7));
  const [budgets, spent, prevSpent] = await Promise.all([
    WeeklyBudget.find({ space: spaceId }).lean(),
    spendingBetween(spaceId, from, to),
    spendingBetween(spaceId, prev.from, prev.to),
  ]);
  budgets.sort((a, b) => (a.category === null ? -1 : b.category === null ? 1 : a.category.localeCompare(b.category)));
  return {
    week: { from: dayString(from), to: dayString(to) },
    budgets: budgets.map((b) => ({ ...serializeWeekly(b, spentFor(b, spent)), lastWeek: withRupees(spentFor(b, prevSpent)) })),
  };
}

export async function upsertWeekly(spaceId, { category, limit }, userId) {
  const existed = await WeeklyBudget.exists({ space: spaceId, category });
  const b = await WeeklyBudget.findOneAndUpdate(
    { space: spaceId, category },
    { $set: { limitPaise: limit }, $setOnInsert: { user: userId } },
    { upsert: true, returnDocument: 'after', runValidators: true, lean: true },
  );
  const { from, to } = weekOf(todayIn(config.timeZone));
  return { created: !existed, budget: serializeWeekly(b, spentFor(b, await spendingBetween(spaceId, from, to))) };
}

export async function removeWeekly(spaceId, id) {
  if (!mongoose.isValidObjectId(id)) throw NOT_FOUND();
  const { deletedCount } = await WeeklyBudget.deleteOne({ _id: id, space: spaceId });
  if (!deletedCount) throw NOT_FOUND();
}

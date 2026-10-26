import mongoose from 'mongoose';
import { HttpError } from '../errors.js';
import { config } from '../config.js';
import { Goal, Transaction } from '../models/index.js';
import { currentMonth, dayString, monthRange, shiftMonth } from '../money.js';
import { todayIn } from '../schedule.js';
import { neededPerMonth } from '../finance.js';

// An emergency fund is usually 6 months of spending.
export const EMERGENCY_MONTHS = 6;

const NOT_FOUND = () => new HttpError(404, 'goal_not_found', 'Goal not found');
const money = (paise) => ({ paise, rupees: paise / 100 });
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const savedOf = (g) => g.entries.reduce((s, e) => s + e.amountPaise, 0);

function serialize(g, today = todayIn(config.timeZone)) {
  const saved = savedOf(g);
  const needed = neededPerMonth({ targetPaise: g.targetPaise, savedPaise: saved, today, targetDate: g.targetDate });
  return {
    id: String(g._id),
    name: g.name,
    kind: g.kind,
    target: money(g.targetPaise),
    targetDate: g.targetDate ? dayString(g.targetDate) : null,
    saved: money(saved),
    remaining: money(Math.max(0, g.targetPaise - saved)),
    percent: Math.min(100, Math.round((saved * 1000) / g.targetPaise) / 10),
    // Null when there's no target date to spread the rest over.
    neededPerMonth: needed === null ? null : money(needed),
    completed: saved >= g.targetPaise,
    entries: [...g.entries].sort((a, b) => b.date - a.date || String(b._id).localeCompare(String(a._id))).map((e) => ({
      id: String(e._id), amount: money(e.amountPaise), date: dayString(e.date), note: e.note, by: e.by ? String(e.by) : null,
    })),
    createdAt: g.createdAt,
  };
}

// Average spending over the last 3 complete months, from the space's real entries.
export async function emergencySuggestion(spaceId) {
  const to = shiftMonth(currentMonth(todayIn(config.timeZone)), -1);
  const from = shiftMonth(to, -2);
  const rows = await Transaction.aggregate([
    { $match: { space: oid(spaceId), deletedAt: null, type: 'expense', date: { $gte: monthRange(from).from, $lte: monthRange(to).to } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$date' } }, total: { $sum: '$amountPaise' } } },
  ]);
  const months = [from, shiftMonth(from, 1), to].map((m) => ({ month: m, spent: money(rows.find((r) => r._id === m)?.total ?? 0) }));
  // Months before the first entry would drag the average down, so only months with spending count.
  const counted = months.filter((m) => m.spent.paise > 0);
  if (!counted.length) return { months, averageMonthly: null, target: null, multiplier: EMERGENCY_MONTHS };
  const average = Math.round(counted.reduce((s, m) => s + m.spent.paise, 0) / counted.length);
  return { months, averageMonthly: money(average), target: money(average * EMERGENCY_MONTHS), multiplier: EMERGENCY_MONTHS };
}

export async function list(spaceId) {
  const [goals, emergency] = await Promise.all([Goal.find({ space: spaceId }).sort({ createdAt: 1 }).lean(), emergencySuggestion(spaceId)]);
  return { goals: goals.map((g) => serialize(g)), emergency };
}

async function owned(spaceId, id) {
  if (!mongoose.isValidObjectId(id)) throw NOT_FOUND();
  const g = await Goal.findOne({ _id: id, space: spaceId });
  if (!g) throw NOT_FOUND();
  return g;
}

export async function create({ space, user }, { name, kind = 'custom', target, targetDate }) {
  let targetPaise = target;
  if (!targetPaise && kind === 'emergency') targetPaise = (await emergencySuggestion(space._id)).target?.paise;
  if (!targetPaise) {
    throw new HttpError(400, 'validation_failed', 'Some fields are missing or invalid', [{ field: 'target', message: kind === 'emergency' ? 'There is no spending yet to base it on; enter a target' : 'Target is required' }]);
  }
  const g = await Goal.create({ space: space._id, name, kind, targetPaise, targetDate: targetDate ?? null, createdBy: user._id });
  return serialize(g);
}

export async function update(spaceId, id, { name, target, targetDate }) {
  const g = await owned(spaceId, id);
  if (name !== undefined) g.name = name;
  if (target !== undefined) g.targetPaise = target;
  if (targetDate !== undefined) g.targetDate = targetDate;
  await g.save();
  return serialize(g);
}

export async function remove(spaceId, id) {
  const { deletedCount } = await Goal.deleteOne({ _id: (await owned(spaceId, id))._id });
  if (!deletedCount) throw NOT_FOUND();
}

// Putting money aside (or taking some back out, never more than is saved).
export async function addEntry({ space, user }, id, { direction, amount, date, note = '' }) {
  const g = await owned(space._id, id);
  if (direction === 'withdraw' && amount > savedOf(g)) {
    throw new HttpError(400, 'validation_failed', 'Some fields are missing or invalid', [{ field: 'amount', message: 'That is more than this goal has saved' }]);
  }
  g.entries.push({ amountPaise: direction === 'withdraw' ? -amount : amount, date: date ?? todayIn(config.timeZone), note, by: user._id });
  await g.save();
  return serialize(g);
}

export async function removeEntry(spaceId, id, entryId) {
  const g = await owned(spaceId, id);
  const e = mongoose.isValidObjectId(entryId) && g.entries.id(entryId);
  if (!e) throw new HttpError(404, 'entry_not_found', 'Entry not found');
  e.deleteOne();
  if (savedOf(g) < 0) throw new HttpError(409, 'would_go_negative', 'Removing this would leave the goal below zero; remove the withdrawal first');
  await g.save();
  return serialize(g);
}

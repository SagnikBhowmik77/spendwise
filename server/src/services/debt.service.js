import mongoose from 'mongoose';
import { HttpError } from '../errors.js';
import { config } from '../config.js';
import { Debt } from '../models/index.js';
import { dayString, formatPaise } from '../money.js';
import { todayIn } from '../schedule.js';

const NOT_FOUND = () => new HttpError(404, 'debt_not_found', 'Not found');
const money = (paise) => ({ paise, rupees: paise / 100 });
const settledOf = (d) => d.settlements.reduce((s, x) => s + x.amountPaise, 0);

function serialize(d, today = todayIn(config.timeZone)) {
  const settled = settledOf(d);
  const outstanding = d.amountPaise - settled;
  return {
    id: String(d._id),
    person: d.person,
    direction: d.direction,
    amount: money(d.amountPaise),
    date: dayString(d.date),
    dueDate: d.dueDate ? dayString(d.dueDate) : null,
    note: d.note,
    settled: money(settled),
    outstanding: money(outstanding),
    status: outstanding === 0 ? 'settled' : d.dueDate && d.dueDate < today ? 'overdue' : 'open',
    settlements: [...d.settlements].sort((a, b) => b.date - a.date).map((s) => ({ id: String(s._id), amount: money(s.amountPaise), date: dayString(s.date), note: s.note })),
  };
}

// Every loan to or from a person, plus a running total per person (positive = they owe you).
export async function list(spaceId) {
  const debts = (await Debt.find({ space: spaceId }).sort({ date: -1, _id: -1 }).lean()).map((d) => serialize(d));
  const people = new Map();
  // Oldest first, so a person is shown with the spelling first used for them.
  for (const d of [...debts].reverse()) {
    const key = d.person.toLowerCase();
    const p = people.get(key) ?? { person: d.person, net: 0 };
    p.net += d.direction === 'lent' ? d.outstanding.paise : -d.outstanding.paise;
    people.set(key, p);
  }
  const owedToYou = debts.filter((d) => d.direction === 'lent').reduce((s, d) => s + d.outstanding.paise, 0);
  const youOwe = debts.filter((d) => d.direction === 'borrowed').reduce((s, d) => s + d.outstanding.paise, 0);
  return {
    debts,
    people: [...people.values()].filter((p) => p.net !== 0).sort((a, b) => Math.abs(b.net) - Math.abs(a.net)).map((p) => ({ person: p.person, net: money(p.net) })),
    totals: { owedToYou: money(owedToYou), youOwe: money(youOwe) },
  };
}

async function owned(spaceId, id) {
  if (!mongoose.isValidObjectId(id)) throw NOT_FOUND();
  const d = await Debt.findOne({ _id: id, space: spaceId });
  if (!d) throw NOT_FOUND();
  return d;
}

export async function create({ space, user }, { person, direction, amount, date, dueDate = null, note = '' }) {
  const d = await Debt.create({ space: space._id, person, direction, amountPaise: amount, date: date ?? todayIn(config.timeZone), dueDate, note, createdBy: user._id });
  return serialize(d);
}

export async function update(spaceId, id, changes) {
  const d = await owned(spaceId, id);
  if (changes.amount !== undefined && changes.amount < settledOf(d)) {
    throw new HttpError(400, 'validation_failed', 'Some fields are missing or invalid', [{ field: 'amount', message: `₹${formatPaise(settledOf(d))} has already been settled` }]);
  }
  for (const [k, field] of Object.entries({ person: 'person', direction: 'direction', amount: 'amountPaise', date: 'date', dueDate: 'dueDate', note: 'note' })) {
    if (changes[k] !== undefined) d[field] = changes[k];
  }
  await d.save();
  return serialize(d);
}

export async function remove(spaceId, id) {
  await Debt.deleteOne({ _id: (await owned(spaceId, id))._id });
}

// A repayment, in full or in part; never more than what's still outstanding.
export async function settle(spaceId, id, { amount, date, note = '' }) {
  const d = await owned(spaceId, id);
  const left = d.amountPaise - settledOf(d);
  const amountPaise = amount ?? left;
  if (left === 0) throw new HttpError(409, 'already_settled', 'This is already settled');
  if (amountPaise > left) {
    throw new HttpError(400, 'validation_failed', 'Some fields are missing or invalid', [{ field: 'amount', message: `Only ₹${formatPaise(left)} is outstanding` }]);
  }
  d.settlements.push({ amountPaise, date: date ?? todayIn(config.timeZone), note });
  await d.save();
  return serialize(d);
}

export async function removeSettlement(spaceId, id, settlementId) {
  const d = await owned(spaceId, id);
  const s = mongoose.isValidObjectId(settlementId) && d.settlements.id(settlementId);
  if (!s) throw new HttpError(404, 'settlement_not_found', 'Repayment not found');
  s.deleteOne();
  await d.save();
  return serialize(d);
}

import mongoose from 'mongoose';
import { HttpError } from '../errors.js';
import { config } from '../config.js';
import { Group } from '../models/index.js';
import { dayString, formatPaise } from '../money.js';
import { todayIn } from '../schedule.js';
import { equalSplit, settleUp } from '../finance.js';

const NOT_FOUND = () => new HttpError(404, 'group_not_found', 'Group not found');
const money = (paise) => ({ paise, rupees: paise / 100 });
const fieldError = (field, message) => new HttpError(400, 'validation_failed', 'Some fields are missing or invalid', [{ field, message }]);
const same = (a, b) => String(a) === String(b);
const MAX_EXPENSES = 1000;

// Per person: what they paid, their share, and the balance (positive = the group owes them).
function balances(g) {
  const rows = new Map(g.members.map((m) => [String(m._id), { paid: 0, share: 0, sent: 0, received: 0 }]));
  for (const e of g.expenses) {
    rows.get(String(e.paidBy)).paid += e.amountPaise;
    for (const s of e.shares) rows.get(String(s.member)).share += s.amountPaise;
  }
  for (const s of g.settlements) {
    rows.get(String(s.from)).sent += s.amountPaise;
    rows.get(String(s.to)).received += s.amountPaise;
  }
  return rows;
}

function serialize(g, { full = true } = {}) {
  const rows = balances(g);
  const name = (id) => g.members.find((m) => same(m._id, id))?.name ?? 'Someone';
  const members = g.members.map((m) => {
    const r = rows.get(String(m._id));
    return { id: String(m._id), name: m.name, upiId: m.upiId, paid: money(r.paid), share: money(r.share), balance: money(r.paid - r.share + r.sent - r.received) };
  });
  const suggestions = settleUp(members.map((m) => ({ id: m.id, paise: m.balance.paise }))).map((p) => ({
    from: p.from, fromName: name(p.from), to: p.to, toName: name(p.to), toUpiId: g.members.find((m) => same(m._id, p.to))?.upiId || null, amount: money(p.paise),
  }));
  const out = {
    id: String(g._id),
    name: g.name,
    members,
    total: money(g.expenses.reduce((s, e) => s + e.amountPaise, 0)),
    expenseCount: g.expenses.length,
    settledUp: suggestions.length === 0,
    suggestions,
    updatedAt: g.updatedAt,
  };
  if (!full) return out;
  return {
    ...out,
    expenses: [...g.expenses].sort((a, b) => b.date - a.date || String(b._id).localeCompare(String(a._id))).map((e) => ({
      id: String(e._id), description: e.description, amount: money(e.amountPaise), date: dayString(e.date),
      paidBy: String(e.paidBy), paidByName: name(e.paidBy),
      shares: e.shares.map((s) => ({ member: String(s.member), name: name(s.member), amount: money(s.amountPaise) })),
    })),
    settlements: [...g.settlements].sort((a, b) => b.date - a.date).map((s) => ({
      id: String(s._id), from: String(s.from), fromName: name(s.from), to: String(s.to), toName: name(s.to), amount: money(s.amountPaise), date: dayString(s.date),
    })),
  };
}

async function owned(spaceId, id) {
  if (!mongoose.isValidObjectId(id)) throw NOT_FOUND();
  const g = await Group.findOne({ _id: id, space: spaceId });
  if (!g) throw NOT_FOUND();
  return g;
}

const memberIds = (g) => new Set(g.members.map((m) => String(m._id)));
function checkMember(g, id, field) {
  if (!memberIds(g).has(String(id))) throw fieldError(field, 'Pick someone in this group');
}

export async function list(spaceId) {
  return (await Group.find({ space: spaceId }).sort({ updatedAt: -1 }).lean()).map((g) => serialize(g, { full: false }));
}

export async function get(spaceId, id) {
  return serialize(await owned(spaceId, id));
}

export async function create({ space, user }, { name, members }) {
  const g = await Group.create({ space: space._id, name, members, createdBy: user._id });
  return serialize(g);
}

// Members are sent as the full list: ones with an id are kept (and may be renamed), new ones are added,
// and anyone left out is removed, which is only allowed while they have no expenses or settlements.
export async function update(spaceId, id, { name, members }) {
  const g = await owned(spaceId, id);
  if (name !== undefined) g.name = name;
  if (members) {
    const keep = new Set(members.filter((m) => m.id).map((m) => m.id));
    for (const m of members) if (m.id && !memberIds(g).has(m.id)) throw fieldError('members', 'Unknown member');
    for (const m of g.members.filter((x) => !keep.has(String(x._id)))) {
      const used = g.expenses.some((e) => same(e.paidBy, m._id) || e.shares.some((s) => same(s.member, m._id) && s.amountPaise > 0))
        || g.settlements.some((s) => same(s.from, m._id) || same(s.to, m._id));
      if (used) throw new HttpError(409, 'member_in_use', `${m.name} is part of expenses or settlements, so they can't be removed`);
    }
    g.members = members.map((m) => (m.id ? { _id: m.id, name: m.name, upiId: m.upiId ?? '' } : { name: m.name, upiId: m.upiId ?? '' }));
    if (g.members.length < 2) throw fieldError('members', 'A group needs at least 2 people');
  }
  await g.save();
  return serialize(g);
}

export async function remove(spaceId, id) {
  await Group.deleteOne({ _id: (await owned(spaceId, id))._id });
}

// Split equally among the chosen people, or by exact amounts that add up to the total.
export async function addExpense(spaceId, id, { description, amount, paidBy, date, split, among, exact }) {
  const g = await owned(spaceId, id);
  if (g.expenses.length >= MAX_EXPENSES) throw new HttpError(409, 'too_many_expenses', `A group can hold up to ${MAX_EXPENSES} expenses`);
  checkMember(g, paidBy, 'paidBy');
  let shares;
  if (split === 'exact') {
    exact.forEach((s, i) => checkMember(g, s.member, `exact.${i}.member`));
    if (new Set(exact.map((s) => s.member)).size !== exact.length) throw fieldError('exact', 'Each person once');
    const sum = exact.reduce((s, x) => s + x.amount, 0);
    if (sum !== amount) throw fieldError('exact', `The shares add up to ₹${formatPaise(sum)}, not ₹${formatPaise(amount)}`);
    shares = exact.map((s) => ({ member: s.member, amountPaise: s.amount }));
  } else {
    const people = [...new Set(among?.length ? among : g.members.map((m) => String(m._id)))];
    people.forEach((m, i) => checkMember(g, m, `among.${i}`));
    const parts = equalSplit(amount, people.length);
    shares = people.map((m, i) => ({ member: m, amountPaise: parts[i] }));
  }
  g.expenses.push({ description, amountPaise: amount, paidBy, date: date ?? todayIn(config.timeZone), shares });
  await g.save();
  return serialize(g);
}

export async function removeExpense(spaceId, id, expenseId) {
  const g = await owned(spaceId, id);
  const e = mongoose.isValidObjectId(expenseId) && g.expenses.id(expenseId);
  if (!e) throw new HttpError(404, 'expense_not_found', 'Expense not found');
  e.deleteOne();
  await g.save();
  return serialize(g);
}

// "Riya paid Arjun ₹450" (by UPI, cash, anything).
export async function addSettlement(spaceId, id, { from, to, amount, date }) {
  const g = await owned(spaceId, id);
  checkMember(g, from, 'from');
  checkMember(g, to, 'to');
  if (same(from, to)) throw fieldError('to', 'Pick two different people');
  g.settlements.push({ from, to, amountPaise: amount, date: date ?? todayIn(config.timeZone) });
  await g.save();
  return serialize(g);
}

export async function removeSettlement(spaceId, id, settlementId) {
  const g = await owned(spaceId, id);
  const s = mongoose.isValidObjectId(settlementId) && g.settlements.id(settlementId);
  if (!s) throw new HttpError(404, 'settlement_not_found', 'Settlement not found');
  s.deleteOne();
  await g.save();
  return serialize(g);
}

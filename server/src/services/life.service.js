// Batch 12P: vehicles, the warranty and insurance vault, credit card rewards and the FIRE calculator.
import mongoose from 'mongoose';
import { HttpError } from '../errors.js';
import { config } from '../config.js';
import { Account, CardReward, Space, Transaction, VaultItem, Vehicle } from '../models/index.js';
import { effectivePct, fireProjection, rewardValue, serviceDue, vehicleStats } from '../life.js';
import { currentMonth, dayString, formatPaise, monthRange, shiftMonth } from '../money.js';
import { addDays, todayIn } from '../schedule.js';
import { create as createTx, explodeSplits } from './transaction.service.js';
import { list as listInvestments } from './investment.service.js';
import { notifySpace } from './alert.service.js';

const money = (paise) => (paise === null ? null : { paise, rupees: paise / 100 });
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const today = () => todayIn(config.timeZone);
const inr = (paise) => `₹${formatPaise(paise)}`;
const shortDay = (d) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d);
const found = async (Model, spaceId, id, message) => {
  const doc = mongoose.isValidObjectId(id) ? await Model.findOne({ _id: id, space: spaceId }) : null;
  if (!doc) throw new HttpError(404, 'not_found', message);
  return doc;
};
const setFields = (doc, body, map) => { for (const [k, f] of map) if (body[k] !== undefined) doc[f] = body[k]; };

// ── Vehicles ──

function serializeVehicle(v, on = today()) {
  const stats = vehicleStats(v.fills);
  const due = serviceDue(v.service, stats.odometerKm, on);
  const { spentPaise, costPerKmPaise, ...rest } = stats;
  return {
    id: String(v._id), name: v.name, kind: v.kind, fuel: v.fuel,
    stats: { ...rest, spent: money(spentPaise), costPerKm: money(costPerKmPaise), segments: stats.segments.map((s) => ({ ...s, to: dayString(s.to) })) },
    service: {
      everyKm: v.service?.everyKm ?? null, everyMonths: v.service?.everyMonths ?? null,
      lastKm: v.service?.lastKm ?? null, lastDate: v.service?.lastDate ? dayString(v.service.lastDate) : null,
      due: due && { ...due, nextDate: due.nextDate ? dayString(due.nextDate) : null },
    },
    fills: [...v.fills].sort((a, b) => b.date - a.date || b.odometerKm - a.odometerKm).map((f) => ({
      id: String(f._id), date: dayString(f.date), odometerKm: f.odometerKm, quantity: f.quantity, amount: money(f.amountPaise),
      fullTank: f.fullTank, transactionId: f.transaction ? String(f.transaction) : null,
    })),
  };
}

export async function listVehicles(spaceId) {
  return { vehicles: (await Vehicle.find({ space: spaceId }).sort({ createdAt: 1 }).lean()).map((v) => serializeVehicle(v)) };
}

export async function createVehicle({ space, user }, b) {
  const v = await Vehicle.create({ space: space._id, name: b.name, kind: b.kind, fuel: b.fuel, service: b.service ?? {}, createdBy: user._id });
  return serializeVehicle(v);
}

export async function updateVehicle(spaceId, id, b) {
  const v = await found(Vehicle, spaceId, id, 'Vehicle not found');
  setFields(v, b, [['name', 'name'], ['kind', 'kind'], ['fuel', 'fuel']]);
  if (b.service) {
    for (const [k, val] of Object.entries(b.service)) v.set(`service.${k}`, val);
    v.remindedFor = null;
  }
  await v.save();
  return serializeVehicle(v);
}

export async function deleteVehicle(spaceId, id) {
  await Vehicle.deleteOne({ _id: (await found(Vehicle, spaceId, id, 'Vehicle not found'))._id });
}

// A fill-up: the odometer can't go backwards from an earlier fill. Recorded as a Fuel expense if an account is given.
export async function addFill({ space, user }, id, { date, odometerKm, quantity, amount, fullTank = true, account = null }) {
  const v = await found(Vehicle, space._id, id, 'Vehicle not found');
  const clash = v.fills.find((f) => (f.date < date && f.odometerKm > odometerKm) || (f.date > date && f.odometerKm < odometerKm));
  if (clash) throw new HttpError(400, 'validation_failed', 'Some fields are missing or invalid', [{ field: 'odometerKm', message: `The odometer read ${clash.odometerKm} km on ${shortDay(clash.date)}` }]);
  let tx = null;
  if (account) tx = await createTx({ space, user }, { type: 'expense', amount, category: 'Fuel', date, note: `${v.name}: ${quantity} ${v.fuel === 'electric' ? 'kWh' : v.fuel === 'cng' ? 'kg' : 'litres'}`.slice(0, 500), account });
  v.fills.push({ date, odometerKm, quantity, amountPaise: amount, fullTank, transaction: tx?.id ?? null });
  await v.save();
  return serializeVehicle(v);
}

export async function removeFill(spaceId, id, fillId) {
  const v = await found(Vehicle, spaceId, id, 'Vehicle not found');
  const f = mongoose.isValidObjectId(fillId) ? v.fills.id(fillId) : null;
  if (!f) throw new HttpError(404, 'fill_not_found', 'Fill-up not found');
  f.deleteOne();
  await v.save();
  return serializeVehicle(v);
}

// Serviced: the clock starts again from this day and odometer reading.
export async function markServiced(spaceId, id, { date, odometerKm }) {
  const v = await found(Vehicle, spaceId, id, 'Vehicle not found');
  v.set('service.lastDate', date ?? today());
  v.set('service.lastKm', odometerKm ?? vehicleStats(v.fills).odometerKm);
  v.remindedFor = null;
  await v.save();
  return serializeVehicle(v);
}

// ── The vault ──

function serializeVault(x, on = today()) {
  const days = Math.round((x.expiryDate - on) / 86_400_000);
  return {
    id: String(x._id), kind: x.kind, name: x.name, provider: x.provider, number: x.number,
    purchaseDate: x.purchaseDate ? dayString(x.purchaseDate) : null, expiryDate: dayString(x.expiryDate),
    amount: money(x.amountPaise ?? null), sumInsured: money(x.sumInsuredPaise ?? null), nominee: x.nominee, note: x.note,
    transactionId: x.transaction ? String(x.transaction) : null,
    daysLeft: days, status: days < 0 ? 'expired' : days <= 30 ? 'soon' : 'ok',
  };
}

export async function listVault(spaceId) {
  return { items: (await VaultItem.find({ space: spaceId }).sort({ expiryDate: 1 }).lean()).map((x) => serializeVault(x)) };
}

const VAULT_FIELDS = [['kind', 'kind'], ['name', 'name'], ['provider', 'provider'], ['number', 'number'], ['purchaseDate', 'purchaseDate'], ['expiryDate', 'expiryDate'],
  ['amount', 'amountPaise'], ['sumInsured', 'sumInsuredPaise'], ['nominee', 'nominee'], ['note', 'note']];

async function checkTransaction(spaceId, txId) {
  if (txId && !(await Transaction.exists({ _id: txId, space: spaceId, deletedAt: null }))) {
    throw new HttpError(400, 'validation_failed', 'Some fields are missing or invalid', [{ field: 'transactionId', message: 'Pick one of your entries' }]);
  }
}

export async function createVaultItem({ space, user }, b) {
  await checkTransaction(space._id, b.transactionId);
  const x = new VaultItem({ space: space._id, createdBy: user._id, transaction: b.transactionId ?? null });
  setFields(x, b, VAULT_FIELDS);
  await x.save();
  return serializeVault(x);
}

export async function updateVaultItem(spaceId, id, b) {
  const x = await found(VaultItem, spaceId, id, 'Item not found');
  if (b.transactionId !== undefined) { await checkTransaction(spaceId, b.transactionId); x.transaction = b.transactionId; }
  if (b.expiryDate !== undefined) x.reminded = [];
  setFields(x, b, VAULT_FIELDS);
  await x.save();
  return serializeVault(x);
}

export async function deleteVaultItem(spaceId, id) {
  await VaultItem.deleteOne({ _id: (await found(VaultItem, spaceId, id, 'Item not found'))._id });
}

// ── Card rewards ──

const serializeRate = (c) => ({ accountId: String(c.account), type: c.type, defaultRate: c.defaultRate, pointValue: c.pointValue ?? null, rules: c.rules.map((r) => ({ category: r.category, rate: r.rate })) });

export async function saveCardRewards(spaceId, accountId, b) {
  if (!mongoose.isValidObjectId(accountId) || !(await Account.exists({ _id: accountId, space: spaceId, type: 'credit_card' }))) {
    throw new HttpError(404, 'card_not_found', 'Credit card not found');
  }
  const c = await CardReward.findOneAndUpdate(
    { space: spaceId, account: accountId },
    { $set: { type: b.type, defaultRate: b.defaultRate, pointValue: b.type === 'points' ? b.pointValue : null, rules: b.rules ?? [] } },
    { upsert: true, new: true, runValidators: true },
  ).lean();
  return serializeRate(c);
}

export async function removeCardRewards(spaceId, accountId) {
  if (mongoose.isValidObjectId(accountId)) await CardReward.deleteOne({ space: spaceId, account: accountId });
}

// Over the last `months` complete months plus this one: what each card earned on what was spent with it, and for
// each category, which of your cards would have earned the most on all of that category's spending.
export async function rewardsReport(spaceId, { months = 12 }) {
  const cards = await Account.find({ space: spaceId, type: 'credit_card', archived: false }).select('name').lean();
  const rates = new Map((await CardReward.find({ space: spaceId }).lean()).map((c) => [String(c.account), c]));
  const from = monthRange(shiftMonth(currentMonth(today()), -months)).from;
  const rows = await Transaction.aggregate([
    { $match: { space: oid(spaceId), deletedAt: null, type: 'expense', date: { $gte: from } } },
    ...explodeSplits(),
    { $group: { _id: { account: '$account', category: '$category' }, total: { $sum: '$amountPaise' } } },
  ]);
  const rated = cards.filter((c) => rates.has(String(c._id)));
  const perCard = cards.map((c) => {
    const rate = rates.get(String(c._id));
    const spent = rows.filter((r) => String(r._id.account) === String(c._id));
    return {
      accountId: String(c._id), name: c.name, rates: rate ? serializeRate(rate) : null,
      spent: money(spent.reduce((s, r) => s + r.total, 0)),
      earned: rate ? money(spent.reduce((s, r) => s + rewardValue(rate, r._id.category, r.total), 0)) : null,
    };
  });
  const byCategory = new Map();
  for (const r of rows) byCategory.set(r._id.category, (byCategory.get(r._id.category) ?? 0) + r.total);
  const categories = [...byCategory].sort((a, b) => b[1] - a[1]).map(([category, total]) => {
    const options = rated.map((c) => ({ accountId: String(c._id), name: c.name, pct: effectivePct(rates.get(String(c._id)), category), value: rewardValue(rates.get(String(c._id)), category, total) }))
      .sort((a, b) => b.value - a.value);
    return { category, spent: money(total), best: options[0] ? { ...options[0], value: money(options[0].value) } : null };
  });
  return { from: dayString(from), months, cards: perCard, categories };
}

// ── FIRE ──

const DEFAULTS = { returnPct: 10, inflationPct: 6, withdrawalPct: 4 };

// Real figures from the space: the last 12 complete months of spending and of income minus spending, and what the
// investments are worth now. Each can be overridden, as can the assumptions.
export async function fire(spaceId, q) {
  const to = monthRange(shiftMonth(currentMonth(today()), -1)).to;
  const from = monthRange(shiftMonth(currentMonth(today()), -12)).from;
  const [flows] = await Transaction.aggregate([
    { $match: { space: oid(spaceId), deletedAt: null, type: { $in: ['income', 'expense'] }, date: { $gte: from, $lte: to } } },
    { $group: { _id: null, income: { $sum: { $cond: [{ $eq: ['$type', 'income'] }, '$amountPaise', 0] } }, expense: { $sum: { $cond: [{ $eq: ['$type', 'expense'] }, '$amountPaise', 0] } } } },
  ]);
  const inv = await listInvestments(spaceId);
  const found12 = { annualSpend: flows?.expense ?? 0, annualSaving: Math.max(0, (flows?.income ?? 0) - (flows?.expense ?? 0)), corpus: inv.summary.value.paise };
  const inputs = {
    annualSpendPaise: q.annualSpend ?? found12.annualSpend,
    annualSavingPaise: q.annualSaving ?? found12.annualSaving,
    corpusPaise: q.corpus ?? found12.corpus,
    returnPct: q.returnPct ?? DEFAULTS.returnPct,
    inflationPct: q.inflationPct ?? DEFAULTS.inflationPct,
    withdrawalPct: q.withdrawalPct ?? DEFAULTS.withdrawalPct,
  };
  const p = inputs.annualSpendPaise > 0 ? fireProjection(inputs) : null;
  return {
    from: dayString(from), to: dayString(to),
    found: { annualSpend: money(found12.annualSpend), annualSaving: money(found12.annualSaving), corpus: money(found12.corpus) },
    inputs: {
      annualSpend: money(inputs.annualSpendPaise), annualSaving: money(inputs.annualSavingPaise), corpus: money(inputs.corpusPaise),
      returnPct: inputs.returnPct, inflationPct: inputs.inflationPct, withdrawalPct: inputs.withdrawalPct,
    },
    target: p ? money(p.targetPaise) : null,
    realReturnPct: p?.realReturnPct ?? null,
    years: p?.years ?? null,
    year: p?.years !== null && p?.years !== undefined ? today().getUTCFullYear() + p.years : null,
    series: p ? p.series.map((s) => ({ year: s.year, corpus: money(s.corpusPaise) })) : [],
    note: 'A projection in today’s money: returns are counted after inflation and you save the same each year. Markets don’t move in straight lines; not financial advice.',
  };
}

// ── Reminders ──

// Warranties and policies 30 and 7 days before they end, and vehicle services coming due. Once each.
export async function sendLifeReminders({ on = today() } = {}) {
  let sent = 0;
  const spaces = new Map();
  const spaceOf = async (id) => { if (!spaces.has(String(id))) spaces.set(String(id), await Space.findById(id).lean()); return spaces.get(String(id)); };
  for (const x of await VaultItem.find({ expiryDate: { $gte: on, $lte: addDays(on, 30) } }).lean()) {
    const days = Math.round((x.expiryDate - on) / 86_400_000);
    const step = days <= 7 ? 7 : 30;
    const key = `${dayString(x.expiryDate)}:${step}`;
    if (x.reminded.includes(key)) continue;
    const claim = await VaultItem.updateOne({ _id: x._id, reminded: { $ne: key } }, { $push: { reminded: key } });
    if (!claim.modifiedCount) continue;
    const space = await spaceOf(x.space);
    if (!space) continue;
    const title = x.kind === 'warranty' ? `${x.name}: warranty ends ${shortDay(x.expiryDate)}` : `Renew ${x.name} by ${shortDay(x.expiryDate)}`;
    const body = x.kind === 'warranty'
      ? `The warranty${x.provider ? ` from ${x.provider}` : ''} ends in ${days} day${days === 1 ? '' : 's'}. Get anything faulty checked before then.`
      : `The policy${x.number ? ` ${x.number}` : ''}${x.provider ? ` with ${x.provider}` : ''} is due for renewal in ${days} day${days === 1 ? '' : 's'}${x.amountPaise ? ` (premium ${inr(x.amountPaise)})` : ''}.`;
    await notifySpace(space, { kind: 'bill', title, body, path: '/vault', tag: `vault-${x._id}`, linkText: 'Open the vault' });
    sent += 1;
  }
  for (const v of await Vehicle.find({ $or: [{ 'service.everyKm': { $ne: null } }, { 'service.everyMonths': { $ne: null } }] }).lean()) {
    const due = serviceDue(v.service, vehicleStats(v.fills).odometerKm, on);
    if (!due || due.status === 'ok') continue;
    const key = `${due.nextKm ?? ''}:${due.nextDate ? dayString(due.nextDate) : ''}`;
    if (v.remindedFor === key) continue;
    const claim = await Vehicle.updateOne({ _id: v._id, remindedFor: { $ne: key } }, { $set: { remindedFor: key } });
    if (!claim.modifiedCount) continue;
    const space = await spaceOf(v.space);
    if (!space) continue;
    const when = [due.nextKm !== null ? `at ${due.nextKm.toLocaleString('en-IN')} km` : null, due.nextDate ? `by ${shortDay(due.nextDate)}` : null].filter(Boolean).join(' or ');
    await notifySpace(space, { kind: 'bill', title: `${v.name} is due for a service`, body: `The next service is due ${when}.`, path: '/vehicles', tag: `service-${v._id}`, linkText: 'See your vehicles' });
    sent += 1;
  }
  return { sent };
}

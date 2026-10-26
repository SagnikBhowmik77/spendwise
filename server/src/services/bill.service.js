import mongoose from 'mongoose';
import { HttpError } from '../errors.js';
import { config } from '../config.js';
import { Account, Bill, BILL_FREQUENCIES, Space } from '../models/index.js';
import { dayString, formatPaise, monthRange } from '../money.js';
import { occurrenceDate, todayIn } from '../schedule.js';
import { create as createTx, remove as removeTx } from './transaction.service.js';
import { notifySpace } from './alert.service.js';

// Reminders go out this many days before a bill is due.
export const REMIND_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const NOT_FOUND = () => new HttpError(404, 'bill_not_found', 'Bill not found');
const money = (paise) => (paise === null || paise === undefined ? null : { paise, rupees: paise / 100 });
const fieldError = (field, message) => new HttpError(400, 'validation_failed', 'Some fields are missing or invalid', [{ field, message }]);
const shortDay = (d) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(d);

// The i-th due date (0 = first). Computed from the first due date, so a bill due on the 31st stays on month ends.
const dueAt = (b, i) => occurrenceDate(b.firstDue, 'monthly', BILL_FREQUENCIES[b.frequency], i);
const daysBetween = (a, b) => Math.round((b - a) / DAY_MS);

function statusFor(due, today) {
  const days = daysBetween(today, due);
  return days < 0 ? 'overdue' : days <= REMIND_DAYS ? 'due-soon' : 'upcoming';
}

function serialize(b, today = todayIn(config.timeZone)) {
  const nextDue = b.active ? dueAt(b, b.paidCount) : null;
  return {
    id: String(b._id),
    name: b.name,
    amount: money(b.amountPaise),
    category: b.category,
    account: b.account ? String(b.account) : null,
    frequency: b.frequency,
    firstDue: dayString(b.firstDue),
    active: b.active,
    nextDue: nextDue ? dayString(nextDue) : null,
    daysUntilDue: nextDue ? daysBetween(today, nextDue) : null,
    status: nextDue ? statusFor(nextDue, today) : 'inactive',
    payments: [...b.payments].reverse().map((p) => ({
      id: String(p._id), dueDate: dayString(p.dueDate), paidOn: p.paidOn ? dayString(p.paidOn) : null,
      amount: money(p.amountPaise), skipped: p.skipped, transactionId: p.transaction ? String(p.transaction) : null,
    })),
  };
}

async function owned(spaceId, id) {
  if (!mongoose.isValidObjectId(id)) throw NOT_FOUND();
  const b = await Bill.findOne({ _id: id, space: spaceId });
  if (!b) throw NOT_FOUND();
  return b;
}

async function checkAccount(spaceId, account) {
  if (account && !(await Account.exists({ _id: account, space: spaceId }))) throw fieldError('account', 'Choose one of your accounts');
}

// Active bills soonest first, then stopped ones.
export async function list(spaceId) {
  const today = todayIn(config.timeZone);
  const bills = (await Bill.find({ space: spaceId }).lean()).map((b) => serialize(b, today));
  return bills.sort((a, b) => (a.nextDue ?? '9999').localeCompare(b.nextDue ?? '9999') || a.name.localeCompare(b.name));
}

// Every due date in a month: paid or skipped ones from history, the rest as overdue, due soon or upcoming.
export async function calendar(spaceId, month) {
  const today = todayIn(config.timeZone);
  const { from, to } = monthRange(month);
  const items = [];
  for (const b of await Bill.find({ space: spaceId }).lean()) {
    for (let i = 0; i < 2000; i += 1) {
      const due = dueAt(b, i);
      if (due > to || (i >= b.paidCount && !b.active)) break;
      if (due < from) continue;
      const payment = i < b.paidCount ? b.payments.find((p) => +p.dueDate === +due) : null;
      items.push({
        billId: String(b._id),
        name: b.name,
        category: b.category,
        dueDate: dayString(due),
        amount: money(payment && !payment.skipped ? payment.amountPaise : b.amountPaise),
        status: i < b.paidCount ? (payment?.skipped ? 'skipped' : 'paid') : statusFor(due, today),
        paidOn: payment?.paidOn ? dayString(payment.paidOn) : null,
      });
    }
  }
  items.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name));
  return { month, items };
}

export async function create({ space, user }, { name, amount = null, category, account = null, frequency, firstDue }) {
  await checkAccount(space._id, account);
  const b = await Bill.create({ space: space._id, name, amountPaise: amount, category, account, frequency, firstDue, createdBy: user._id });
  return serialize(b);
}

export async function update(spaceId, id, changes) {
  const b = await owned(spaceId, id);
  await checkAccount(spaceId, changes.account);
  for (const [k, field] of Object.entries({ name: 'name', amount: 'amountPaise', category: 'category', account: 'account', frequency: 'frequency', firstDue: 'firstDue', active: 'active' })) {
    if (changes[k] !== undefined) b[field] = changes[k];
  }
  // A new due date means the next reminder is for that date.
  if (changes.firstDue !== undefined || changes.frequency !== undefined) b.remindedFor = null;
  await b.save();
  return serialize(b);
}

export async function remove(spaceId, id) {
  await Bill.deleteOne({ _id: (await owned(spaceId, id))._id });
}

// "Mark as paid": records the expense (unless addEntry is false) and moves on to the next due date.
export async function pay({ space, user }, id, { amount, date, account, addEntry = true }) {
  const b = await owned(space._id, id);
  if (!b.active) throw new HttpError(409, 'bill_inactive', 'This bill is stopped; start it again to pay it');
  const amountPaise = amount ?? b.amountPaise;
  if (!amountPaise) throw fieldError('amount', 'Enter how much this bill came to');
  await checkAccount(space._id, account);
  const dueDate = dueAt(b, b.paidCount);
  const paidOn = date ?? todayIn(config.timeZone);
  let transaction = null;
  if (addEntry) {
    const tx = await createTx({ space, user }, {
      type: 'expense', amount: amountPaise, category: b.category, date: paidOn,
      note: `${b.name} bill (due ${shortDay(dueDate)})`, account: account ?? b.account ?? undefined,
    });
    transaction = tx.id;
  }
  b.payments.push({ dueDate, paidOn, amountPaise, transaction });
  b.paidCount += 1;
  await b.save();
  return serialize(b);
}

// Nothing to pay this time (paid elsewhere, waived): move to the next due date without an entry.
export async function skip(spaceId, id) {
  const b = await owned(spaceId, id);
  if (!b.active) throw new HttpError(409, 'bill_inactive', 'This bill is stopped');
  b.payments.push({ dueDate: dueAt(b, b.paidCount), skipped: true });
  b.paidCount += 1;
  await b.save();
  return serialize(b);
}

// Takes back the most recent payment or skip, removing the expense it recorded (restorable for 30 days).
export async function undoLast({ space, user }, id) {
  const b = await owned(space._id, id);
  const last = b.payments.at(-1);
  if (!last) throw new HttpError(409, 'nothing_to_undo', 'This bill has no payments to undo');
  if (last.transaction) await removeTx({ space, user }, last.transaction).catch(() => null);
  last.deleteOne();
  b.paidCount = Math.max(0, b.paidCount - 1);
  await b.save();
  return serialize(b);
}

// Once per due date, 3 days (or fewer) before it, everyone in the space who wants bill reminders gets one.
export async function sendBillReminders({ today = todayIn(config.timeZone) } = {}) {
  let sent = 0;
  for (const b of await Bill.find({ active: true }).lean()) {
    const due = dueAt(b, b.paidCount);
    const days = daysBetween(today, due);
    const key = dayString(due);
    if (days < 0 || days > REMIND_DAYS || b.remindedFor === key) continue;
    const claim = await Bill.updateOne({ _id: b._id, remindedFor: { $ne: key } }, { $set: { remindedFor: key } });
    if (!claim.modifiedCount) continue;
    const space = await Space.findById(b.space).lean();
    if (!space) continue;
    const when = days === 0 ? 'is due today' : days === 1 ? 'is due tomorrow' : `is due in ${days} days`;
    await notifySpace(space, {
      kind: 'bill',
      title: `${b.name} ${when}`,
      body: `${b.amountPaise ? `₹${formatPaise(b.amountPaise)}` : 'Payment'} due on ${shortDay(due)}. Mark it paid in Spendwise once it's done.`,
      path: '/bills',
      tag: `bill-${b._id}`,
      linkText: 'See your bills',
    });
    sent += 1;
  }
  return { sent };
}

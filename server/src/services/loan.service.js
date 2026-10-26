import mongoose from 'mongoose';
import { HttpError } from '../errors.js';
import { config } from '../config.js';
import { Account, Loan } from '../models/index.js';
import { dayString, formatPaise } from '../money.js';
import { todayIn } from '../schedule.js';
import { emiFor, loanState, prepaymentImpact, projection } from '../finance.js';
import { create as createTx, remove as removeTx } from './transaction.service.js';

const NOT_FOUND = () => new HttpError(404, 'loan_not_found', 'Loan not found');
const money = (paise) => (paise === null ? null : { paise, rupees: paise / 100 });
const fieldError = (field, message) => new HttpError(400, 'validation_failed', 'Some fields are missing or invalid', [{ field, message }]);
const day = (d) => (d ? dayString(d) : null);

function serialize(l) {
  const s = loanState({ principalPaise: l.principalPaise, annualRatePct: l.annualRatePct, emiPaise: l.emiPaise, firstEmiDate: l.firstEmiDate, payments: l.payments });
  return {
    id: String(l._id),
    name: l.name,
    lender: l.lender,
    principal: money(l.principalPaise),
    annualRatePct: l.annualRatePct,
    tenureMonths: l.tenureMonths,
    firstEmiDate: day(l.firstEmiDate),
    emi: money(l.emiPaise),
    account: l.account ? String(l.account) : null,
    // Interest over the whole loan if every EMI is paid on schedule, for comparison.
    scheduledInterest: money(projection(l.principalPaise, l.annualRatePct, l.emiPaise).interestPaise),
    balance: money(s.balancePaise),
    principalRepaid: money(s.principalRepaidPaise),
    interestPaid: money(s.interestPaidPaise),
    emisPaid: s.emisPaid,
    monthsLeft: s.monthsLeft,
    interestLeft: money(s.interestLeftPaise),
    nextEmiDate: day(s.nextEmiDate),
    payoffDate: day(s.payoffDate),
    closed: s.balancePaise === 0,
    payments: [...l.payments].sort((a, b) => b.date - a.date).map((p) => ({
      id: String(p._id), kind: p.kind, amount: money(p.amountPaise), date: day(p.date), note: p.note, transactionId: p.transaction ? String(p.transaction) : null,
    })),
  };
}

async function owned(spaceId, id) {
  if (!mongoose.isValidObjectId(id)) throw NOT_FOUND();
  const l = await Loan.findOne({ _id: id, space: spaceId });
  if (!l) throw NOT_FOUND();
  return l;
}

async function checkAccount(spaceId, account) {
  if (account && !(await Account.exists({ _id: account, space: spaceId }))) throw fieldError('account', 'Choose one of your accounts');
}

export async function list(spaceId) {
  return (await Loan.find({ space: spaceId }).sort({ createdAt: 1 }).lean()).map(serialize);
}

// The EMI is worked out from the amount, rate and tenure unless the lender's exact figure is given.
export async function create({ space, user }, { name, lender = '', principal, annualRatePct, tenureMonths, firstEmiDate, emi, account = null }) {
  const emiPaise = emi ?? emiFor(principal, annualRatePct, tenureMonths);
  if (projection(principal, annualRatePct, emiPaise).months === null) throw fieldError('emi', "This EMI doesn't even cover the interest, so the loan would never be repaid");
  await checkAccount(space._id, account);
  const l = await Loan.create({ space: space._id, name, lender, principalPaise: principal, annualRatePct, tenureMonths, firstEmiDate, emiPaise, account, createdBy: user._id });
  return serialize(l);
}

export async function update(spaceId, id, changes) {
  const l = await owned(spaceId, id);
  await checkAccount(spaceId, changes.account);
  const map = { name: 'name', lender: 'lender', principal: 'principalPaise', annualRatePct: 'annualRatePct', tenureMonths: 'tenureMonths', firstEmiDate: 'firstEmiDate', emi: 'emiPaise', account: 'account' };
  for (const [k, field] of Object.entries(map)) if (changes[k] !== undefined) l[field] = changes[k];
  if (projection(l.principalPaise, l.annualRatePct, l.emiPaise).months === null) throw fieldError('emi', "This EMI doesn't even cover the interest, so the loan would never be repaid");
  await l.save();
  return serialize(l);
}

export async function remove(spaceId, id) {
  await Loan.deleteOne({ _id: (await owned(spaceId, id))._id });
}

// Records an EMI (default: the loan's EMI) or a prepayment. With addEntry, the same payment is also
// added as an "EMI & Loans" expense from the loan's account, so balances and budgets see it.
export async function addPayment({ space, user }, id, { kind, amount, date, note = '', addEntry = true, account }) {
  const l = await owned(space._id, id);
  if (serialize(l).closed) throw new HttpError(409, 'loan_closed', 'This loan is already fully repaid');
  const amountPaise = amount ?? l.emiPaise;
  const when = date ?? todayIn(config.timeZone);
  await checkAccount(space._id, account);
  let transaction = null;
  if (addEntry) {
    const tx = await createTx({ space, user }, {
      type: 'expense', amount: amountPaise, category: 'EMI & Loans', date: when,
      note: `${kind === 'emi' ? 'EMI' : 'Prepayment'}: ${l.name}${note ? ` (${note})` : ''}`,
      account: account ?? l.account ?? undefined,
    });
    transaction = tx.id;
  }
  l.payments.push({ kind, amountPaise, date: when, note, transaction });
  await l.save();
  return serialize(l);
}

// Removing a payment also removes the expense recorded with it (restorable for 30 days like any entry).
export async function removePayment({ space, user }, id, paymentId) {
  const l = await owned(space._id, id);
  const p = mongoose.isValidObjectId(paymentId) && l.payments.id(paymentId);
  if (!p) throw new HttpError(404, 'payment_not_found', 'Payment not found');
  if (p.transaction) await removeTx({ space, user }, p.transaction).catch(() => null);
  p.deleteOne();
  await l.save();
  return serialize(l);
}

// "What if I prepay ₹X now?" Both ways a lender can apply it.
export async function prepayment(spaceId, id, { amount }) {
  const l = await owned(spaceId, id);
  const s = serialize(l);
  if (s.closed) throw new HttpError(409, 'loan_closed', 'This loan is already fully repaid');
  if (amount > s.balance.paise) throw fieldError('amount', `That's more than the ₹${formatPaise(s.balance.paise)} left to repay`);
  const r = prepaymentImpact({ balancePaise: s.balance.paise, annualRatePct: l.annualRatePct, emiPaise: l.emiPaise, lumpPaise: amount });
  return {
    amount: money(amount),
    now: { balance: s.balance, emi: s.emi, monthsLeft: r.before.months, interestLeft: money(r.before.interestPaise) },
    reduceTenure: { emi: s.emi, monthsLeft: r.reduceTenure.months, monthsSaved: r.reduceTenure.monthsSaved, interestLeft: money(r.reduceTenure.interestPaise), interestSaved: money(r.reduceTenure.interestSavedPaise) },
    reduceEmi: { emi: money(r.reduceEmi.emiPaise), monthsLeft: r.reduceEmi.months, interestLeft: money(r.reduceEmi.interestPaise), interestSaved: money(r.reduceEmi.interestSavedPaise) },
  };
}

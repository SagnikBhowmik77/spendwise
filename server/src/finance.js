// Money maths for goals, loans, shared expenses and credit cards. Amounts are whole paise,
// interest rates are annual percentages (8.5 = 8.5% a year) and days are UTC-midnight Dates.
import { occurrenceDate } from './schedule.js';

const MAX_MONTHS = 600; // 50 years: anything longer is treated as "never paid off"

// Standard EMI: P·r·(1+r)^n / ((1+r)^n − 1) with r the monthly rate.
export function emiFor(principalPaise, annualRatePct, months) {
  const r = annualRatePct / 1200;
  if (r === 0) return Math.ceil(principalPaise / months);
  const f = (1 + r) ** months;
  return Math.round((principalPaise * r * f) / (f - 1));
}

// Paying `emiPaise` every month from `balancePaise`: how many months, and how much interest.
// Simulated month by month with rounding to the paisa, like a lender's schedule; the last EMI is smaller.
export function projection(balancePaise, annualRatePct, emiPaise) {
  const r = annualRatePct / 1200;
  let balance = balancePaise;
  let interest = 0;
  let months = 0;
  while (balance > 0 && months < MAX_MONTHS) {
    const i = Math.round(balance * r);
    if (emiPaise <= i) return { months: null, interestPaise: null };
    interest += i;
    balance += i - emiPaise;
    // Paise left over from rounding the EMI are folded into the last EMI, as lenders do.
    if (balance < 100) balance = 0;
    months += 1;
  }
  return balance > 0 ? { months: null, interestPaise: null } : { months, interestPaise: interest };
}

// Where a loan stands after the payments recorded so far. An EMI first pays that month's interest
// on the balance and the rest reduces it; a prepayment reduces the balance directly.
export function loanState({ principalPaise, annualRatePct, emiPaise, firstEmiDate, payments }) {
  const r = annualRatePct / 1200;
  let balance = principalPaise;
  let interestPaid = 0;
  let emisPaid = 0;
  const sorted = [...payments].sort((a, b) => a.date - b.date);
  for (const p of sorted) {
    if (p.kind === 'emi') {
      const interest = Math.min(p.amountPaise, Math.round(balance * r));
      interestPaid += interest;
      balance = Math.max(0, balance - (p.amountPaise - interest));
      emisPaid += 1;
    } else {
      balance = Math.max(0, balance - p.amountPaise);
    }
  }
  const ahead = projection(balance, annualRatePct, emiPaise);
  const nextEmiDate = balance > 0 ? occurrenceDate(firstEmiDate, 'monthly', 1, emisPaid) : null;
  const payoffDate = ahead.months ? occurrenceDate(firstEmiDate, 'monthly', 1, emisPaid + ahead.months - 1) : null;
  return {
    balancePaise: balance,
    principalRepaidPaise: principalPaise - balance,
    interestPaidPaise: interestPaid,
    emisPaid,
    monthsLeft: ahead.months,
    interestLeftPaise: ahead.interestPaise,
    nextEmiDate,
    payoffDate,
  };
}

// What a one-off prepayment now would do: keep the EMI and finish sooner, or keep the end date and pay a smaller EMI.
export function prepaymentImpact({ balancePaise, annualRatePct, emiPaise, lumpPaise }) {
  const before = projection(balancePaise, annualRatePct, emiPaise);
  const left = Math.max(0, balancePaise - lumpPaise);
  const shorter = projection(left, annualRatePct, emiPaise);
  const newEmi = left && before.months ? emiFor(left, annualRatePct, before.months) : 0;
  const smaller = projection(left, annualRatePct, newEmi || 1);
  return {
    before,
    reduceTenure: {
      months: shorter.months,
      monthsSaved: before.months && shorter.months !== null ? before.months - shorter.months : null,
      interestPaise: shorter.interestPaise,
      interestSavedPaise: before.interestPaise !== null && shorter.interestPaise !== null ? before.interestPaise - shorter.interestPaise : null,
    },
    reduceEmi: {
      emiPaise: newEmi,
      months: left ? smaller.months : 0,
      interestPaise: left ? smaller.interestPaise : 0,
      interestSavedPaise: before.interestPaise !== null && (left ? smaller.interestPaise : 0) !== null ? before.interestPaise - (left ? smaller.interestPaise : 0) : null,
    },
  };
}

// Whole months from `from` to `to` (the target month counts), at least 1.
export function monthsUntil(from, to) {
  const m = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth()) + (to.getUTCDate() >= from.getUTCDate() ? 1 : 0);
  return Math.max(1, m);
}

// Saving the rest evenly until the target date.
export function neededPerMonth({ targetPaise, savedPaise, today, targetDate }) {
  const left = targetPaise - savedPaise;
  if (left <= 0 || !targetDate) return left <= 0 ? 0 : null;
  if (targetDate < today) return left;
  return Math.ceil(left / monthsUntil(today, targetDate));
}

// ₹100 among 3 → [3334, 3333, 3333]: the extra paise go to the first people.
export function equalSplit(totalPaise, people) {
  const base = Math.floor(totalPaise / people);
  return Array.from({ length: people }, (_, i) => base + (i < totalPaise - base * people ? 1 : 0));
}

// Who pays whom to settle a group. `balances`: [{ id, paise }] where positive means owed money.
// The biggest debtor pays the biggest creditor until one is square, so no one pays more than once per
// creditor and there are at most (people − 1) payments.
export function settleUp(balances) {
  const creditors = balances.filter((b) => b.paise > 0).map((b) => ({ ...b })).sort((a, b) => b.paise - a.paise);
  const debtors = balances.filter((b) => b.paise < 0).map((b) => ({ ...b, paise: -b.paise })).sort((a, b) => b.paise - a.paise);
  const payments = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].paise, creditors[j].paise);
    if (amount > 0) payments.push({ from: debtors[i].id, to: creditors[j].id, paise: amount });
    debtors[i].paise -= amount;
    creditors[j].paise -= amount;
    if (debtors[i].paise === 0) i += 1;
    if (creditors[j].paise === 0) j += 1;
  }
  return payments;
}

// Day `d` of the month `offset` months from day's month, clamped to that month's length.
function dayOfMonth(day, d, offset = 0) {
  const first = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + offset, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last)));
}
const nextDay = (d) => new Date(d.getTime() + 24 * 60 * 60 * 1000);

// A credit card's billing cycle around `today`. The statement is made on `statementDay`; payment is due
// on the next `dueDay` after it. Returns the open cycle, the last closed one and that statement's due date.
export function cardCycle({ statementDay, dueDay, today }) {
  let lastStatement = dayOfMonth(today, statementDay);
  if (lastStatement >= today) lastStatement = dayOfMonth(today, statementDay, -1);
  const previousStatement = dayOfMonth(lastStatement, statementDay, -1);
  const nextStatement = dayOfMonth(lastStatement, statementDay, 1);
  let due = dayOfMonth(lastStatement, dueDay);
  if (due <= lastStatement) due = dayOfMonth(lastStatement, dueDay, 1);
  return {
    current: { from: nextDay(lastStatement), to: nextStatement },
    last: { from: nextDay(previousStatement), to: lastStatement },
    dueDate: due,
  };
}

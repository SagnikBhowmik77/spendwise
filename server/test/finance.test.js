// Batch 12E maths: EMIs, loan balances, prepayments, goals, splits and card cycles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardCycle, emiFor, equalSplit, loanState, monthsUntil, neededPerMonth, prepaymentImpact, projection, settleUp } from '../src/finance.js';
import { parseDay } from '../src/money.js';

const d = parseDay;
const day = (date) => date.toISOString().slice(0, 10);

test('EMI matches the standard formula banks use', () => {
  assert.equal(emiFor(100_000_000, 8.5, 240), 867_823); // ₹10 lakh, 8.5%, 20 years → ₹8,678.23
  assert.equal(emiFor(50_000_000, 10, 60), 1_062_352); // ₹5 lakh, 10%, 5 years → ₹10,623.52
  assert.equal(emiFor(1_200_000, 0, 12), 100_000); // no-cost EMI
  const p = projection(50_000_000, 10, 1_062_352);
  assert.equal(p.months, 60);
  assert.ok(Math.abs(p.interestPaise - 13_741_120) < 100, `interest ${p.interestPaise}`); // ≈ ₹1,37,411
  assert.deepEqual(projection(100_000, 24, 1_000), { months: null, interestPaise: null }); // EMI below interest: never ends
});

test('a loan after some EMIs and a prepayment', () => {
  const loan = { principalPaise: 50_000_000, annualRatePct: 10, emiPaise: 1_062_352, firstEmiDate: d('2026-05-05') };
  const emi = (date) => ({ kind: 'emi', amountPaise: 1_062_352, date: d(date) });
  const s = loanState({ ...loan, payments: [emi('2026-05-05'), emi('2026-06-05'), emi('2026-07-05')] });
  // Month 1: interest ₹4,166.67, principal ₹6,456.85 → balance ₹4,93,543.15, and so on.
  assert.equal(s.emisPaid, 3);
  assert.equal(s.interestPaidPaise, 416_667 + 411_286 + 405_860);
  assert.equal(s.balancePaise, 50_000_000 - (3 * 1_062_352 - (416_667 + 411_286 + 405_860)));
  assert.equal(s.monthsLeft, 57);
  assert.equal(day(s.nextEmiDate), '2026-08-05');
  assert.equal(day(s.payoffDate), '2031-04-05');

  const pre = loanState({ ...loan, payments: [emi('2026-05-05'), { kind: 'prepayment', amountPaise: 10_000_000, date: d('2026-05-20') }] });
  assert.ok(pre.monthsLeft < 50);
  const impact = prepaymentImpact({ balancePaise: s.balancePaise, annualRatePct: 10, emiPaise: 1_062_352, lumpPaise: 10_000_000 });
  assert.ok(impact.reduceTenure.monthsSaved >= 10);
  assert.ok(impact.reduceTenure.interestSavedPaise > impact.reduceEmi.interestSavedPaise);
  assert.equal(impact.reduceEmi.months, 57);
  assert.ok(impact.reduceEmi.emiPaise < 1_062_352);
  const cleared = loanState({ ...loan, payments: [{ kind: 'prepayment', amountPaise: 60_000_000, date: d('2026-05-01') }] });
  assert.deepEqual([cleared.balancePaise, cleared.monthsLeft, cleared.nextEmiDate], [0, 0, null]);
});

test('goals: months left and saving needed per month', () => {
  assert.equal(monthsUntil(d('2026-10-24'), d('2027-03-31')), 6);
  assert.equal(monthsUntil(d('2026-10-24'), d('2026-11-10')), 1);
  assert.equal(neededPerMonth({ targetPaise: 6_000_000, savedPaise: 1_200_000, today: d('2026-10-24'), targetDate: d('2027-03-31') }), 800_000);
  assert.equal(neededPerMonth({ targetPaise: 100, savedPaise: 150, today: d('2026-10-24'), targetDate: null }), 0);
  assert.equal(neededPerMonth({ targetPaise: 100, savedPaise: 0, today: d('2026-10-24'), targetDate: null }), null);
});

test('splits and the fewest payments to settle a group', () => {
  assert.deepEqual(equalSplit(10_000, 3), [3334, 3333, 3333]);
  assert.equal(equalSplit(10_000, 3).reduce((a, b) => a + b), 10_000);
  // A paid ₹900 for everyone, B paid ₹300: shares ₹400 each.
  const pay = settleUp([{ id: 'A', paise: 50_000 }, { id: 'B', paise: -10_000 }, { id: 'C', paise: -40_000 }]);
  assert.deepEqual(pay, [{ from: 'C', to: 'A', paise: 40_000 }, { from: 'B', to: 'A', paise: 10_000 }]);
  const four = settleUp([{ id: 'A', paise: 300 }, { id: 'B', paise: 200 }, { id: 'C', paise: -250 }, { id: 'D', paise: -250 }]);
  assert.ok(four.length <= 3);
  assert.deepEqual(['A', 'B', 'C', 'D'].map((id) => four.reduce((s, p) => s + (p.to === id ? -p.paise : 0) + (p.from === id ? p.paise : 0), 0)), [-300, -200, 250, 250]);
  assert.deepEqual(settleUp([{ id: 'A', paise: 0 }]), []);
});

test('credit card cycle: statement on the 15th, due on the 5th', () => {
  const c = cardCycle({ statementDay: 15, dueDay: 5, today: d('2026-10-24') });
  assert.deepEqual([day(c.last.from), day(c.last.to), day(c.dueDate), day(c.current.from), day(c.current.to)],
    ['2026-09-16', '2026-10-15', '2026-11-05', '2026-10-16', '2026-11-15']);
  // On statement day the cycle closes today; a 31st statement day clamps in short months.
  const s = cardCycle({ statementDay: 24, dueDay: 12, today: d('2026-10-24') });
  assert.deepEqual([day(s.current.to), day(s.last.to), day(s.dueDate)], ['2026-10-24', '2026-09-24', '2026-10-12']);
  const feb = cardCycle({ statementDay: 31, dueDay: 20, today: d('2027-02-10') });
  assert.deepEqual([day(feb.last.to), day(feb.current.to), day(feb.dueDate)], ['2027-01-31', '2027-02-28', '2027-02-20']);
});

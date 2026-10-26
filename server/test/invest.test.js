// Batch 12H maths: XIRR, FD, RD, PPF and AMFI's file layouts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fdValue, monthsBetween, parseNavFile, ppfValue, rdValue, unitsFor, xirr } from '../src/invest.js';
import { parseDay } from '../src/money.js';

const d = parseDay;

test('XIRR: a year at 10%, and monthly SIPs', () => {
  assert.equal(xirr([{ date: d('2025-01-01'), amount: -10_000 }, { date: d('2026-01-01'), amount: 11_000 }]), 10);
  // ₹1,000 a month for 12 months, worth ₹12,600 a month after the last: about 9% a year.
  const sip = Array.from({ length: 12 }, (_, i) => ({ date: d(`2025-${String(i + 1).padStart(2, '0')}-01`), amount: -1000 }));
  const r = xirr([...sip, { date: d('2026-01-01'), amount: 12_600 }]);
  assert.ok(r > 8.5 && r < 10, `xirr ${r}`);
  assert.equal(xirr([{ date: d('2025-01-01'), amount: -100 }]), null);
});

test('fixed deposit: quarterly compounding and simple interest', () => {
  const fd = fdValue({ principalPaise: 10_000_000, ratePct: 7, startDate: d('2025-01-01'), tenureMonths: 12 });
  assert.equal(fd.value, 10_718_590); // ₹1,00,000 × 1.0175⁴ = ₹1,07,185.90
  assert.equal(fd.maturityDate.toISOString().slice(0, 10), '2026-01-01');
  const half = fdValue({ principalPaise: 10_000_000, ratePct: 7, startDate: d('2025-01-01'), tenureMonths: 12, on: d('2025-07-02') });
  assert.ok(half.value > 10_340_000 && half.value < 10_360_000 && !half.matured);
  assert.equal(fdValue({ principalPaise: 10_000_000, ratePct: 6, startDate: d('2025-01-01'), tenureMonths: 12, compounding: 'simple' }).value, 10_600_000);
});

test('recurring deposit: each instalment grows for its own time', () => {
  const rd = rdValue({ monthlyPaise: 100_000, ratePct: 7, startDate: d('2025-01-01'), tenureMonths: 12 });
  assert.equal(rd.paid, 1_200_000);
  assert.ok(rd.value > 1_240_000 && rd.value < 1_250_000, `rd ${rd.value}`); // about ₹12,450
  const part = rdValue({ monthlyPaise: 100_000, ratePct: 7, startDate: d('2025-01-01'), tenureMonths: 12, on: d('2025-03-15') });
  assert.deepEqual([part.paid, part.matured], [300_000, false]);
});

test('PPF: a deposit counts for the month only if made by the 5th; interest credited in March', () => {
  const early = ppfValue({ deposits: [{ date: d('2025-04-03'), amountPaise: 15_000_000 }], ratePct: 7.1, on: d('2026-03-31') });
  assert.deepEqual([early.interestCredited, early.balance, early.accrued], [1_065_000, 16_065_000, 0]);
  const late = ppfValue({ deposits: [{ date: d('2025-04-10'), amountPaise: 15_000_000 }], ratePct: 7.1, on: d('2026-03-31') });
  assert.equal(late.interestCredited, 976_250); // April missed: 11 months
  assert.equal(early.maturityDate.toISOString().slice(0, 10), '2041-04-01'); // 15 full financial years
  const mid = ppfValue({ deposits: [{ date: d('2025-04-03'), amountPaise: 15_000_000 }], ratePct: 7.1, on: d('2025-06-30') });
  assert.deepEqual([mid.balance, mid.accrued], [15_000_000, 266_250]); // 3 months accrued, not yet credited
});

test('AMFI files: the daily layout and the history layout', () => {
  const daily = [
    'Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date',
    ' ', 'Open Ended Schemes(Equity Scheme - Flexi Cap Fund)', ' ', 'PPFAS Mutual Fund', ' ',
    '122639;INF879O01027;-;Parag Parikh Flexi Cap Fund;Direct Plan;Growth;88.9695;23-Oct-2026',
    '999999;-;-;Closed Fund;Direct Plan;Growth;N.A.;23-Oct-2026',
  ].join('\r\n');
  const [row, ...rest] = parseNavFile(daily);
  assert.equal(rest.length, 0);
  assert.deepEqual([row.code, row.name, row.plan, row.option, row.isin, row.isinReinv, row.nav, row.date.toISOString().slice(0, 10)],
    [122639, 'Parag Parikh Flexi Cap Fund', 'Direct Plan', 'Growth', 'INF879O01027', '', 88.9695, '2026-10-23']);
  const hist = 'Scheme Code;NAV Name;Plan;Option;ISIN Div Payout/ISIN Growth;ISIN Div Reinvestment;Net Asset Value;Date\n\nPPFAS Mutual Fund\n122639;Parag Parikh Flexi Cap Fund - Direct Plan - Growth;Direct Plan;Growth;INF879O01027;;88.7620;05-Oct-2026\n';
  assert.deepEqual(parseNavFile(hist).map((r) => [r.code, r.nav, r.date.toISOString().slice(0, 10)]), [[122639, 88.762, '2026-10-05']]);
  assert.deepEqual(parseNavFile('not a nav file'), []);
  assert.equal(unitsFor(500_000, 88.762), 56.3304); // ₹5,000 at ₹88.762
  assert.equal(monthsBetween(d('2025-01-15'), d('2025-04-14')), 2);
});

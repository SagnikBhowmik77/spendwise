// Batch 12G: tax maths, worked by hand from the official rates for tax year 2026-27.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTax, fyOf, fyRange, hraExemption, salaryBreakdown } from '../src/tax.js';
import { parseDay } from '../src/money.js';

const L = (r) => Math.round(r * 100);
const tax = (taxable, regime = 'new', age, fy = '2026-27') => computeTax({ fy, regime, taxable: L(taxable), age });

test('new regime: ₹12 lakh is tax-free, marginal relief just above it', () => {
  assert.deepEqual([tax(1200000).slabTax, tax(1200000).rebate, tax(1200000).total], [L(60000), L(60000), 0]);
  // ₹12.25 lakh: slab tax ₹63,750, but tax can't exceed the ₹25,000 above ₹12 lakh → ₹25,000 + 4% cess.
  const t = tax(1225000);
  assert.deepEqual([t.slabTax, t.rebate, t.cess, t.total], [L(63750), L(38750), L(1000), L(26000)]);
  // ₹12.8 lakh: ₹72,000 is less than the ₹80,000 above ₹12 lakh, so no relief.
  assert.deepEqual([tax(1280000).rebate, tax(1280000).total], [0, L(74880)]);
});

test('old regime by age, with the ₹5 lakh rebate', () => {
  assert.equal(tax(1000000, 'old').total, L(117000)); // 12,500 + 1,00,000 + 4% cess
  assert.equal(tax(500000, 'old').total, 0);
  assert.equal(tax(500000, 'old', 'senior').total, 0);
  assert.equal(tax(700000, 'old', 'superSenior').total, L(41600)); // 20% of 2 lakh + cess
  assert.equal(tax(1000000, 'old', 'senior').total, L(114400)); // 10,000 + 1,00,000 + cess
});

test('surcharge above ₹50 lakh, with marginal relief at the threshold', () => {
  assert.equal(tax(6000000).surcharge, L(138000));
  assert.equal(tax(6000000).total, L(1578720));
  // ₹50.1 lakh: 10% surcharge would be ₹1,08,300, but tax may only rise by the ₹10,000 above ₹50 lakh.
  const t = tax(5010000);
  assert.deepEqual([t.slabTax, t.surcharge, t.total], [L(1083000), L(7000), L(1133600)]);
  // Above ₹5 crore: 25% under the new regime, 37% under the old.
  assert.equal(tax(60000000).surcharge, Math.round(tax(60000000).slabTax * 0.25));
  assert.equal(tax(60000000, 'old').surcharge, Math.round(tax(60000000, 'old').slabTax * 0.37));
});

test('HRA: 50% of salary in the 8 listed cities from 2026-27, 4 cities before', () => {
  const pune = (fy) => hraExemption({ fy, hraReceived: L(360000), rentPaid: L(400000), salary: L(600000), city: 'Pune' });
  assert.deepEqual([pune('2026-27').exempt, pune('2026-27').pct], [L(300000), 50]);
  assert.deepEqual([pune('2025-26').exempt, pune('2025-26').pct], [L(240000), 40]);
  assert.equal(hraExemption({ fy: '2026-27', hraReceived: L(240000), rentPaid: L(240000), salary: L(600000), city: 'Jaipur' }).exempt, L(180000));
});

test('financial years run April to March', () => {
  assert.equal(fyOf(parseDay('2026-03-31')), '2025-26');
  assert.equal(fyOf(parseDay('2026-04-01')), '2026-27');
  assert.equal(fyOf(parseDay('2099-12-31')), '2099-00');
  const r = fyRange('2026-27');
  assert.deepEqual([r.from.toISOString().slice(0, 10), r.to.toISOString().slice(0, 10)], ['2026-04-01', '2027-03-31']);
  assert.throws(() => tax(100, 'new', 'below60', '2019-20'), /No tax rules/);
});

test('salary breakdown: ₹15 lakh CTC, both regimes', () => {
  const s = salaryBreakdown({ fy: '2026-27', ctc: L(1500000), basicPct: 40, pf: 'capped', rentPaid: L(300000), city: 'Bengaluru', investments: L(100000), healthSelf: L(20000) });
  assert.deepEqual([s.salary.basic, s.salary.employerPf, s.salary.gross, s.salary.hra], [L(600000), L(21600), L(1478400), L(300000)]);
  assert.deepEqual([s.new.taxable, s.new.tax.total, s.new.monthlyTakeHome], [L(1403400), L(94130), L(113347.5)]);
  assert.deepEqual(s.old.deductions, { hra: L(240000), standardDeduction: L(50000), professionalTax: L(2500), investments: L(121600), health: L(20000) });
  // ₹1,30,821.60 is rounded to the nearest ₹10 (section 516).
  assert.deepEqual([s.old.taxable, s.old.tax.total], [L(1044300), L(130820)]);
  assert.deepEqual([s.better, s.saving], ['new', L(36690)]);
});

test('rounding to the nearest ₹10 (section 516)', async () => {
  const { roundTen } = await import('../src/tax.js');
  assert.deepEqual([roundTen(L(94130.4)), roundTen(L(130825)), roundTen(L(130824.99)), roundTen(0)], [L(94130), L(130830), L(130820), 0]);
});

// Batch 12G API: tax rules and tracker, salary breakdown, 60-day cash flow, "Can I afford it?",
// financial-year report periods. Dates are relative to today.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, uniqueEmail, GOOD_PASSWORD } from './helpers.js';
import { addDays, occurrenceDate, todayIn } from '../src/schedule.js';
import { dayString } from '../src/money.js';
import { cardCycle } from '../src/finance.js';
import { fyOf, fyRange } from '../src/tax.js';

let t;
const newUser = async () => (await t.api('POST', '/api/auth/register', { body: { name: 'Arnav', email: uniqueEmail(), password: GOOD_PASSWORD } })).body.token;
const call = (method, path, body, tk) => t.api(method, path, { token: tk, body });
const now = todayIn('Asia/Kolkata');
const today = dayString(now);
const fy = fyOf(now);
const fyStart = fyRange(fy).from;
const inFy = (n) => dayString(addDays(fyStart, n) > now ? now : addDays(fyStart, n));

before(async () => { t = await startTestServer(); });
after(() => t.stop());

test('tax rules for the current and previous year, with their law and sections', async () => {
  const tk = await newUser();
  const r = (await call('GET', '/api/tax/rules', undefined, tk)).body;
  assert.equal(r.fy, fy);
  if (fy === '2026-27') {
    assert.deepEqual([r.law, r.sections.investments, r.limits.investments.rupees, r.standardDeduction.new.rupees], ['Income-tax Act, 2025', 'Section 123 (was 80C)', 150000, 75000]);
    assert.ok(r.hraFiftyPctCities.includes('Pune'));
  }
  const prev = (await call('GET', '/api/tax/rules?fy=2025-26', undefined, tk)).body;
  assert.deepEqual([prev.law, prev.sections.health, prev.hraFiftyPctCities.length], ['Income-tax Act, 1961', 'Section 80D', 4]);
  assert.equal((await call('GET', '/api/tax/rules?fy=2019-20', undefined, tk)).status, 400);
});

test('tax tracker: tagged expenses against each limit for the financial year', async () => {
  const tk = await newUser();
  const add = (amount, tags, date, category = 'Insurance') => call('POST', '/api/transactions', { type: 'expense', amount, category, tags, date }, tk);
  await add('50000', ['80c'], inFy(1));
  await add('120000', ['80C'], inFy(2), 'Investments');
  await add('20000', ['80d'], inFy(3));
  await add('30000', ['80d-parents'], inFy(4));
  for (const n of [0, 31, 62]) await add('25000', ['rent'], inFy(n), 'Rent');
  await add('99999', ['80c'], dayString(addDays(fyStart, -1))); // last financial year
  const s = (await call('GET', '/api/tax/summary?parentsSenior=true', undefined, tk)).body;
  const b = s.buckets;
  assert.deepEqual([b.investments.used.rupees, b.investments.remaining.rupees, b.investments.percent], [170000, 0, 100]);
  assert.deepEqual([b.healthSelf.used.rupees, b.healthSelf.limit.rupees], [20000, 25000]);
  assert.deepEqual([b.healthParents.used.rupees, b.healthParents.limit.rupees, b.healthParents.remaining.rupees], [30000, 50000, 20000]);
  assert.equal(b.rent.used.rupees, 75000);
  assert.equal(s.from, dayString(fyStart));
  assert.match(s.note, /estimate/i);
});

test('salary breakdown through the API (₹15 lakh CTC, Bengaluru rent)', async () => {
  const tk = await newUser();
  const res = await call('POST', '/api/tax/salary', { fy: '2026-27', ctc: '1500000', basicPct: 40, rentPaid: '300000', city: 'Bengaluru', investments: '100000', healthSelf: '20000' }, tk);
  assert.equal(res.status, 200);
  const s = res.body;
  assert.deepEqual([s.new.tax.total.rupees, s.new.monthlyTakeHome.rupees, s.old.tax.total.rupees, s.better, s.saving.rupees], [94130, 113347.5, 130820, 'new', 36690]);
  assert.equal(s.old.hraPct, 50);
  assert.ok(s.sources.length >= 3);
  assert.equal((await call('POST', '/api/tax/salary', { ctc: '1500000', age: 'teen' }, tk)).status, 400);
});

test('60-day cash flow: bills, EMIs and card dues against cash and bank, and "Can I afford it?"', async () => {
  const tk = await newUser();
  const bank = (await call('POST', '/api/accounts', { name: 'SBI', type: 'bank', openingBalance: '50000' }, tk)).body.account;
  // ₹3,000 already owed on the card (no purchases, so day-to-day spending stays at zero).
  const card = (await call('POST', '/api/accounts', { name: 'Card', type: 'credit_card', openingBalance: '-3000' }, tk)).body.account;
  await call('PATCH', `/api/accounts/${card.id}`, { statementDay: 15, dueDay: 5 }, tk);
  const c = cardCycle({ statementDay: 15, dueDay: 5, today: now });
  const billDue = addDays(now, 5);
  await call('POST', '/api/bills', { name: 'Electricity', amount: '10000', category: 'Bills & Utilities', frequency: 'monthly', firstDue: dayString(billDue), account: bank.id }, tk);
  const emiFirst = addDays(now, 10);
  await call('POST', '/api/loans', { name: 'Phone EMI', principal: '100000', annualRatePct: 0, tenureMonths: 20, firstEmiDate: dayString(emiFirst), account: bank.id }, tk);

  const f = (await call('GET', '/api/cashflow', undefined, tk)).body;
  const end = addDays(now, 60);
  const within = (first) => [0, 1, 2, 3].map((i) => occurrenceDate(first, 'monthly', 1, i)).filter((d) => d <= end).length;
  const bills = within(billDue);
  const emis = within(emiFirst);
  const cardDue = c.dueDate <= end ? 1 : 0;
  assert.equal(f.start.rupees, 50000);
  assert.equal(f.perDay.rupees, 0);
  assert.equal(f.days.length, 61);
  assert.equal(f.end.rupees, 50000 - bills * 10000 - emis * 5000 - cardDue * 3000);
  assert.ok(f.days.find((d) => d.date === dayString(billDue)).events.some((e) => e.kind === 'bill' && e.amount.rupees === -10000));
  assert.equal(f.firstNegative, null);

  const ok = (await call('GET', '/api/cashflow/afford?amount=5000', undefined, tk)).body;
  assert.equal(ok.verdict, 'yes');
  const no = (await call('GET', `/api/cashflow/afford?amount=${f.end.rupees + 1}`, undefined, tk)).body;
  assert.deepEqual([no.verdict, no.lowestWith.balance.rupees < 0], ['no', true]);
  assert.equal(no.monthsToSave, null);
});

test('financial-year periods in saved reports', async () => {
  const tk = await newUser();
  await call('POST', '/api/transactions', { type: 'expense', amount: '700', category: 'Food & Dining', date: today }, tk);
  await call('POST', '/api/transactions', { type: 'expense', amount: '900', category: 'Food & Dining', date: dayString(addDays(fyStart, -3)) }, tk);
  const thisFy = (await call('POST', '/api/saved-reports/preview', { groupBy: 'category', period: 'this-fy' }, tk)).body;
  assert.deepEqual([thisFy.from, thisFy.total.rupees], [dayString(fyStart), 700]);
  const lastFy = (await call('POST', '/api/saved-reports/preview', { groupBy: 'category', period: 'last-fy' }, tk)).body;
  assert.deepEqual([lastFy.from, lastFy.to, lastFy.total.rupees], [dayString(fyRange(fyOf(addDays(fyStart, -1))).from), dayString(addDays(fyStart, -1)), 900]);
});

// Batch 12F: insights, saved reports, streaks, challenges, achievements and "worth it?".
// CPI comes from a local stand-in for MoSPI's API, answering in MoSPI's own format.
// Dates are relative to today so the tests keep passing on any day.
import http from 'node:http';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const cpiOf = (y, m) => 100 + (y - 2025) * 12 + (m - 1); // made-up figures for the stub only
const stubNow = new Date();
const cpiStub = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const years = (u.searchParams.get('year') ?? '').split(',').map(Number);
  const series = u.searchParams.get('series');
  const data = [];
  for (const y of years) {
    if ((series === 'Back') !== (y < 2025)) continue;
    for (let m = 1; m <= 12; m += 1) {
      // Published with a month's lag, like MoSPI.
      if (y > stubNow.getUTCFullYear() || (y === stubNow.getUTCFullYear() && m >= stubNow.getUTCMonth() + 1)) continue;
      for (const sector of ['Rural', 'Urban', 'Combined']) {
        data.push({ base_year: '2024', series, year: String(y), month: MONTH_NAMES[m - 1], state: 'All India', sector, division: 'CPI (General)', index: String(cpiOf(y, m) + (sector === 'Combined' ? 0 : 5)) });
      }
    }
  }
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ data, meta_data: { page: 1, totalPages: 1 }, statusCode: true }));
});
await new Promise((r) => cpiStub.listen(0, '127.0.0.1', r));
process.env.CPI_URL = `http://127.0.0.1:${cpiStub.address().port}/api/cpi/getCPIData`;

const { test, before, after } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { startTestServer, uniqueEmail, GOOD_PASSWORD } = await import('./helpers.js');
const { todayIn, addDays } = await import('../src/schedule.js');
const { currentMonth, dayString, monthRange, shiftMonth } = await import('../src/money.js');

let t;
const newUser = async () => (await t.api('POST', '/api/auth/register', { body: { name: 'Ira', email: uniqueEmail(), password: GOOD_PASSWORD } })).body.token;
const call = (method, path, body, tk) => t.api(method, path, { token: tk, body });
const add = (tk, body) => call('POST', '/api/transactions', { type: 'expense', category: 'Food & Dining', ...body }, tk);
const now = todayIn('Asia/Kolkata');
const today = dayString(now);
const ago = (n) => dayString(addDays(now, -n));
const month = currentMonth(now);
const inMonth = (offset, dayOfMonth) => `${shiftMonth(month, offset)}-${String(dayOfMonth).padStart(2, '0')}`;

before(async () => { t = await startTestServer(); });
after(async () => { await t.stop(); cpiStub.close(); });

test('month-end forecast: spent so far + usual daily rate for the days left + bills still due', async () => {
  const tk = await newUser();
  for (const off of [-3, -2, -1]) await add(tk, { amount: '3000', date: inMonth(off, 10) });
  await add(tk, { amount: '1000', date: today });
  const f = (await call('GET', '/api/insights/forecast', undefined, tk)).body;
  assert.equal(f.spent.paise, 100_000);
  assert.equal(f.basis.method, 'history');
  const histFrom = new Date(`${inMonth(-3, 10)}T00:00:00Z`);
  const days = Math.round((monthRange(month).from - histFrom) / 86_400_000);
  assert.equal(f.basis.days, days);
  assert.equal(f.basis.perDay.paise, Math.round(900_000 / days));
  assert.equal(f.forecast.paise, f.spent.paise + f.expectedDayToDay.paise + f.scheduledTotal.paise);
  assert.equal(f.lastMonth.paise, 300_000);
  if (f.daysLeft > 0) {
    await call('POST', '/api/bills', { name: 'Electricity', amount: '1500', category: 'Bills & Utilities', frequency: 'monthly', firstDue: dayString(monthRange(month).to) }, tk);
    const g = (await call('GET', '/api/insights/forecast', undefined, tk)).body;
    assert.deepEqual(g.scheduled.map((s) => [s.kind, s.name, s.amount.paise]), [['bill', 'Electricity', 150_000]]);
    assert.equal(g.forecast.paise - f.forecast.paise, 150_000);
  }
});

test('unusual spending: a category far above its 3-month average, and an oversized single expense', async () => {
  const tk = await newUser();
  for (const off of [-3, -2, -1]) {
    await add(tk, { amount: '700', date: inMonth(off, 5) });
    await add(tk, { amount: '600', date: inMonth(off, 12) });
    await add(tk, { amount: '700', date: inMonth(off, 20) });
    await add(tk, { amount: '500', date: inMonth(off, 8), category: 'Transport' });
  }
  await add(tk, { amount: '9000', date: today, note: 'Anniversary dinner' });
  await add(tk, { amount: '450', date: today, category: 'Transport' });
  const u = (await call('GET', '/api/insights/unusual', undefined, tk)).body;
  assert.equal(u.baselineMonths, 3);
  assert.deepEqual(u.categories.map((c) => [c.category, c.spent.paise, c.average.paise]), [['Food & Dining', 900_000, 200_000]]);
  assert.deepEqual(u.transactions.map((x) => [x.note, x.amount.paise, x.usual.paise]), [['Anniversary dinner', 900_000, 70_000]]);
});

test('savings rate per month, with the average of complete months', async () => {
  const tk = await newUser();
  await add(tk, { type: 'income', amount: '50000', category: 'Salary', date: inMonth(-1, 1) });
  await add(tk, { amount: '40000', date: inMonth(-1, 15) });
  await add(tk, { type: 'income', amount: '50000', category: 'Salary', date: inMonth(-2, 1) });
  await add(tk, { amount: '45000', date: inMonth(-2, 15) });
  const s = (await call('GET', '/api/insights/savings-rate?months=3', undefined, tk)).body;
  assert.deepEqual(s.months.map((m) => [m.month, m.rate]), [[shiftMonth(month, -2), 10], [shiftMonth(month, -1), 20], [month, null]]);
  assert.equal(s.averageRate, 15);
});

test('patterns by weekday and time of day; comparing two periods', async () => {
  const tk = await newUser();
  // 2026-10-05 is a Monday, 2026-10-10 a Saturday (fixed past dates).
  await add(tk, { amount: '200', date: '2026-10-05', time: '08:30' });
  await add(tk, { amount: '800', date: '2026-10-10', time: '22:15' });
  await add(tk, { amount: '1000', date: '2026-10-10', time: '01:00', category: 'Transport' });
  const p = (await call('GET', '/api/insights/patterns?from=2026-10-05&to=2026-10-11', undefined, tk)).body;
  assert.deepEqual(p.weekdays.map((d) => d.total.paise), [20_000, 0, 0, 0, 0, 180_000, 0]);
  assert.equal(p.weekendShare, 90);
  assert.deepEqual(p.timeOfDay.buckets.map((b) => [b.name, b.total.paise]), [['Morning', 20_000], ['Afternoon', 0], ['Evening', 0], ['Night', 180_000]]);
  assert.equal(p.timeOfDay.hours[22].total.paise, 80_000);

  const c = (await call('GET', '/api/insights/compare?aFrom=2026-10-05&aTo=2026-10-05&bFrom=2026-10-10&bTo=2026-10-10', undefined, tk)).body;
  assert.deepEqual([c.a.expense.paise, c.b.expense.paise, c.expenseChange.paise, c.expenseChangePct], [20_000, 180_000, 160_000, 800]);
  assert.deepEqual(c.categories.map((x) => [x.category, x.change.paise]), [['Transport', 100_000], ['Food & Dining', 60_000]]);
  assert.equal((await call('GET', '/api/insights/patterns?from=2026-10-10&to=2026-10-01', undefined, tk)).status, 400);
});

test('merchants ranked, one merchant month by month; merchant can be typed by hand', async () => {
  const tk = await newUser();
  await add(tk, { amount: '450', date: ago(3), merchant: 'Swiggy' });
  await add(tk, { amount: '350', date: ago(1), merchant: 'swiggy' });
  await add(tk, { amount: '900', date: ago(2), merchant: 'DMart', category: 'Groceries' });
  await add(tk, { amount: '100', date: ago(2), note: 'Chai' });
  const m = (await call('GET', '/api/insights/merchants', undefined, tk)).body;
  assert.deepEqual(m.merchants.map((x) => [x.merchant, x.total.paise, x.count]), [['DMart', 90_000, 1], ['Swiggy', 80_000, 2]]);
  assert.deepEqual([m.withoutMerchant.count, m.withoutMerchant.total.paise], [1, 10_000]);
  const one = (await call('GET', '/api/insights/merchants/SWIGGY', undefined, tk)).body;
  assert.deepEqual([one.total.paise, one.months.at(-1).total.paise > 0 || one.months.at(-2).total.paise > 0, one.recent.length], [80_000, true, 2]);
  assert.equal((await call('GET', '/api/insights/merchants/Nobody', undefined, tk)).status, 404);
});

test('subscription finder: the same charge every month', async () => {
  const tk = await newUser();
  for (const n of [2, 32, 62, 92]) await add(tk, { amount: '649', date: ago(n), note: 'Netflix', category: 'Entertainment' });
  for (const n of [5, 40, 61]) await add(tk, { amount: String(200 + n * 7), date: ago(n), note: 'Groceries run', category: 'Groceries' });
  // Nearly the same amount every month is still not a subscription when it varies by more than 3%.
  for (const [n, a] of [[4, '1210'], [34, '1150'], [64, '1190'], [94, '1240']]) await add(tk, { amount: a, date: ago(n), merchant: 'DMart', category: 'Groceries' });
  const s = (await call('GET', '/api/insights/subscriptions', undefined, tk)).body;
  assert.deepEqual(s.subscriptions.map((x) => [x.name, x.cadence, x.amount.paise, x.active, x.tracked]), [['Netflix', 'monthly', 64_900, true, false]]);
  assert.equal(s.activeYearlyCost.paise, 64_900 * 12);
});

test('year in review and spending in today’s prices (official CPI)', async () => {
  const tk = await newUser();
  await add(tk, { type: 'income', amount: '10000', category: 'Salary', date: inMonth(-1, 1) });
  await add(tk, { amount: '2500', date: inMonth(-1, 3), merchant: 'Swiggy' });
  await add(tk, { amount: '1500', date: inMonth(-2, 3), category: 'Transport' });
  const y = (await call('GET', `/api/insights/year?year=${now.getUTCFullYear()}`, undefined, tk)).body;
  const thisYear = [inMonth(-1, 3), inMonth(-2, 3)].filter((d) => d.startsWith(String(now.getUTCFullYear())));
  assert.equal(y.expense.paise, (thisYear.includes(inMonth(-1, 3)) ? 250_000 : 0) + (thisYear.includes(inMonth(-2, 3)) ? 150_000 : 0));
  assert.equal((await call('GET', '/api/insights/year?year=2999', undefined, tk)).status, 400);

  const inf = (await call('GET', '/api/insights/inflation?months=3', undefined, tk)).body;
  assert.equal(inf.priceMonth, shiftMonth(month, -1));
  assert.match(inf.source, /MoSPI/);
  const [y1, m1] = shiftMonth(month, -2).split('-').map(Number);
  const [y2, m2] = shiftMonth(month, -1).split('-').map(Number);
  const two = inf.months[0];
  assert.deepEqual([two.month, two.spent.paise, two.cpi], [shiftMonth(month, -2), 150_000, cpiOf(y1, m1)]);
  assert.equal(two.inTodaysPrices.paise, Math.round(150_000 * cpiOf(y2, m2) / cpiOf(y1, m1)));
  assert.deepEqual([inf.months[2].published, inf.months[2].inTodaysPrices.paise], [false, 0]);
});

test('"worth it?" ratings and regret insights', async () => {
  const tk = await newUser();
  const a = (await add(tk, { amount: '2000', date: ago(1), note: 'Impulse sneakers', category: 'Shopping', worth: 'no' })).body.transaction;
  assert.equal(a.worth, 'no');
  const b = (await add(tk, { amount: '1000', date: ago(1), category: 'Shopping' })).body.transaction;
  assert.equal((await call('PATCH', `/api/transactions/${b.id}`, { worth: 'yes' }, tk)).body.transaction.worth, 'yes');
  await add(tk, { amount: '500', date: ago(2), worth: 'meh' });
  assert.equal((await add(tk, { amount: '500', date: ago(2), worth: 'maybe' })).status, 400);
  const income = (await add(tk, { type: 'income', amount: '100', category: 'Gifts', date: ago(1), worth: 'no' })).body.transaction;
  assert.equal(income.worth, null);
  const r = (await call('GET', '/api/insights/regret', undefined, tk)).body;
  assert.deepEqual([r.rated, r.counts, r.notWorthIt.paise, r.notWorthItShare], [3, { yes: 1, meh: 1, no: 1 }, 200_000, 57.1]);
  assert.deepEqual(r.categories.map((c) => [c.category, c.shareOfRated]), [['Shopping', 66.7]]);
});

test('no-spend streaks, logging streaks and a no-spend challenge', async () => {
  const tk = await newUser();
  await add(tk, { amount: '300', date: ago(10) });
  await add(tk, { type: 'income', amount: '100', category: 'Gifts', date: ago(4) });
  const s = (await call('GET', '/api/insights/streaks', undefined, tk)).body;
  assert.equal(s.noSpend.current, 10);
  assert.equal(s.noSpend.todaySoFar, true);
  assert.equal(s.logging.current, 0);

  const c = await call('POST', '/api/challenges', { days: 7, startDate: ago(2), allowed: ['Rent'] }, tk);
  assert.deepEqual([c.status, c.body.challenge.status, c.body.challenge.cleanDays, c.body.challenge.daysLeft], [201, 'active', 3, 5]);
  assert.equal((await call('POST', '/api/challenges', { days: 3 }, tk)).status, 409);
  await add(tk, { amount: '15000', date: today, category: 'Rent' }); // allowed: doesn't break it
  assert.equal((await call('GET', '/api/challenges', undefined, tk)).body.challenges[0].status, 'active');
  await add(tk, { amount: '80', date: today });
  const failed = (await call('GET', '/api/challenges', undefined, tk)).body.challenges[0];
  assert.deepEqual([failed.status, failed.failedOn], ['failed', today]);
  // After spending today, the next challenge can start tomorrow; it waits as "scheduled".
  const next = (await call('POST', '/api/challenges', { days: 3, startDate: dayString(addDays(now, 1)) }, tk)).body.challenge;
  assert.deepEqual([next.status, next.cleanDays, next.daysLeft], ['scheduled', 0, 3]);
  assert.equal((await call('POST', '/api/challenges', { days: 5 }, tk)).status, 409);
  assert.equal((await call('POST', '/api/challenges', { days: 3, startDate: dayString(addDays(now, 3)) }, tk)).status, 400);
});

test('achievements are worked out from real data', async () => {
  const tk = await newUser();
  let a = (await call('GET', '/api/insights/achievements', undefined, tk)).body.achievements;
  assert.equal(a.find((x) => x.id === 'first-entry').achieved, false);
  await add(tk, { type: 'income', amount: '30000', category: 'Salary', date: inMonth(-1, 1) });
  await add(tk, { amount: '20000', date: inMonth(-1, 2) });
  for (let n = 0; n < 7; n += 1) await add(tk, { amount: '10', date: ago(n) });
  a = Object.fromEntries((await call('GET', '/api/insights/achievements', undefined, tk)).body.achievements.map((x) => [x.id, x]));
  assert.equal(a['first-entry'].achieved, true);
  assert.equal(a['saver-20'].achieved, true);
  assert.equal(a['logging-7'].achieved, true);
  assert.equal(a['hundred-entries'].achieved, false);
});

test('saved reports: preview, save, run, change and delete', async () => {
  const tk = await newUser();
  await add(tk, { amount: '500', date: ago(1), tags: ['office'] });
  await add(tk, { amount: '300', date: ago(1), category: 'Transport', tags: ['office'] });
  await add(tk, { amount: '200', date: ago(1), category: 'Transport' });
  const body = { name: 'Office spending', groupBy: 'category', period: 'last-3-months', filters: { type: 'expense', tag: 'office' } };
  const preview = (await call('POST', '/api/saved-reports/preview', { ...body, name: undefined }, tk)).body;
  assert.deepEqual(preview.rows.map((r) => [r.label, r.total.paise, r.share]), [['Food & Dining', 50_000, 62.5], ['Transport', 30_000, 37.5]]);
  const saved = (await call('POST', '/api/saved-reports', body, tk)).body.report;
  assert.equal(saved.filters.tag, 'office');
  const byTag = (await call('PUT', `/api/saved-reports/${saved.id}`, { ...body, groupBy: 'tag', filters: { type: 'expense' } }, tk)).body.report;
  const run = (await call('GET', `/api/saved-reports/${byTag.id}/run`, undefined, tk)).body;
  assert.deepEqual(run.rows.map((r) => [r.label, r.total.paise]), [['#office', 80_000], ['(no tag)', 20_000]]);
  assert.equal((await call('POST', '/api/saved-reports', { ...body, period: 'custom' }, tk)).status, 400);
  assert.equal((await call('GET', '/api/saved-reports', undefined, tk)).body.reports.length, 1);
  assert.equal((await call('DELETE', `/api/saved-reports/${saved.id}`, undefined, tk)).status, 204);
  assert.equal((await call('GET', `/api/saved-reports/${saved.id}/run`, undefined, await newUser())).status, 404);
});

test('the usual daily rate leaves out rent, insurance, investments, bills and one-offs of ₹10,000+', async () => {
  const tk = await newUser();
  for (const off of [-3, -2, -1]) {
    await add(tk, { amount: '3000', date: inMonth(off, 10) });
    await add(tk, { amount: '25000', date: inMonth(off, 1), category: 'Rent' });
    await add(tk, { amount: '1800', date: inMonth(off, 7), category: 'Insurance' });
    await add(tk, { amount: '2000', date: inMonth(off, 5), category: 'Bills & Utilities' });
  }
  await add(tk, { amount: '12000', date: inMonth(-2, 20), category: 'Shopping', note: 'Phone' });
  await add(tk, { amount: '9999', date: inMonth(-2, 21), category: 'Shopping' });
  const f = (await call('GET', '/api/insights/forecast', undefined, tk)).body;
  assert.equal(f.basis.perDay.paise, Math.round((3 * 300_000 + 999_900) / f.basis.days));
});

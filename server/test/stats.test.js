import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, uniqueEmail, GOOD_PASSWORD } from './helpers.js';

let t;
let token;

const newUser = async () =>
  (await t.api('POST', '/api/auth/register', { body: { name: 'Kabir', email: uniqueEmail(), password: GOOD_PASSWORD } })).body.token;

const get = (path) => t.api('GET', path, { token });

before(async () => {
  t = await startTestServer();
  token = await newUser();
  const entries = [
    { type: 'income', amount: '50000', category: 'Salary', date: '2026-09-30' },
    { type: 'income', amount: '8000.50', category: 'Freelance', date: '2026-10-15' },
    { type: 'expense', amount: '12000', category: 'Rent', date: '2026-10-01' },
    { type: 'expense', amount: '450', category: 'Food & Dining', date: '2026-10-03' },
    { type: 'expense', amount: '820.25', category: 'Food & Dining', date: '2026-10-10' },
    { type: 'expense', amount: '300', category: 'Transport', date: '2026-08-20' },
  ];
  for (const body of entries) {
    const res = await t.api('POST', '/api/transactions', { token, body });
    assert.equal(res.status, 201);
  }
});
after(() => t.stop());

test('summary totals income, expense and balance in exact paise', async () => {
  const { status, body } = await get('/api/stats/summary');
  assert.equal(status, 200);
  assert.deepEqual(body.income, { paise: 5800050, rupees: 58000.5 });
  assert.deepEqual(body.expense, { paise: 1357025, rupees: 13570.25 });
  assert.deepEqual(body.balance, { paise: 4443025, rupees: 44430.25 });
  assert.equal(body.count, 6);
});

test('summary respects the same filters as the list, and can go negative', async () => {
  const oct = (await get('/api/stats/summary?from=2026-10-01&to=2026-10-31')).body;
  assert.equal(oct.income.paise, 800050);
  assert.equal(oct.expense.paise, 1327025);
  assert.equal(oct.balance.paise, -526975);

  const food = (await get(`/api/stats/summary?category=${encodeURIComponent('Food & Dining')}`)).body;
  assert.equal(food.expense.paise, 127025);
  assert.equal(food.income.paise, 0);
  assert.equal(food.count, 2);

  assert.equal((await get('/api/stats/summary?q=nothing-matches')).body.count, 0);
  assert.equal((await get('/api/stats/summary?from=2026-10-10&to=2026-10-01')).status, 400);
});

test('by-category gives the pie chart slices, biggest first, with shares', async () => {
  const exp = (await get('/api/stats/by-category')).body;
  assert.equal(exp.type, 'expense');
  assert.equal(exp.total.paise, 1357025);
  assert.deepEqual(
    exp.categories.map((c) => [c.category, c.total.paise, c.count, c.share]),
    [['Rent', 1200000, 1, 88.4], ['Food & Dining', 127025, 2, 9.4], ['Transport', 30000, 1, 2.2]],
  );

  const inc = (await get('/api/stats/by-category?type=income')).body;
  assert.deepEqual(inc.categories.map((c) => [c.category, c.share]), [['Salary', 86.2], ['Freelance', 13.8]]);

  assert.equal((await get('/api/stats/by-category?type=both')).status, 400);
});

test('monthly gives every month in the range, including empty ones', async () => {
  const res = (await get('/api/stats/monthly?from=2026-07-01&to=2026-10-31')).body;
  assert.equal(res.from, '2026-07-01');
  assert.equal(res.to, '2026-10-31');
  assert.deepEqual(
    res.months.map((m) => [m.month, m.income.paise, m.expense.paise, m.balance.paise]),
    [
      ['2026-07', 0, 0, 0],
      ['2026-08', 0, 30000, -30000],
      ['2026-09', 5000000, 0, 5000000],
      ['2026-10', 800050, 1327025, -526975],
    ],
  );
});

test('monthly defaults to the last 12 months ending this month', async () => {
  const res = (await get('/api/stats/monthly')).body;
  assert.equal(res.months.length, 12);
  assert.equal(res.months.at(-1).month, new Date().toISOString().slice(0, 7));
});

test('daily gives every day in the range for line charts', async () => {
  const res = (await get('/api/stats/daily?from=2026-10-01&to=2026-10-03')).body;
  assert.deepEqual(
    res.days.map((d) => [d.date, d.income.paise, d.expense.paise]),
    [['2026-10-01', 0, 1200000], ['2026-10-02', 0, 0], ['2026-10-03', 0, 45000]],
  );
  const def = (await get('/api/stats/daily')).body;
  assert.equal(def.days.length, 30);
  assert.equal(def.days.at(-1).date, new Date().toISOString().slice(0, 10));
});

test('very long ranges are refused instead of building huge responses', async () => {
  const months = await get('/api/stats/monthly?from=2020-01-01&to=2026-10-01');
  assert.equal(months.status, 400);
  assert.equal(months.body.error.code, 'range_too_large');
  const days = await get('/api/stats/daily?from=2025-01-01&to=2026-10-01');
  assert.equal(days.status, 400);
});

test('stats only ever include the logged-in user’s entries', async () => {
  const other = await newUser();
  const summary = (await t.api('GET', '/api/stats/summary', { token: other })).body;
  assert.deepEqual(summary, {
    income: { paise: 0, rupees: 0 },
    expense: { paise: 0, rupees: 0 },
    balance: { paise: 0, rupees: 0 },
    count: 0,
  });
  const pie = (await t.api('GET', '/api/stats/by-category', { token: other })).body;
  assert.deepEqual(pie.categories, []);
  assert.equal((await t.api('GET', '/api/stats/summary')).status, 401);
});

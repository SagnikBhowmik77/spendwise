import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, uniqueEmail, GOOD_PASSWORD } from './helpers.js';
import { Budget } from '../src/models/index.js';
import { currentMonth, shiftMonth } from '../src/money.js';

let t;
let token;

const newUser = async () =>
  (await t.api('POST', '/api/auth/register', { body: { name: 'Isha', email: uniqueEmail(), password: GOOD_PASSWORD } })).body.token;
const put = (body, tk = token) => t.api('PUT', '/api/budgets', { token: tk, body });
const get = (path, tk = token) => t.api('GET', path, { token: tk });

before(async () => {
  t = await startTestServer();
  token = await newUser();
  const entries = [
    ['expense', '3000', 'Food & Dining', '2026-10-02'],
    ['expense', '1200', 'Food & Dining', '2026-10-20'],
    ['expense', '12000', 'Rent', '2026-10-01'],
    ['expense', '450', 'Transport', '2026-10-21'],
    ['expense', '999', 'Shopping', '2026-10-05'],
    ['income', '60000', 'Salary', '2026-10-01'],
    ['expense', '5500', 'Food & Dining', '2026-09-15'],
  ];
  for (const [type, amount, category, date] of entries) {
    assert.equal((await t.api('POST', '/api/transactions', { token, body: { type, amount, category, date } })).status, 201);
  }
});
after(() => t.stop());

test('set budgets and see spent, remaining and status per category', async () => {
  assert.equal((await put({ month: '2026-10', category: 'Food & Dining', limit: '5000' })).status, 201);
  assert.equal((await put({ month: '2026-10', category: 'Rent', limit: '12000' })).status, 201);
  const over = await put({ month: '2026-10', category: 'Transport', limit: '400' });
  assert.equal(over.status, 201);
  assert.equal(over.body.budget.status, 'over');
  assert.equal((await put({ month: '2026-10', limit: '20000' })).status, 201);

  const view = (await get('/api/budgets?month=2026-10')).body;
  assert.equal(view.month, '2026-10');
  assert.deepEqual(
    view.categories.map((c) => [c.category, c.limit.paise, c.spent.paise, c.remaining.paise, c.percentUsed, c.status]),
    [
      ['Food & Dining', 500000, 420000, 80000, 84, 'warning'],
      ['Rent', 1200000, 1200000, 0, 100, 'warning'],
      ['Transport', 40000, 45000, -5000, 112.5, 'over'],
    ],
  );
  // The overall budget counts every expense that month (income never counts).
  assert.equal(view.overall.category, null);
  assert.equal(view.overall.spent.paise, 1764900);
  assert.equal(view.overall.percentUsed, 88.2);
  assert.equal(view.overall.status, 'warning');
  assert.deepEqual(view.unbudgeted, [{ category: 'Shopping', spent: { paise: 99900, rupees: 999 } }]);
  assert.deepEqual(view.totals, {
    budgeted: { paise: 1740000, rupees: 17400 },
    spentInBudgeted: { paise: 1665000, rupees: 16650 },
    spentTotal: { paise: 1764900, rupees: 17649 },
  });
});

test('setting the same budget again changes its limit instead of duplicating it', async () => {
  const res = await put({ month: '2026-10', category: 'Food & Dining', limit: '8400' });
  assert.equal(res.status, 200);
  assert.equal(res.body.budget.percentUsed, 50);
  assert.equal(res.body.budget.status, 'ok');
  const count = await Budget.countDocuments({ month: '2026-10', category: 'Food & Dining' });
  assert.equal(count, 1);
});

test('update by id and delete', async () => {
  const view = (await get('/api/budgets?month=2026-10')).body;
  const transport = view.categories.find((c) => c.category === 'Transport');

  const upd = await t.api('PATCH', `/api/budgets/${transport.id}`, { token, body: { limit: '500' } });
  assert.equal(upd.status, 200);
  assert.equal(upd.body.budget.status, 'warning');
  assert.equal(upd.body.budget.remaining.paise, 5000);

  const other = await newUser();
  assert.equal((await t.api('PATCH', `/api/budgets/${transport.id}`, { token: other, body: { limit: '1' } })).status, 404);
  assert.equal((await t.api('DELETE', `/api/budgets/${transport.id}`, { token: other })).status, 404);
  assert.deepEqual((await get('/api/budgets?month=2026-10', other)).body.categories, []);

  assert.equal((await t.api('DELETE', `/api/budgets/${transport.id}`, { token })).status, 204);
  assert.equal((await t.api('DELETE', `/api/budgets/${transport.id}`, { token })).status, 404);
  const after = (await get('/api/budgets?month=2026-10')).body;
  assert.ok(after.unbudgeted.some((u) => u.category === 'Transport'));
});

test('copy a month’s budgets forward without overwriting ones already set', async () => {
  assert.equal((await put({ month: '2026-11', category: 'Rent', limit: '15000' })).status, 201);

  const res = await t.api('POST', '/api/budgets/copy', { token, body: { from: '2026-10', to: '2026-11' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.copied, 2);
  assert.equal(res.body.skipped, 1);
  const rent = res.body.month.categories.find((c) => c.category === 'Rent');
  assert.equal(rent.limit.paise, 1500000);
  assert.equal(res.body.month.overall.limit.paise, 2000000);

  const again = await t.api('POST', '/api/budgets/copy', { token, body: { from: '2026-10', to: '2026-11' } });
  assert.equal(again.body.copied, 0);

  const empty = await t.api('POST', '/api/budgets/copy', { token, body: { from: '2026-01', to: '2026-11' } });
  assert.equal(empty.status, 404);
  assert.equal((await t.api('POST', '/api/budgets/copy', { token, body: { from: '2026-10', to: '2026-10' } })).status, 400);
});

test('history shows how each month went, including months with no budget', async () => {
  const res = (await get('/api/budgets/history?to=2026-10&months=2')).body;
  assert.equal(res.from, '2026-09');
  assert.deepEqual(res.months.map((m) => m.month), ['2026-09', '2026-10']);
  assert.equal(res.months[0].overall, null);
  assert.deepEqual(res.months[0].unbudgeted, [{ category: 'Food & Dining', spent: { paise: 550000, rupees: 5500 } }]);
  assert.equal(res.months[1].overall.spent.paise, 1764900);

  const food = (await get(`/api/budgets/history?to=2026-10&months=2&category=${encodeURIComponent('Food & Dining')}`)).body;
  assert.deepEqual(
    food.months.map((m) => [m.month, m.budget?.limit.paise ?? null, m.spent.paise]),
    [['2026-09', null, 550000], ['2026-10', 840000, 420000]],
  );
});

test('budget input is validated', async () => {
  const bad = [
    { month: '2026-13', limit: '100' },
    { month: '26-10', limit: '100' },
    { month: shiftMonth(currentMonth(), 13), limit: '100' },
    { month: '2026-10', limit: '0' },
    { month: '2026-10', limit: '12.345' },
    { month: '2026-10', category: '', limit: '100' },
  ];
  for (const body of bad) assert.equal((await put(body)).status, 400, JSON.stringify(body));
  assert.equal((await put({ month: shiftMonth(currentMonth(), 12), limit: '100' })).status, 201);
  assert.equal((await get('/api/budgets?month=2026-1')).status, 400);
  assert.equal((await get('/api/budgets/history?months=50')).status, 400);
  assert.equal((await t.api('GET', '/api/budgets')).status, 401);
});

test('the current month is the default', async () => {
  const res = (await get('/api/budgets')).body;
  assert.equal(res.month, currentMonth());
});

test('deleting the account deletes its budgets too', async () => {
  const email = uniqueEmail();
  const reg = await t.api('POST', '/api/auth/register', { body: { name: 'Temp', email, password: GOOD_PASSWORD } });
  await put({ month: '2026-10', category: 'Rent', limit: '100' }, reg.body.token);
  assert.equal(await Budget.countDocuments({ user: reg.body.user.id }), 1);
  await t.api('DELETE', '/api/auth/me', { token: reg.body.token, body: { password: GOOD_PASSWORD } });
  assert.equal(await Budget.countDocuments({ user: reg.body.user.id }), 0);
});

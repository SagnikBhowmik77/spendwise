import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, uniqueEmail, GOOD_PASSWORD } from './helpers.js';
import { rupeesToPaise, parseDay } from '../src/money.js';

let t;
before(async () => { t = await startTestServer(); });
after(() => t.stop());

const newUser = async () =>
  (await t.api('POST', '/api/auth/register', { body: { name: 'Meera', email: uniqueEmail(), password: GOOD_PASSWORD } })).body.token;

const add = (token, body) =>
  t.api('POST', '/api/transactions', {
    token,
    body: { type: 'expense', amount: '100', category: 'Food & Dining', date: '2026-10-01', ...body },
  });

test('money and day parsing never uses float maths', () => {
  assert.equal(rupeesToPaise('1,250.50'), 125050);
  assert.equal(rupeesToPaise('0.30'), 30);
  // 0.1 + 0.2 is 0.30000000000000004 in floating point: refused, not silently rounded.
  assert.equal(rupeesToPaise(0.1 + 0.2), null);
  assert.equal(rupeesToPaise(19.99), 1999);
  assert.equal(rupeesToPaise('12.5'), 1250);
  assert.equal(rupeesToPaise('12.345'), null);
  assert.equal(rupeesToPaise('-5'), null);
  assert.equal(rupeesToPaise('1e3'), null);
  assert.equal(parseDay('2026-02-30'), null);
  assert.equal(parseDay('2024-02-29').toISOString(), '2024-02-29T00:00:00.000Z');
});

test('create stores the entry for the logged-in user and returns it', async () => {
  const token = await newUser();
  const res = await add(token, { amount: '1,250.50', note: '  dinner with team ', date: '2026-10-05' });
  assert.equal(res.status, 201);
  const tx = res.body.transaction;
  assert.equal(tx.amountPaise, 125050);
  assert.equal(tx.amount, 1250.5);
  assert.equal(tx.note, 'dinner with team');
  assert.equal(tx.date, '2026-10-05');
  assert.equal(tx.type, 'expense');
  assert.ok(tx.id);
});

test('create rejects bad input with a field-level reason', async () => {
  const token = await newUser();
  const cases = [
    [{ amount: '0' }, 'amount', /more than/],
    [{ amount: '-50' }, 'amount', /2 decimal places/],
    [{ amount: '10.999' }, 'amount', /2 decimal places/],
    [{ amount: '100000001' }, 'amount', /at most/],
    [{ amount: undefined }, 'amount', /required/],
    [{ type: 'gift' }, 'type', /income, expense or transfer/],
    [{ category: '   ' }, 'category', /required/],
    [{ date: '2026-13-01' }, 'date', /real day/],
    [{ date: '1999-12-31' }, 'date', /2000 or later/],
    [{ date: '2999-01-01' }, 'date', /future/],
    [{ note: 'x'.repeat(501) }, 'note', /500/],
  ];
  for (const [body, field, message] of cases) {
    const res = await add(token, body);
    assert.equal(res.status, 400, JSON.stringify(body));
    const detail = res.body.error.details.find((d) => d.field === field);
    assert.ok(detail, `expected an error on ${field} for ${JSON.stringify(body)}`);
    assert.match(detail.message, message);
  }
});

test('transactions need a login', async () => {
  assert.equal((await t.api('GET', '/api/transactions')).status, 401);
  assert.equal((await t.api('POST', '/api/transactions', { body: {} })).status, 401);
});

test('users only ever see, edit or delete their own entries', async () => {
  const alice = await newUser();
  const bob = await newUser();
  const mine = (await add(alice, { note: 'alice only' })).body.transaction;

  const bobList = await t.api('GET', '/api/transactions', { token: bob });
  assert.equal(bobList.body.total, 0);
  assert.equal((await t.api('GET', `/api/transactions/${mine.id}`, { token: bob })).status, 404);
  assert.equal((await t.api('PATCH', `/api/transactions/${mine.id}`, { token: bob, body: { amount: '1' } })).status, 404);
  assert.equal((await t.api('DELETE', `/api/transactions/${mine.id}`, { token: bob })).status, 404);

  const still = await t.api('GET', `/api/transactions/${mine.id}`, { token: alice });
  assert.equal(still.status, 200);
  assert.equal(still.body.transaction.amountPaise, 10000);
});

test('get, update and delete by id', async () => {
  const token = await newUser();
  const tx = (await add(token)).body.transaction;

  const upd = await t.api('PATCH', `/api/transactions/${tx.id}`, {
    token, body: { amount: 249.99, category: 'Groceries', note: 'veg + milk' },
  });
  assert.equal(upd.status, 200);
  assert.equal(upd.body.transaction.amountPaise, 24999);
  assert.equal(upd.body.transaction.category, 'Groceries');
  assert.equal(upd.body.transaction.date, '2026-10-01');

  assert.equal((await t.api('PATCH', `/api/transactions/${tx.id}`, { token, body: {} })).status, 400);
  assert.equal((await t.api('PATCH', `/api/transactions/${tx.id}`, { token, body: { amount: '0' } })).status, 400);

  assert.equal((await t.api('DELETE', `/api/transactions/${tx.id}`, { token })).status, 200);
  assert.equal((await t.api('GET', `/api/transactions/${tx.id}`, { token })).status, 404);
  assert.equal((await t.api('DELETE', `/api/transactions/${tx.id}`, { token })).status, 404);
  assert.equal((await t.api('GET', '/api/transactions/not-an-id', { token })).status, 404);
});

test('list filters by type, category, date range and text, newest first by default', async () => {
  const token = await newUser();
  await add(token, { type: 'income', amount: '50000', category: 'Salary', date: '2026-09-30' });
  await add(token, { amount: '12000', category: 'Rent', date: '2026-10-01' });
  await add(token, { amount: '450', category: 'Food & Dining', date: '2026-10-03', note: 'Biryani' });
  await add(token, { amount: '300', category: 'Transport', date: '2026-10-07', note: 'metro card' });
  await add(token, { amount: '820', category: 'Food & Dining', date: '2026-10-10', note: 'groceries run' });

  const all = await t.api('GET', '/api/transactions', { token });
  assert.equal(all.body.total, 5);
  assert.deepEqual(all.body.items.map((i) => i.date), ['2026-10-10', '2026-10-07', '2026-10-03', '2026-10-01', '2026-09-30']);

  const income = await t.api('GET', '/api/transactions?type=income', { token });
  assert.deepEqual(income.body.items.map((i) => i.category), ['Salary']);

  const food = await t.api('GET', `/api/transactions?category=${encodeURIComponent('Food & Dining,Rent')}`, { token });
  assert.equal(food.body.total, 3);

  const range = await t.api('GET', '/api/transactions?from=2026-10-01&to=2026-10-07', { token });
  assert.deepEqual(range.body.items.map((i) => i.date), ['2026-10-07', '2026-10-03', '2026-10-01']);

  const search = await t.api('GET', '/api/transactions?q=BIRYANI', { token });
  assert.equal(search.body.total, 1);
  // Regex characters in the search are treated literally.
  assert.equal((await t.api('GET', '/api/transactions?q=.*', { token })).body.total, 0);

  const bad = await t.api('GET', '/api/transactions?from=2026-10-10&to=2026-10-01', { token });
  assert.equal(bad.status, 400);
  assert.equal((await t.api('GET', '/api/transactions?sort=random', { token })).status, 400);
  assert.equal((await t.api('GET', '/api/transactions?type=gift', { token })).status, 400);
});

test('list sorts by amount and paginates with stable totals', async () => {
  const token = await newUser();
  for (const amount of ['5', '15', '25', '35', '45']) await add(token, { amount });

  const asc = await t.api('GET', '/api/transactions?sort=amount', { token });
  assert.deepEqual(asc.body.items.map((i) => i.amountPaise), [500, 1500, 2500, 3500, 4500]);
  const desc = await t.api('GET', '/api/transactions?sort=-amount', { token });
  assert.deepEqual(desc.body.items.map((i) => i.amountPaise), [4500, 3500, 2500, 1500, 500]);

  const page1 = await t.api('GET', '/api/transactions?sort=amount&limit=2&page=1', { token });
  const page3 = await t.api('GET', '/api/transactions?sort=amount&limit=2&page=3', { token });
  assert.equal(page1.body.total, 5);
  assert.equal(page1.body.totalPages, 3);
  assert.deepEqual(page1.body.items.map((i) => i.amountPaise), [500, 1500]);
  assert.deepEqual(page3.body.items.map((i) => i.amountPaise), [4500]);

  // Entries on the same day keep a fixed order across pages.
  const seen = new Set();
  for (let page = 1; page <= 3; page++) {
    const res = await t.api('GET', `/api/transactions?limit=2&page=${page}`, { token });
    res.body.items.forEach((i) => seen.add(i.id));
  }
  assert.equal(seen.size, 5);

  assert.equal((await t.api('GET', '/api/transactions?limit=500', { token })).status, 400);
});

test('categories returns the suggestions plus the user’s own', async () => {
  const token = await newUser();
  await add(token, { category: 'Pet care' });
  await add(token, { category: 'Groceries' });
  await add(token, { type: 'income', category: 'Tuition' });

  const res = await t.api('GET', '/api/categories', { token });
  assert.equal(res.status, 200);
  assert.ok(res.body.defaults.expense.includes('Groceries'));
  assert.deepEqual(res.body.custom, { income: ['Tuition'], expense: ['Pet care'] });

  const other = await t.api('GET', '/api/categories', { token: await newUser() });
  assert.deepEqual(other.body.custom, { income: [], expense: [] });
});

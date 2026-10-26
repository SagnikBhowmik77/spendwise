import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, uniqueEmail, GOOD_PASSWORD } from './helpers.js';

let t;
let token;
// The entry the log tests work on, shared between them.
let thisTx;

const newUser = async (name = 'Kavya') =>
  (await t.api('POST', '/api/auth/register', { body: { name, email: uniqueEmail(), password: GOOD_PASSWORD } })).body.token;
const call = (method, path, body, tk = token) => t.api(method, path, { token: tk, body });

before(async () => {
  t = await startTestServer();
  token = await newUser();
});
after(() => t.stop());

test('a deleted entry disappears everywhere and can be undone', async () => {
  const tx = (await call('POST', '/api/transactions', { type: 'expense', amount: '700', category: 'Groceries', date: '2026-10-11' })).body.transaction;
  await call('PUT', '/api/budgets', { month: '2026-10', category: 'Groceries', limit: '1000' });

  const del = await call('DELETE', `/api/transactions/${tx.id}`);
  assert.equal(del.status, 200);
  assert.ok(new Date(del.body.restorableUntil) > new Date(Date.now() + 29 * 24 * 60 * 60 * 1000));
  assert.equal((await call('GET', '/api/transactions')).body.total, 0);
  assert.equal((await call('GET', '/api/stats/summary')).body.expense.paise, 0);
  assert.equal((await call('GET', '/api/budgets?month=2026-10')).body.categories[0].spent.paise, 0);
  assert.equal((await call('GET', `/api/transactions/${tx.id}`)).status, 404);

  const undo = await call('POST', `/api/transactions/${tx.id}/restore`);
  assert.equal(undo.status, 200);
  assert.equal((await call('GET', '/api/stats/summary')).body.expense.paise, 70000);
  assert.equal((await call('POST', `/api/transactions/${tx.id}/restore`)).status, 404);
});

test('every change is logged with who made it, newest first', async () => {
  const tx = (await call('POST', '/api/transactions', { type: 'expense', amount: '250', category: 'Transport', date: '2026-10-12' })).body.transaction;
  await call('PATCH', `/api/transactions/${tx.id}`, { amount: '300', note: 'auto + metro' });
  await call('DELETE', `/api/transactions/${tx.id}`);

  const { body } = await call('GET', `/api/activity?entityId=${tx.id}`);
  assert.deepEqual(body.items.map((i) => i.action), ['delete', 'update', 'create']);
  assert.deepEqual(body.items.map((i) => i.summary), [
    'Deleted expense of ₹300.00 · Transport',
    'Edited expense of ₹300.00 · Transport',
    'Added expense of ₹250.00 · Transport',
  ]);
  assert.ok(body.items.every((i) => i.user.name === 'Kavya'));
  assert.deepEqual(body.items.map((i) => i.canRestore), [true, true, false]);
  tx.logs = body.items;
  thisTx = tx;
});


test('an older version can be restored, and a deletion undone, from the log', async () => {
  const [del, edit, create] = thisTx.logs;
  const undone = await call('POST', `/api/activity/${del.id}/revert`);
  assert.equal(undone.status, 200);
  assert.equal(undone.body.transaction.amountPaise, 30000);

  const back = await call('POST', `/api/activity/${edit.id}/revert`);
  assert.equal(back.status, 200);
  assert.equal(back.body.transaction.amountPaise, 25000);
  assert.equal(back.body.transaction.note, '');

  assert.equal((await call('POST', `/api/activity/${create.id}/revert`)).status, 400);
  assert.equal((await call('POST', `/api/activity/${del.id}/revert`)).status, 409);

  const actions = (await call('GET', `/api/activity?entityId=${thisTx.id}`)).body.items.map((i) => i.action);
  assert.deepEqual(actions.slice(0, 2), ['revert', 'restore']);
});

test('the log is private to the space', async () => {
  const other = await newUser('Other');
  assert.equal((await call('GET', '/api/activity', undefined, other)).body.total, 0);
  const anyLog = (await call('GET', '/api/activity')).body.items[0];
  assert.equal((await call('POST', `/api/activity/${anyLog.id}/revert`, undefined, other)).status, 404);
  assert.ok((await call('GET', '/api/activity?limit=2')).body.totalPages >= 2);
});

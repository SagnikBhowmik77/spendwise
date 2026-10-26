import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { startTestServer } from './helpers.js';
import { runMigrations } from '../src/migrations.js';
import { Budget, RecurringRule, Space, Transaction, User } from '../src/models/index.js';
import { issueToken } from '../src/services/auth.service.js';

let t;
before(async () => { t = await startTestServer(); });
after(() => t.stop());

test('records from before spaces move into their owner’s personal space and Cash account, once', async () => {
  // A user and data shaped like the app stored them before batch 12A (no space, no account).
  const user = await User.create({ name: 'Early', email: 'early@example.com', passwordHash: 'x' });
  const day = new Date('2026-10-01');
  await Transaction.collection.insertOne({ user: user._id, type: 'expense', amountPaise: 5000, category: 'Food', note: '', date: day });
  await Budget.collection.insertOne({ user: user._id, month: '2026-10', category: 'Food', limitPaise: 10000 });
  await RecurringRule.collection.insertOne({
    user: user._id, type: 'expense', amountPaise: 100, category: 'Rent', note: '', frequency: 'monthly', interval: 1,
    startDate: day, endDate: null, nextIndex: 1, nextRunDate: new Date('2026-11-01'), active: true,
  });

  const first = await runMigrations({ log: () => {} });
  assert.equal(first.moved, 3);
  const space = await Space.findOne({ owner: user._id, kind: 'personal' }).lean();
  const tx = await Transaction.findOne({ user: user._id }).lean();
  assert.equal(String(tx.space), String(space._id));
  assert.equal(String(tx.account), String(space.defaultAccount));
  assert.equal(String((await Budget.findOne({ user: user._id }).lean()).space), String(space._id));
  assert.equal(String((await RecurringRule.findOne({ user: user._id }).lean()).account), String(space.defaultAccount));

  assert.equal((await runMigrations({ log: () => {} })).moved, 0);

  // And the old entry shows up through the API like any other.
  const token = await issueToken(user);
  assert.ok(jwt.decode(token).sub);
  const list = await t.api('GET', '/api/transactions?preset=all', { token });
  assert.equal(list.body.total, 1);
  assert.equal((await t.api('GET', '/api/stats/summary', { token })).body.expense.paise, 5000);
});

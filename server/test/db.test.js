// Runs against a real, throwaway MongoDB (mongodb-memory-server), never Atlas.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../src/app.js';
import { connectDb, disconnectDb } from '../src/db.js';
import { User, Transaction } from '../src/models/index.js';

let mongo;
let server;
let base;

before(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDb(mongo.getUri('spendwise-test'));
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await disconnectDb();
  await mongo.stop();
});

const newUser = (email = 'a@example.com') =>
  User.create({ name: 'Asha', email, passwordHash: 'not-a-real-hash' });

test('health reports a connected database', async () => {
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.deepEqual(body.database, { configured: true, connected: true });
});

test('user email is unique regardless of case', async () => {
  await newUser('Dup@Example.com');
  await assert.rejects(newUser('dup@example.com'), /duplicate key/);
});

test('password hash is never serialised or selected by default', async () => {
  const user = await newUser('hide@example.com');
  assert.equal(JSON.stringify(user).includes('passwordHash'), false);
  const fetched = await User.findById(user.id);
  assert.equal(fetched.passwordHash, undefined);
  const withHash = await User.findById(user.id).select('+passwordHash');
  assert.equal(withHash.passwordHash, 'not-a-real-hash');
});

test('transactions store whole paise and validate type and amount', async () => {
  const user = await newUser('tx@example.com');
  const ids = { space: new mongoose.Types.ObjectId(), account: new mongoose.Types.ObjectId() };
  const base = { ...ids, user: user._id, type: 'expense', category: 'Food', date: new Date('2026-10-01') };

  const ok = await Transaction.create({ ...base, amountPaise: 1250, note: '  lunch  ' });
  assert.equal(ok.amountPaise, 1250);
  assert.equal(ok.note, 'lunch');
  assert.equal(ok.toJSON().createdBy, user.id);

  await assert.rejects(Transaction.create({ ...base, amountPaise: 12.5 }), /whole number of paise/);
  await assert.rejects(Transaction.create({ ...base, amountPaise: 0 }), /amountPaise/);
  await assert.rejects(Transaction.create({ ...base, amountPaise: 100, type: 'gift' }), /type/);
  await assert.rejects(Transaction.create({ ...base, amountPaise: 100, paymentMethod: 'cheque' }), /paymentMethod/);
  await assert.rejects(Transaction.create({ ...base, amountPaise: 100, account: undefined }), /account/);
  await assert.rejects(Transaction.create({ ...base, amountPaise: 100, category: '' }), /category/);
});

test('indexes for per-user history and filters exist', async () => {
  const indexes = await Transaction.collection.indexes();
  const keys = indexes.map((i) => JSON.stringify(i.key));
  assert.ok(keys.includes(JSON.stringify({ space: 1, deletedAt: 1, date: -1 })));
  assert.ok(keys.includes(JSON.stringify({ space: 1, deletedAt: 1, type: 1, category: 1, date: -1 })));
  // Deleted entries are purged after the undo window.
  assert.ok(indexes.some((i) => JSON.stringify(i.key) === '{"deletedAt":1}' && i.expireAfterSeconds === 30 * 24 * 60 * 60));
});

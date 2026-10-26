// Batch 12B: tags, time, splits, foreign currency, trips, receipts.
// Exchange rates come from a local stub of the Frankfurter API (no internet in tests).
import http from 'node:http';

const fxCalls = [];
const fxStub = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  fxCalls.push(url.pathname + url.search);
  res.setHeader('content-type', 'application/json');
  if (url.pathname === '/currencies') return res.end(JSON.stringify({ USD: 'United States Dollar', EUR: 'Euro', INR: 'Indian Rupee' }));
  const base = url.searchParams.get('base');
  if (base === 'ERR') { res.statusCode = 500; return res.end('{}'); }
  if (base !== 'USD' && base !== 'EUR') { res.statusCode = 404; return res.end('{"message":"not found"}'); }
  // 2026-10-18 is a Sunday: ECB publishes nothing, so Friday's rate is returned.
  const day = url.pathname.slice(1) === '2026-10-18' ? '2026-10-16' : url.pathname.slice(1);
  res.end(JSON.stringify({ amount: 1, base, date: day, rates: { INR: base === 'USD' ? 94.93 : 103.4 } }));
});
await new Promise((r) => fxStub.listen(0, r));
process.env.FX_URL = `http://127.0.0.1:${fxStub.address().port}`;

const { test, before, after } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { startTestServer, uniqueEmail, GOOD_PASSWORD } = await import('./helpers.js');
const { Transaction } = await import('../src/models/index.js');
const { removeOrphanReceipts } = await import('../src/services/receipt.service.js');

let t;
let token;
const newUser = async () =>
  (await t.api('POST', '/api/auth/register', { body: { name: 'Tanvi', email: uniqueEmail(), password: GOOD_PASSWORD } })).body.token;
const call = (method, path, body, tk = token) => t.api(method, path, { token: tk, body });
const add = (body, tk) => call('POST', '/api/transactions', { type: 'expense', date: '2026-10-10', ...body }, tk);

before(async () => { t = await startTestServer(); token = await newUser(); });
after(async () => { await t.stop(); fxStub.close(); });

test('tags are cleaned up, filterable and listed with counts', async () => {
  const a = await add({ amount: '120', category: 'Food & Dining', tags: ['#Office', 'office', 'Trip-Goa'] });
  assert.deepEqual(a.body.transaction.tags, ['office', 'trip-goa']);
  await add({ amount: '80', category: 'Transport', tags: ['office'] });
  assert.equal((await add({ amount: '5', category: 'Other', tags: ['two words'] })).status, 400);
  assert.equal((await add({ amount: '5', category: 'Other', tags: Array.from({ length: 11 }, (_, i) => `t${i}`) })).status, 400);

  assert.equal((await call('GET', '/api/transactions?tag=%23office')).body.total, 2);
  assert.equal((await call('GET', '/api/stats/summary?tag=office')).body.expense.paise, 20000);
  assert.deepEqual((await call('GET', '/api/tags')).body.tags, [{ tag: 'office', count: 2 }, { tag: 'trip-goa', count: 1 }]);
});

test('an optional time orders entries within a day', async () => {
  const other = await newUser();
  await add({ amount: '10', category: 'Other', date: '2026-10-12', time: '09:05' }, other);
  await add({ amount: '20', category: 'Other', date: '2026-10-12', time: '21:30' }, other);
  await add({ amount: '30', category: 'Other', date: '2026-10-12' }, other);
  const list = (await call('GET', '/api/transactions', undefined, other)).body.items;
  assert.deepEqual(list.map((x) => x.time), ['21:30', '09:05', null]);
  assert.equal((await add({ amount: '1', category: 'Other', time: '25:00' }, other)).status, 400);
});

test('a split bill counts under each of its categories', async () => {
  const tk = await newUser();
  const res = await add({ amount: '450', splits: [{ category: 'Groceries', amount: '300' }, { category: 'Pet food', amount: '150' }] }, tk);
  assert.equal(res.status, 201);
  assert.equal(res.body.transaction.category, 'Split');
  assert.deepEqual(res.body.transaction.splits.map((s) => [s.category, s.amountPaise]), [['Groceries', 30000], ['Pet food', 15000]]);

  const bad = await add({ amount: '450', splits: [{ category: 'Groceries', amount: '300' }, { category: 'Other', amount: '100' }] }, tk);
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.details[0].field, 'splits');
  assert.equal((await add({ type: 'transfer', amount: '10', toAccount: '0'.repeat(24), splits: [{ category: 'a', amount: '5' }, { category: 'b', amount: '5' }] }, tk)).status, 400);

  const pie = (await call('GET', '/api/stats/by-category?from=2026-10-01&to=2026-10-31', undefined, tk)).body.categories;
  assert.deepEqual(pie.map((c) => [c.category, c.total.paise]), [['Groceries', 30000], ['Pet food', 15000]]);
  // Filtering by one category finds the entry but counts only that part.
  assert.equal((await call('GET', '/api/transactions?category=Groceries', undefined, tk)).body.total, 1);
  assert.equal((await call('GET', '/api/stats/summary?category=Groceries', undefined, tk)).body.expense.paise, 30000);
  assert.equal((await call('GET', '/api/stats/summary', undefined, tk)).body.expense.paise, 45000);
  // Budgets count the part too, and custom part categories are suggested.
  await call('PUT', '/api/budgets', { month: '2026-10', category: 'Groceries', limit: '1000' }, tk);
  assert.equal((await call('GET', '/api/budgets?month=2026-10', undefined, tk)).body.categories[0].spent.paise, 30000);
  assert.ok((await call('GET', '/api/categories', undefined, tk)).body.custom.expense.includes('Pet food'));

  // Changing the amount must keep the parts adding up; removing the split needs a category.
  const id = res.body.transaction.id;
  assert.equal((await call('PATCH', `/api/transactions/${id}`, { amount: '500' }, tk)).status, 400);
  const plain = await call('PATCH', `/api/transactions/${id}`, { splits: null, category: 'Groceries' }, tk);
  assert.equal(plain.body.transaction.splits, null);
  assert.equal(plain.body.transaction.category, 'Groceries');
});

test('foreign-currency entries use that day’s ECB rate and keep the original amount', async () => {
  const tk = await newUser();
  const res = await add({ currency: 'usd', originalAmount: '12.50', category: 'Travel', date: '2026-10-20' }, tk);
  assert.equal(res.status, 201);
  // 1250 cents × 94.93 = 118662.5 paise → ₹1,186.63
  assert.equal(res.body.transaction.amountPaise, 118663);
  assert.deepEqual(res.body.transaction.original, { currency: 'USD', amount: 12.5, amountMinor: 1250, rate: 94.93, rateDate: '2026-10-20' });

  // A Sunday uses Friday's published rate, and the answer says so.
  const sunday = await add({ currency: 'EUR', originalAmount: '10', category: 'Travel', date: '2026-10-18' }, tk);
  assert.equal(sunday.body.transaction.original.rateDate, '2026-10-16');
  assert.equal(sunday.body.transaction.amountPaise, 103400);

  // The same day's rate is cached, not fetched again.
  const before = fxCalls.length;
  await add({ currency: 'USD', originalAmount: '1', category: 'Travel', date: '2026-10-20' }, tk);
  assert.equal(fxCalls.length, before);

  // Parts of a foreign split are converted at the same rate and still add up.
  const split = await add({ currency: 'USD', originalAmount: '10', date: '2026-10-20', splits: [{ category: 'Travel', amount: '7.33' }, { category: 'Food & Dining', amount: '2.67' }] }, tk);
  const parts = split.body.transaction.splits.map((s) => s.amountPaise);
  assert.equal(parts.reduce((a, b) => a + b, 0), split.body.transaction.amountPaise);

  assert.equal((await add({ currency: 'XYZ', originalAmount: '5', category: 'Travel' }, tk)).body.error.code, 'unknown_currency');
  assert.equal((await add({ currency: 'INR', originalAmount: '5', category: 'Travel' }, tk)).status, 400);
  assert.equal((await add({ currency: 'USD', category: 'Travel' }, tk)).status, 400);
  assert.equal((await add({ currency: 'ERR', originalAmount: '5', category: 'Travel' }, tk)).status, 503);

  const rate = (await call('GET', '/api/fx/rate?currency=USD&date=2026-10-20', undefined, tk)).body;
  assert.deepEqual(rate, { currency: 'USD', rate: 94.93, rateDate: '2026-10-20' });
  assert.deepEqual(Object.keys((await call('GET', '/api/fx/currencies', undefined, tk)).body.currencies), ['USD', 'EUR']);

  // Typing a rupee amount over a foreign entry drops the foreign details.
  const edited = await call('PATCH', `/api/transactions/${res.body.transaction.id}`, { amount: '1200' }, tk);
  assert.equal(edited.body.transaction.original, null);
});

test('trip mode: one trip at a time, with a tag, budget and summary', async () => {
  const tk = await newUser();
  const trip = (await call('POST', '/api/trips', { name: 'Goa 2026!', budget: '40000' }, tk)).body.trip;
  assert.deepEqual([trip.tag, trip.active, trip.budget.paise], ['trip-goa-2026', true, 4000000]);
  assert.equal((await call('POST', '/api/trips', { name: 'Another' }, tk)).status, 409);

  await add({ amount: '3000', category: 'Travel', tags: [trip.tag], date: '2026-10-10', note: 'flight' }, tk);
  await add({ amount: '1200', category: 'Food & Dining', tags: [trip.tag], date: '2026-10-11' }, tk);
  await add({ amount: '800', category: 'Food & Dining', tags: [trip.tag], date: '2026-10-11' }, tk);
  await add({ amount: '999', category: 'Shopping', date: '2026-10-11' }, tk);

  const summary = (await call('GET', `/api/trips/${trip.id}/summary`, undefined, tk)).body;
  assert.equal(summary.trip.spent.paise, 500000);
  assert.equal(summary.trip.percentUsed, 12.5);
  assert.deepEqual(summary.categories.map((c) => [c.category, c.total.paise]), [['Travel', 300000], ['Food & Dining', 200000]]);
  assert.equal(summary.daysWithSpending, 2);
  assert.equal(summary.perDay.paise, 250000);
  assert.equal(summary.biggest.note, 'flight');

  const ended = (await call('PATCH', `/api/trips/${trip.id}`, { end: true }, tk)).body.trip;
  assert.equal(ended.active, false);
  const again = (await call('POST', '/api/trips', { name: 'Goa 2026' }, tk)).body.trip;
  assert.equal(again.tag, 'trip-goa-2026-2');
  assert.deepEqual((await call('GET', '/api/trips', undefined, tk)).body.trips.map((x) => x.active), [true, false]);
});

test('receipt photos: real images only, private to the space, cleaned up with their entry', async () => {
  const tk = await newUser();
  const tx = (await add({ amount: '640', category: 'Groceries' }, tk)).body.transaction;
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 7)]);
  const put = (body, type = 'image/jpeg', who = tk) => fetch(`${t.base}/api/transactions/${tx.id}/receipt`, {
    method: 'PUT', headers: { authorization: `Bearer ${who}`, 'content-type': type }, body,
  });

  assert.equal((await put(jpeg)).status, 201);
  assert.equal((await call('GET', `/api/transactions/${tx.id}`, undefined, tk)).body.transaction.hasReceipt, true);
  const got = await fetch(`${t.base}/api/transactions/${tx.id}/receipt`, { headers: { authorization: `Bearer ${tk}` } });
  assert.equal(got.headers.get('content-type'), 'image/jpeg');
  assert.ok(Buffer.from(await got.arrayBuffer()).equals(jpeg));

  assert.equal((await put(Buffer.from('not an image at all'))).status, 400);
  assert.equal((await put(Buffer.concat([jpeg, Buffer.alloc(2 * 1024 * 1024)]))).status, 413);
  const outsider = await newUser();
  assert.equal((await put(jpeg, 'image/jpeg', outsider)).status, 404);
  assert.equal((await fetch(`${t.base}/api/transactions/${tx.id}/receipt`, { headers: { authorization: `Bearer ${outsider}` } })).status, 404);

  assert.equal((await call('DELETE', `/api/transactions/${tx.id}/receipt`, undefined, tk)).status, 204);
  assert.equal((await call('GET', `/api/transactions/${tx.id}`, undefined, tk)).body.transaction.hasReceipt, false);

  // A photo whose entry is gone for good (purged after the undo window) is removed by the hourly job.
  assert.equal((await put(jpeg)).status, 201);
  await Transaction.deleteOne({ _id: tx.id });
  assert.equal(await removeOrphanReceipts(), 1);
  assert.equal(await removeOrphanReceipts(), 0);
});

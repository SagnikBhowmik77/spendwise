import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, uniqueEmail, GOOD_PASSWORD } from './helpers.js';

let t;
let token;
const acc = {};

const newUser = async () =>
  (await t.api('POST', '/api/auth/register', { body: { name: 'Arjun', email: uniqueEmail(), password: GOOD_PASSWORD } })).body.token;
const call = (method, path, body, tk = token) => t.api(method, path, { token: tk, body });
const add = (body, tk = token) => call('POST', '/api/transactions', { date: '2026-10-10', ...body }, tk);
const balances = async () => {
  const { body } = await call('GET', '/api/accounts?includeArchived=true');
  return { ...Object.fromEntries(body.accounts.map((a) => [a.name, a.balance.paise])), netWorth: body.netWorth };
};

before(async () => {
  t = await startTestServer();
  token = await newUser();
});
after(() => t.stop());

test('a new user starts with one "Cash" account, the default, at ₹0', async () => {
  const { body } = await call('GET', '/api/accounts');
  assert.equal(body.accounts.length, 1);
  assert.deepEqual(
    [body.accounts[0].name, body.accounts[0].type, body.accounts[0].isDefault, body.accounts[0].balance.paise],
    ['Cash', 'cash', true, 0],
  );
  acc.Cash = body.accounts[0].id;
  assert.equal(body.netWorth.net.paise, 0);
});

test('accounts can be added with an opening balance, negative for a card with money owed', async () => {
  for (const [name, type, openingBalance] of [['HDFC Savings', 'bank', '50,000'], ['ICICI Card', 'credit_card', '-2000'], ['Paytm', 'wallet', undefined]]) {
    const res = await call('POST', '/api/accounts', { name, type, openingBalance });
    assert.equal(res.status, 201, name);
    acc[name] = res.body.account.id;
  }
  const dup = await call('POST', '/api/accounts', { name: 'hdfc savings', type: 'bank' });
  assert.equal(dup.status, 409);
  assert.equal((await call('POST', '/api/accounts', { name: 'X', type: 'locker' })).status, 400);
  assert.equal((await call('POST', '/api/accounts', { name: 'Y', type: 'bank', openingBalance: '12.345' })).status, 400);
});

test('entries move balances; transfers move money between accounts without being income or spending', async () => {
  const rows = [
    { type: 'income', amount: '30000', category: 'Salary', account: acc['HDFC Savings'], paymentMethod: 'netbanking' },
    { type: 'expense', amount: '450', category: 'Food & Dining', account: acc.Paytm, paymentMethod: 'upi' },
    { type: 'expense', amount: '1200', category: 'Shopping', account: acc['ICICI Card'], paymentMethod: 'card' },
    // ATM withdrawal and paying the card bill.
    { type: 'transfer', amount: '2000', account: acc['HDFC Savings'], toAccount: acc.Cash, note: 'ATM' },
    { type: 'transfer', amount: '1200', account: acc['HDFC Savings'], toAccount: acc['ICICI Card'], paymentMethod: 'upi', category: 'ignored' },
  ];
  for (const body of rows) assert.equal((await add(body)).status, 201, JSON.stringify(body));

  const b = await balances();
  assert.equal(b.Cash, 200000);
  assert.equal(b['HDFC Savings'], 7680000);
  assert.equal(b['ICICI Card'], -200000);
  assert.equal(b.Paytm, -45000);
  assert.deepEqual(
    [b.netWorth.assets.paise, b.netWorth.liabilities.paise, b.netWorth.net.paise],
    [7880000, 245000, 7635000],
  );

  // Totals ignore transfers.
  const summary = (await call('GET', '/api/stats/summary')).body;
  assert.equal(summary.income.paise, 3000000);
  assert.equal(summary.expense.paise, 165000);
  assert.equal(summary.count, 3);

  // Transfers are listed, with a fixed category and no payment method.
  const transfers = (await call('GET', '/api/transactions?type=transfer')).body.items;
  assert.equal(transfers.length, 2);
  assert.ok(transfers.every((x) => x.category === 'Transfer' && x.paymentMethod === null && x.toAccount));
  // Filtering by an account includes transfers in and out of it.
  assert.equal((await call('GET', `/api/transactions?account=${acc.Cash}`)).body.total, 1);
  assert.equal((await call('GET', `/api/transactions?account=${acc['HDFC Savings']}`)).body.total, 3);
});

test('spending by payment method', async () => {
  const res = (await call('GET', '/api/stats/by-payment-method')).body;
  assert.deepEqual(res.methods.map((m) => [m.method, m.total.paise, m.share]), [['card', 120000, 72.7], ['upi', 45000, 27.3]]);
  // The card-bill transfer was sent with "upi", but transfers never keep a payment method.
  assert.equal((await call('GET', '/api/transactions?paymentMethod=upi')).body.total, 1);
});

test('entries are checked against your own, active accounts', async () => {
  const noTo = await add({ type: 'transfer', amount: '10', account: acc.Cash });
  assert.equal(noTo.status, 400);
  assert.equal(noTo.body.error.details[0].field, 'toAccount');
  const same = await add({ type: 'transfer', amount: '10', account: acc.Cash, toAccount: acc.Cash });
  assert.equal(same.body.error.details[0].field, 'toAccount');

  const otherToken = await newUser();
  const foreign = await add({ type: 'expense', amount: '10', category: 'Other', account: acc.Cash }, otherToken);
  assert.equal(foreign.status, 400);
  assert.equal(foreign.body.error.details[0].field, 'account');
  assert.equal((await add({ type: 'expense', amount: '10', category: 'Other', paymentMethod: 'cheque' })).status, 400);

  // Without an account, the default (Cash) is used.
  const dflt = await add({ type: 'expense', amount: '10', category: 'Other' });
  assert.equal(dflt.body.transaction.account, acc.Cash);
  await call('DELETE', `/api/transactions/${dflt.body.transaction.id}`);
});

test('a transfer stays a transfer when edited', async () => {
  const tr = (await call('GET', '/api/transactions?type=transfer')).body.items[0];
  const res = await call('PATCH', `/api/transactions/${tr.id}`, { type: 'expense' });
  assert.equal(res.status, 400);
  const moved = await call('PATCH', `/api/transactions/${tr.id}`, { amount: '1500' });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.transaction.amountPaise, 150000);
});

test('archiving hides an account from pickers but keeps it in net worth and history', async () => {
  const before = (await balances()).netWorth.net.paise;
  const res = await call('PATCH', `/api/accounts/${acc.Paytm}`, { archived: true });
  assert.equal(res.status, 200);
  assert.equal(res.body.account.archived, true);
  const active = (await call('GET', '/api/accounts')).body;
  assert.ok(!active.accounts.some((a) => a.name === 'Paytm'));
  assert.equal(active.archivedCount, 1);
  assert.equal(active.netWorth.net.paise, before);

  const blocked = await add({ type: 'expense', amount: '5', category: 'Other', account: acc.Paytm });
  assert.match(blocked.body.error.details[0].message, /archived/);
  await call('PATCH', `/api/accounts/${acc.Paytm}`, { archived: false });
});

test('only an account without history can be deleted; the default moves if needed', async () => {
  const used = await call('DELETE', `/api/accounts/${acc.Paytm}`);
  assert.equal(used.status, 409);
  assert.equal(used.body.error.code, 'account_in_use');

  const spare = (await call('POST', '/api/accounts', { name: 'Old wallet', type: 'wallet' })).body.account;
  assert.equal((await call('DELETE', `/api/accounts/${spare.id}`)).status, 204);

  // Making HDFC the default, then archiving it, hands "default" to another active account.
  assert.equal((await call('PATCH', `/api/accounts/${acc['HDFC Savings']}`, { isDefault: true })).body.account.isDefault, true);
  await call('PATCH', `/api/accounts/${acc['HDFC Savings']}`, { archived: true });
  const list = (await call('GET', '/api/accounts')).body.accounts;
  assert.equal(list.filter((a) => a.isDefault).length, 1);
  assert.notEqual(list.find((a) => a.isDefault).id, acc['HDFC Savings']);
});

test('the last active account can’t be archived', async () => {
  const solo = await newUser();
  const [only] = (await call('GET', '/api/accounts', undefined, solo)).body.accounts;
  const res = await call('PATCH', `/api/accounts/${only.id}`, { archived: true }, solo);
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'last_account');
});

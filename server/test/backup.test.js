// Batch 12I: back up a space as JSON and restore it, here or into another account.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, uniqueEmail, GOOD_PASSWORD } from './helpers.js';
import { todayIn, addDays } from '../src/schedule.js';
import { dayString } from '../src/money.js';

let t;
const call = (method, path, body, token) => t.api(method, path, { token, body });
const newUser = async () => (await t.api('POST', '/api/auth/register', { body: { name: 'Ira', email: uniqueEmail(), password: GOOD_PASSWORD } })).body.token;
const now = todayIn('Asia/Kolkata');
const ago = (n) => dayString(addDays(now, -n));

before(async () => { t = await startTestServer(); });
after(async () => { await t.stop(); });

async function fill(tk) {
  const bank = (await call('POST', '/api/accounts', { name: 'HDFC', type: 'bank', openingBalance: '50000' }, tk)).body.account;
  await call('POST', '/api/transactions', { type: 'income', amount: '80000', category: 'Salary', account: bank.id, date: ago(20) }, tk);
  await call('POST', '/api/transactions', { type: 'expense', amount: '450', category: 'Food & Dining', account: bank.id, date: ago(3), note: 'Lunch', tags: ['work'] }, tk);
  const bill = (await call('POST', '/api/bills', { name: 'Electricity', amount: '1800', category: 'Bills & Utilities', frequency: 'monthly', firstDue: ago(5), account: bank.id }, tk)).body.bill;
  await call('POST', `/api/bills/${bill.id}/pay`, { date: ago(4) }, tk);
  const goal = (await call('POST', '/api/goals', { name: 'Laptop', target: '90000' }, tk)).body.goal;
  await call('POST', `/api/goals/${goal.id}/entries`, { direction: 'add', amount: '5000', date: ago(2) }, tk);
  await call('POST', '/api/investments', { kind: 'fd', name: 'SBI FD', principal: '100000', ratePct: 7, startDate: ago(100), tenureMonths: 12 }, tk);
  assert.equal((await call('PUT', '/api/budgets', { month: dayString(now).slice(0, 7), category: 'Food & Dining', limit: '6000' }, tk)).status < 300, true);
  return { bank };
}

test('a backup has everything in the space; restoring it into another account links it all up again', async () => {
  const a = await newUser();
  await fill(a);
  const res = await t.api('GET', '/api/backup', { token: a });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /^attachment; filename="spendwise-backup-personal-\d{4}-\d{2}-\d{2}\.json"$/);
  const backup = res.body;
  assert.deepEqual([backup.app, backup.format], ['spendwise', 1]);
  assert.deepEqual([backup.counts.accounts, backup.counts.transactions, backup.counts.bills, backup.counts.goals, backup.counts.holdings, backup.counts.budgets], [2, 3, 1, 1, 1, 1]);

  const b = await newUser();
  assert.equal((await call('POST', '/api/backup/restore', { password: 'wrong pass 1', backup }, b)).status, 400);
  const r = await call('POST', '/api/backup/restore', { password: GOOD_PASSWORD, backup }, b);
  assert.equal(r.status, 200);
  assert.equal(r.body.restored.transactions, 3);
  // Same data, new ids, references pointing at the restored records.
  const accounts = (await call('GET', '/api/accounts', undefined, b)).body;
  assert.deepEqual(accounts.accounts.map((x) => x.name).sort(), ['Cash', 'HDFC']);
  const hdfc = accounts.accounts.find((x) => x.name === 'HDFC');
  assert.equal(hdfc.balance.paise, (50_000 + 80_000 - 450 - 1_800) * 100);
  assert.ok(!backup.data.accounts.some((x) => x._id === hdfc.id));
  const txs = (await call('GET', '/api/transactions?preset=all', undefined, b)).body.items;
  assert.equal(txs.length, 3);
  assert.ok(txs.every((x) => x.account === hdfc.id));
  const [bill] = (await call('GET', '/api/bills', undefined, b)).body.bills;
  assert.ok(txs.some((x) => x.id === bill.payments[0].transactionId));
  assert.equal((await call('GET', '/api/goals', undefined, b)).body.goals[0].saved.paise, 500_000);
  assert.equal((await call('GET', '/api/investments', undefined, b)).body.holdings[0].principal.paise, 10_000_000);
  // The original account is untouched.
  assert.equal((await call('GET', '/api/transactions?preset=all', undefined, a)).body.items.length, 3);
  // The restore is in the activity log.
  assert.match((await call('GET', '/api/activity', undefined, b)).body.items[0].summary, /^Restored a backup from \d{4}-\d{2}-\d{2}: 3 entries and 2 accounts/);
});

test('restoring replaces what is in the space; a bad backup changes nothing', async () => {
  const a = await newUser();
  await fill(a);
  const backup = (await t.api('GET', '/api/backup', { token: a })).body;
  // Changes after the backup...
  const lunch = (await call('GET', '/api/transactions?preset=all', undefined, a)).body.items.find((x) => x.note === 'Lunch');
  await call('DELETE', `/api/transactions/${lunch.id}`, undefined, a);
  await call('POST', '/api/transactions', { type: 'expense', amount: '999', category: 'Shopping', date: ago(1) }, a);
  // ...are undone by restoring it.
  assert.equal((await call('POST', '/api/backup/restore', { password: GOOD_PASSWORD, backup }, a)).status, 200);
  const restored = (await call('GET', '/api/transactions?preset=all', undefined, a)).body.items;
  assert.equal(restored.length, 3);
  assert.ok(restored.some((x) => x.note === 'Lunch' && x.tags.includes('work')));
  assert.ok(!restored.some((x) => x.category === 'Shopping'));
  // A record that breaks the rules: nothing is removed or added.
  const broken = structuredClone(backup);
  broken.data.transactions[0].amountPaise = -5;
  const r = await call('POST', '/api/backup/restore', { password: GOOD_PASSWORD, backup: broken }, a);
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, 'invalid_backup');
  assert.equal(r.body.error.details[0].field, 'transactions[0].amountPaise');
  assert.equal((await call('GET', '/api/transactions?preset=all', undefined, a)).body.items.length, 3);
  // Not a backup at all, or a format this version can't read.
  assert.equal((await call('POST', '/api/backup/restore', { password: GOOD_PASSWORD, backup: { app: 'other', format: 1, data: {} } }, a)).status, 400);
  assert.equal((await call('POST', '/api/backup/restore', { password: GOOD_PASSWORD, backup: { ...backup, format: 9 } }, a)).status, 400);
  // Two accounts with the same name would break the space.
  const dupes = structuredClone(backup);
  dupes.data.accounts[1].name = dupes.data.accounts[0].name;
  assert.match((await call('POST', '/api/backup/restore', { password: GOOD_PASSWORD, backup: dupes }, a)).body.error.details.at(-1).message, /Two accounts are called/);
});

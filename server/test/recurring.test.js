import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, uniqueEmail, GOOD_PASSWORD, personalSpace } from './helpers.js';
import { occurrenceDate, todayIn, addDays } from '../src/schedule.js';
import { dayString, parseDay } from '../src/money.js';
import { RecurringRule, Transaction } from '../src/models/index.js';
import { processDue } from '../src/services/recurring.service.js';

let t;
let token;
let userId;
let owner;
// The API works on "today" in India time; tests that go through the API build dates around it.
const TODAY = todayIn('Asia/Kolkata');
const day = (offset) => dayString(addDays(TODAY, offset));
const d = (s) => parseDay(s);

const newUser = async () =>
  (await t.api('POST', '/api/auth/register', { body: { name: 'Riya', email: uniqueEmail(), password: GOOD_PASSWORD } })).body;
const create = (body, tk = token) =>
  t.api('POST', '/api/recurring', {
    token: tk,
    body: { type: 'expense', amount: '100', category: 'Rent', frequency: 'monthly', startDate: day(0), ...body },
  });
const entriesOf = (ruleId) => Transaction.find({ recurringRule: ruleId }).sort({ date: 1 }).lean();

before(async () => {
  t = await startTestServer();
  const reg = await newUser();
  token = reg.token;
  userId = reg.user.id;
  // Rules inserted directly need the space and account the API would fill in.
  owner = { ...(await personalSpace(userId)), user: userId };
});
after(() => t.stop());

test('occurrence dates keep their day of month and handle short months and leap years', () => {
  const monthly = [0, 1, 2, 3].map((i) => dayString(occurrenceDate(d('2026-01-31'), 'monthly', 1, i)));
  assert.deepEqual(monthly, ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  const yearly = [0, 1, 4].map((i) => dayString(occurrenceDate(d('2024-02-29'), 'yearly', 1, i)));
  assert.deepEqual(yearly, ['2024-02-29', '2025-02-28', '2028-02-29']);
  assert.equal(dayString(occurrenceDate(d('2026-10-01'), 'weekly', 2, 1)), '2026-10-15');
  assert.equal(dayString(occurrenceDate(d('2026-12-31'), 'daily', 1, 1)), '2027-01-01');
  assert.equal(dayString(occurrenceDate(d('2026-11-30'), 'monthly', 3, 1)), '2027-02-28');
});

test('"today" follows India time, not UTC', () => {
  // 19:00 UTC on 31 Oct is 00:30 on 1 Nov in India.
  const late = new Date('2026-10-31T19:00:00Z');
  assert.equal(dayString(todayIn('Asia/Kolkata', late)), '2026-11-01');
  assert.equal(dayString(todayIn('UTC', late)), '2026-10-31');
});

test('creating a rule with a past start date adds the entries already due, once', async () => {
  const start = dayString(addDays(TODAY, -65));
  const res = await create({ startDate: start, category: 'Rent', amount: '12000', note: 'Flat rent' });
  assert.equal(res.status, 201);

  const expected = [];
  for (let i = 0; occurrenceDate(d(start), 'monthly', 1, i) <= TODAY; i++) expected.push(dayString(occurrenceDate(d(start), 'monthly', 1, i)));
  assert.equal(res.body.created, expected.length);
  assert.equal(res.body.rule.status, 'active');
  assert.equal(res.body.rule.nextDate, dayString(occurrenceDate(d(start), 'monthly', 1, expected.length)));

  const rows = await entriesOf(res.body.rule.id);
  assert.deepEqual(rows.map((r) => dayString(r.date)), expected);
  assert.ok(rows.every((r) => r.amountPaise === 1200000 && r.note === 'Flat rent' && String(r.user) === userId));

  // Shows up in the normal list, marked as coming from the rule.
  const list = await t.api('GET', '/api/transactions?category=Rent', { token });
  assert.ok(list.body.items.every((i) => i.recurringRuleId === res.body.rule.id));

  // Running again creates nothing new.
  assert.equal((await processDue()).created, 0);
  assert.equal((await entriesOf(res.body.rule.id)).length, expected.length);
});

test('two runs at the same moment never create duplicates', async () => {
  const rule = await RecurringRule.create({
    ...owner, type: 'expense', amountPaise: 500, category: 'Fuel', frequency: 'daily', interval: 1,
    startDate: d('2026-01-01'), nextIndex: 0, nextRunDate: d('2026-01-01'),
  });
  const until = d('2026-01-20');
  const results = await Promise.all([processDue({ today: until, ruleId: rule._id }), processDue({ today: until, ruleId: rule._id })]);
  assert.equal(results[0].created + results[1].created, 20);
  assert.equal((await entriesOf(rule._id)).length, 20);
  const fresh = await RecurringRule.findById(rule._id).lean();
  assert.equal(fresh.nextIndex, 20);
  assert.equal(dayString(fresh.nextRunDate), '2026-01-21');
  // Parked so later tests' runs leave it alone.
  await RecurringRule.updateOne({ _id: rule._id }, { $set: { active: false } });
});

test('a rule stops at its end date and is marked ended', async () => {
  const rule = await RecurringRule.create({
    ...owner, type: 'income', amountPaise: 100000, category: 'Freelance', frequency: 'weekly', interval: 1,
    startDate: d('2026-03-02'), endDate: d('2026-03-20'), nextIndex: 0, nextRunDate: d('2026-03-02'),
  });
  assert.equal((await processDue({ today: d('2026-06-01'), ruleId: rule._id })).created, 3);
  assert.deepEqual((await entriesOf(rule._id)).map((r) => dayString(r.date)), ['2026-03-02', '2026-03-09', '2026-03-16']);
  const view = (await t.api('GET', `/api/recurring/${rule._id}`, { token })).body.rule;
  assert.equal(view.status, 'ended');
  assert.equal(view.nextDate, null);
});

test('pausing stops new entries; resuming skips what was missed instead of back-filling', async () => {
  const rule = await RecurringRule.create({
    ...owner, type: 'expense', amountPaise: 29900, category: 'Entertainment', frequency: 'monthly', interval: 1,
    startDate: d('2026-01-15'), nextIndex: 2, nextRunDate: d('2026-03-15'), active: false,
  });
  // Paused: the runner ignores it even though March is long past.
  assert.equal((await processDue({ today: TODAY, ruleId: rule._id })).created, 0);

  const res = await t.api('PATCH', `/api/recurring/${rule._id}`, { token, body: { active: true } });
  assert.equal(res.status, 200);
  assert.equal(res.body.rule.status, 'active');
  let i = 2;
  while (occurrenceDate(d('2026-01-15'), 'monthly', 1, i) < TODAY) i++;
  const firstAfterResume = occurrenceDate(d('2026-01-15'), 'monthly', 1, i);
  const rows = await entriesOf(rule._id);
  // Only today's entry is created, and only if one falls exactly on today.
  assert.equal(rows.length, firstAfterResume.getTime() === TODAY.getTime() ? 1 : 0);

  const paused = await t.api('PATCH', `/api/recurring/${rule._id}`, { token, body: { active: false } });
  assert.equal(paused.body.rule.status, 'paused');
});

test('editing a rule changes future entries only', async () => {
  const res = await create({ frequency: 'weekly', startDate: day(-7), amount: '100', category: 'Groceries' });
  assert.equal(res.body.created, 2);
  const id = res.body.rule.id;

  const upd = await t.api('PATCH', `/api/recurring/${id}`, { token, body: { amount: '250', note: 'bigger basket' } });
  assert.equal(upd.status, 200);
  assert.equal(upd.body.rule.amountPaise, 25000);

  await processDue({ today: addDays(TODAY, 7), ruleId: id });
  const rows = await entriesOf(id);
  assert.deepEqual(rows.map((r) => r.amountPaise), [10000, 10000, 25000]);
  assert.equal(rows[2].note, 'bigger basket');
});

test('deleting a rule keeps the entries it already made', async () => {
  const res = await create({ frequency: 'daily', startDate: day(-2), category: 'Transport', amount: '40' });
  assert.equal(res.body.created, 3);
  const id = res.body.rule.id;
  assert.equal((await t.api('DELETE', `/api/recurring/${id}`, { token })).status, 204);
  assert.equal((await t.api('GET', `/api/recurring/${id}`, { token })).status, 404);
  assert.equal((await entriesOf(id)).length, 3);
  await processDue({ today: addDays(TODAY, 5), spaceId: owner.space });
  assert.equal((await entriesOf(id)).length, 3);
});

test('upcoming lists what active rules will add in the next days', async () => {
  const { token: fresh } = await newUser();
  await create({ startDate: day(3), category: 'Rent', amount: '12000' }, fresh);
  await create({ type: 'income', frequency: 'weekly', startDate: day(1), category: 'Salary', amount: '5000' }, fresh);
  const paused = await create({ startDate: day(2), category: 'Gym', amount: '999' }, fresh);
  await t.api('PATCH', `/api/recurring/${paused.body.rule.id}`, { token: fresh, body: { active: false } });

  const res = (await t.api('GET', '/api/recurring/upcoming?days=14', { token: fresh })).body;
  assert.deepEqual(res.items.map((x) => [x.date, x.category]), [
    [day(1), 'Salary'], [day(3), 'Rent'], [day(8), 'Salary'],
  ]);
  assert.equal(res.totals.expense.paise, 1200000);
  assert.equal(res.totals.income.paise, 1000000);

  const rules = (await t.api('GET', '/api/recurring', { token: fresh })).body.rules;
  assert.deepEqual(rules.map((r) => r.status), ['active', 'active', 'paused']);
});

test('recurring input is validated', async () => {
  const bad = [
    { startDate: day(-400) },
    { startDate: day(400) },
    { startDate: day(0), endDate: day(-1) },
    { frequency: 'hourly' },
    { interval: 0 },
    { interval: 13 },
    { amount: '0' },
  ];
  for (const body of bad) assert.equal((await create(body)).status, 400, JSON.stringify(body));

  const ok = await create({ startDate: day(5) });
  assert.equal(ok.body.created, 0);
  const id = ok.body.rule.id;
  // The schedule can't be changed, only amount/category/note/end date/active.
  assert.equal((await t.api('PATCH', `/api/recurring/${id}`, { token, body: { frequency: 'daily' } })).status, 400);
  assert.equal((await t.api('PATCH', `/api/recurring/${id}`, { token, body: { endDate: day(1) } })).status, 400);
  assert.equal((await t.api('PATCH', `/api/recurring/${id}`, { token, body: { active: 'yes' } })).status, 400);
});

test('rules are private, need a login, and go when the account is deleted', async () => {
  const mine = (await create({ startDate: day(10) })).body.rule.id;
  const other = await newUser();
  assert.equal((await t.api('GET', `/api/recurring/${mine}`, { token: other.token })).status, 404);
  assert.equal((await t.api('PATCH', `/api/recurring/${mine}`, { token: other.token, body: { amount: '1' } })).status, 404);
  assert.equal((await t.api('DELETE', `/api/recurring/${mine}`, { token: other.token })).status, 404);
  assert.deepEqual((await t.api('GET', '/api/recurring', { token: other.token })).body.rules, []);
  assert.equal((await t.api('GET', '/api/recurring')).status, 401);

  await create({ startDate: day(-1) }, other.token);
  assert.equal(await RecurringRule.countDocuments({ user: other.user.id }), 1);
  await t.api('DELETE', '/api/auth/me', { token: other.token, body: { password: GOOD_PASSWORD } });
  assert.equal(await RecurringRule.countDocuments({ user: other.user.id }), 0);
  assert.equal(await Transaction.countDocuments({ user: other.user.id }), 0);
});

test('entries typed by hand are not linked to any rule', async () => {
  const res = await t.api('POST', '/api/transactions', {
    token, body: { type: 'expense', amount: '10', category: 'Other', date: day(0) },
  });
  assert.equal(res.body.transaction.recurringRuleId, null);
});

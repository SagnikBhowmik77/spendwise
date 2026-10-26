// Batches 12O–12S: envelopes, sinking funds and the wishlist; vehicles, the vault, card rewards and FIRE; the
// offline queue's de-duplication; roles, private accounts and approvals; and the calendar feed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, uniqueEmail, GOOD_PASSWORD, markVerified } from './helpers.js';
import { config } from '../src/config.js';
import { dayString, currentMonth, shiftMonth } from '../src/money.js';
import { addDays, todayIn } from '../src/schedule.js';
import { fireProjection, rewardValue, serviceDue, vehicleStats } from '../src/life.js';
import { Space, Transaction } from '../src/models/index.js';
import { migrateRoles } from '../src/services/space.service.js';

let t;
const today = () => todayIn(config.timeZone);
const inDays = (n) => dayString(addDays(today(), n));
const register = async (name) => {
  const email = uniqueEmail();
  const { body } = await t.api('POST', '/api/auth/register', { body: { name, email, password: GOOD_PASSWORD } });
  await markVerified(email);
  return { token: body.token, id: body.user.id, email, name };
};
const call = (method, path, body, who, spaceId) => t.api(method, path, { token: who.token, body, headers: spaceId ? { 'x-space-id': spaceId } : {} });
const expense = (amount, category, extra = {}) => ({ type: 'expense', amount, category, date: inDays(0), ...extra });

before(async () => { t = await startTestServer(); });
after(() => t.stop());

// ── 12O ──

test('envelopes: money in each envelope against what was really spent, and a category in only one envelope', async () => {
  const me = await register('Asha');
  const month = currentMonth(today());
  await call('POST', '/api/transactions', { type: 'income', amount: '50000', category: 'Salary', date: inDays(0) }, me);
  await call('POST', '/api/transactions', expense('4500', 'Food & Dining'), me);
  await call('POST', '/api/transactions', expense('1200', 'Groceries'), me);
  await call('POST', '/api/transactions', expense('800', 'Entertainment'), me);

  const empty = await call('GET', `/api/envelopes?month=${month}`, undefined, me);
  assert.equal(empty.body.hasPlan, false);
  assert.equal(empty.body.available.rupees, 50000);

  const dup = await call('PUT', `/api/envelopes?month=${month}`, { envelopes: [
    { name: 'Food', categories: ['Food & Dining'], amount: '5000' }, { name: 'Eating', categories: ['Food & Dining'], amount: '100' },
  ] }, me);
  assert.equal(dup.status, 400);

  const saved = await call('PUT', `/api/envelopes?month=${month}`, { envelopes: [
    { name: 'Food', categories: ['Food & Dining', 'Groceries'], amount: '6000' },
    { name: 'Rent', categories: ['Rent'], amount: '20000' },
  ] }, me);
  assert.equal(saved.status, 200);
  const food = saved.body.envelopes.find((e) => e.name === 'Food');
  assert.deepEqual([food.spent.rupees, food.left.rupees, food.status], [5700, 300, 'warning']);
  assert.deepEqual([saved.body.assigned.rupees, saved.body.toAssign.rupees], [26000, 24000]);
  assert.deepEqual(saved.body.outsideCategories.map((c) => [c.category, c.spent.rupees]), [['Entertainment', 800]]);

  const next = shiftMonth(month, 1);
  const copied = await call('POST', `/api/envelopes/copy?month=${next}`, undefined, me);
  assert.equal(copied.status, 201);
  assert.equal(copied.body.envelopes.length, 2);
  assert.equal((await call('POST', `/api/envelopes/copy?month=${next}`, undefined, me)).status, 409);
  assert.equal((await call('POST', `/api/envelopes/copy?month=${shiftMonth(month, 5)}`, undefined, me)).status, 404);
});

test('sinking funds: what to put aside each month, and paying records the expense and moves the due date on', async () => {
  const me = await register('Kabir');
  const due = inDays(120);
  const { body: { fund } } = await call('POST', '/api/sinking-funds', { name: 'Car insurance', amount: '12000', nextDue: due, everyMonths: 12, category: 'Insurance' }, me);
  assert.ok(fund.monthly.rupees >= 2400 && fund.monthly.rupees <= 4000);
  const added = await call('POST', `/api/sinking-funds/${fund.id}/contributions`, { amount: '5000' }, me);
  assert.equal(added.body.fund.saved.rupees, 5000);
  assert.equal((await call('POST', `/api/sinking-funds/${fund.id}/contributions`, { direction: 'withdraw', amount: '9000' }, me)).status, 400);

  const accounts = (await call('GET', '/api/accounts', undefined, me)).body.accounts;
  const paid = await call('POST', `/api/sinking-funds/${fund.id}/paid`, { amount: '11000', account: accounts[0].id, date: inDays(0) }, me);
  assert.equal(paid.status, 200);
  assert.equal(paid.body.fund.nextDue, due);
  assert.equal(paid.body.fund.saved.rupees, 0);
  const list = (await call('GET', '/api/transactions?category=Insurance', undefined, me)).body.items;
  assert.deepEqual(list.map((x) => [x.amount, x.note]), [[11000, 'Car insurance']]);
});

test('wishlist: buying before the cooling-off ends needs a second yes; dropped items add up as money kept', async () => {
  const me = await register('Meera');
  const { body: { item: phone } } = await call('POST', '/api/wishlist', { name: 'New phone', price: '30000', coolDays: 30 }, me);
  assert.deepEqual([phone.ready, phone.daysLeft], [false, 30]);
  const soon = await call('POST', `/api/wishlist/${phone.id}/decide`, { decision: 'bought' }, me);
  assert.equal(soon.status, 409);
  assert.equal(soon.body.error.code, 'still_cooling_off');
  const accounts = (await call('GET', '/api/accounts', undefined, me)).body.accounts;
  const bought = await call('POST', `/api/wishlist/${phone.id}/decide`, { decision: 'bought', early: true, account: accounts[0].id }, me);
  assert.equal(bought.body.item.status, 'bought');
  assert.ok(bought.body.item.transactionId);
  assert.equal((await call('POST', `/api/wishlist/${phone.id}/decide`, { decision: 'dropped' }, me)).status, 409);

  const { body: { item: shoes } } = await call('POST', '/api/wishlist', { name: 'Shoes', price: '4500' }, me);
  await call('POST', `/api/wishlist/${shoes.id}/decide`, { decision: 'dropped' }, me);
  const list = (await call('GET', '/api/wishlist', undefined, me)).body;
  assert.equal(list.droppedTotal.rupees, 4500);
  assert.equal(list.waitingTotal.rupees, 0);
});

// ── 12P ──

test('mileage is measured between full tanks, and a service is due by km or by months, whichever is first', () => {
  const D = (s) => new Date(`${s}T00:00:00Z`);
  const s = vehicleStats([
    { date: D('2026-01-01'), odometerKm: 10000, quantity: 30, amountPaise: 300000, fullTank: true },
    { date: D('2026-01-10'), odometerKm: 10200, quantity: 10, amountPaise: 100000, fullTank: false },
    { date: D('2026-01-20'), odometerKm: 10600, quantity: 20, amountPaise: 200000, fullTank: true },
  ]);
  // 600 km on the 30 litres put in after the first full tank.
  assert.deepEqual([s.averageMileage, s.kmTracked, s.costPerKmPaise], [20, 600, 500]);
  const due = serviceDue({ everyKm: 5000, everyMonths: 6, lastKm: 6000, lastDate: D('2025-10-01') }, 10600, D('2026-01-20'));
  assert.deepEqual([due.nextKm, due.kmLeft, due.status], [11000, 400, 'soon']);
  // 4 points per ₹100 at ₹0.25 a point on ₹1,000: ₹10.
  assert.equal(rewardValue({ type: 'points', defaultRate: 4, pointValue: 0.25, rules: [] }, 'Shopping', 100_000), 1000);
  // ₹6 lakh a year at a 4% withdrawal rate needs ₹1.5 crore.
  assert.equal(fireProjection({ annualSpendPaise: 60_000_000, corpusPaise: 0, annualSavingPaise: 0, returnPct: 10, inflationPct: 6, withdrawalPct: 4, maxYears: 5 }).targetPaise, 1_500_000_000);
});

test('vehicles: fill-ups can be recorded as Fuel expenses, and the odometer can’t go backwards', async () => {
  const me = await register('Dev');
  const { body: { vehicle } } = await call('POST', '/api/vehicles', { name: 'Swift', service: { everyKm: 10000, lastKm: 1000 } }, me);
  const cash = (await call('GET', '/api/accounts', undefined, me)).body.accounts[0].id;
  await call('POST', `/api/vehicles/${vehicle.id}/fills`, { date: inDays(-10), odometerKm: 5000, quantity: 30, amount: '3000', account: cash }, me);
  const back = await call('POST', `/api/vehicles/${vehicle.id}/fills`, { date: inDays(-1), odometerKm: 4000, quantity: 10, amount: '1000' }, me);
  assert.equal(back.status, 400);
  const ok = await call('POST', `/api/vehicles/${vehicle.id}/fills`, { date: inDays(-1), odometerKm: 5600, quantity: 30, amount: '3000' }, me);
  assert.equal(ok.body.vehicle.stats.averageMileage, 20);
  assert.equal(ok.body.vehicle.service.due.kmLeft, 5400);
  const fuel = (await call('GET', '/api/transactions?category=Fuel', undefined, me)).body.items;
  assert.equal(fuel.length, 1);
  const serviced = await call('POST', `/api/vehicles/${vehicle.id}/serviced`, {}, me);
  assert.equal(serviced.body.vehicle.service.lastKm, 5600);
});

test('vault and card rewards: expiry status, and which card earns most per category', async () => {
  const me = await register('Nisha');
  const item = await call('POST', '/api/vault', { kind: 'insurance', name: 'Health cover', provider: 'Star Health', expiryDate: inDays(20), amount: '18000' }, me);
  assert.equal(item.status, 201);
  assert.equal(item.body.item.status, 'soon');

  const a = (await call('POST', '/api/accounts', { name: 'Cashback card', type: 'credit_card' }, me)).body.account;
  const b = (await call('POST', '/api/accounts', { name: 'Points card', type: 'credit_card' }, me)).body.account;
  const cash = (await call('GET', '/api/accounts', undefined, me)).body.accounts.find((x) => x.type === 'cash');
  assert.equal((await call('PUT', `/api/card-rewards/${cash.id}`, { type: 'cashback', defaultRate: 1 }, me)).status, 404);
  assert.equal((await call('PUT', `/api/card-rewards/${b.id}`, { type: 'points', defaultRate: 2 }, me)).status, 400);
  await call('PUT', `/api/card-rewards/${a.id}`, { type: 'cashback', defaultRate: 1, rules: [{ category: 'Shopping', rate: 5 }] }, me);
  await call('PUT', `/api/card-rewards/${b.id}`, { type: 'points', defaultRate: 10, pointValue: 0.25 }, me);
  await call('POST', '/api/transactions', expense('10000', 'Shopping', { account: a.id }), me);
  await call('POST', '/api/transactions', expense('2000', 'Food & Dining', { account: b.id }), me);
  const report = (await call('GET', '/api/card-rewards', undefined, me)).body;
  assert.equal(report.cards.find((c) => c.name === 'Cashback card').earned.rupees, 500);
  assert.equal(report.cards.find((c) => c.name === 'Points card').earned.rupees, 50);
  const best = Object.fromEntries(report.categories.map((c) => [c.category, c.best.name]));
  assert.deepEqual(best, { Shopping: 'Cashback card', 'Food & Dining': 'Points card' });
});

test('FIRE works from real spending, and every input can be changed', async () => {
  const me = await register('Om');
  const found = (await call('GET', '/api/fire', undefined, me)).body;
  assert.equal(found.target, null);
  const raw = await call('GET', '/api/fire?annualSpend=600000&corpus=0&annualSaving=1000000&returnPct=10&inflationPct=6&withdrawalPct=4', undefined, me);
  assert.equal(raw.status, 200);
  const r = raw.body;
  assert.equal(r.target.rupees, 15_000_000);
  assert.ok(r.years > 5 && r.years < 15);
  assert.ok(r.series.at(-1).corpus.paise >= r.target.paise);
  assert.equal((await call('GET', '/api/fire?corpus=-5', undefined, me)).status, 400);
});

// ── 12Q ──

test('an entry sent twice from the offline queue is saved once', async () => {
  const me = await register('Tara');
  const body = expense('250', 'Food & Dining', { clientRef: 'offline-abc12345' });
  const [x, y] = await Promise.all([call('POST', '/api/transactions', body, me), call('POST', '/api/transactions', body, me)]);
  assert.equal(x.body.transaction.id, y.body.transaction.id);
  assert.equal((await call('GET', '/api/transactions', undefined, me)).body.total, 1);
  assert.equal((await call('POST', '/api/transactions', expense('1', 'Food & Dining', { clientRef: 'no spaces!' }), me)).status, 400);
});

// ── 12R ──

async function household() {
  const owner = await register('Priya');
  const space = (await call('POST', '/api/spaces', { name: 'Home' }, owner)).body.space;
  const join = async (name, role) => {
    const email = uniqueEmail();
    const inv = await call('POST', `/api/spaces/${space.id}/invites`, { email, role }, owner);
    const { body } = await t.api('POST', '/api/auth/register', { body: { name, email, password: GOOD_PASSWORD } });
    await markVerified(email);
    const who = { token: body.token, id: body.user.id, name };
    await t.api('POST', `/api/invites/${inv.body.link.split('/invite/')[1]}/accept`, { token: who.token });
    return who;
  };
  return { owner, space, editor: await join('Rahul', 'editor'), viewer: await join('Dadi', 'viewer'), child: await join('Chintu', 'child') };
}

test('roles: viewers only look, children only add their own expenses within pocket money', async () => {
  const { owner, space, editor, viewer, child } = await household();
  const roles = (await call('GET', '/api/spaces/current', undefined, owner, space.id)).body.space.members.map((m) => [m.name, m.role]);
  assert.deepEqual(roles, [['Priya', 'owner'], ['Rahul', 'editor'], ['Dadi', 'viewer'], ['Chintu', 'child']]);

  assert.equal((await call('POST', '/api/transactions', expense('100', 'Groceries'), editor, space.id)).status, 201);
  assert.equal((await call('GET', '/api/transactions', undefined, viewer, space.id)).status, 200);
  const no = await call('POST', '/api/transactions', expense('100', 'Groceries'), viewer, space.id);
  assert.deepEqual([no.status, no.body.error.code], [403, 'read_only_member']);
  assert.equal((await call('POST', '/api/goals', { name: 'Trip', target: '1000' }, viewer, space.id)).status, 403);
  assert.equal((await call('POST', '/api/integrations/calendar', undefined, viewer, space.id)).status, 201);

  assert.equal((await call('PATCH', `/api/spaces/${space.id}/members/${child.id}`, { pocketMoney: '500' }, editor)).status, 403);
  await call('PATCH', `/api/spaces/${space.id}/members/${child.id}`, { pocketMoney: '500' }, owner);
  assert.equal((await call('POST', '/api/transactions', { type: 'income', amount: '50', category: 'Gift', date: inDays(0) }, child, space.id)).status, 403);
  assert.equal((await call('POST', '/api/transactions', expense('300', 'Snacks'), child, space.id)).status, 201);
  const over = await call('POST', '/api/transactions', expense('250', 'Snacks'), child, space.id);
  assert.deepEqual([over.status, over.body.error.code], [409, 'pocket_money_exceeded']);
  assert.equal((await call('POST', '/api/goals', { name: 'Cycle', target: '5000' }, child, space.id)).status, 403);

  await call('PATCH', `/api/spaces/${space.id}/members/${viewer.id}`, { role: 'editor' }, owner);
  assert.equal((await call('POST', '/api/transactions', expense('100', 'Groceries'), viewer, space.id)).status, 201);
  assert.equal((await call('PATCH', `/api/spaces/${space.id}/members/${owner.id}`, { role: 'viewer' }, owner)).status, 400);
});

test('older spaces: “member” becomes editor', async () => {
  const { space, editor } = await household();
  await Space.collection.updateOne({ _id: new Space.base.Types.ObjectId(space.id), 'members.user': new Space.base.Types.ObjectId(editor.id) }, { $set: { 'members.$.role': 'member' } });
  await migrateRoles();
  const s = await Space.findById(space.id).lean();
  assert.equal(s.members.find((m) => String(m.user) === editor.id).role, 'editor');
  assert.equal((await call('POST', '/api/transactions', expense('10', 'Groceries'), editor, space.id)).status, 201);
});

test('a private account and its entries are seen only by the person it belongs to', async () => {
  const { owner, space, editor } = await household();
  const mine = (await call('POST', '/api/accounts', { name: 'My salary account', type: 'bank' }, editor, space.id)).body.account;
  assert.equal((await call('PATCH', `/api/accounts/${mine.id}`, { private: true }, owner, space.id)).status, 403);
  const p = await call('PATCH', `/api/accounts/${mine.id}`, { private: true }, editor, space.id);
  assert.equal(p.body.account.private, true);
  await call('POST', '/api/transactions', expense('7000', 'Shopping', { account: mine.id }), editor, space.id);
  await call('POST', '/api/transactions', expense('200', 'Groceries'), editor, space.id);

  const ownerAccounts = (await call('GET', '/api/accounts', undefined, owner, space.id)).body.accounts.map((a) => a.name);
  assert.equal(ownerAccounts.includes('My salary account'), false);
  const ownerTx = (await call('GET', '/api/transactions', undefined, owner, space.id)).body.items.map((x) => x.category);
  assert.deepEqual(ownerTx, ['Groceries']);
  const ownerActivity = (await call('GET', '/api/activity', undefined, owner, space.id)).body.items.map((a) => a.summary).join(' | ');
  assert.equal(ownerActivity.includes('Shopping'), false);
  assert.equal((await call('POST', '/api/transactions', expense('1', 'Food & Dining', { account: mine.id }), owner, space.id)).status, 400);

  const editorTx = (await call('GET', '/api/transactions', undefined, editor, space.id)).body.items.map((x) => x.category).sort();
  assert.deepEqual(editorTx, ['Groceries', 'Shopping']);
  await call('PATCH', `/api/accounts/${mine.id}`, { private: false }, editor, space.id);
  assert.equal((await call('GET', '/api/transactions', undefined, owner, space.id)).body.total, 2);
});

test('approvals: a big expense by a member counts nowhere until the owner approves it', async () => {
  const { owner, space, editor } = await household();
  assert.equal((await call('PATCH', `/api/spaces/${space.id}/settings`, { approvalAbove: '5000' }, editor)).status, 403);
  const set = await call('PATCH', `/api/spaces/${space.id}/settings`, { approvalAbove: '5000' }, owner);
  assert.equal(set.body.space.approvalAbove.rupees, 5000);

  const big = (await call('POST', '/api/transactions', expense('8000', 'Electronics'), editor, space.id)).body.transaction;
  assert.equal(big.pending, true);
  const small = (await call('POST', '/api/transactions', expense('400', 'Groceries'), editor, space.id)).body.transaction;
  assert.equal(small.pending, false);
  assert.equal((await call('POST', '/api/transactions', expense('9000', 'Furniture'), owner, space.id)).body.transaction.pending, false);
  const tv = (await call('POST', '/api/transactions', expense('6000', 'Electronics'), editor, space.id)).body.transaction;

  const listed = (await call('GET', '/api/transactions', undefined, owner, space.id)).body.items.map((x) => x.category).sort();
  assert.deepEqual(listed, ['Furniture', 'Groceries']);
  const waiting = (await call('GET', '/api/approvals', undefined, editor, space.id)).body.pending;
  assert.deepEqual(waiting.map((x) => [x.amount, x.requestedBy]), [[8000, 'Rahul'], [6000, 'Rahul']]);

  assert.equal((await call('POST', `/api/approvals/${big.id}`, { decision: 'approve' }, editor, space.id)).status, 403);
  assert.equal((await call('POST', `/api/approvals/${big.id}`, { decision: 'approve' }, owner, space.id)).status, 200);
  assert.equal((await call('POST', `/api/approvals/${tv.id}`, { decision: 'reject' }, owner, space.id)).status, 200);
  assert.equal((await call('POST', `/api/approvals/${tv.id}`, { decision: 'approve' }, owner, space.id)).status, 404);
  const settled = (await call('GET', '/api/transactions', undefined, owner, space.id)).body.items.map((x) => x.category).sort();
  assert.deepEqual(settled, ['Electronics', 'Furniture', 'Groceries']);
  assert.equal((await call('GET', '/api/approvals', undefined, owner, space.id)).body.pending.length, 0);
  // Turned down: gone, and not in the bin either.
  assert.equal(await Transaction.countDocuments({ _id: tv.id, deletedAt: null, pending: { $in: [true, false, null] } }), 0);
  assert.equal((await call('GET', '/api/transactions/deleted', undefined, owner, space.id)).body?.items?.length ?? 0, 0);
});

// ── 12S ──

test('calendar: a private address with bills, card due dates and warranties; resetting retires the old one', async () => {
  const me = await register('Ravi');
  await call('POST', '/api/bills', { name: 'Airtel, broadband', amount: '799', category: 'Mobile & Internet', frequency: 'monthly', firstDue: inDays(5) }, me);
  const card = (await call('POST', '/api/accounts', { name: 'HDFC card', type: 'credit_card' }, me)).body.account;
  await call('PATCH', `/api/accounts/${card.id}`, { statementDay: 5, dueDay: 25 }, me);
  await call('POST', '/api/vault', { kind: 'warranty', name: 'Fridge', expiryDate: inDays(40) }, me);

  assert.equal((await call('GET', '/api/integrations/calendar', undefined, me)).body.feed, null);
  const first = await call('POST', '/api/integrations/calendar', undefined, me);
  assert.equal(first.status, 201);
  assert.match(first.body.url, /\/api\/calendar\/cal_[\w-]{43}\.ics$/);
  const path = new URL(first.body.url).pathname;
  const res = await fetch(t.base + path);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/calendar/);
  const ics = await res.text();
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /SUMMARY:Bill: Airtel\\, broadband ₹799/);
  assert.match(ics, /SUMMARY:Card bill due: HDFC card/);
  assert.match(ics, /SUMMARY:Warranty ends: Fridge/);
  assert.ok(ics.split('\r\n').every((l) => Buffer.byteLength(l) <= 75));
  assert.notEqual((await call('GET', '/api/integrations/calendar', undefined, me)).body.feed.lastFetchedAt, null);

  const second = await call('POST', '/api/integrations/calendar', undefined, me);
  assert.notEqual(second.body.url, first.body.url);
  assert.equal((await fetch(t.base + path)).status, 404);
  assert.equal((await fetch(`${t.base}/api/calendar/not-a-feed.ics`)).status, 404);
  const file = await fetch(`${t.base}/api/integrations/calendar/download`, { headers: { authorization: `Bearer ${me.token}` } });
  assert.match(file.headers.get('content-disposition'), /spendwise\.ics/);
  await call('DELETE', '/api/integrations/calendar', undefined, me);
  assert.equal((await fetch(t.base + new URL(second.body.url).pathname)).status, 404);
});

test('wishlist: an item added just after midnight IST counts from that IST day, not the UTC day before', async () => {
  const { serializeWish } = await import('../src/services/budgeting.service.js');
  const { parseDay } = await import('../src/money.js');
  // 00:17 IST on 26 Oct 2026 is still 25 Oct in UTC.
  const w = { _id: 'x', name: 'Phone', pricePaise: 100, coolDays: 30, status: 'waiting', createdAt: new Date('2026-10-25T18:47:00Z') };
  const s = serializeWish(w, parseDay('2026-10-26'));
  assert.deepEqual([s.addedOn, s.readyOn, s.daysLeft, s.ready], ['2026-10-26', '2026-11-25', 30, false]);
  // Late evening IST is the same calendar day in both zones.
  const late = serializeWish({ ...w, createdAt: new Date('2026-10-26T17:00:00Z') }, parseDay('2026-10-26'));
  assert.equal(late.addedOn, '2026-10-26');
});

// Batch 12E: goals, loans, money lent/borrowed, group expenses, bills and credit card cycles.
// Dates are worked out from today, so the tests keep passing whatever day they run.
process.env.SMTP_HOST = 'smtp.test.invalid';
process.env.SMTP_USER = 'sender@example.com';
process.env.SMTP_PASS = 'abcd efgh ijkl mnop';
process.env.ALERT_DELAY_MS = '0';

const { test, before, after } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const nodemailer = (await import('nodemailer')).default;
const { startTestServer, uniqueEmail, GOOD_PASSWORD, markVerified } = await import('./helpers.js');
const { setTransport } = await import('../src/mailer.js');
const { flushAlertChecks } = await import('../src/services/alert.service.js');
const { sendBillReminders } = await import('../src/services/bill.service.js');
const { todayIn, addDays, occurrenceDate } = await import('../src/schedule.js');
const { cardCycle } = await import('../src/finance.js');
const { currentMonth, dayString, shiftMonth } = await import('../src/money.js');

const mails = [];
const json = nodemailer.createTransport({ jsonTransport: true });
setTransport({ sendMail: async (m) => { const info = await json.sendMail(m); mails.push(JSON.parse(info.message)); return info; } });

let t;
const newUser = async () => {
  const email = uniqueEmail();
  const { body } = await t.api('POST', '/api/auth/register', { body: { name: 'Neha', email, password: GOOD_PASSWORD } });
  await (await import('../src/services/auth.service.js')).lastVerifyMail;
  for (let i = mails.length - 1; i >= 0; i -= 1) if (/Confirm your email/.test(mails[i].subject)) mails.splice(i, 1);
  await markVerified(email);
  return body.token;
};
const call = (method, path, body, tk) => t.api(method, path, { token: tk, body });
const todayDate = todayIn('Asia/Kolkata');
const today = dayString(todayDate);
const inDays = (n) => dayString(addDays(todayDate, n));

before(async () => { t = await startTestServer(); });
after(async () => { await flushAlertChecks(); await t.stop(); });

test('savings goals: progress, per-month need, and an emergency fund from real spending', async () => {
  const tk = await newUser();
  const target = dayString(occurrenceDate(todayDate, 'monthly', 1, 5)); // 6 months including this one
  const g = (await call('POST', '/api/goals', { name: 'Goa trip', target: '60000', targetDate: target }, tk)).body.goal;
  let r = await call('POST', `/api/goals/${g.id}/entries`, { direction: 'add', amount: '12000', note: 'Diwali bonus' }, tk);
  assert.equal(r.status, 201);
  assert.deepEqual([r.body.goal.saved.paise, r.body.goal.percent, r.body.goal.neededPerMonth.paise], [1_200_000, 20, 800_000]);
  assert.equal((await call('POST', `/api/goals/${g.id}/entries`, { direction: 'withdraw', amount: '20000' }, tk)).status, 400);
  r = await call('POST', `/api/goals/${g.id}/entries`, { direction: 'withdraw', amount: '2000' }, tk);
  assert.equal(r.body.goal.saved.paise, 1_000_000);
  r = await call('DELETE', `/api/goals/${g.id}/entries/${r.body.goal.entries[1].id}`, undefined, tk);
  assert.equal(r.status, 409); // removing the deposit would leave it below zero
  assert.equal((await call('POST', `/api/goals/${g.id}/entries`, { direction: 'add', amount: '1', date: inDays(5) }, tk)).status, 400);

  // Three complete months of spending: ₹20,000, ₹30,000 and ₹25,000 → average ₹25,000 → target ₹1,50,000.
  const months = [3, 2, 1].map((n) => shiftMonth(currentMonth(todayDate), -n));
  for (const [m, amount] of [[months[0], '20000'], [months[1], '30000'], [months[2], '25000']]) {
    await call('POST', '/api/transactions', { type: 'expense', amount, category: 'Rent', date: `${m}-10` }, tk);
  }
  const list = (await call('GET', '/api/goals', undefined, tk)).body;
  assert.deepEqual([list.emergency.averageMonthly.paise, list.emergency.target.paise], [2_500_000, 15_000_000]);
  const ef = await call('POST', '/api/goals', { name: 'Emergency fund', kind: 'emergency' }, tk);
  assert.deepEqual([ef.status, ef.body.goal.target.paise, ef.body.goal.neededPerMonth], [201, 15_000_000, null]);
  const empty = await newUser();
  assert.equal((await call('POST', '/api/goals', { name: 'EF', kind: 'emergency' }, empty)).body.error.details[0].field, 'target');
});

test('a loan: EMI from rate and tenure, payments recorded as expenses, prepayment what-if', async () => {
  const tk = await newUser();
  const res = await call('POST', '/api/loans', { name: 'Car loan', lender: 'HDFC Bank', principal: '500000', annualRatePct: 10, tenureMonths: 60, firstEmiDate: today }, tk);
  assert.equal(res.status, 201);
  const loan = res.body.loan;
  assert.deepEqual([loan.emi.paise, loan.monthsLeft, loan.nextEmiDate, loan.balance.paise], [1_062_352, 60, today, 50_000_000]);
  assert.ok(Math.abs(loan.scheduledInterest.paise - 13_741_120) < 100);

  const paid = (await call('POST', `/api/loans/${loan.id}/payments`, { kind: 'emi' }, tk)).body.loan;
  assert.deepEqual([paid.emisPaid, paid.interestPaid.paise, paid.balance.paise, paid.monthsLeft], [1, 416_667, 50_000_000 - 645_685, 59]);
  const entry = (await call('GET', '/api/transactions', undefined, tk)).body.items[0];
  assert.deepEqual([entry.category, entry.amountPaise, entry.note], ['EMI & Loans', 1_062_352, 'EMI: Car loan']);

  const whatIf = (await call('GET', `/api/loans/${loan.id}/prepayment?amount=100000`, undefined, tk)).body;
  assert.ok(whatIf.reduceTenure.monthsSaved >= 10, JSON.stringify(whatIf.reduceTenure));
  assert.ok(whatIf.reduceEmi.emi.paise < 1_062_352);
  assert.equal(whatIf.reduceEmi.monthsLeft, 59);
  assert.equal((await call('GET', `/api/loans/${loan.id}/prepayment?amount=900000`, undefined, tk)).status, 400);

  // Removing the payment removes its expense too.
  const back = (await call('DELETE', `/api/loans/${loan.id}/payments/${paid.payments[0].id}`, undefined, tk)).body.loan;
  assert.equal(back.balance.paise, 50_000_000);
  assert.equal((await call('GET', '/api/transactions', undefined, tk)).body.total, 0);
  // A prepayment without an entry, and an EMI too small to ever repay the loan.
  assert.equal((await call('POST', `/api/loans/${loan.id}/payments`, { kind: 'prepayment' }, tk)).status, 400);
  assert.equal((await call('POST', '/api/loans', { name: 'Bad', principal: '100000', annualRatePct: 24, tenureMonths: 12, firstEmiDate: today, emi: '1000' }, tk)).body.error.details[0].field, 'emi');
});

test('money lent and borrowed, settled in parts, with a net per person', async () => {
  const tk = await newUser();
  const lent = (await call('POST', '/api/debts', { person: 'Riya', direction: 'lent', amount: '5000', note: 'Concert tickets' }, tk)).body.debt;
  await call('POST', '/api/debts', { person: 'riya', direction: 'borrowed', amount: '1000' }, tk);
  await call('POST', '/api/debts', { person: 'Arjun', direction: 'borrowed', amount: '700', dueDate: inDays(-1) }, tk);
  const part = (await call('POST', `/api/debts/${lent.id}/settlements`, { amount: '2000' }, tk)).body.debt;
  assert.deepEqual([part.outstanding.paise, part.status], [300_000, 'open']);
  assert.equal((await call('POST', `/api/debts/${lent.id}/settlements`, { amount: '4000' }, tk)).status, 400);
  const all = (await call('GET', '/api/debts', undefined, tk)).body;
  assert.deepEqual(all.totals, { owedToYou: { paise: 300_000, rupees: 3000 }, youOwe: { paise: 170_000, rupees: 1700 } });
  assert.deepEqual(all.people.map((p) => [p.person, p.net.paise]), [['Riya', 200_000], ['Arjun', -70_000]]);
  assert.equal(all.debts.find((d) => d.person === 'Arjun').status, 'overdue');
  const done = (await call('POST', `/api/debts/${lent.id}/settlements`, {}, tk)).body.debt;
  assert.deepEqual([done.outstanding.paise, done.status], [0, 'settled']);
  assert.equal((await call('PATCH', `/api/debts/${lent.id}`, { amount: '100' }, tk)).status, 400);
});

test('group expenses: equal and exact splits, fewest settle-up payments with UPI IDs', async () => {
  const tk = await newUser();
  const bad = await call('POST', '/api/groups', { name: 'Goa', members: [{ name: 'Asha', upiId: 'not a upi' }, { name: 'Bala' }] }, tk);
  assert.equal(bad.status, 400);
  let g = (await call('POST', '/api/groups', { name: 'Goa', members: [{ name: 'Asha', upiId: 'asha@okaxis' }, { name: 'Bala' }, { name: 'Chirag' }] }, tk)).body.group;
  const [A, B, C] = g.members.map((m) => m.id);
  g = (await call('POST', `/api/groups/${g.id}/expenses`, { description: 'Villa', amount: '900', paidBy: A }, tk)).body.group;
  g = (await call('POST', `/api/groups/${g.id}/expenses`, { description: 'Scooters', amount: '300', paidBy: B }, tk)).body.group;
  assert.deepEqual(g.members.map((m) => m.balance.paise), [50_000, -10_000, -40_000]);
  assert.deepEqual(g.suggestions.map((s) => [s.fromName, s.toName, s.amount.paise, s.toUpiId]), [['Chirag', 'Asha', 40_000, 'asha@okaxis'], ['Bala', 'Asha', 10_000, 'asha@okaxis']]);

  const mismatch = await call('POST', `/api/groups/${g.id}/expenses`, { description: 'Dinner', amount: '100', paidBy: C, split: 'exact', exact: [{ member: A, amount: '60' }, { member: B, amount: '30' }] }, tk);
  assert.equal(mismatch.status, 400);
  g = (await call('POST', `/api/groups/${g.id}/expenses`, { description: 'Dinner', amount: '100', paidBy: C, split: 'exact', exact: [{ member: A, amount: '60' }, { member: B, amount: '40' }] }, tk)).body.group;
  g = (await call('POST', `/api/groups/${g.id}/expenses`, { description: 'Snacks', amount: '100', paidBy: A, among: [B, C] }, tk)).body.group;
  assert.equal(g.members.reduce((s, m) => s + m.balance.paise, 0), 0);
  // Chirag paid ₹100 and shares ₹450 (300 + 100 + 50): ₹350 settles him.
  g = (await call('POST', `/api/groups/${g.id}/settlements`, { from: C, to: A, amount: '350' }, tk)).body.group;
  assert.equal(g.members[2].balance.paise, 0);
  assert.ok(g.suggestions.every((s) => s.fromName !== 'Chirag'));
  assert.equal((await call('POST', `/api/groups/${g.id}/settlements`, { from: A, to: A, amount: '1' }, tk)).status, 400);

  // People with expenses can be renamed but not removed; a new person can join.
  const keep = g.members.map((m) => ({ id: m.id, name: m.name === 'Bala' ? 'Balaji' : m.name, upiId: m.upiId }));
  assert.equal((await call('PATCH', `/api/groups/${g.id}`, { members: keep.slice(0, 2) }, tk)).status, 409);
  g = (await call('PATCH', `/api/groups/${g.id}`, { members: [...keep, { name: 'Divya' }] }, tk)).body.group;
  assert.deepEqual(g.members.map((m) => m.name), ['Asha', 'Balaji', 'Chirag', 'Divya']);
  assert.equal((await call('GET', `/api/groups/${g.id}`, undefined, await newUser())).status, 404);
  assert.equal((await call('GET', '/api/groups', undefined, tk)).body.groups[0].expenseCount, 4);
});

test('bills: due dates, mark as paid records the expense, undo, calendar and the 3-day reminder', async () => {
  const tk = await newUser();
  await call('PATCH', '/api/notifications/settings', { billEmail: true }, tk);
  const airtel = (await call('POST', '/api/bills', { name: 'Airtel', amount: '799', category: 'Mobile & Internet', frequency: 'monthly', firstDue: inDays(2) }, tk)).body.bill;
  assert.deepEqual([airtel.nextDue, airtel.daysUntilDue, airtel.status], [inDays(2), 2, 'due-soon']);
  const power = (await call('POST', '/api/bills', { name: 'Electricity', category: 'Bills & Utilities', frequency: 'monthly', firstDue: inDays(-3) }, tk)).body.bill;
  assert.equal(power.status, 'overdue');
  assert.equal((await call('POST', `/api/bills/${power.id}/pay`, {}, tk)).body.error.details[0].field, 'amount');

  const cal = (await call('GET', `/api/bills/calendar?month=${inDays(2).slice(0, 7)}`, undefined, tk)).body.items;
  assert.ok(cal.some((i) => i.name === 'Airtel' && i.dueDate === inDays(2) && i.status === 'due-soon'));

  // The reminder goes out once per due date.
  const before = mails.length;
  await sendBillReminders({ today: todayDate });
  await sendBillReminders({ today: todayDate });
  const sent = mails.slice(before);
  assert.deepEqual(sent.map((m) => m.subject), ['Spendwise: Airtel is due in 2 days']);
  assert.match(sent[0].text, /₹799\.00 due on /);

  const paid = (await call('POST', `/api/bills/${airtel.id}/pay`, {}, tk)).body.bill;
  assert.equal(paid.nextDue, dayString(occurrenceDate(addDays(todayDate, 2), 'monthly', 1, 1)));
  const entry = (await call('GET', '/api/transactions', undefined, tk)).body.items[0];
  assert.deepEqual([entry.category, entry.amountPaise], ['Mobile & Internet', 79_900]);
  assert.match(entry.note, /^Airtel bill \(due /);
  const undone = (await call('POST', `/api/bills/${airtel.id}/undo`, undefined, tk)).body.bill;
  assert.equal(undone.nextDue, inDays(2));
  assert.equal((await call('GET', '/api/transactions', undefined, tk)).body.total, 0);

  const skipped = (await call('POST', `/api/bills/${power.id}/skip`, undefined, tk)).body.bill;
  assert.deepEqual([skipped.payments[0].skipped, skipped.status !== 'overdue' || skipped.daysUntilDue < 0], [true, true]);
  const stopped = (await call('PATCH', `/api/bills/${airtel.id}`, { active: false }, tk)).body.bill;
  assert.deepEqual([stopped.status, stopped.nextDue], ['inactive', null]);
  assert.equal((await call('POST', `/api/bills/${airtel.id}/pay`, {}, tk)).status, 409);
});

test('credit card cycle: last statement, due date, paid since and the open cycle', async () => {
  const tk = await newUser();
  const card = (await call('POST', '/api/accounts', { name: 'HDFC Millennia', type: 'credit_card' }, tk)).body.account;
  const bank = (await call('POST', '/api/accounts', { name: 'HDFC Savings', type: 'bank', openingBalance: '50000' }, tk)).body.account;
  assert.equal((await call('GET', `/api/accounts/${card.id}/cycle`, undefined, tk)).body.error.code, 'cycle_not_set');
  assert.equal((await call('GET', `/api/accounts/${bank.id}/cycle`, undefined, tk)).body.error.code, 'not_a_card');
  const statementDay = 15;
  const dueDay = 5;
  assert.equal((await call('PATCH', `/api/accounts/${card.id}`, { statementDay, dueDay }, tk)).body.account.statementDay, 15);
  assert.equal((await call('PATCH', `/api/accounts/${card.id}`, { statementDay: 32 }, tk)).status, 400);

  const c = cardCycle({ statementDay, dueDay, today: todayDate });
  const add = (body) => call('POST', '/api/transactions', body, tk);
  await add({ type: 'expense', amount: '3000', category: 'Shopping', date: dayString(c.last.to), account: card.id });
  await add({ type: 'expense', amount: '1200', category: 'Food & Dining', date: dayString(c.last.from), account: card.id });
  await add({ type: 'income', amount: '200', category: 'Refunds', date: dayString(c.last.to), account: card.id });
  await add({ type: 'transfer', amount: '1500', date: dayString(c.current.from), account: bank.id, toAccount: card.id });
  await add({ type: 'expense', amount: '650', category: 'Fuel', date: dayString(c.current.from), account: card.id });

  const cyc = (await call('GET', `/api/accounts/${card.id}/cycle`, undefined, tk)).body;
  assert.deepEqual(
    [cyc.lastStatement.purchases.paise, cyc.lastStatement.refunds.paise, cyc.lastStatement.balance.paise, cyc.lastStatement.paidSince.paise, cyc.lastStatement.remaining.paise],
    [420_000, 20_000, 400_000, 150_000, 250_000],
  );
  assert.equal(cyc.lastStatement.dueDate, dayString(c.dueDate));
  assert.equal(cyc.lastStatement.status, todayDate > c.dueDate ? 'overdue' : 'due');
  assert.deepEqual([cyc.currentCycle.purchases.paise, cyc.outstanding.paise], [65_000, 400_000 - 150_000 + 65_000]);
});

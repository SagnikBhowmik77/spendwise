// Email "configured" for this file only (own process). Messages go to nodemailer's in-memory JSON
// transport and are captured here; nothing leaves the machine.
process.env.SMTP_HOST = 'smtp.test.invalid';
process.env.SMTP_USER = 'sender@example.com';
process.env.SMTP_PASS = 'abcd efgh ijkl mnop';
process.env.APP_URL = 'https://app.example/';

const { test, before, after, beforeEach } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const nodemailer = (await import('nodemailer')).default;
const { startTestServer, uniqueEmail, GOOD_PASSWORD, markVerified } = await import('./helpers.js');
const { setTransport } = await import('../src/mailer.js');
const { sendMonthlyReports, reportMonthFor, monthLabel } = await import('../src/services/report.service.js');
const { currentMonth, shiftMonth, parseDay } = await import('../src/money.js');
const { User } = await import('../src/models/index.js');

let t;
let sent = [];
let failNext = 0;
const json = nodemailer.createTransport({ jsonTransport: true });
setTransport({
  sendMail: async (message) => {
    if (failNext > 0) {
      failNext -= 1;
      throw new Error('SMTP down');
    }
    const info = await json.sendMail(message);
    sent.push(JSON.parse(info.message));
    return info;
  },
});

const newUser = async (name = 'Tara') => {
  const email = uniqueEmail();
  const { body } = await t.api('POST', '/api/auth/register', { body: { name, email, password: GOOD_PASSWORD } });
  await (await import('../src/services/auth.service.js')).lastVerifyMail;
  for (let i = sent.length - 1; i >= 0; i -= 1) if (/Confirm your email/.test(sent[i].subject)) sent.splice(i, 1);
  await markVerified(email);
  return { ...body, user: { ...body.user, emailVerified: true }, email };
};
const add = (token, body) => t.api('POST', '/api/transactions', { token, body });
// The first day of next month: the day the current month's report becomes due.
const nextMonthFirst = () => parseDay(`${shiftMonth(currentMonth(), 1)}-01`);

let main;
before(async () => {
  t = await startTestServer();
  main = await newUser('Tara <script>');
  const entries = [
    { type: 'expense', amount: '12000', category: 'Rent', date: '2026-09-02' },
    { type: 'expense', amount: '3000', category: 'Food & Dining', date: '2026-09-10' },
    { type: 'income', amount: '50000', category: 'Salary', date: '2026-10-01' },
    { type: 'expense', amount: '12000', category: 'Rent', date: '2026-10-02' },
    { type: 'expense', amount: '3000', category: 'Food & Dining', date: '2026-10-05' },
    { type: 'expense', amount: '500', category: 'Snacks <b>', date: '2026-10-06' },
  ];
  for (const body of entries) assert.equal((await add(main.token, body)).status, 201);
  await t.api('PUT', '/api/budgets', { token: main.token, body: { month: '2026-10', category: 'Rent', limit: '12000' } });
});
after(() => t.stop());
beforeEach(() => { sent = []; });

test('the report sums the month, compares with the month before and lists budgets', async () => {
  const res = await t.api('GET', '/api/reports/preview?month=2026-10', { token: main.token });
  assert.equal(res.status, 200);
  const { report, subject, text, html } = res.body;
  assert.equal(report.label, 'October 2026');
  assert.equal(report.summary.income.paise, 5000000);
  assert.equal(report.summary.expense.paise, 1550000);
  assert.equal(report.summary.balance.paise, 3450000);
  // ₹15,500 vs ₹15,000 in September.
  assert.equal(report.expenseChangePercent, 3.3);
  assert.deepEqual(report.topCategories.map((c) => c.category), ['Rent', 'Food & Dining', 'Snacks <b>']);
  assert.equal(report.budgets.categories[0].status, 'warning');

  assert.equal(subject, 'Your Spendwise summary for October 2026');
  assert.match(text, /Expenses: ₹15,500\.00/);
  assert.match(text, /3\.3% more than in September 2026/);
  assert.match(text, /Rent: ₹12,000\.00 of ₹12,000\.00 \(100%, close to the limit\)/);
  assert.match(html, /₹50,000\.00/);
  // Names and categories are escaped, never injected as HTML.
  assert.ok(html.includes('Snacks &lt;b&gt;'));
  assert.ok(html.includes('Tara &lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('https://app.example/settings'));
});

test('an empty month says so plainly instead of showing zero charts', async () => {
  const fresh = await newUser();
  const { text, html, report } = (await t.api('GET', '/api/reports/preview?month=2026-10', { token: fresh.token })).body;
  assert.equal(report.summary.count, 0);
  assert.match(text, /You didn't record any transactions in October 2026\./);
  assert.match(html, /You didn't record any transactions/);
  assert.equal(report.expenseChangePercent, null);
});

test('a test email goes only to the user’s own address, from the configured sender', async () => {
  const res = await t.api('POST', '/api/reports/send-test', { token: main.token, body: {} });
  assert.equal(res.status, 200);
  assert.equal(res.body.sentTo, main.email);
  assert.equal(res.body.month, reportMonthFor());
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].to.map((a) => a.address), [main.email]);
  assert.equal(sent[0].from.address, 'sender@example.com');
  assert.equal(sent[0].from.name, 'Spendwise');
  assert.equal(sent[0].subject, `Your Spendwise summary for ${monthLabel(reportMonthFor())}`);
  assert.ok(sent[0].html && sent[0].text);

  const explicit = await t.api('POST', '/api/reports/send-test', { token: main.token, body: { month: '2026-10' } });
  assert.equal(explicit.body.month, '2026-10');
  assert.equal((await t.api('POST', '/api/reports/send-test', { token: main.token, body: { month: '2999-01' } })).status, 400);
});

test('test emails are capped at 5 an hour per user', async () => {
  const user = await newUser();
  for (let i = 0; i < 5; i++) assert.equal((await t.api('POST', '/api/reports/send-test', { token: user.token, body: {} })).status, 200);
  const blocked = await t.api('POST', '/api/reports/send-test', { token: user.token, body: {} });
  assert.equal(blocked.status, 429);
  assert.equal(sent.length, 5);
});

test('reports are off until the user turns them on; turning on starts with the current month', async () => {
  const user = await newUser();
  const initial = (await t.api('GET', '/api/reports/settings', { token: user.token })).body;
  assert.deepEqual(initial, { enabled: false, lastSentMonth: null, emailConfigured: true, emailVerified: true });

  const on = await t.api('PATCH', '/api/reports/settings', { token: user.token, body: { enabled: true } });
  assert.equal(on.status, 200);
  assert.equal(on.body.enabled, true);
  // Last month is marked as done, so nobody gets a surprise report for a month before they joined.
  assert.equal(on.body.lastSentMonth, reportMonthFor());
  assert.equal((await t.api('PATCH', '/api/reports/settings', { token: user.token, body: { enabled: 'yes' } })).status, 400);
});

test('the monthly job sends each opted-in user one report per month, even if runs overlap', async () => {
  await User.updateMany({}, { $set: { 'monthlyReport.enabled': false } });
  const a = await newUser('A');
  const b = await newUser('B');
  const off = await newUser('Off');
  for (const u of [a, b]) await t.api('PATCH', '/api/reports/settings', { token: u.token, body: { enabled: true } });

  // Still this month: the current month's report isn't due yet.
  assert.equal((await sendMonthlyReports()).sent, 0);

  const due = nextMonthFirst();
  const [r1, r2] = await Promise.all([sendMonthlyReports({ today: due }), sendMonthlyReports({ today: due })]);
  assert.equal(r1.sent + r2.sent, 2);
  assert.deepEqual(sent.map((m) => m.to[0].address).sort(), [a.email, b.email].sort());
  assert.ok(!sent.some((m) => m.to[0].address === off.email));
  assert.equal(r1.month, currentMonth());

  assert.equal((await sendMonthlyReports({ today: due })).sent, 0);
  const row = await User.findOne({ email: a.email }).lean();
  assert.equal(row.monthlyReport.lastSentMonth, currentMonth());
});

test('a failed send is retried on the next run instead of being skipped', async () => {
  await User.updateMany({}, { $set: { 'monthlyReport.enabled': false } });
  const u = await newUser();
  await t.api('PATCH', '/api/reports/settings', { token: u.token, body: { enabled: true } });
  const due = nextMonthFirst();

  failNext = 1;
  const quiet = { error: () => {} };
  const first = await sendMonthlyReports({ today: due, log: quiet });
  assert.deepEqual([first.sent, first.failed], [0, 1]);
  assert.equal((await User.findOne({ email: u.email }).lean()).monthlyReport.lastSentMonth, reportMonthFor());

  const second = await sendMonthlyReports({ today: due, log: quiet });
  assert.deepEqual([second.sent, second.failed], [1, 0]);
  assert.equal(sent.length, 1);
});

test('report endpoints need a login', async () => {
  assert.equal((await t.api('GET', '/api/reports/settings')).status, 401);
  assert.equal((await t.api('POST', '/api/reports/send-test', { body: {} })).status, 401);
});

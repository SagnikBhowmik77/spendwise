// Batch 12D: budget rollover, weekly budgets, budget alerts (push + email) and the daily reminder.
// Push goes to a local stub "push service" that decrypts each message the way a browser would.
import http from 'node:http';
import crypto from 'node:crypto';
import webpush from 'web-push';
import ece from 'http_ece';

const vapid = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = vapid.publicKey;
process.env.VAPID_PRIVATE_KEY = vapid.privateKey;
process.env.VAPID_SUBJECT = 'mailto:alerts@example.com';
process.env.ALERT_DELAY_MS = '0';
process.env.SMTP_HOST = 'smtp.test.invalid';
process.env.SMTP_USER = 'sender@example.com';
process.env.SMTP_PASS = 'abcd efgh ijkl mnop';

// A "browser": its own key pair and auth secret, as pushManager.subscribe() would create.
function browser() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return { ecdh, auth, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };
}
const browsers = new Map(); // path -> browser
const pushes = []; // { path, headers, message }
let goneNext = false;
const stub = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    if (goneNext) { goneNext = false; res.statusCode = 410; return res.end(); }
    const b = browsers.get(req.url);
    const plain = ece.decrypt(Buffer.concat(chunks), { version: 'aes128gcm', privateKey: b.ecdh, authSecret: b.auth });
    pushes.push({ path: req.url, headers: req.headers, message: JSON.parse(plain.toString()) });
    res.statusCode = 201;
    res.end();
  });
});
await new Promise((r) => stub.listen(0, '127.0.0.1', r));
const stubUrl = (path) => `http://127.0.0.1:${stub.address().port}${path}`;

const { test, before, after } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const nodemailer = (await import('nodemailer')).default;
const { startTestServer, uniqueEmail, GOOD_PASSWORD, markVerified } = await import('./helpers.js');
const { setTransport } = await import('../src/mailer.js');
const { flushAlertChecks, sendReminders } = await import('../src/services/alert.service.js');
const { todayIn } = await import('../src/schedule.js');
const { dayString } = await import('../src/money.js');

const mails = [];
const json = nodemailer.createTransport({ jsonTransport: true });
setTransport({ sendMail: async (m) => { const info = await json.sendMail(m); mails.push(JSON.parse(info.message)); return info; } });

let t;
const newUser = async (name = 'Ishaan') => {
  const email = uniqueEmail();
  const { body } = await t.api('POST', '/api/auth/register', { body: { name, email, password: GOOD_PASSWORD } });
  await (await import('../src/services/auth.service.js')).lastVerifyMail;
  for (let i = mails.length - 1; i >= 0; i -= 1) if (/Confirm your email/.test(mails[i].subject)) mails.splice(i, 1);
  await markVerified(email);
  return body.token;
};
const call = (method, path, body, tk) => t.api(method, path, { token: tk, body });
const spend = (tk, amount, date, category = 'Food & Dining') => call('POST', '/api/transactions', { type: 'expense', amount, category, date }, tk);
const subscribe = async (tk, path) => {
  const b = browser();
  browsers.set(path, b);
  return call('POST', '/api/notifications/subscriptions', { endpoint: stubUrl(path), keys: b.keys }, tk);
};
const today = dayString(todayIn('Asia/Kolkata'));
const month = today.slice(0, 7);

before(async () => { t = await startTestServer(); });
after(async () => { await flushAlertChecks(); await t.stop(); stub.close(); });

test('unspent budget rolls over month to month, overspending carries nothing', async () => {
  const tk = await newUser();
  const put = (m, limit, rollover) => call('PUT', '/api/budgets', { month: m, category: 'Food & Dining', limit, rollover }, tk);
  await put('2026-07', '5000');
  await spend(tk, '3000', '2026-07-10');
  const aug = (await put('2026-08', '5000', true)).body.budget;
  assert.deepEqual([aug.rollover, aug.baseLimit.paise, aug.carriedOver.paise, aug.limit.paise], [true, 500000, 200000, 700000]);
  await spend(tk, '6500', '2026-08-10');
  // August could spend 7,000 (5,000 + 2,000 rolled over) and spent 6,500: 500 rolls into September.
  assert.equal((await put('2026-09', '5000', true)).body.budget.carriedOver.paise, 50000);
  await spend(tk, '9000', '2026-09-12');
  const oct = (await put('2026-10', '5000', true)).body.budget;
  assert.deepEqual([oct.carriedOver.paise, oct.limit.paise], [0, 500000]);

  // Turning it off drops the carry; copying a month keeps the setting.
  const sep = (await call('GET', '/api/budgets?month=2026-09', undefined, tk)).body.categories[0];
  assert.equal((await call('PATCH', `/api/budgets/${sep.id}`, { rollover: false }, tk)).body.budget.limit.paise, 500000);
  assert.equal((await call('PATCH', `/api/budgets/${sep.id}`, {}, tk)).status, 400);
  await call('POST', '/api/budgets/copy', { from: '2026-10', to: '2026-11' }, tk);
  assert.equal((await call('GET', '/api/budgets?month=2026-11', undefined, tk)).body.categories[0].rollover, true);
  const hist = (await call('GET', '/api/budgets/history?to=2026-09&months=3&category=Food%20%26%20Dining', undefined, tk)).body.months;
  assert.deepEqual(hist.map((m) => m.budget.carriedOver.paise), [0, 200000, 0]);
});

test('weekly budgets cover Monday to Sunday and compare with last week', async () => {
  const tk = await newUser();
  assert.equal((await call('PUT', '/api/budgets/weekly', { category: 'Food & Dining', limit: '2000' }, tk)).status, 201);
  assert.equal((await call('PUT', '/api/budgets/weekly', { limit: '6000' }, tk)).status, 201);
  assert.equal((await call('PUT', '/api/budgets/weekly', { category: 'Food & Dining', limit: '2500' }, tk)).status, 200);
  await spend(tk, '900', '2026-10-19');
  await spend(tk, '700', '2026-10-21', 'Transport');
  await spend(tk, '400', '2026-10-18'); // Sunday: last week
  const w = (await call('GET', '/api/budgets/weekly?date=2026-10-22', undefined, tk)).body;
  assert.deepEqual(w.week, { from: '2026-10-19', to: '2026-10-25' });
  assert.deepEqual(w.budgets.map((b) => [b.category, b.limit.paise, b.spent.paise, b.lastWeek.paise, b.status]), [
    [null, 600000, 160000, 40000, 'ok'],
    ['Food & Dining', 250000, 90000, 40000, 'ok'],
  ]);
  assert.equal((await call('DELETE', `/api/budgets/weekly/${w.budgets[0].id}`, undefined, tk)).status, 204);
  assert.equal((await call('GET', '/api/budgets/weekly?date=2026-10-22', undefined, tk)).body.budgets.length, 1);
});

test('push subscriptions: real push services only, a test push arrives encrypted and signed', async () => {
  const tk = await newUser();
  const settings = (await call('GET', '/api/notifications/settings', undefined, tk)).body;
  assert.deepEqual([settings.push.configured, settings.push.publicKey, settings.devices, settings.reminderTime], [true, vapid.publicKey, 0, '21:00']);
  assert.equal((await call('POST', '/api/notifications/test', undefined, tk)).status, 400);
  const evil = await call('POST', '/api/notifications/subscriptions', { endpoint: 'https://169.254.169.254/latest', keys: browser().keys }, tk);
  assert.equal(evil.status, 400);
  assert.equal((await subscribe(tk, '/push/test-1')).body.devices, 1);

  const sent = await call('POST', '/api/notifications/test', undefined, tk);
  assert.deepEqual(sent.body, { sent: 1, failed: 0 });
  const p = pushes.at(-1);
  assert.equal(p.message.title, 'Spendwise notifications work');
  assert.equal(p.headers['content-encoding'], 'aes128gcm');
  assert.match(p.headers.authorization, /^vapid t=.+, k=/);
  // A browser that unsubscribed (410 Gone) is forgotten.
  goneNext = true;
  assert.deepEqual((await call('POST', '/api/notifications/test', undefined, tk)).body, { sent: 0, failed: 1 });
  assert.equal((await call('GET', '/api/notifications/settings', undefined, tk)).body.devices, 0);
});

test('a budget alerts once at 80% and once at 100%, by push and by email', async () => {
  const tk = await newUser('Zoya');
  await subscribe(tk, '/push/zoya');
  await call('PATCH', '/api/notifications/settings', { budgetEmail: true }, tk);
  await call('PUT', '/api/budgets', { month, category: 'Food & Dining', limit: '1000' }, tk);
  const mine = () => pushes.filter((p) => p.path === '/push/zoya').map((p) => p.message);

  await spend(tk, '850', today);
  await flushAlertChecks();
  assert.equal(mine().length, 1);
  assert.equal(mine()[0].title, 'Food & Dining budget at 85%');
  assert.match(mine()[0].body, /^₹850\.00 of ₹1,000\.00 spent in /);
  assert.equal(mine()[0].url, '/budgets');
  assert.equal(mails.at(-1).subject, 'Spendwise: Food & Dining budget at 85%');

  await spend(tk, '50', today); // 90%: same band, no new alert
  await flushAlertChecks();
  assert.equal(mine().length, 1);
  await spend(tk, '200', today);
  await flushAlertChecks();
  assert.equal(mine().length, 2);
  assert.equal(mine()[1].title, 'Food & Dining budget used up');
  assert.match(mine()[1].body, /₹1,100\.00 of ₹1,000\.00 .* ₹100\.00 over\.$/);

  // A weekly budget jumping straight past 100% sends only the 100% alert.
  await call('PATCH', '/api/notifications/settings', { budgetEmail: false }, tk);
  const before = mails.length;
  await call('PUT', '/api/budgets/weekly', { limit: '500' }, tk);
  await flushAlertChecks();
  assert.equal(mine().length, 3);
  assert.equal(mine()[2].title, 'Overall weekly budget used up');
  assert.equal(mails.length, before);
  // Turning push alerts off stops them.
  await call('PATCH', '/api/notifications/settings', { budgetPush: false }, tk);
  await call('PUT', '/api/budgets', { month, limit: '1200' }, tk);
  await flushAlertChecks();
  assert.equal(mine().length, 3);
});

test('the daily reminder goes out once, only to people who logged nothing today', async () => {
  const idle = await newUser('Idle');
  const busy = await newUser('Busy');
  await subscribe(idle, '/push/idle');
  await subscribe(busy, '/push/busy');
  for (const tk of [idle, busy]) await call('PATCH', '/api/notifications/settings', { reminder: true, reminderTime: '21:00' }, tk);
  await spend(busy, '60', today, 'Transport');
  const reminders = () => pushes.filter((p) => p.message.tag === 'daily-reminder').map((p) => p.path);
  // 8 pm and 9:10 pm India time on the same (UTC) day as today.
  const at = (hhmm) => new Date(`${today}T${hhmm}:00+05:30`);

  assert.equal((await sendReminders({ now: at('20:00') })).sent, 0);
  await sendReminders({ now: at('21:10') });
  assert.deepEqual(reminders(), ['/push/idle']);
  assert.equal(pushes.find((p) => p.path === '/push/idle').message.title, 'Anything to log today?');
  await sendReminders({ now: at('21:15') });
  assert.deepEqual(reminders(), ['/push/idle']);
});

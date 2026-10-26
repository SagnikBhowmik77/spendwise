// Forgot password, email verification, what waits for a confirmed address, and the "Get started" checklist.
// Email "configured" for this file only (own process); messages are captured in memory, nothing is sent.
process.env.SMTP_HOST = 'smtp.test.invalid';
process.env.SMTP_USER = 'sender@example.com';
process.env.SMTP_PASS = 'abcd efgh ijkl mnop';
process.env.APP_URL = 'https://app.example/';

const { test, before, after, beforeEach } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const nodemailer = (await import('nodemailer')).default;
const { startTestServer, uniqueEmail, GOOD_PASSWORD } = await import('./helpers.js');
const { setTransport } = await import('../src/mailer.js');
const auth = await import('../src/services/auth.service.js');
const { EmailToken, User } = await import('../src/models/index.js');
const mongoose = (await import('mongoose')).default;

let t;
let sent = [];
const json = nodemailer.createTransport({ jsonTransport: true });
setTransport({ sendMail: async (m) => { const info = await json.sendMail(m); sent.push(JSON.parse(info.message)); return info; } });

before(async () => { t = await startTestServer(); });
after(() => t.stop());
beforeEach(() => { sent = []; });

const settle = () => Promise.all([auth.lastVerifyMail, auth.lastResetMail]);
const tokenIn = (mail, path) => {
  const m = mail.text.match(new RegExp(`https://app\\.example${path}#token=([A-Za-z0-9_-]+)`));
  assert.ok(m, `no ${path} link in: ${mail.text}`);
  return m[1];
};
async function signUp(name = 'Ira') {
  const email = uniqueEmail();
  const { status, body } = await t.api('POST', '/api/auth/register', { body: { name, email, password: GOOD_PASSWORD } });
  assert.equal(status, 201);
  await settle();
  return { ...body, email };
}

test('signing up sends a confirmation link; it confirms the address once and only once', async () => {
  const me = await signUp();
  assert.equal(me.user.emailVerified, false);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to[0].address, me.email);
  const token = tokenIn(sent[0], '/verify-email');
  // Only the hash is stored.
  const row = await EmailToken.findOne({ purpose: 'verify' }).sort({ createdAt: -1 }).lean();
  assert.notEqual(row.tokenHash, token);

  const ok = await t.api('POST', '/api/auth/verify-email', { body: { token } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.email, me.email);
  assert.equal((await t.api('GET', '/api/auth/me', { token: me.token })).body.user.emailVerified, true);
  const again = await t.api('POST', '/api/auth/verify-email', { body: { token } });
  assert.deepEqual([again.status, again.body.error.code], [400, 'invalid_link']);
  // Already confirmed: nothing more to send.
  assert.equal((await t.api('POST', '/api/auth/verify-email/send', { token: me.token })).status, 409);
});

test('a new confirmation link replaces the old one, and can’t be asked for again within 2 minutes', async () => {
  const me = await signUp();
  const first = tokenIn(sent[0], '/verify-email');
  assert.equal((await t.api('POST', '/api/auth/verify-email/send', { token: me.token })).status, 429);
  await EmailToken.collection.updateMany({ user: new mongoose.Types.ObjectId(me.user.id) }, { $set: { createdAt: new Date(Date.now() - 3 * 60_000) } });
  const resend = await t.api('POST', '/api/auth/verify-email/send', { token: me.token });
  assert.deepEqual([resend.status, resend.body.sentTo], [200, me.email]);
  const second = tokenIn(sent[1], '/verify-email');
  assert.equal((await t.api('POST', '/api/auth/verify-email', { body: { token: first } })).status, 400);
  assert.equal((await t.api('POST', '/api/auth/verify-email', { body: { token: second } })).status, 200);
});

test('forgot password: same answer for unknown addresses, a 30-minute single-use link for known ones', async () => {
  const me = await signUp();
  sent = [];
  const unknown = await t.api('POST', '/api/auth/password/forgot', { body: { email: uniqueEmail() } });
  const known = await t.api('POST', '/api/auth/password/forgot', { body: { email: me.email.toUpperCase() } });
  assert.deepEqual([unknown.status, unknown.body], [202, { ok: true }]);
  assert.deepEqual([known.status, known.body], [202, { ok: true }]);
  await settle();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to[0].address, me.email);
  const row = await EmailToken.findOne({ user: me.user.id, purpose: 'reset' }).lean();
  const minutes = (row.expiresAt - row.createdAt) / 60_000;
  assert.ok(minutes > 29.9 && minutes <= 30, `expires after ${minutes} minutes`);

  // Asking again straight away doesn't send a second email (no inbox flooding).
  await t.api('POST', '/api/auth/password/forgot', { body: { email: me.email } });
  await settle();
  assert.equal(sent.length, 1);

  const token = tokenIn(sent[0], '/reset-password');
  const weak = await t.api('POST', '/api/auth/password/reset', { body: { token, password: 'short' } });
  assert.equal(weak.status, 400);
  const reset = await t.api('POST', '/api/auth/password/reset', { body: { token, password: 'a new password 7' } });
  assert.equal(reset.status, 204);
  await settle();
  // Every device is signed out, the old password is gone, the new one works, and the owner is told.
  assert.equal((await t.api('GET', '/api/auth/me', { token: me.token })).status, 401);
  assert.equal((await t.api('POST', '/api/auth/login', { body: { email: me.email, password: GOOD_PASSWORD } })).status, 401);
  const login = await t.api('POST', '/api/auth/login', { body: { email: me.email, password: 'a new password 7' } });
  assert.equal(login.status, 200);
  // Opening the link proved the inbox is theirs.
  assert.equal(login.body.user.emailVerified, true);
  assert.match(sent.at(-1).subject, /password was changed/);
  assert.equal((await t.api('POST', '/api/auth/password/reset', { body: { token, password: 'another one 99' } })).status, 400);
});

test('an expired or made-up reset link is refused', async () => {
  const me = await signUp();
  await t.api('POST', '/api/auth/password/forgot', { body: { email: me.email } });
  await settle();
  const token = tokenIn(sent.at(-1), '/reset-password');
  await EmailToken.updateOne({ user: me.user.id, purpose: 'reset' }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await t.api('POST', '/api/auth/password/reset', { body: { token, password: 'a new password 7' } })).status, 400);
  assert.equal((await t.api('POST', '/api/auth/password/reset', { body: { token: 'x'.repeat(43), password: 'a new password 7' } })).status, 400);
  assert.equal((await t.api('POST', '/api/auth/password/reset', { body: { token: 'not a token', password: 'a new password 7' } })).status, 400);
});

test('two-factor login stays on after a reset', async () => {
  const me = await signUp();
  await User.updateOne({ _id: me.user.id }, { $set: { 'twoFactor.enabled': true } });
  await t.api('POST', '/api/auth/password/forgot', { body: { email: me.email } });
  await settle();
  const token = tokenIn(sent.at(-1), '/reset-password');
  assert.equal((await t.api('POST', '/api/auth/password/reset', { body: { token, password: 'a new password 7' } })).status, 204);
  const login = await t.api('POST', '/api/auth/login', { body: { email: me.email, password: 'a new password 7' } });
  assert.equal(login.body.twoFactorRequired, true);
  assert.equal(login.body.token, undefined);
});

test('until the address is confirmed: no reports, no invites, no new-device emails', async () => {
  const owner = await signUp('Owner');
  await t.api('POST', '/api/auth/verify-email', { body: { token: tokenIn(sent[0], '/verify-email') } });
  const guest = await signUp('Guest');

  const on = await t.api('PATCH', '/api/reports/settings', { token: guest.token, body: { enabled: true } });
  assert.deepEqual([on.status, on.body.error.code], [409, 'email_not_verified']);
  assert.equal((await t.api('GET', '/api/reports/settings', { token: guest.token })).body.emailVerified, false);

  const { body: { space } } = await t.api('POST', '/api/spaces', { token: owner.token, body: { name: 'Flat 302' } });
  sent = [];
  const inv = await t.api('POST', `/api/spaces/${space.id}/invites`, { token: owner.token, body: { email: guest.email } });
  assert.equal(inv.status, 201);
  const link = sent[0].text.match(/\/invite\/([A-Za-z0-9_-]+)/)[1];
  const blocked = await t.api('POST', `/api/invites/${link}/accept`, { token: guest.token });
  assert.deepEqual([blocked.status, blocked.body.error.code], [403, 'email_not_verified']);

  // A sign-in from a second device would normally email a warning; not to an unconfirmed address.
  sent = [];
  await t.api('POST', '/api/auth/login', { body: { email: guest.email, password: GOOD_PASSWORD }, headers: { 'x-device-id': 'second-device' } });
  await auth.lastLoginAlert;
  assert.equal(sent.length, 0);

  await t.api('POST', '/api/auth/verify-email', { body: { token: tokenIn((await resendFor(guest)), '/verify-email') } });
  assert.equal((await t.api('POST', `/api/invites/${link}/accept`, { token: guest.token })).status, 200);
});

async function resendFor(user) {
  await EmailToken.collection.updateMany({ user: new mongoose.Types.ObjectId(user.user.id) }, { $set: { createdAt: new Date(Date.now() - 3 * 60_000) } });
  sent = [];
  assert.equal((await t.api('POST', '/api/auth/verify-email/send', { token: user.token })).status, 200);
  return sent[0];
}

test('the "Get started" checklist reflects what is really in the space, and stays hidden once dismissed', async () => {
  const me = await signUp();
  const get = async () => (await t.api('GET', '/api/onboarding', { token: me.token })).body;
  assert.deepEqual(await get(), { dismissed: false, steps: { account: false, entry: false, budget: false, email: false, telegram: false } });

  assert.equal((await t.api('POST', '/api/accounts', { token: me.token, body: { name: 'HDFC Savings', type: 'bank' } })).status, 201);
  assert.equal((await t.api('POST', '/api/transactions', { token: me.token, body: { type: 'expense', amount: '120', category: 'Food & Dining', date: '2026-10-01' } })).status, 201);
  assert.equal((await t.api('PUT', '/api/budgets', { token: me.token, body: { month: '2026-10', category: 'Food & Dining', limit: '5000' } })).status, 201);
  await t.api('POST', '/api/auth/verify-email', { body: { token: tokenIn(sent[0], '/verify-email') } });
  assert.deepEqual((await get()).steps, { account: true, entry: true, budget: true, email: true, telegram: false });

  const dismissed = await t.api('POST', '/api/auth/checklist/dismiss', { token: me.token });
  assert.equal(dismissed.status, 200);
  assert.equal((await get()).dismissed, true);
});

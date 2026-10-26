import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { startTestServer, uniqueEmail, GOOD_PASSWORD, personalSpace } from './helpers.js';
import { User, Transaction } from '../src/models/index.js';

let t;
before(async () => { t = await startTestServer(); });
after(() => t.stop());

const register = (overrides = {}) =>
  t.api('POST', '/api/auth/register', {
    body: { name: 'Asha Rao', email: uniqueEmail(), password: GOOD_PASSWORD, ...overrides },
  });

test('register creates the account, hashes the password and returns a working token', async () => {
  const email = uniqueEmail();
  const res = await register({ email: `  ${email.toUpperCase()} ` });
  assert.equal(res.status, 201);
  assert.equal(res.body.user.email, email);
  assert.equal(res.body.user.name, 'Asha Rao');
  assert.equal(res.body.user.passwordHash, undefined);
  assert.equal(res.body.user.tokenVersion, undefined);

  const stored = await User.findOne({ email }).select('+passwordHash');
  assert.match(stored.passwordHash, /^\$2[aby]\$/);
  assert.notEqual(stored.passwordHash, GOOD_PASSWORD);

  const me = await t.api('GET', '/api/auth/me', { token: res.body.token });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.email, email);
});

test('register refuses a duplicate email with 409', async () => {
  const email = uniqueEmail();
  assert.equal((await register({ email })).status, 201);
  const dup = await register({ email: email.toUpperCase() });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error.code, 'email_taken');
});

test('register validates every field and reports which one is wrong', async () => {
  const res = await t.api('POST', '/api/auth/register', { body: { name: '', email: 'not-an-email', password: 'short' } });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'validation_failed');
  // "short" breaks two password rules, and both messages are reported.
  const fields = [...new Set(res.body.error.details.map((d) => d.field))].sort();
  assert.deepEqual(fields, ['email', 'name', 'password']);
  assert.equal(res.body.error.details.filter((d) => d.field === 'password').length, 2);

  const noDigit = await register({ password: 'onlyletters' });
  assert.equal(noDigit.status, 400);
  assert.match(noDigit.body.error.details[0].message, /letter and a number/);

  const tooLong = await register({ password: `a1${'é'.repeat(40)}` });
  assert.equal(tooLong.status, 400);
  assert.match(tooLong.body.error.details[0].message, /72 bytes/);
});

test('login works with the right password and gives one generic error otherwise', async () => {
  const email = uniqueEmail();
  await register({ email });

  const ok = await t.api('POST', '/api/auth/login', { body: { email, password: GOOD_PASSWORD } });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.token);

  const wrong = await t.api('POST', '/api/auth/login', { body: { email, password: 'wrong password 1' } });
  const unknown = await t.api('POST', '/api/auth/login', { body: { email: uniqueEmail(), password: GOOD_PASSWORD } });
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  // Same message, so the API never reveals which emails have accounts.
  assert.deepEqual(wrong.body, unknown.body);
});

test('protected routes need a valid, unexpired, correctly signed token', async () => {
  const { body } = await register();
  const claims = jwt.decode(body.token);

  assert.equal((await t.api('GET', '/api/auth/me')).body.error.code, 'auth_required');
  assert.equal((await t.api('GET', '/api/auth/me', { headers: { authorization: body.token } })).status, 401);

  const forged = jwt.sign({ tv: 0 }, 'some-other-secret-some-other-secret-123', {
    subject: claims.sub, issuer: 'spendwise', jwtid: 'x', expiresIn: '1h',
  });
  assert.equal((await t.api('GET', '/api/auth/me', { token: forged })).status, 401);

  const expired = jwt.sign({ tv: 0, exp: Math.floor(Date.now() / 1000) - 10 }, process.env.JWT_SECRET, {
    subject: claims.sub, issuer: 'spendwise', jwtid: 'y',
  });
  const res = await t.api('GET', '/api/auth/me', { token: expired });
  assert.equal(res.status, 401);
  assert.match(res.body.error.message, /expired/);

  const unsigned = jwt.sign({ tv: 0, sub: claims.sub, iss: 'spendwise' }, null, { algorithm: 'none' });
  assert.equal((await t.api('GET', '/api/auth/me', { token: unsigned })).status, 401);
});

test('logout revokes only that token; logout-all revokes every device', async () => {
  const email = uniqueEmail();
  const phone = (await register({ email })).body.token;
  const laptop = (await t.api('POST', '/api/auth/login', { body: { email, password: GOOD_PASSWORD } })).body.token;

  assert.equal((await t.api('POST', '/api/auth/logout', { token: phone })).status, 204);
  assert.equal((await t.api('GET', '/api/auth/me', { token: phone })).status, 401);
  assert.equal((await t.api('GET', '/api/auth/me', { token: laptop })).status, 200);

  const tablet = (await t.api('POST', '/api/auth/login', { body: { email, password: GOOD_PASSWORD } })).body.token;
  assert.equal((await t.api('POST', '/api/auth/logout-all', { token: laptop })).status, 204);
  assert.equal((await t.api('GET', '/api/auth/me', { token: laptop })).status, 401);
  assert.equal((await t.api('GET', '/api/auth/me', { token: tablet })).status, 401);
});

test('profile name can be updated', async () => {
  const { token } = (await register()).body;
  const res = await t.api('PATCH', '/api/auth/me', { token, body: { name: '  Asha R.  ' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.user.name, 'Asha R.');
});

test('the app language is saved on its own and only en or hi is accepted', async () => {
  const { token, user } = (await register()).body;
  assert.equal(user.language, 'en');
  const res = await t.api('PATCH', '/api/auth/me', { token, body: { language: 'hi' } });
  assert.equal(res.status, 200);
  assert.deepEqual([res.body.user.language, res.body.user.name], ['hi', user.name]);
  assert.equal((await t.api('PATCH', '/api/auth/me', { token, body: { language: 'fr' } })).status, 400);
  assert.equal((await t.api('PATCH', '/api/auth/me', { token, body: {} })).status, 400);
});

test('changing the password needs the current one and logs out other devices', async () => {
  const email = uniqueEmail();
  const old = (await register({ email })).body.token;

  const bad = await t.api('POST', '/api/auth/password', { token: old, body: { currentPassword: 'nope 1234', newPassword: 'brand new 99' } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'wrong_password');

  const ok = await t.api('POST', '/api/auth/password', { token: old, body: { currentPassword: GOOD_PASSWORD, newPassword: 'brand new 99' } });
  assert.equal(ok.status, 200);
  assert.equal((await t.api('GET', '/api/auth/me', { token: old })).status, 401);
  assert.equal((await t.api('GET', '/api/auth/me', { token: ok.body.token })).status, 200);

  assert.equal((await t.api('POST', '/api/auth/login', { body: { email, password: GOOD_PASSWORD } })).status, 401);
  assert.equal((await t.api('POST', '/api/auth/login', { body: { email, password: 'brand new 99' } })).status, 200);
});

test('deleting the account needs the password and removes the user and their transactions', async () => {
  const email = uniqueEmail();
  const { token, user } = (await register({ email })).body;
  await Transaction.create({ ...(await personalSpace(user.id)), user: user.id, type: 'expense', amountPaise: 500, category: 'Food', date: new Date() });

  assert.equal((await t.api('DELETE', '/api/auth/me', { token, body: { password: 'wrong 123' } })).status, 400);
  assert.equal((await t.api('DELETE', '/api/auth/me', { token, body: { password: GOOD_PASSWORD } })).status, 204);

  assert.equal(await User.countDocuments({ email }), 0);
  assert.equal(await Transaction.countDocuments({ user: user.id }), 0);
  assert.equal((await t.api('GET', '/api/auth/me', { token })).status, 401);
});

test('health reports that login is configured', async () => {
  const res = await t.api('GET', '/api/health');
  assert.deepEqual(res.body.auth, { configured: true });
});

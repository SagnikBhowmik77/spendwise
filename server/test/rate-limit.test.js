// Own process (node --test isolates files), so these low limits don't affect other tests.
process.env.LOGIN_RATE_LIMIT = '3';
process.env.REGISTER_RATE_LIMIT = '2';

const { test, before, after } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { startTestServer, uniqueEmail, GOOD_PASSWORD } = await import('./helpers.js');

let t;
before(async () => { t = await startTestServer(); });
after(() => t.stop());

test('failed logins are limited per IP; successful ones do not count', async () => {
  const email = uniqueEmail();
  await t.api('POST', '/api/auth/register', { body: { name: 'Ravi', email, password: GOOD_PASSWORD } });

  for (let i = 0; i < 5; i++) {
    assert.equal((await t.api('POST', '/api/auth/login', { body: { email, password: GOOD_PASSWORD } })).status, 200);
  }
  for (let i = 0; i < 3; i++) {
    assert.equal((await t.api('POST', '/api/auth/login', { body: { email, password: 'wrong 123' } })).status, 401);
  }
  const blocked = await t.api('POST', '/api/auth/login', { body: { email, password: GOOD_PASSWORD } });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.error.code, 'rate_limited');
});

test('account creation is limited per IP', async () => {
  const make = () => t.api('POST', '/api/auth/register', { body: { name: 'Ravi', email: uniqueEmail(), password: GOOD_PASSWORD } });
  // One registration already happened in the test above.
  assert.equal((await make()).status, 201);
  assert.equal((await make()).status, 429);
});

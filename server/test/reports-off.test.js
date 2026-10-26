// No SMTP settings in this process: email features must say so plainly, never pretend.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, uniqueEmail, GOOD_PASSWORD } from './helpers.js';
import { sendMonthlyReports } from '../src/services/report.service.js';

let t;
let token;
before(async () => {
  t = await startTestServer();
  token = (await t.api('POST', '/api/auth/register', { body: { name: 'Om', email: uniqueEmail(), password: GOOD_PASSWORD } })).body.token;
});
after(() => t.stop());

test('without SMTP, email features refuse with a clear "not configured" answer', async () => {
  assert.deepEqual((await t.api('GET', '/api/health')).body.email, { configured: false });
  assert.equal((await t.api('GET', '/api/reports/settings', { token })).body.emailConfigured, false);

  const on = await t.api('PATCH', '/api/reports/settings', { token, body: { enabled: true } });
  assert.equal(on.status, 503);
  assert.equal(on.body.error.code, 'email_not_configured');

  const sendTest = await t.api('POST', '/api/reports/send-test', { token, body: {} });
  assert.equal(sendTest.status, 503);

  // The preview needs no email, so it still works.
  assert.equal((await t.api('GET', '/api/reports/preview', { token })).status, 200);
  assert.deepEqual(await sendMonthlyReports(), { month: null, sent: 0, failed: 0 });
});

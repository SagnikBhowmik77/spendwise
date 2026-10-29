// The production mail path: the API signs each email and posts it to the relay (client/api/send-mail.js), which
// sends it through SMTP. Here the relay runs on a local port with a capturing transport; nothing leaves the machine.
import { createServer } from 'node:http';
const SECRET = 'relay-test-secret-0123456789abcdef';
const server = createServer();
await new Promise((resolve) => server.listen(0, resolve));
process.env.MAIL_RELAY_URL = `http://127.0.0.1:${server.address().port}/api/send-mail`;
process.env.MAIL_RELAY_SECRET = SECRET;

const { test, after } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { relay, sign } = await import('../../client/api/send-mail.js');
const mailer = await import('../src/mailer.js');

const relayEnv = { SMTP_HOST: 'smtp.test.invalid', SMTP_USER: 'sender@example.com', SMTP_PASS: 'x', MAIL_RELAY_SECRET: SECRET };
const sent = [];
const capture = { sendMail: async (m) => { sent.push(m); return { messageId: `<${sent.length}@test>` }; } };
server.on('request', (req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', async () => {
    const r = await relay({ method: req.method, headers: req.headers, raw }, { env: relayEnv, transport: capture });
    res.writeHead(r.status, { 'content-type': 'application/json' }).end(JSON.stringify(r.body));
  });
});
after(() => server.close());

const post = (raw, headers) => relay({ method: 'POST', headers, raw }, { env: relayEnv, transport: capture });
const signed = (raw, ts = Date.now(), secret = SECRET) => ({ 'x-spendwise-timestamp': String(ts), 'x-spendwise-signature': sign(secret, ts, raw) });

test('with a relay set, sendMail goes over HTTPS-style POST, signed, and arrives from the relay’s own address', async () => {
  assert.equal(mailer.emailConfigured(), true);
  const out = await mailer.sendMail({ to: 'ira@example.com', subject: 'Confirm your email', text: 'Link: x', html: '<p>Link</p>' });
  assert.equal(out.ok, true);
  assert.equal(sent.at(-1).to[0], 'ira@example.com');
  assert.equal(sent.at(-1).from, 'Spendwise <sender@example.com>');
  assert.equal(sent.at(-1).subject, 'Confirm your email');
  assert.equal(await mailer.verifyMail(), true);
});

test('the relay refuses a wrong secret, an old or missing signature, and bad recipients', async () => {
  const raw = JSON.stringify({ to: 'ira@example.com', subject: 'Hi', text: 'x' });
  assert.equal((await post(raw, signed(raw, Date.now(), 'wrong-secret'))).body.error, 'bad_signature');
  assert.equal((await post(raw, signed(raw, Date.now() - 6 * 60_000))).body.error, 'stale_request');
  assert.equal((await post(raw, {})).body.error, 'stale_request');
  // A signature is for exactly one body.
  assert.equal((await post(raw.replace('Hi', 'Hello'), signed(raw))).body.error, 'bad_signature');
  for (const to of ['not-an-address', ['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com', 'e@example.com', 'f@example.com'], []]) {
    const body = JSON.stringify({ to, subject: 'Hi', text: 'x' });
    assert.equal((await post(body, signed(body))).body.error, 'bad_message', JSON.stringify(to));
  }
  const count = sent.length;
  const ok = JSON.stringify({ to: ['a@example.com', 'b@example.com'], subject: 'Hi', text: 'x' });
  assert.equal((await post(ok, signed(ok))).status, 200);
  assert.equal(sent.length, count + 1);
});

test('the relay says when it is not set up, and a failed send reaches the API as an error', async () => {
  const raw = JSON.stringify({ to: 'ira@example.com', subject: 'Hi', text: 'x' });
  const off = await relay({ method: 'POST', headers: signed(raw), raw }, { env: { MAIL_RELAY_SECRET: SECRET }, transport: capture });
  assert.deepEqual([off.status, off.body.error], [503, 'relay_not_configured']);
  assert.equal((await relay({ method: 'GET', headers: {}, raw: '' }, { env: {} })).body.configured, false);
  assert.equal((await relay({ method: 'GET', headers: {}, raw: '' }, { env: relayEnv })).body.configured, true);

  const realRelayEnv = { ...relayEnv };
  relayEnv.MAIL_RELAY_SECRET = 'rotated-on-vercel-only';
  await assert.rejects(mailer.sendMail({ to: 'ira@example.com', subject: 'Hi', text: 'x' }), /Mail relay answered 401: bad_signature/);
  Object.assign(relayEnv, realRelayEnv);
});

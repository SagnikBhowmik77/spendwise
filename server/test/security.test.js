// Batch 12I: one-time codes, signed-in devices, two-factor login, new-device emails and the app lock.
// Email is "configured" for this file only; messages go to nodemailer's in-memory JSON transport.
process.env.SMTP_HOST = 'smtp.test.invalid';
process.env.SMTP_USER = 'sender@example.com';
process.env.SMTP_PASS = 'abcd efgh ijkl mnop';

const { test, before, after, beforeEach } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const jwt = (await import('jsonwebtoken')).default;
const nodemailer = (await import('nodemailer')).default;
const { startTestServer, uniqueEmail, GOOD_PASSWORD, markVerified } = await import('./helpers.js');
const { setTransport } = await import('../src/mailer.js');
const auth = await import('../src/services/auth.service.js');
const s = await import('../src/security.js');
const { Session, User } = await import('../src/models/index.js');
const { config } = await import('../src/config.js');

let t;
let sent = [];
const json = nodemailer.createTransport({ jsonTransport: true });
setTransport({ sendMail: async (m) => { const info = await json.sendMail(m); sent.push(JSON.parse(info.message)); return info; } });

const CHROME_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const SAFARI_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
const as = (ua, deviceId) => ({ 'user-agent': ua, ...(deviceId && { 'x-device-id': deviceId }) });
const call = (method, path, { token, body, headers } = {}) => t.api(method, path, { token, body, headers });
async function newUser(headers = as(CHROME_WIN, 'laptop-1')) {
  const email = uniqueEmail();
  const r = await call('POST', '/api/auth/register', { body: { name: 'Ira', email, password: GOOD_PASSWORD }, headers });
  await (await import('../src/services/auth.service.js')).lastVerifyMail;
  for (let i = sent.length - 1; i >= 0; i -= 1) if (/Confirm your email/.test(sent[i].subject)) sent.splice(i, 1);
  await markVerified(email);
  return { email, token: r.body.token, id: r.body.user.id };
}
const login = (email, headers) => call('POST', '/api/auth/login', { body: { email, password: GOOD_PASSWORD }, headers });
const codeFor = (secret, offset = 0) => s.totpAt(s.base32Decode(secret), s.totpStep() + offset);

before(async () => { t = await startTestServer(); });
after(async () => { await t.stop(); });
beforeEach(() => { sent = []; });

test('one-time codes match RFC 6238; backup codes, encryption and device names', () => {
  const rfc = Buffer.from('12345678901234567890');
  for (const [time, code] of [[59, '94287082'], [1111111109, '07081804'], [1234567890, '89005924'], [2000000000, '69279037']]) {
    assert.equal(s.totpAt(rfc, Math.floor(time / 30), 8), code);
  }
  const secret = s.newTotpSecret();
  const now = Date.now();
  const step = s.totpStep(now);
  assert.equal(s.verifyTotp(secret, s.totpAt(secret, step), { now }), step);
  assert.equal(s.verifyTotp(secret, s.totpAt(secret, step - 1), { now }), step - 1); // 30 s of clock drift
  assert.equal(s.verifyTotp(secret, s.totpAt(secret, step - 3), { now }), null);
  assert.equal(s.verifyTotp(secret, s.totpAt(secret, step), { now, after: step }), null); // used already
  assert.equal(s.base32Decode(s.base32Encode(secret)).equals(secret), true);
  assert.equal(s.decryptSecret(s.encryptSecret(secret, 'k'.repeat(40)), 'k'.repeat(40)).equals(secret), true);
  const codes = s.newBackupCodes();
  assert.equal(codes.length, 10);
  assert.ok(codes.every((c) => /^[a-z2-9]{4}-[a-z2-9]{4}$/.test(c)));
  assert.equal(s.hashBackupCode(codes[0].toUpperCase().replace('-', ' '), 'x'), s.hashBackupCode(codes[0], 'x'));
  assert.equal(s.deviceLabel(CHROME_WIN), 'Chrome on Windows');
  assert.equal(s.deviceLabel(SAFARI_IOS), 'Safari on iOS');
  assert.ok(s.otpauthUrl('ABCD', 'a@b.c').startsWith('otpauth://totp/Spendwise%3Aa%40b.c?secret=ABCD&issuer=Spendwise'));
});

test('signed-in devices: listed with the current one marked, and each can be signed out', async () => {
  const u = await newUser();
  const phone = (await login(u.email, as(SAFARI_IOS, 'phone-1'))).body.token;
  const list = (await call('GET', '/api/auth/sessions', { token: u.token })).body.sessions;
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((x) => [x.label, x.current]).sort(), [['Chrome on Windows', true], ['Safari on iOS', false]]);
  const other = list.find((x) => !x.current);
  assert.equal((await call('DELETE', `/api/auth/sessions/${other.id}`, { token: u.token })).status, 204);
  assert.equal((await call('GET', '/api/auth/me', { token: phone })).status, 401);
  // Sign out the others, then this one.
  const tablet = (await login(u.email, as(CHROME_WIN, 'tablet'))).body.token;
  assert.equal((await call('POST', '/api/auth/sessions/sign-out-others', { token: u.token })).body.signedOut, 1);
  assert.equal((await call('GET', '/api/auth/me', { token: tablet })).status, 401);
  assert.equal((await call('POST', '/api/auth/logout', { token: u.token })).status, 204);
  assert.equal((await call('GET', '/api/auth/me', { token: u.token })).status, 401);
  // Someone else's session can't be signed out.
  const v = await newUser();
  const vSession = (await call('GET', '/api/auth/sessions', { token: v.token })).body.sessions[0];
  const w = await newUser();
  assert.equal((await call('DELETE', `/api/auth/sessions/${vSession.id}`, { token: w.token })).status, 404);
});

test('tokens from before devices were listed keep working and get a row; a 2FA challenge is never a login', async () => {
  const u = await newUser();
  const user = await User.findById(u.id);
  const legacy = jwt.sign({ tv: user.tokenVersion }, config.jwt.secret, { algorithm: 'HS256', subject: u.id, issuer: config.jwt.issuer, jwtid: 'legacy-1', expiresIn: '1h' });
  assert.equal((await call('GET', '/api/auth/me', { token: legacy, headers: as(SAFARI_IOS) })).status, 200);
  assert.equal((await Session.findOne({ jti: 'legacy-1' }).lean()).label, 'Safari on iOS');
  const challenge = jwt.sign({ tv: user.tokenVersion }, config.jwt.secret, { algorithm: 'HS256', subject: u.id, issuer: config.jwt.issuer, audience: 'spendwise-2fa', expiresIn: '5m' });
  assert.equal((await call('GET', '/api/auth/me', { token: challenge })).status, 401);
});

test('two-factor login: set up with a code, then the password alone is not enough', async () => {
  const u = await newUser();
  const setup = (await call('POST', '/api/auth/2fa/setup', { token: u.token })).body;
  assert.match(setup.secret, /^[A-Z2-7]{4}( [A-Z2-7]{4}){7}$/);
  assert.ok(setup.otpauthUrl.includes(`secret=${setup.secret.replace(/ /g, '')}`));
  assert.equal((await call('POST', '/api/auth/2fa/enable', { token: u.token, body: { code: '000000' } })).status, 400);
  const on = await call('POST', '/api/auth/2fa/enable', { token: u.token, body: { code: codeFor(setup.secret) } });
  assert.equal(on.status, 200);
  const backups = on.body.backupCodes;
  assert.equal(backups.length, 10);
  assert.equal((await call('GET', '/api/auth/me', { token: u.token })).body.user.twoFactor.enabled, true);
  assert.equal((await call('GET', '/api/auth/2fa', { token: u.token })).body.backupCodesLeft, 10);
  // Nothing secret comes back with the user.
  const raw = JSON.stringify((await call('GET', '/api/auth/me', { token: u.token })).body);
  assert.ok(!/secretEnc|backupCodes|pinHash|knownDevices|lastStep/.test(raw), raw);

  const first = await login(u.email);
  assert.deepEqual([first.status, first.body.twoFactorRequired, first.body.token], [200, true, undefined]);
  assert.equal((await call('POST', '/api/auth/login/2fa', { body: { challenge: first.body.challenge, code: '123456' } })).status, 400);
  // The code used to turn it on was this step's, so the next step's code is the one to use now.
  const next = codeFor(setup.secret, 1);
  const ok = await call('POST', '/api/auth/login/2fa', { body: { challenge: first.body.challenge, code: next } });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.token);
  assert.equal((await call('GET', '/api/auth/me', { token: ok.body.token })).status, 200);
  // A code works once.
  const again = await login(u.email);
  assert.equal((await call('POST', '/api/auth/login/2fa', { body: { challenge: again.body.challenge, code: next } })).body.error.code, 'invalid_code');
  // A backup code works once too, whatever its case or spacing.
  const viaBackup = await call('POST', '/api/auth/login/2fa', { body: { challenge: again.body.challenge, code: backups[0].toUpperCase().replace('-', ' ') } });
  assert.deepEqual([viaBackup.status, viaBackup.body.usedBackup, viaBackup.body.backupCodesLeft], [200, true, 9]);
  assert.equal((await call('POST', '/api/auth/login/2fa', { body: { challenge: again.body.challenge, code: backups[0] } })).status, 400);
  // A made-up challenge doesn't work.
  assert.equal((await call('POST', '/api/auth/login/2fa', { body: { challenge: 'x.y.z', code: codeFor(setup.secret) } })).status, 401);
  // New backup codes need a code; turning it off needs the password as well.
  const fresh = await call('POST', '/api/auth/2fa/backup-codes', { token: u.token, body: { code: backups[1] } });
  assert.equal(fresh.body.backupCodes.length, 10);
  assert.equal((await call('POST', '/api/auth/2fa/disable', { token: u.token, body: { password: 'wrong pass 1', code: fresh.body.backupCodes[0] } })).status, 400);
  assert.equal((await call('POST', '/api/auth/2fa/disable', { token: u.token, body: { password: GOOD_PASSWORD, code: backups[2] } })).status, 400); // old codes stopped working
  assert.equal((await call('POST', '/api/auth/2fa/disable', { token: u.token, body: { password: GOOD_PASSWORD, code: fresh.body.backupCodes[0] } })).status, 204);
  assert.ok((await login(u.email)).body.token);
});

test('two-factor login: too many wrong codes stop further tries for a while', async () => {
  const u = await newUser();
  const { secret } = (await call('POST', '/api/auth/2fa/setup', { token: u.token })).body;
  await call('POST', '/api/auth/2fa/enable', { token: u.token, body: { code: codeFor(secret) } });
  const { challenge } = (await login(u.email)).body;
  for (let i = 0; i < auth.MAX_CODE_FAILURES; i += 1) {
    assert.equal((await call('POST', '/api/auth/login/2fa', { body: { challenge, code: '999999' } })).status, 400);
  }
  const blocked = await call('POST', '/api/auth/login/2fa', { body: { challenge, code: codeFor(secret, 1) } });
  assert.deepEqual([blocked.status, blocked.body.error.code], [429, 'too_many_codes']);
});

test('new-device sign-in email: not for the first device or one seen before, and can be turned off', async () => {
  const u = await newUser(as(CHROME_WIN, 'laptop-1'));
  await login(u.email, as(CHROME_WIN, 'laptop-1'));
  await auth.lastLoginAlert;
  assert.equal(sent.length, 0);
  await login(u.email, as(SAFARI_IOS, 'phone-9'));
  await auth.lastLoginAlert;
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].to.map((a) => a.address), [u.email]);
  assert.equal(sent[0].subject, 'New sign-in to Spendwise from Safari on iOS');
  assert.match(sent[0].text, /change your password now/);
  await login(u.email, as(SAFARI_IOS, 'phone-9'));
  await auth.lastLoginAlert;
  assert.equal(sent.length, 1);
  assert.equal((await call('PATCH', '/api/notifications/settings', { token: u.token, body: { loginEmail: false } })).body.loginEmail, false);
  await login(u.email, as(CHROME_WIN, 'office-pc'));
  await auth.lastLoginAlert;
  assert.equal(sent.length, 1);
});

test('app lock: locked devices get 423 until the PIN is entered; too many wrong PINs sign the device out', async () => {
  const u = await newUser();
  assert.equal((await call('PUT', '/api/auth/lock', { token: u.token, body: { password: GOOD_PASSWORD } })).status, 400); // a PIN is needed
  assert.equal((await call('PUT', '/api/auth/lock', { token: u.token, body: { password: 'wrong 12345', pin: '2468' } })).status, 400);
  const on = await call('PUT', '/api/auth/lock', { token: u.token, body: { password: GOOD_PASSWORD, pin: '2468', timeoutMinutes: 5 } });
  assert.deepEqual([on.status, on.body.enabled, on.body.timeoutMinutes], [200, true, 5]);
  assert.equal((await call('GET', '/api/transactions', { token: u.token })).status, 200);
  assert.equal((await call('POST', '/api/auth/lock/now', { token: u.token })).status, 204);
  const blocked = await call('GET', '/api/transactions', { token: u.token });
  assert.deepEqual([blocked.status, blocked.body.error.code], [423, 'app_locked']);
  const me = await call('GET', '/api/auth/me', { token: u.token });
  assert.deepEqual([me.status, me.body.locked, me.body.user.appLock.enabled], [200, true, true]);
  assert.match((await call('POST', '/api/auth/lock/unlock', { token: u.token, body: { pin: '1111' } })).body.error.message, /4 tries left/);
  assert.equal((await call('POST', '/api/auth/lock/unlock', { token: u.token, body: { pin: '2468' } })).status, 204);
  assert.equal((await call('GET', '/api/transactions', { token: u.token })).status, 200);
  // Left alone longer than the timeout, the device locks by itself.
  const session = await Session.findOne({ user: u.id });
  await Session.updateOne({ _id: session._id }, { $set: { lastActiveAt: new Date(Date.now() - 6 * 60_000) } });
  assert.equal((await call('GET', '/api/stats/summary', { token: u.token })).status, 423);
  for (let i = 1; i < 5; i += 1) assert.equal((await call('POST', '/api/auth/lock/unlock', { token: u.token, body: { pin: '0000' } })).status, 400);
  const out = await call('POST', '/api/auth/lock/unlock', { token: u.token, body: { pin: '0000' } });
  assert.deepEqual([out.status, out.body.error.code], [401, 'locked_out']);
  assert.equal((await call('GET', '/api/auth/me', { token: u.token })).status, 401);
  // Signing in again with the password gives an unlocked device.
  const again = (await login(u.email)).body.token;
  assert.equal((await call('GET', '/api/transactions', { token: again })).status, 200);
  // Fingerprint set-up asks the browser for a platform authenticator with the person verified.
  const opts = (await call('POST', '/api/auth/lock/passkeys/options', { token: again })).body;
  assert.deepEqual([opts.rp.id, opts.authenticatorSelection.authenticatorAttachment, opts.authenticatorSelection.userVerification], ['localhost', 'platform', 'required']);
  assert.ok(opts.challenge.length > 20);
  assert.equal((await call('POST', '/api/auth/lock/unlock/options', { token: again })).status, 409); // none set up yet
  assert.equal((await call('POST', '/api/auth/lock/disable', { token: again, body: { password: GOOD_PASSWORD } })).body.enabled, false);
  assert.equal((await call('POST', '/api/auth/lock/now', { token: again })).status, 409);
  assert.equal((await call('GET', '/api/transactions', { token: again })).status, 200);
});

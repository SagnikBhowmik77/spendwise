import { randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { HttpError } from '../errors.js';
import { emailConfigured, sendMail } from '../mailer.js';
import { User, RevokedToken, PushSubscription, Session, ApiToken, TelegramLink, EmailToken } from '../models/index.js';
import { decryptSecret, deviceLabel, hashBackupCode, normaliseBackupCode, sha256, verifyTotp } from '../security.js';
import { ensurePersonalSpace, removeUserFromAllSpaces } from './space.service.js';

const BAD_LOGIN = () => new HttpError(401, 'invalid_credentials', 'Email or password is incorrect');
const BAD_TOKEN = (message = 'Your session is no longer valid. Please log in again.') =>
  new HttpError(401, 'invalid_token', message);
// The second step of a two-factor login is a short-lived token of its own, never usable as a login.
const TWO_FACTOR_AUDIENCE = 'spendwise-2fa';
const TWO_FACTOR_WINDOW = '5m';
// Wrong codes allowed per account in 15 minutes (a 6-digit code has a million possibilities).
export const MAX_CODE_FAILURES = 10;
const CODE_WINDOW_MS = 15 * 60 * 1000;
// Devices remembered for new-device alerts.
const KNOWN_DEVICES = 20;

// Compared against when the email doesn't exist, so "unknown email" and "wrong password" take the same time.
let dummyHash;
const getDummyHash = () => (dummyHash ??= bcrypt.hashSync('spendwise-timing-equaliser', config.bcryptRounds));

export function authConfigured() {
  return Boolean(config.jwt.secret);
}

// What a request says about the device: browser, IP, and the random id the app keeps (X-Device-Id).
export const clientInfo = (req) => ({
  userAgent: (req.get('user-agent') ?? '').slice(0, 300),
  ip: (req.ip ?? '').slice(0, 64),
  deviceId: (req.get('x-device-id') ?? '').slice(0, 100),
});

// A login token plus its session row (the "signed-in devices" list).
export async function issueToken(user, client = {}) {
  const jti = randomUUID();
  const token = jwt.sign({ tv: user.tokenVersion }, config.jwt.secret, {
    algorithm: 'HS256',
    subject: String(user._id),
    issuer: config.jwt.issuer,
    jwtid: jti,
    expiresIn: config.jwt.expiresIn,
  });
  await Session.create({
    user: user._id, jti, expiresAt: new Date(jwt.decode(token).exp * 1000),
    label: deviceLabel(client.userAgent), userAgent: client.userAgent ?? '', ip: client.ip ?? '',
  });
  return token;
}

const istTime = (d) => new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: config.timeZone }).format(d);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function sendLoginAlert(user, client, when) {
  const label = deviceLabel(client.userAgent);
  const link = `${config.appUrl}/settings`;
  const where = client.ip ? ` (IP address ${client.ip})` : '';
  await sendMail({
    to: user.email,
    subject: `New sign-in to Spendwise from ${label}`,
    text: `Your Spendwise account was just signed in to from ${label}${where} on ${istTime(when)} India time.\n\n`
      + "If this was you, there's nothing to do.\n"
      + `If it wasn't, change your password now: that signs every device out. ${link}\n\n`
      + 'You get this because new-device sign-in emails are on in Settings → Security.',
    html: `<div style="font-family:sans-serif;font-size:15px"><p>Your Spendwise account was just signed in to from <b>${esc(label)}</b>${esc(where)} on ${esc(istTime(when))} India time.</p>`
      + `<p>If this was you, there's nothing to do.</p><p>If it wasn't, <a href="${esc(link)}">change your password now</a>: that signs every device out.</p>`
      + '<p style="color:#64748b;font-size:12px">You get this because new-device sign-in emails are on in Settings → Security.</p></div>',
  });
}

// Remembers the device; on a device not seen before (and not the very first one), emails the owner.
// The email goes out in the background so a slow mail server never holds up signing in.
export let lastLoginAlert = Promise.resolve();
async function noteDevice(user, client) {
  const key = sha256(client.deviceId ? `id:${client.deviceId}` : `ua:${deviceLabel(client.userAgent)}`);
  const u = await User.findById(user._id).select('+knownDevices email notify emailVerifiedAt');
  const now = new Date();
  if (u.knownDevices.some((d) => d.key === key)) {
    await User.updateOne({ _id: u._id, 'knownDevices.key': key }, { $set: { 'knownDevices.$.lastSeen': now } });
    return false;
  }
  const first = u.knownDevices.length === 0;
  await User.updateOne({ _id: u._id }, { $push: { knownDevices: { $each: [{ key, label: deviceLabel(client.userAgent), firstSeen: now, lastSeen: now }], $slice: -KNOWN_DEVICES } } });
  if (!first && u.notify?.loginEmail !== false && u.emailVerifiedAt && emailConfigured()) {
    lastLoginAlert = sendLoginAlert(u, client, now).catch((err) => console.error(`New-device email failed: ${err.message}`));
  }
  return !first;
}

async function finishLogin(user, client) {
  const token = await issueToken(user, client);
  await noteDevice(user, client);
  return { user, token };
}

export async function register({ name, email, password }, client = {}) {
  const passwordHash = await bcrypt.hash(password, config.bcryptRounds);
  let user;
  try {
    user = await User.create({ name, email, passwordHash });
  } catch (err) {
    if (err.code === 11000) throw new HttpError(409, 'email_taken', 'An account with this email already exists');
    throw err;
  }
  // Every account starts with a personal space and a "Cash" account.
  await ensurePersonalSpace(user);
  // The confirmation link goes out in the background; signing up never waits for the mail server.
  if (emailConfigured()) {
    lastVerifyMail = sendVerification(user).catch((err) => console.error(`Verification email failed: ${err.message}`));
  }
  return finishLogin(user, client);
}

// ── Email links: password reset and address verification ──

const RESET_MINUTES = 30;
const VERIFY_HOURS = 24;
// A new link for the same account at most this often, so nobody can flood someone's inbox.
const RESEND_COOLDOWN_MS = 2 * 60 * 1000;
const EMAIL_OFF = () => new HttpError(503, 'email_not_configured', 'Email is not set up on this server, so links can’t be sent');
const BAD_LINK = () => new HttpError(400, 'invalid_link', 'This link is invalid, has expired or was already used. Ask for a new one.');

// Tests wait on these; nothing else should.
export let lastResetMail = Promise.resolve();
export let lastVerifyMail = Promise.resolve();

// A fresh random token: the link carries it, the database only its hash. Older links of the same kind stop working.
async function newEmailToken(user, purpose, ms) {
  const token = randomBytes(32).toString('base64url');
  await EmailToken.deleteMany({ user: user._id, purpose });
  await EmailToken.create({ user: user._id, purpose, tokenHash: sha256(token), email: user.email, expiresAt: new Date(Date.now() + ms) });
  return token;
}

async function recentlySent(user, purpose) {
  return EmailToken.exists({ user: user._id, purpose, createdAt: { $gt: new Date(Date.now() - RESEND_COOLDOWN_MS) } });
}

// Finds a live link and removes it, so each link works once.
async function takeEmailToken(token, purpose) {
  const row = await EmailToken.findOneAndDelete({ tokenHash: sha256(String(token)), purpose, expiresAt: { $gt: new Date() } });
  if (!row) throw BAD_LINK();
  return row;
}

const mailHtml = (paragraphs, link, linkText, footer) => '<div style="font-family:sans-serif;font-size:15px;line-height:1.5">'
  + paragraphs.map((p) => `<p>${esc(p)}</p>`).join('')
  + `<p><a href="${esc(link)}" style="display:inline-block;background:#2f5bd3;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">${esc(linkText)}</a></p>`
  + `<p style="color:#64748b;font-size:12px">${esc(footer)}</p></div>`;

// Always answers the same way, whether or not the address has an account, and sends in the background,
// so the reply can't be used to find out who uses Spendwise.
export async function requestPasswordReset({ email }) {
  if (!emailConfigured()) throw EMAIL_OFF();
  const user = await User.findOne({ email });
  if (!user || (await recentlySent(user, 'reset'))) return;
  lastResetMail = (async () => {
    // The token is in the part after "#", which browsers never send to a server or in a Referer header.
    const link = `${config.appUrl}/reset-password#token=${await newEmailToken(user, 'reset', RESET_MINUTES * 60_000)}`;
    const footer = 'If you didn’t ask for this, ignore this email: your password stays as it is.';
    await sendMail({
      to: user.email,
      subject: 'Reset your Spendwise password',
      text: `Someone (hopefully you) asked to reset the password for your Spendwise account.\n\nChoose a new password: ${link}\n\n`
        + `The link works once, for ${RESET_MINUTES} minutes.\n${footer}`,
      html: mailHtml(['Someone (hopefully you) asked to reset the password for your Spendwise account.', `The link works once, for ${RESET_MINUTES} minutes.`],
        link, 'Choose a new password', footer),
    });
  })().catch((err) => console.error(`Password reset email failed: ${err.message}`));
}

// A new password signs out every device. Two-factor login stays on. Opening the link proves the inbox is
// theirs, so the address counts as confirmed too.
export async function resetPassword({ token, password }) {
  const row = await takeEmailToken(token, 'reset');
  const user = await User.findById(row.user).select('+passwordHash');
  if (!user || user.email !== row.email) throw BAD_LINK();
  user.passwordHash = await bcrypt.hash(password, config.bcryptRounds);
  user.tokenVersion += 1;
  user.emailVerifiedAt ??= new Date();
  await user.save();
  await Session.deleteMany({ user: user._id });
  await EmailToken.deleteMany({ user: user._id, purpose: 'reset' });
  if (emailConfigured()) {
    lastResetMail = sendMail({
      to: user.email,
      subject: 'Your Spendwise password was changed',
      text: `The password for your Spendwise account was just changed with a reset link, and every device was signed out.\n\n`
        + `If this wasn't you, reset it again now: ${config.appUrl}/forgot-password`,
      html: mailHtml(['The password for your Spendwise account was just changed with a reset link, and every device was signed out.', 'If this wasn’t you, reset it again now.'],
        `${config.appUrl}/forgot-password`, 'Reset my password', 'You get this email after every password reset.'),
    }).catch((err) => console.error(`Password-changed email failed: ${err.message}`));
  }
}

export async function sendVerification(user) {
  if (user.emailVerifiedAt) throw new HttpError(409, 'already_verified', 'Your email address is already confirmed');
  if (!emailConfigured()) throw EMAIL_OFF();
  if (await recentlySent(user, 'verify')) {
    throw new HttpError(429, 'recently_sent', 'We sent a link a moment ago. Check your inbox (and spam), or try again in 2 minutes.');
  }
  const link = `${config.appUrl}/verify-email#token=${await newEmailToken(user, 'verify', VERIFY_HOURS * 3_600_000)}`;
  const footer = 'If you didn’t create a Spendwise account, ignore this email and nothing will be sent to you again.';
  await sendMail({
    to: user.email,
    subject: 'Confirm your email for Spendwise',
    text: `Hi ${user.name}, confirm this is your email address so Spendwise can send you reports and alerts.\n\n`
      + `Confirm: ${link}\n\nThe link works for ${VERIFY_HOURS} hours.\n${footer}`,
    html: mailHtml([`Hi ${user.name}, confirm this is your email address so Spendwise can send you reports and alerts.`, `The link works for ${VERIFY_HOURS} hours.`],
      link, 'Confirm my email', footer),
  });
  return { sentTo: user.email };
}

// Works signed in or out: the link itself is the proof.
export async function verifyEmail({ token }) {
  const row = await takeEmailToken(token, 'verify');
  const user = await User.findById(row.user);
  if (!user || user.email !== row.email) throw BAD_LINK();
  if (!user.emailVerifiedAt) {
    user.emailVerifiedAt = new Date();
    await user.save();
  }
  return { email: user.email };
}

export async function dismissChecklist(user) {
  user.checklistDismissedAt ??= new Date();
  await user.save();
  return user;
}

// With two-factor on, the password only earns a 5-minute challenge for the code step.
export async function login({ email, password }, client = {}) {
  const user = await User.findOne({ email }).select('+passwordHash');
  const matches = await bcrypt.compare(password, user?.passwordHash ?? getDummyHash());
  if (!user || !matches) throw BAD_LOGIN();
  if (user.twoFactor?.enabled) {
    const challenge = jwt.sign({ tv: user.tokenVersion }, config.jwt.secret, {
      algorithm: 'HS256', subject: String(user._id), issuer: config.jwt.issuer, audience: TWO_FACTOR_AUDIENCE, expiresIn: TWO_FACTOR_WINDOW,
    });
    return { twoFactorRequired: true, challenge };
  }
  return finishLogin(user, client);
}

const SECOND_FACTOR_FIELDS = '+twoFactor.secretEnc +twoFactor.lastStep +twoFactor.backupCodes +twoFactor.failures +twoFactor.failuresSince';
export const withSecondFactor = (id) => User.findById(id).select(SECOND_FACTOR_FIELDS);

// Checks a 6-digit code from the authenticator app (each works once) or an unused backup code.
// Too many wrong codes in 15 minutes stops further tries for a while.
export async function useSecondFactor(user, code) {
  const tf = user.twoFactor;
  const now = new Date();
  if (tf.failuresSince && now - tf.failuresSince > CODE_WINDOW_MS) { tf.failures = 0; tf.failuresSince = null; }
  if (tf.failures >= MAX_CODE_FAILURES) throw new HttpError(429, 'too_many_codes', 'Too many wrong codes. Try again in 15 minutes.');
  const clean = String(code).replace(/\s/g, '');
  let usedBackup = false;
  let ok = false;
  if (/^\d{6}$/.test(clean)) {
    const step = verifyTotp(decryptSecret(tf.secretEnc, config.jwt.secret), clean, { after: tf.lastStep });
    if (step !== null) { tf.lastStep = step; ok = true; }
  } else if (normaliseBackupCode(clean).length === 8) {
    const hash = hashBackupCode(clean, config.jwt.secret);
    const entry = tf.backupCodes.find((c) => c.hash === hash && !c.usedAt);
    if (entry) { entry.usedAt = now; ok = true; usedBackup = true; }
  }
  if (!ok) {
    tf.failures += 1;
    tf.failuresSince ??= now;
    user.markModified('twoFactor');
    await user.save();
    throw new HttpError(400, 'invalid_code', 'That code is not right (or was already used). Check your authenticator app and try again.');
  }
  tf.failures = 0;
  tf.failuresSince = null;
  user.markModified('twoFactor');
  await user.save();
  return { usedBackup, backupCodesLeft: tf.backupCodes.filter((c) => !c.usedAt).length };
}

export async function loginTwoFactor({ challenge, code }, client = {}) {
  let claims;
  try {
    claims = jwt.verify(challenge, config.jwt.secret, { algorithms: ['HS256'], issuer: config.jwt.issuer, audience: TWO_FACTOR_AUDIENCE });
  } catch {
    throw new HttpError(401, 'challenge_expired', 'That sign-in took too long. Enter your email and password again.');
  }
  const user = await withSecondFactor(claims.sub);
  if (!user || user.tokenVersion !== claims.tv || !user.twoFactor.enabled) {
    throw new HttpError(401, 'challenge_expired', 'Enter your email and password again.');
  }
  const used = await useSecondFactor(user, code);
  const result = await finishLogin(await User.findById(user._id), client);
  return { ...result, usedBackup: used.usedBackup, backupCodesLeft: used.backupCodesLeft };
}

export async function verifyToken(token, client = {}) {
  let claims;
  try {
    claims = jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'], issuer: config.jwt.issuer });
  } catch (err) {
    if (err.name === 'TokenExpiredError') throw BAD_TOKEN('Your session has expired. Please log in again.');
    throw BAD_TOKEN();
  }
  // A two-factor challenge (or any token without an id) is not a login.
  if (claims.aud || !claims.jti) throw BAD_TOKEN();
  const [user, found] = await Promise.all([User.findById(claims.sub), Session.findOne({ jti: claims.jti })]);
  if (!user || user.tokenVersion !== claims.tv) throw BAD_TOKEN();
  let session = found;
  if (!session) {
    // Tokens from before devices were listed get a row on first use, unless they were logged out.
    if (await RevokedToken.exists({ jti: claims.jti })) throw BAD_TOKEN();
    session = await Session.findOneAndUpdate(
      { jti: claims.jti },
      { $setOnInsert: { user: user._id, jti: claims.jti, expiresAt: new Date(claims.exp * 1000), label: deviceLabel(client.userAgent), userAgent: client.userAgent ?? '', ip: client.ip ?? '' } },
      { upsert: true, returnDocument: 'after' },
    );
  }
  if (String(session.user) !== String(user._id)) throw BAD_TOKEN();
  return { user, claims, session };
}

// Ends one session: its row goes and its token is listed as revoked until it would expire.
export async function endSession(session) {
  await RevokedToken.updateOne(
    { jti: session.jti },
    { $setOnInsert: { jti: session.jti, expiresAt: session.expiresAt } },
    { upsert: true },
  );
  await Session.deleteOne({ _id: session._id });
}

// Logs out every device: all existing tokens carry the old tokenVersion.
export async function logoutAll(user) {
  await User.updateOne({ _id: user._id }, { $inc: { tokenVersion: 1 } });
  await Session.deleteMany({ user: user._id });
}

export async function updateProfile(user, { name, language }) {
  if (name !== undefined) user.name = name;
  if (language !== undefined) user.language = language;
  await user.save();
  return user;
}

export async function checkPassword(user, password, message = 'Password is incorrect') {
  const withHash = await User.findById(user._id).select('+passwordHash');
  if (!(await bcrypt.compare(password, withHash.passwordHash))) throw new HttpError(400, 'wrong_password', message);
  return withHash;
}

// Changing the password logs out every other device and returns a fresh token for this one.
export async function changePassword(user, { currentPassword, newPassword }, client = {}) {
  const withHash = await checkPassword(user, currentPassword, 'Current password is incorrect');
  withHash.passwordHash = await bcrypt.hash(newPassword, config.bcryptRounds);
  withHash.tokenVersion += 1;
  await withHash.save();
  await Session.deleteMany({ user: user._id });
  return { user: withHash, token: await issueToken(withHash, client) };
}

// Permanently deletes the account and all of the user's data.
export async function deleteAccount(user, { password }) {
  await checkPassword(user, password);
  // Every collection holding this user's data must be listed here.
  // The personal space and everything in it goes; in shared spaces this person just leaves
  // (entries they added stay with the household, shown as "Former member").
  await removeUserFromAllSpaces(user);
  await PushSubscription.deleteMany({ user: user._id });
  await Session.deleteMany({ user: user._id });
  await ApiToken.deleteMany({ user: user._id });
  await TelegramLink.deleteMany({ user: user._id });
  await User.deleteOne({ _id: user._id });
}

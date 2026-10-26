// Batch 12I: signed-in devices, two-factor login setup, and the app lock (PIN or fingerprint).
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { config } from '../config.js';
import { HttpError } from '../errors.js';
import { Session, User } from '../models/index.js';
import {
  base32Encode, decryptSecret, deviceLabel, encryptSecret, hashBackupCode, newBackupCodes, newTotpSecret, otpauthUrl, verifyTotp,
} from '../security.js';
import { checkPassword, endSession, useSecondFactor, withSecondFactor } from './auth.service.js';

// Wrong PINs allowed before this device is signed out.
export const MAX_PIN_FAILURES = 5;
const CHALLENGE_MS = 5 * 60 * 1000;
const fieldError = (field, message) => new HttpError(400, 'validation_failed', 'Some fields are missing or invalid', [{ field, message }]);

// Signed-in devices

export async function listSessions(user, current) {
  const rows = await Session.find({ user: user._id }).sort({ lastSeenAt: -1 }).lean();
  return rows.map((s) => ({
    id: String(s._id), label: s.label, ip: s.ip, signedInAt: s.createdAt, lastSeenAt: s.lastSeenAt,
    current: String(s._id) === String(current._id),
  }));
}

export async function revokeSession(user, id) {
  const s = mongoose.isValidObjectId(id) ? await Session.findOne({ _id: id, user: user._id }) : null;
  if (!s) throw new HttpError(404, 'session_not_found', 'That device is already signed out');
  await endSession(s);
}

// Signs out every device except this one.
export async function revokeOthers(user, current) {
  const others = await Session.find({ user: user._id, _id: { $ne: current._id } });
  for (const s of others) await endSession(s);
  return others.length;
}

// Two-factor login

export async function twoFactorStatus(user) {
  const u = await withSecondFactor(user._id);
  return {
    enabled: u.twoFactor.enabled,
    enabledAt: u.twoFactor.enabledAt,
    backupCodesLeft: u.twoFactor.enabled ? u.twoFactor.backupCodes.filter((c) => !c.usedAt).length : 0,
  };
}

// A new secret to scan; it only takes effect once a code from it is confirmed.
export async function startTwoFactor(user) {
  if (user.twoFactor?.enabled) throw new HttpError(409, 'two_factor_on', 'Two-factor login is already on');
  const secret = newTotpSecret();
  await User.updateOne({ _id: user._id }, { $set: { 'twoFactor.pendingSecretEnc': encryptSecret(secret, config.jwt.secret) } });
  const b32 = base32Encode(secret);
  return { secret: b32.match(/.{1,4}/g).join(' '), otpauthUrl: otpauthUrl(b32, user.email) };
}

const freshCodes = () => {
  const codes = newBackupCodes();
  return { codes, stored: codes.map((c) => ({ hash: hashBackupCode(c, config.jwt.secret), usedAt: null })) };
};

export async function confirmTwoFactor(user, { code }) {
  const u = await User.findById(user._id).select('+twoFactor.pendingSecretEnc');
  if (u.twoFactor.enabled) throw new HttpError(409, 'two_factor_on', 'Two-factor login is already on');
  if (!u.twoFactor.pendingSecretEnc) throw new HttpError(409, 'no_setup', 'Start setting up two-factor login first');
  const step = verifyTotp(decryptSecret(u.twoFactor.pendingSecretEnc, config.jwt.secret), code.replace(/\s/g, ''));
  if (step === null) throw fieldError('code', 'That code doesn’t match. Check your phone sets its time automatically, and try the newest code.');
  const { codes, stored } = freshCodes();
  await User.updateOne({ _id: u._id }, {
    $set: {
      'twoFactor.enabled': true, 'twoFactor.enabledAt': new Date(), 'twoFactor.secretEnc': u.twoFactor.pendingSecretEnc,
      'twoFactor.pendingSecretEnc': null, 'twoFactor.lastStep': step, 'twoFactor.backupCodes': stored,
      'twoFactor.failures': 0, 'twoFactor.failuresSince': null,
    },
  });
  return { backupCodes: codes };
}

// Turning it off needs the password and a current code (or a backup code).
export async function disableTwoFactor(user, { password, code }) {
  await checkPassword(user, password);
  const u = await withSecondFactor(user._id);
  if (!u.twoFactor.enabled) throw new HttpError(409, 'two_factor_off', 'Two-factor login is already off');
  await useSecondFactor(u, code);
  await User.updateOne({ _id: u._id }, {
    $set: { 'twoFactor.enabled': false, 'twoFactor.enabledAt': null, 'twoFactor.secretEnc': null, 'twoFactor.backupCodes': [], 'twoFactor.lastStep': -1 },
  });
}

// New backup codes (the old ones stop working); needs a current code.
export async function regenerateBackupCodes(user, { code }) {
  const u = await withSecondFactor(user._id);
  if (!u.twoFactor.enabled) throw new HttpError(409, 'two_factor_off', 'Turn on two-factor login first');
  await useSecondFactor(u, code);
  const { codes, stored } = freshCodes();
  await User.updateOne({ _id: u._id }, { $set: { 'twoFactor.backupCodes': stored } });
  return { backupCodes: codes };
}

// App lock

const lockView = (u) => ({
  enabled: u.appLock.enabled,
  timeoutMinutes: u.appLock.timeoutMinutes,
  passkeys: u.appLock.passkeys.map((p) => ({ id: String(p._id), label: p.label, createdAt: p.createdAt, lastUsedAt: p.lastUsedAt })),
});

export async function lockStatus(user) {
  return lockView(await User.findById(user._id));
}

// Turns the lock on or changes its PIN or timeout (always with the account password).
export async function setLock(user, session, { password, pin, timeoutMinutes }) {
  await checkPassword(user, password);
  const withPin = await User.findById(user._id).select('+appLock.pinHash');
  if (!pin && !withPin.appLock.pinHash) throw fieldError('pin', 'Choose a PIN of 4 to 8 digits');
  const $set = { 'appLock.enabled': true };
  if (pin) $set['appLock.pinHash'] = await bcrypt.hash(pin, config.bcryptRounds);
  if (timeoutMinutes) $set['appLock.timeoutMinutes'] = timeoutMinutes;
  await User.updateOne({ _id: user._id }, { $set });
  // This device stays unlocked while it's being set up.
  await Session.updateOne({ _id: session._id }, { $set: { locked: false, lockFailures: 0, lastActiveAt: new Date() } });
  return lockStatus(user);
}

export async function disableLock(user, { password }) {
  await checkPassword(user, password);
  await User.updateOne({ _id: user._id }, { $set: { 'appLock.enabled': false, 'appLock.pinHash': null, 'appLock.passkeys': [] } });
  await Session.updateMany({ user: user._id }, { $set: { locked: false, lockFailures: 0 } });
  return lockStatus(user);
}

export async function lockNow(user, session) {
  if (!user.appLock?.enabled) throw new HttpError(409, 'lock_off', 'App lock is off');
  await Session.updateOne({ _id: session._id }, { $set: { locked: true } });
}

async function unlocked(session) {
  await Session.updateOne({ _id: session._id }, { $set: { locked: false, lockFailures: 0, lastActiveAt: new Date(), challenge: null } });
}

// A wrong PIN counts against this device; too many signs it out, so the password is needed again.
export async function unlockWithPin(user, session, { pin }) {
  const u = await User.findById(user._id).select('+appLock.pinHash');
  if (!u.appLock.enabled || !u.appLock.pinHash) throw new HttpError(409, 'lock_off', 'App lock is off');
  if (await bcrypt.compare(pin, u.appLock.pinHash)) return unlocked(session);
  const { lockFailures } = await Session.findOneAndUpdate({ _id: session._id }, { $inc: { lockFailures: 1 } }, { returnDocument: 'after' });
  if (lockFailures >= MAX_PIN_FAILURES) {
    await endSession(session);
    throw new HttpError(401, 'locked_out', 'Too many wrong PINs, so this device was signed out. Sign in again with your password.');
  }
  const left = MAX_PIN_FAILURES - lockFailures;
  throw new HttpError(400, 'wrong_pin', `Wrong PIN. ${left} ${left === 1 ? 'try' : 'tries'} left before this device is signed out.`);
}

// Fingerprint (passkey) unlock: the browser proves the person is there with the device's own sensor.
async function storeChallenge(session, value, purpose) {
  await Session.updateOne({ _id: session._id }, { $set: { challenge: { value, purpose, expiresAt: new Date(Date.now() + CHALLENGE_MS) } } });
}
async function takeChallenge(session, purpose) {
  const s = await Session.findOneAndUpdate({ _id: session._id }, { $set: { challenge: null } });
  const c = s?.challenge;
  if (!c || c.purpose !== purpose || c.expiresAt < new Date()) throw new HttpError(400, 'challenge_expired', 'That took too long. Try again.');
  return c.value;
}

export async function passkeyRegistrationOptions(user, session) {
  if (!user.appLock?.enabled) throw new HttpError(409, 'lock_off', 'Turn on app lock with a PIN first; the PIN stays as the fallback');
  const options = await generateRegistrationOptions({
    rpName: 'Spendwise',
    rpID: config.webauthn.rpId,
    userName: user.email,
    userDisplayName: user.name,
    userID: new TextEncoder().encode(String(user._id)),
    attestationType: 'none',
    excludeCredentials: user.appLock.passkeys.map((p) => ({ id: p.credentialId, transports: p.transports })),
    authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'discouraged', userVerification: 'required' },
  });
  await storeChallenge(session, options.challenge, 'register');
  return options;
}

export async function addPasskey(user, session, { response, label }) {
  const expectedChallenge = await takeChallenge(session, 'register');
  let result;
  try {
    result = await verifyRegistrationResponse({
      response, expectedChallenge, expectedOrigin: config.webauthn.origins, expectedRPID: config.webauthn.rpId, requireUserVerification: true,
    });
  } catch (err) {
    throw new HttpError(400, 'passkey_failed', `The fingerprint couldn't be set up: ${err.message}`);
  }
  if (!result.verified) throw new HttpError(400, 'passkey_failed', 'The fingerprint couldn’t be set up');
  const { credential } = result.registrationInfo;
  await User.updateOne({ _id: user._id }, {
    $push: {
      'appLock.passkeys': {
        credentialId: credential.id, publicKey: Buffer.from(credential.publicKey).toString('base64url'), counter: credential.counter,
        transports: response.response?.transports ?? [], label: label || deviceLabel(session.userAgent),
      },
    },
  });
  return lockStatus(user);
}

export async function removePasskey(user, id) {
  const res = mongoose.isValidObjectId(id) ? await User.updateOne({ _id: user._id }, { $pull: { 'appLock.passkeys': { _id: id } } }) : null;
  if (!res?.modifiedCount) throw new HttpError(404, 'passkey_not_found', 'That fingerprint isn’t set up');
  return lockStatus(user);
}

export async function passkeyUnlockOptions(user, session) {
  if (!user.appLock?.enabled || !user.appLock.passkeys.length) throw new HttpError(409, 'no_passkey', 'No fingerprint is set up; use your PIN');
  const options = await generateAuthenticationOptions({
    rpID: config.webauthn.rpId,
    allowCredentials: user.appLock.passkeys.map((p) => ({ id: p.credentialId, transports: p.transports })),
    userVerification: 'required',
  });
  await storeChallenge(session, options.challenge, 'unlock');
  return options;
}

export async function unlockWithPasskey(user, session, { response }) {
  const expectedChallenge = await takeChallenge(session, 'unlock');
  const key = user.appLock.passkeys.find((p) => p.credentialId === response?.id);
  if (!key) throw new HttpError(400, 'passkey_failed', 'That fingerprint isn’t set up for this account. Use your PIN.');
  let result;
  try {
    result = await verifyAuthenticationResponse({
      response, expectedChallenge, expectedOrigin: config.webauthn.origins, expectedRPID: config.webauthn.rpId, requireUserVerification: true,
      credential: { id: key.credentialId, publicKey: Buffer.from(key.publicKey, 'base64url'), counter: key.counter, transports: key.transports },
    });
  } catch (err) {
    throw new HttpError(400, 'passkey_failed', `The fingerprint check failed: ${err.message}`);
  }
  if (!result.verified) throw new HttpError(400, 'passkey_failed', 'The fingerprint check failed');
  await User.updateOne({ _id: user._id, 'appLock.passkeys._id': key._id }, {
    $set: { 'appLock.passkeys.$.counter': result.authenticationInfo.newCounter, 'appLock.passkeys.$.lastUsedAt': new Date() },
  });
  await unlocked(session);
}

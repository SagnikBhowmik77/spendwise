import * as auth from '../services/auth.service.js';
import * as security from '../services/security.service.js';

// Controllers translate HTTP <-> service calls; all rules live in the service.
const client = auth.clientInfo;

export async function register(req, res) {
  const { user, token } = await auth.register(req.valid.body, client(req));
  res.status(201).json({ token, user });
}

// Either { token, user } or, with two-factor on, { twoFactorRequired, challenge } for the code step.
export async function login(req, res) {
  res.json(await auth.login(req.valid.body, client(req)));
}

export async function loginTwoFactor(req, res) {
  res.json(await auth.loginTwoFactor(req.valid.body, client(req)));
}

// `locked` tells the app to show the lock screen before anything else.
export function me(req, res) {
  res.json({ user: req.user, locked: req.locked });
}

export async function updateMe(req, res) {
  const user = await auth.updateProfile(req.user, req.valid.body);
  res.json({ user });
}

export async function logout(req, res) {
  await auth.endSession(req.authSession);
  res.status(204).end();
}

export async function logoutAll(req, res) {
  await auth.logoutAll(req.user);
  res.status(204).end();
}

export async function changePassword(req, res) {
  const { user, token } = await auth.changePassword(req.user, req.valid.body, client(req));
  res.json({ token, user });
}

export async function deleteMe(req, res) {
  await auth.deleteAccount(req.user, req.valid.body);
  res.status(204).end();
}

// Batch 12I: devices, two-factor login and the app lock.
export const sessions = async (req, res) => res.json({ sessions: await security.listSessions(req.user, req.authSession) });
export const revokeSession = async (req, res) => { await security.revokeSession(req.user, req.params.id); res.status(204).end(); };
export const revokeOthers = async (req, res) => res.json({ signedOut: await security.revokeOthers(req.user, req.authSession) });

export const twoFactorStatus = async (req, res) => res.json(await security.twoFactorStatus(req.user));
export const twoFactorSetup = async (req, res) => res.json(await security.startTwoFactor(req.user));
export const twoFactorEnable = async (req, res) => res.json(await security.confirmTwoFactor(req.user, req.valid.body));
export const twoFactorDisable = async (req, res) => { await security.disableTwoFactor(req.user, req.valid.body); res.status(204).end(); };
export const backupCodes = async (req, res) => res.json(await security.regenerateBackupCodes(req.user, req.valid.body));

export const lockStatus = async (req, res) => res.json(await security.lockStatus(req.user));
export const setLock = async (req, res) => res.json(await security.setLock(req.user, req.authSession, req.valid.body));
export const disableLock = async (req, res) => res.json(await security.disableLock(req.user, req.valid.body));
export const lockNow = async (req, res) => { await security.lockNow(req.user, req.authSession); res.status(204).end(); };
export const unlockPin = async (req, res) => { await security.unlockWithPin(req.user, req.authSession, req.valid.body); res.status(204).end(); };
export const passkeyOptions = async (req, res) => res.json(await security.passkeyRegistrationOptions(req.user, req.authSession));
export const addPasskey = async (req, res) => res.status(201).json(await security.addPasskey(req.user, req.authSession, req.valid.body));
export const removePasskey = async (req, res) => res.json(await security.removePasskey(req.user, req.params.id));
export const unlockOptions = async (req, res) => res.json(await security.passkeyUnlockOptions(req.user, req.authSession));
export const unlockPasskey = async (req, res) => { await security.unlockWithPasskey(req.user, req.authSession, req.valid.body); res.status(204).end(); };

// Email links. "Forgot password" answers 202 whether or not the address has an account.
export async function forgotPassword(req, res) {
  await auth.requestPasswordReset(req.valid.body);
  res.status(202).json({ ok: true });
}
export const resetPassword = async (req, res) => { await auth.resetPassword(req.valid.body); res.status(204).end(); };
export const sendVerification = async (req, res) => res.json(await auth.sendVerification(req.user));
export const verifyEmail = async (req, res) => res.json(await auth.verifyEmail(req.valid.body));
export const dismissChecklist = async (req, res) => res.json({ user: await auth.dismissChecklist(req.user) });

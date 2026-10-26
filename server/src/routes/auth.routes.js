import { Router } from 'express';
import { HttpError } from '../errors.js';
import { requireDb } from '../db.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { createAuthLimiters } from '../middleware/rateLimits.js';
import { authConfigured } from '../services/auth.service.js';
import * as ctrl from '../controllers/auth.controller.js';
import {
  registerSchema, loginSchema, updateProfileSchema, changePasswordSchema, deleteAccountSchema, loginTwoFactorSchema,
  twoFactorCodeSchema, twoFactorDisableSchema, setLockSchema, disableLockSchema, unlockPinSchema, addPasskeySchema, unlockPasskeySchema,
  forgotPasswordSchema, resetPasswordSchema, verifyEmailSchema,
} from '../schemas/auth.schemas.js';

export function authRouter() {
  const router = Router();
  const limit = createAuthLimiters();

  router.use((_req, _res, next) => {
    if (!authConfigured()) return next(new HttpError(503, 'auth_not_configured', 'Login is not configured on this server'));
    next();
  });
  router.use(requireDb);

  router.post('/register', limit.register, validate({ body: registerSchema }), ctrl.register);
  router.post('/login', limit.login, validate({ body: loginSchema }), ctrl.login);
  // Wrong codes count towards the same failed-login limit.
  router.post('/login/2fa', limit.login, validate({ body: loginTwoFactorSchema }), ctrl.loginTwoFactor);

  // Email links: forgot password and confirming the address (both work signed out; the link is the proof).
  router.post('/password/forgot', limit.emailLink, validate({ body: forgotPasswordSchema }), ctrl.forgotPassword);
  router.post('/password/reset', limit.emailLink, validate({ body: resetPasswordSchema }), ctrl.resetPassword);
  router.post('/verify-email', limit.emailLink, validate({ body: verifyEmailSchema }), ctrl.verifyEmail);
  router.post('/verify-email/send', requireAuth, ctrl.sendVerification);
  router.post('/checklist/dismiss', requireAuth, ctrl.dismissChecklist);

  router.get('/me', requireAuth, ctrl.me);
  router.patch('/me', requireAuth, validate({ body: updateProfileSchema }), ctrl.updateMe);
  router.delete('/me', requireAuth, validate({ body: deleteAccountSchema }), ctrl.deleteMe);
  router.post('/logout', requireAuth, ctrl.logout);
  router.post('/logout-all', requireAuth, ctrl.logoutAll);
  router.post('/password', requireAuth, validate({ body: changePasswordSchema }), ctrl.changePassword);

  // Signed-in devices.
  router.get('/sessions', requireAuth, ctrl.sessions);
  router.post('/sessions/sign-out-others', requireAuth, ctrl.revokeOthers);
  router.delete('/sessions/:id', requireAuth, ctrl.revokeSession);

  // Two-factor login with an authenticator app.
  router.get('/2fa', requireAuth, ctrl.twoFactorStatus);
  router.post('/2fa/setup', requireAuth, ctrl.twoFactorSetup);
  router.post('/2fa/enable', requireAuth, validate({ body: twoFactorCodeSchema }), ctrl.twoFactorEnable);
  router.post('/2fa/disable', requireAuth, validate({ body: twoFactorDisableSchema }), ctrl.twoFactorDisable);
  router.post('/2fa/backup-codes', requireAuth, validate({ body: twoFactorCodeSchema }), ctrl.backupCodes);

  // App lock: PIN or fingerprint after a while without use.
  router.get('/lock', requireAuth, ctrl.lockStatus);
  router.put('/lock', requireAuth, validate({ body: setLockSchema }), ctrl.setLock);
  router.post('/lock/disable', requireAuth, validate({ body: disableLockSchema }), ctrl.disableLock);
  router.post('/lock/now', requireAuth, ctrl.lockNow);
  router.post('/lock/unlock', requireAuth, validate({ body: unlockPinSchema }), ctrl.unlockPin);
  router.post('/lock/unlock/options', requireAuth, ctrl.unlockOptions);
  router.post('/lock/unlock/passkey', requireAuth, validate({ body: unlockPasskeySchema }), ctrl.unlockPasskey);
  router.post('/lock/passkeys/options', requireAuth, ctrl.passkeyOptions);
  router.post('/lock/passkeys', requireAuth, validate({ body: addPasskeySchema }), ctrl.addPasskey);
  router.delete('/lock/passkeys/:id', requireAuth, ctrl.removePasskey);

  return router;
}

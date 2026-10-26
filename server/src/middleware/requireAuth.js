import { HttpError } from '../errors.js';
import { Session } from '../models/index.js';
import { clientInfo, verifyToken } from '../services/auth.service.js';
import { TOKEN_PREFIX, verifyApiToken } from '../services/apiToken.service.js';

// While the app is locked, only these work: who am I, sign out, and unlocking.
const LOCK_FREE = /^\/api\/auth\/(me|logout|lock\/unlock(\/[a-z-]+)?)$/;
const SEEN_EVERY_MS = 60_000;
const ACTIVE_EVERY_MS = 15_000;
// Personal API tokens work on the money data, not on the account itself or its connections.
const TOKEN_BLOCKED = /^\/api\/(auth|backup|integrations|spaces|invites|notifications)(\/|$)/;

// Protects a route: needs "Authorization: Bearer <token>". Sets req.user (the User document), req.auth (token
// claims) and req.authSession (this device's session). With app lock on, a device left alone longer than the
// chosen time (or locked by the app) gets 423 until it is unlocked.
export async function requireAuth(req, _res, next) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return next(new HttpError(401, 'auth_required', 'Please log in to continue'));
  }
  if (token.startsWith(TOKEN_PREFIX)) {
    const { user, token: apiToken } = await verifyApiToken(token);
    if (TOKEN_BLOCKED.test(req.originalUrl.split('?')[0])) {
      return next(new HttpError(403, 'token_not_allowed', 'API tokens can’t be used for account, security or sharing settings. Sign in to the app for those.'));
    }
    if (apiToken.scope === 'read' && !['GET', 'HEAD'].includes(req.method)) {
      return next(new HttpError(403, 'read_only_token', 'This API token can only read. Make a read-and-write token to change data.'));
    }
    req.user = user;
    req.apiToken = apiToken;
    req.auth = null;
    req.authSession = null;
    req.locked = false;
    return next();
  }
  const client = clientInfo(req);
  const { user, claims, session } = await verifyToken(token, client);
  req.user = user;
  req.auth = claims;
  req.authSession = session;
  const now = Date.now();
  const lockFree = LOCK_FREE.test(req.originalUrl.split('?')[0]);
  req.locked = false;
  if (user.appLock?.enabled) {
    const idle = now - session.lastActiveAt > user.appLock.timeoutMinutes * 60_000;
    if (session.locked || idle) {
      req.locked = true;
      if (!session.locked) await Session.updateOne({ _id: session._id }, { $set: { locked: true } });
      if (!lockFree) return next(new HttpError(423, 'app_locked', 'Spendwise is locked. Unlock it with your PIN or fingerprint.'));
    }
  }
  const $set = {};
  if (now - session.lastSeenAt > SEEN_EVERY_MS) Object.assign($set, { lastSeenAt: new Date(now), ip: client.ip });
  if (!lockFree && now - session.lastActiveAt > ACTIVE_EVERY_MS) $set.lastActiveAt = new Date(now);
  if (Object.keys($set).length) await Session.updateOne({ _id: session._id }, { $set });
  next();
}

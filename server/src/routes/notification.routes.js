import { Router } from 'express';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { config } from '../config.js';
import { requireDb } from '../db.js';
import { HttpError } from '../errors.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/requireAuth.js';
import * as ctrl from '../controllers/notification.controller.js';

// The server sends requests to subscription endpoints, so only the real browser push services are accepted
// (Chrome/Android, Firefox, Safari, Edge). Tests use a local stub.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /\.notify\.windows\.com$/];
const endpoint = z.string().max(1000).refine((value) => {
  try {
    const url = new URL(value);
    if (config.env === 'test' && url.protocol === 'http:' && url.hostname === '127.0.0.1') return true;
    return url.protocol === 'https:' && PUSH_HOSTS.some((re) => re.test(url.hostname));
  } catch {
    return false;
  }
}, 'This browser\'s push service is not supported');
const key = (max) => z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/, 'Invalid key').max(max);

const subscribeSchema = z.object({ endpoint, keys: z.object({ p256dh: key(200), auth: key(100) }) });
const unsubscribeSchema = z.object({ endpoint: z.string().max(1000) });
const settingsSchema = z
  .object({
    budgetPush: z.boolean(),
    budgetEmail: z.boolean(),
    billPush: z.boolean(),
    billEmail: z.boolean(),
    reminder: z.boolean(),
    loginEmail: z.boolean(),
    reminderTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:MM'),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Send at least one setting to change');

export function notificationRouter() {
  const router = Router();
  router.use(requireDb, requireAuth);

  const testLimit = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 10,
    keyGenerator: (req) => String(req.user._id),
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) => next(new HttpError(429, 'rate_limited', 'You can send 10 test notifications an hour. Try again later.')),
  });

  router.get('/settings', ctrl.getSettings);
  router.patch('/settings', validate({ body: settingsSchema }), ctrl.updateSettings);
  router.post('/subscriptions', validate({ body: subscribeSchema }), ctrl.subscribe);
  router.delete('/subscriptions', validate({ body: unsubscribeSchema }), ctrl.unsubscribe);
  router.post('/test', testLimit, ctrl.sendTest);
  return router;
}

import { Router } from 'express';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { requireDb } from '../db.js';
import { HttpError } from '../errors.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { isMonth, currentMonth } from '../money.js';
import * as ctrl from '../controllers/report.controller.js';

// A finished or current month; reports can't describe the future.
const month = z
  .string()
  .refine(isMonth, 'Month must be in YYYY-MM format')
  .refine((m) => m >= '2000-01' && m <= currentMonth(), 'Month must be between 2000-01 and this month');

const settingsSchema = z.object({ enabled: z.boolean({ error: 'enabled must be true or false' }) });

export function reportRouter() {
  const router = Router();
  router.use(requireDb, requireAuth);

  // Test emails go to the user's own address; this cap stops a stuck button from flooding it.
  const testLimit = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    keyGenerator: (req) => String(req.user._id),
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) => next(new HttpError(429, 'rate_limited', 'You can send 5 test emails an hour. Try again later.')),
  });

  router.get('/settings', ctrl.getSettings);
  router.patch('/settings', validate({ body: settingsSchema }), ctrl.updateSettings);
  router.get('/preview', validate({ query: z.object({ month: month.optional() }) }), ctrl.preview);
  router.post('/send-test', testLimit, validate({ body: z.object({ month: month.optional() }) }), ctrl.sendTest);

  return router;
}

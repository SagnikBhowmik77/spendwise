import { Router } from 'express';
import { requireDb } from '../db.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireSpace } from '../middleware/requireSpace.js';
import * as ctrl from '../controllers/stats.controller.js';
import { summaryQuery, byCategoryQuery, seriesQuery } from '../schemas/stats.schemas.js';

export function statsRouter() {
  const router = Router();
  router.use(requireDb, requireAuth, requireSpace);

  router.get('/summary', validate({ query: summaryQuery }), ctrl.summary);
  router.get('/by-category', validate({ query: byCategoryQuery }), ctrl.byCategory);
  router.get('/by-payment-method', validate({ query: byCategoryQuery }), ctrl.byPaymentMethod);
  router.get('/monthly', validate({ query: seriesQuery }), ctrl.monthly);
  router.get('/daily', validate({ query: seriesQuery }), ctrl.daily);

  return router;
}

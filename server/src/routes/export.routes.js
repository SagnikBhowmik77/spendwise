import { Router } from 'express';
import { z } from 'zod';
import { requireDb } from '../db.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireSpace } from '../middleware/requireSpace.js';
import * as ctrl from '../controllers/export.controller.js';
import { filterFields, fromBeforeTo } from '../schemas/transaction.schemas.js';

// Same filters as the list, so "export" always gives exactly what is on screen.
const exportQuery = z
  .object({ ...filterFields, sort: z.enum(['date', '-date', 'amount', '-amount']).default('-date') })
  .refine(...fromBeforeTo);

export function exportRouter() {
  const router = Router();
  router.use(requireDb, requireAuth, requireSpace);
  router.get('/transactions.csv', validate({ query: exportQuery }), ctrl.csv);
  router.get('/transactions.pdf', validate({ query: exportQuery }), ctrl.pdf);
  return router;
}

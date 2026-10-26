import { Router } from 'express';
import { requireDb } from '../db.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireSpace } from '../middleware/requireSpace.js';
import * as ctrl from '../controllers/budget.controller.js';
import {
  upsertBudgetSchema, updateBudgetSchema, listBudgetsQuery, copyBudgetsSchema, historyQuery, upsertWeeklySchema, weeklyQuery,
} from '../schemas/budget.schemas.js';

export function budgetRouter() {
  const router = Router();
  router.use(requireDb, requireAuth, requireSpace);

  router.get('/', validate({ query: listBudgetsQuery }), ctrl.list);
  router.put('/', validate({ body: upsertBudgetSchema }), ctrl.upsert);
  router.get('/history', validate({ query: historyQuery }), ctrl.history);
  router.post('/copy', validate({ body: copyBudgetsSchema }), ctrl.copy);
  router.get('/weekly', validate({ query: weeklyQuery }), ctrl.weekly);
  router.put('/weekly', validate({ body: upsertWeeklySchema }), ctrl.upsertWeekly);
  router.delete('/weekly/:id', ctrl.removeWeekly);
  router.patch('/:id', validate({ body: updateBudgetSchema }), ctrl.update);
  router.delete('/:id', ctrl.remove);

  return router;
}

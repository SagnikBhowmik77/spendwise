import { Router } from 'express';
import { requireDb } from '../db.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireSpace } from '../middleware/requireSpace.js';
import * as ctrl from '../controllers/recurring.controller.js';
import { createRecurringSchema, updateRecurringSchema, upcomingQuery } from '../schemas/recurring.schemas.js';

export function recurringRouter() {
  const router = Router();
  router.use(requireDb, requireAuth, requireSpace);

  router.get('/', ctrl.list);
  router.post('/', validate({ body: createRecurringSchema }), ctrl.create);
  router.get('/upcoming', validate({ query: upcomingQuery }), ctrl.upcoming);
  router.get('/:id', ctrl.get);
  router.patch('/:id', validate({ body: updateRecurringSchema }), ctrl.update);
  router.delete('/:id', ctrl.remove);

  return router;
}

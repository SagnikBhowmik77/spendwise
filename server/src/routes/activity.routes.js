import { Router } from 'express';
import { requireDb } from '../db.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireSpace } from '../middleware/requireSpace.js';
import * as ctrl from '../controllers/activity.controller.js';
import { activityQuery } from '../schemas/space.schemas.js';

export function activityRouter() {
  const router = Router();
  router.use(requireDb, requireAuth, requireSpace);
  router.get('/', validate({ query: activityQuery }), ctrl.list);
  router.post('/:id/revert', ctrl.revert);
  return router;
}

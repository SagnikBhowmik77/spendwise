import { Router } from 'express';
import { requireDb } from '../db.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireSpace } from '../middleware/requireSpace.js';
import * as ctrl from '../controllers/account.controller.js';
import { createAccountSchema, listAccountsQuery, updateAccountSchema } from '../schemas/account.schemas.js';

export function accountRouter() {
  const router = Router();
  router.use(requireDb, requireAuth, requireSpace);
  router.get('/', validate({ query: listAccountsQuery }), ctrl.list);
  router.post('/', validate({ body: createAccountSchema }), ctrl.create);
  router.patch('/:id', validate({ body: updateAccountSchema }), ctrl.update);
  router.delete('/:id', ctrl.remove);
  router.get('/:id/cycle', ctrl.cycle);
  return router;
}

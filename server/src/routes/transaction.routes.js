import { Router } from 'express';
import { requireDb } from '../db.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireSpace } from '../middleware/requireSpace.js';
import * as ctrl from '../controllers/transaction.controller.js';
import {
  createTransactionSchema, updateTransactionSchema, listTransactionsQuery,
} from '../schemas/transaction.schemas.js';

export function transactionRouter() {
  const router = Router();
  router.use(requireDb, requireAuth, requireSpace);

  router.get('/', validate({ query: listTransactionsQuery }), ctrl.list);
  router.post('/', validate({ body: createTransactionSchema }), ctrl.create);
  router.get('/:id', ctrl.get);
  router.patch('/:id', validate({ body: updateTransactionSchema }), ctrl.update);
  router.delete('/:id', ctrl.remove);
  router.post('/:id/restore', ctrl.restore);

  return router;
}

export function categoryRouter() {
  const router = Router();
  router.use(requireDb, requireAuth, requireSpace);
  router.get('/', ctrl.categories);
  return router;
}

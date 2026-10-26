import express, { Router } from 'express';
import { requireDb } from '../db.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireSpace } from '../middleware/requireSpace.js';
import * as ctrl from '../controllers/import.controller.js';
import { commitSchema, layoutSchema, previewSchema, ruleSchema } from '../schemas/import.schemas.js';

// Statements carry up to 5,000 lines, more than the API's usual 100 KB body.
export const IMPORT_BODY_LIMIT = '6mb';

// /api/imports: statement preview and import, undo, category rules and saved bank layouts.
export function importRouter() {
  const router = Router();
  router.use(express.json({ limit: IMPORT_BODY_LIMIT }));
  router.use(requireDb, requireAuth, requireSpace);
  router.post('/preview', validate({ body: previewSchema }), ctrl.preview);
  router.get('/', ctrl.list);
  router.post('/', validate({ body: commitSchema }), ctrl.commit);
  router.get('/rules', ctrl.listRules);
  router.post('/rules', validate({ body: ruleSchema }), ctrl.saveRule);
  router.delete('/rules/:id', ctrl.removeRule);
  router.get('/layouts', ctrl.listLayouts);
  router.put('/layouts', validate({ body: layoutSchema }), ctrl.saveLayout);
  router.delete('/layouts/:id', ctrl.removeLayout);
  router.delete('/:id', ctrl.undo);
  router.post('/:id/restore', ctrl.redo);
  return router;
}

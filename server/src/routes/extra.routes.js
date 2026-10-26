import express, { Router } from 'express';
import { requireDb } from '../db.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireSpace } from '../middleware/requireSpace.js';
import * as ctrl from '../controllers/extra.controller.js';
import { rateQuery, startTripSchema, updateTripSchema } from '../schemas/extra.schemas.js';
import { MAX_RECEIPT_BYTES } from '../services/receipt.service.js';

// /api/fx: currency list and rates (ECB, via Frankfurter).
export function fxRouter() {
  const router = Router();
  router.use(requireDb, requireAuth);
  router.get('/currencies', ctrl.currencies);
  router.get('/rate', validate({ query: rateQuery }), ctrl.rate);
  return router;
}

export function tagRouter() {
  const router = Router();
  router.use(requireDb, requireAuth, requireSpace);
  router.get('/', ctrl.tags);
  return router;
}

export function tripRouter() {
  const router = Router();
  router.use(requireDb, requireAuth, requireSpace);
  router.get('/', ctrl.listTrips);
  router.post('/', validate({ body: startTripSchema }), ctrl.startTrip);
  router.patch('/:id', validate({ body: updateTripSchema }), ctrl.updateTrip);
  router.delete('/:id', ctrl.deleteTrip);
  router.get('/:id/summary', ctrl.tripSummary);
  return router;
}

// Mounted on /api/transactions: the receipt photo of one entry. The body is the image itself.
export function receiptRouter() {
  const router = Router();
  router.use(requireDb, requireAuth, requireSpace);
  router.put('/:id/receipt', express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: MAX_RECEIPT_BYTES }), ctrl.uploadReceipt);
  router.get('/:id/receipt', ctrl.getReceipt);
  router.delete('/:id/receipt', ctrl.deleteReceipt);
  return router;
}

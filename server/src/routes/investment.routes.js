import { Router } from 'express';
import { requireDb } from '../db.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireSpace } from '../middleware/requireSpace.js';
import * as ctrl from '../controllers/investment.controller.js';
import * as s from '../schemas/investment.schemas.js';

export function investmentRouter() {
  const r = Router();
  r.use(requireDb, requireAuth, requireSpace);
  r.get('/', ctrl.list);
  r.get('/schemes', validate({ query: s.schemeQuery }), ctrl.schemes);
  r.get('/timeline', validate({ query: s.timelineQuery }), ctrl.timeline);
  r.post('/', validate({ body: s.holdingCreate }), ctrl.create);
  r.get('/:id', ctrl.get);
  r.patch('/:id', validate({ body: s.holdingUpdate }), ctrl.update);
  r.delete('/:id', ctrl.remove);
  r.post('/:id/trades', validate({ body: s.trade }), ctrl.addTrade);
  r.delete('/:id/trades/:tradeId', ctrl.removeTrade);
  r.put('/:id/sip', validate({ body: s.sip }), ctrl.setSip);
  r.delete('/:id/sip', ctrl.stopSip);
  r.post('/:id/deposits', validate({ body: s.deposit }), ctrl.addDeposit);
  r.delete('/:id/deposits/:depositId', ctrl.removeDeposit);
  r.post('/:id/passbook', validate({ body: s.passbook }), ctrl.addPassbook);
  r.delete('/:id/passbook/:entryId', ctrl.removePassbook);
  return r;
}

import { Router } from 'express';
import { requireDb } from '../db.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireSpace } from '../middleware/requireSpace.js';
import * as ctrl from '../controllers/insight.controller.js';
import * as s from '../schemas/insight.schemas.js';

const spaceRouter = () => {
  const router = Router();
  router.use(requireDb, requireAuth, requireSpace);
  return router;
};

// /api/insights: read-only analysis of the space's entries.
export function insightRouter() {
  const r = spaceRouter();
  r.get('/forecast', ctrl.forecast);
  r.get('/unusual', validate({ query: s.monthQuery }), ctrl.unusual);
  r.get('/savings-rate', validate({ query: s.monthsQuery(36, 12) }), ctrl.savingsRate);
  r.get('/patterns', validate({ query: s.rangeQuery }), ctrl.patterns);
  r.get('/compare', validate({ query: s.compareQuery }), ctrl.compare);
  r.get('/merchants', validate({ query: s.rangeQuery }), ctrl.merchants);
  r.get('/merchants/:name', ctrl.merchant);
  r.get('/subscriptions', ctrl.subscriptions);
  r.get('/year', validate({ query: s.yearQuery }), ctrl.year);
  r.get('/inflation', validate({ query: s.monthsQuery(60, 24) }), ctrl.inflation);
  r.get('/regret', validate({ query: s.monthsQuery(24, 3) }), ctrl.regret);
  r.get('/streaks', ctrl.streaks);
  r.get('/achievements', ctrl.achievements);
  return r;
}

export function challengeRouter() {
  const r = spaceRouter();
  r.get('/', ctrl.listChallenges);
  r.post('/', validate({ body: s.challengeBody }), ctrl.startChallenge);
  r.post('/:id/stop', ctrl.stopChallenge);
  return r;
}

export function savedReportRouter() {
  const r = spaceRouter();
  r.get('/', ctrl.listReports);
  r.post('/', validate({ body: s.reportBody }), ctrl.createReport);
  r.post('/preview', validate({ body: s.reportPreview }), ctrl.previewReport);
  r.put('/:id', validate({ body: s.reportBody }), ctrl.updateReport);
  r.delete('/:id', ctrl.deleteReport);
  r.get('/:id/run', ctrl.runReport);
  return r;
}

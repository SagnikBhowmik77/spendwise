import { Router } from 'express';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { requireDb } from '../db.js';
import { HttpError } from '../errors.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireSpace } from '../middleware/requireSpace.js';
import * as ctrl from '../controllers/space.controller.js';
import * as approvals from '../services/approval.service.js';
import { inviteWithRoleSchema, memberUpdateSchema, spaceNameSchema, spaceSettingsSchema } from '../schemas/space.schemas.js';

export function spaceRouter() {
  const router = Router();
  router.use(requireDb, requireAuth);

  // Invites send email, so each user can send a limited number an hour.
  const inviteLimit = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 20,
    keyGenerator: (req) => String(req.user._id),
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) => next(new HttpError(429, 'rate_limited', 'Too many invites this hour. Try again later.')),
  });

  router.get('/', ctrl.list);
  router.get('/current', requireSpace, ctrl.current);
  router.post('/', validate({ body: spaceNameSchema }), ctrl.create);
  router.patch('/:id', validate({ body: spaceNameSchema }), ctrl.rename);
  router.delete('/:id', ctrl.remove);
  router.post('/:id/invites', inviteLimit, validate({ body: inviteWithRoleSchema }), ctrl.invite);
  router.patch('/:id/settings', validate({ body: spaceSettingsSchema }), ctrl.updateSettings);
  router.patch('/:id/members/:userId', validate({ body: memberUpdateSchema }), ctrl.updateMember);
  router.delete('/:id/invites/:inviteId', ctrl.revokeInvite);
  router.delete('/:id/members/:userId', ctrl.removeMember);
  return router;
}

// /api/invites/:token: anyone with the link can see what it's for; accepting needs the invited account.
export function inviteRouter() {
  const router = Router();
  router.use(requireDb);
  router.get('/:token', ctrl.getInvite);
  router.post('/:token/accept', requireAuth, ctrl.acceptInvite);
  return router;
}

// /api/approvals (batch 12R): big expenses waiting for the owner of the current space.
export function approvalRouter() {
  const router = Router();
  router.use(requireDb, requireAuth, requireSpace);
  router.get('/', async (req, res) => res.json(await approvals.list(req.space._id)));
  router.post('/:id', validate({ body: z.object({ decision: z.enum(['approve', 'reject'], { error: 'Approve or reject' }) }) }),
    async (req, res) => res.json(await approvals.decide({ space: req.space, user: req.user }, req.params.id, req.valid.body)));
  return router;
}

import express, { Router } from 'express';
import { z } from 'zod';
import { requireDb } from '../db.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireSpace } from '../middleware/requireSpace.js';
import { config } from '../config.js';
import { dayString } from '../money.js';
import { todayIn } from '../schedule.js';
import { exportSpace, restore } from '../services/backup.service.js';

// A year or two of entries is a few MB of JSON, more than the API's usual 100 KB body.
export const BACKUP_BODY_LIMIT = '20mb';
const restoreSchema = z.object({
  password: z.string().min(1, 'Password is required'),
  backup: z.object({ app: z.string(), format: z.number(), data: z.record(z.string(), z.unknown()) }).passthrough(),
});

// /api/backup: download everything in the space as JSON, or replace it with a backup.
export function backupRouter() {
  const router = Router();
  router.use(express.json({ limit: BACKUP_BODY_LIMIT }));
  router.use(requireDb, requireAuth, requireSpace);
  router.get('/', async (req, res) => {
    const backup = await exportSpace(req.space);
    const name = req.space.kind === 'personal' ? 'personal' : req.space.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'space';
    res.set({
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="spendwise-backup-${name}-${dayString(todayIn(config.timeZone))}.json"`,
    });
    res.send(JSON.stringify(backup, null, 1));
  });
  router.post('/restore', validate({ body: restoreSchema }), async (req, res) => {
    res.json(await restore({ space: req.space, user: req.user }, req.valid.body));
  });
  return router;
}

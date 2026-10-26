import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { requireDb } from '../db.js';
import { HttpError } from '../errors.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireSpace } from '../middleware/requireSpace.js';
import { TOKEN_SCOPES, WEBHOOK_EVENTS } from '../models/index.js';
import * as tokens from '../services/apiToken.service.js';
import * as webhooks from '../services/webhook.service.js';
import * as google from '../services/google.service.js';
import * as telegram from '../services/telegram.service.js';
import * as calendar from '../services/calendar.service.js';
import { rateLimit } from 'express-rate-limit';

const tokenSchema = z.object({
  name: z.string().trim().min(1, 'Give the token a name, like “Home server”').max(60),
  scope: z.enum(TOKEN_SCOPES, { error: 'Read or write' }).default('read'),
  expiresInDays: z.coerce.number().int().min(1).max(3650).nullable().optional(),
});
const events = z.array(z.enum(WEBHOOK_EVENTS, { error: 'Unknown event' })).min(1, 'Pick at least one event').max(WEBHOOK_EVENTS.length);
const webhookSchema = z.object({ url: z.string().trim().min(1, 'Enter the address').max(500), events: events.default(WEBHOOK_EVENTS) });
const webhookUpdate = z.object({ url: z.string().trim().min(1).max(500), events, active: z.boolean() }).partial()
  .refine((v) => Object.keys(v).length > 0, 'Send at least one field to change');
const telegramUpdate = z.object({
  dailySummary: z.boolean(),
  summaryTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:MM'),
}).partial().refine((v) => Object.keys(v).length > 0, 'Send at least one field to change');

const ctx = (req) => ({ space: req.space, user: req.user });

// /api/integrations (batch 12J): API tokens, webhooks, Google Sheets and Telegram.
export function integrationRouter() {
  const r = Router();

  // Google sends the browser back here after the consent screen (the signed `state` says who it is).
  r.get('/google/callback', requireDb, async (req, res) => {
    res.redirect(`${config.appUrl}${await google.finishConnect(req.query)}`);
  });
  // Telegram posts new messages here once a webhook is set (after deploying).
  r.post('/telegram/webhook', requireDb, (req, res, next) => {
    if (!telegram.telegramConfigured() || req.get('x-telegram-bot-api-secret-token') !== telegram.webhookSecret()) {
      return next(new HttpError(401, 'not_telegram', 'Not from Telegram'));
    }
    res.json({ ok: true });
    telegram.handleUpdate(req.body).catch((err) => console.error('Telegram message failed:', err.message));
  });

  r.use(requireDb, requireAuth, requireSpace);

  r.get('/tokens', async (req, res) => res.json({ tokens: await tokens.list(req.user) }));
  r.post('/tokens', validate({ body: tokenSchema }), async (req, res) => res.status(201).json(await tokens.create(ctx(req), req.valid.body)));
  r.delete('/tokens/:id', async (req, res) => { await tokens.revoke(req.user, req.params.id); res.status(204).end(); });

  r.get('/webhooks', async (req, res) => res.json({ webhooks: await webhooks.list(req.space._id), events: WEBHOOK_EVENTS }));
  r.post('/webhooks', validate({ body: webhookSchema }), async (req, res) => res.status(201).json(await webhooks.create(ctx(req), req.valid.body)));
  r.patch('/webhooks/:id', validate({ body: webhookUpdate }), async (req, res) => res.json(await webhooks.update(req.space._id, req.params.id, req.valid.body)));
  r.delete('/webhooks/:id', async (req, res) => { await webhooks.remove(req.space._id, req.params.id); res.status(204).end(); });
  r.post('/webhooks/:id/secret', async (req, res) => res.json(await webhooks.rotateSecret(req.space._id, req.params.id)));
  r.post('/webhooks/:id/test', async (req, res) => res.json(await webhooks.test(req.space._id, req.params.id)));
  r.get('/webhooks/:id/deliveries', async (req, res) => res.json({ deliveries: await webhooks.deliveries(req.space._id, req.params.id) }));

  r.get('/google', async (req, res) => res.json(await google.status(req.space)));
  r.post('/google/start', async (req, res) => res.json({ url: google.startUrl(ctx(req)) }));
  r.post('/google/sync', async (req, res) => {
    const result = await google.syncSpace(req.space._id);
    if (!result) throw new HttpError(404, 'not_connected', 'Google Sheets isn’t connected for this space');
    res.json({ ...result, ...(await google.status(req.space)) });
  });
  r.delete('/google', async (req, res) => { await google.disconnect(req.space); res.status(204).end(); });

  r.get('/telegram', async (req, res) => res.json(await telegram.status(req.user)));
  r.post('/telegram/link', async (req, res) => res.status(201).json(await telegram.createLinkCode(ctx(req))));
  r.patch('/telegram/:id', validate({ body: telegramUpdate }), async (req, res) => res.json(await telegram.updateLink(req.user, req.params.id, req.valid.body)));
  r.delete('/telegram/:id', async (req, res) => { await telegram.unlink(req.user, req.params.id); res.status(204).end(); });

  // Batch 12S: the private calendar address, and the same calendar as a one-off file.
  r.get('/calendar', async (req, res) => res.json(await calendar.status(ctx(req))));
  r.post('/calendar', async (req, res) => res.status(201).json(await calendar.reset(ctx(req))));
  r.delete('/calendar', async (req, res) => { await calendar.remove(ctx(req)); res.status(204).end(); });
  r.get('/calendar/download', async (req, res) => {
    res.set('Content-Type', 'text/calendar; charset=utf-8').set('Content-Disposition', 'attachment; filename="spendwise.ics"');
    res.send(await calendar.icsFor(req.space, req.user));
  });

  return r;
}

// /api/calendar/<secret>.ics (batch 12S): what calendar apps subscribe to. The secret in the address is the login.
export function calendarFeedRouter() {
  const r = Router();
  r.use(rateLimit({
    windowMs: 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false,
    handler: (_req, _res, next) => next(new HttpError(429, 'rate_limited', 'Too many requests. Try again in a minute.')),
  }));
  r.get('/:file', requireDb, async (req, res, next) => {
    const m = calendar.FEED_FILE.exec(req.params.file);
    if (!m) return next(new HttpError(404, 'calendar_not_found', 'This calendar address is not valid any more'));
    const ics = await calendar.publicIcs(m[1]);
    res.set('Content-Type', 'text/calendar; charset=utf-8').set('Cache-Control', 'private, max-age=900').send(ics);
  });
  return r;
}

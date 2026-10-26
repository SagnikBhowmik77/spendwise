// Batch 12O: envelopes, sinking funds and the wishlist.
import { Router } from 'express';
import { z } from 'zod';
import { requireDb } from '../db.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireSpace } from '../middleware/requireSpace.js';
import { amount, day, entryDay, objectId } from '../schemas/transaction.schemas.js';
import * as b from '../services/budgeting.service.js';

const spaceRouter = () => {
  const router = Router();
  router.use(requireDb, requireAuth, requireSpace);
  return router;
};
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month looks like 2026-10');
const name = z.string().trim().min(1, 'Name is required').max(60, 'Up to 60 characters');
const category = z.string().trim().min(1).max(40);
const sid = (req) => req.space._id;

const envelopeSave = z.object({
  income: amount.nullable().optional(),
  envelopes: z.array(z.object({
    name,
    categories: z.array(category).max(20, 'Up to 20 categories').default([]),
    amount,
  })).max(30, 'Up to 30 envelopes'),
});

const fundFields = {
  name,
  amount,
  nextDue: day,
  everyMonths: z.coerce.number().int('Whole months').min(1, 'At least every month').max(120, 'At most every 10 years'),
  category: z.string().trim().max(40),
};
const fundCreate = z.object({ ...fundFields, everyMonths: fundFields.everyMonths.default(12), category: fundFields.category.optional() });
const fundUpdate = z.object(fundFields).partial().refine((v) => Object.keys(v).length > 0, 'Send at least one field to change');
const contribution = z.object({ direction: z.enum(['add', 'withdraw']).default('add'), amount, date: entryDay.optional() });
const payment = z.object({ amount: amount.optional(), date: entryDay.optional(), account: objectId().optional() });

const wishFields = {
  name,
  price: amount,
  url: z.union([z.literal(''), z.url('Enter a full link, starting with https://').max(500)]),
  note: z.string().trim().max(200, 'Up to 200 characters'),
  coolDays: z.coerce.number().int('Whole days').min(1, 'At least a day').max(365, 'At most a year'),
};
const wishCreate = z.object({ ...wishFields, url: wishFields.url.optional(), note: wishFields.note.optional(), coolDays: wishFields.coolDays.default(30) });
const wishUpdate = z.object(wishFields).partial().refine((v) => Object.keys(v).length > 0, 'Send at least one field to change');
const wishDecide = z.object({
  decision: z.enum(['bought', 'dropped']),
  early: z.boolean().optional(),
  amount: amount.optional(),
  date: entryDay.optional(),
  account: objectId().optional(),
  category: category.optional(),
});

export function envelopeRouter() {
  const r = spaceRouter();
  r.get('/', validate({ query: z.object({ month }) }), async (req, res) => res.json(await b.envelopes(sid(req), req.valid.query)));
  r.put('/', validate({ query: z.object({ month }), body: envelopeSave }), async (req, res) => res.json(await b.saveEnvelopes(sid(req), { ...req.valid.query, ...req.valid.body })));
  r.post('/copy', validate({ query: z.object({ month }) }), async (req, res) => res.status(201).json(await b.copyEnvelopes(sid(req), req.valid.query)));
  r.delete('/', validate({ query: z.object({ month }) }), async (req, res) => { await b.deleteEnvelopes(sid(req), req.valid.query); res.status(204).end(); });
  return r;
}

export function sinkingFundRouter() {
  const r = spaceRouter();
  r.get('/', async (req, res) => res.json(await b.listFunds(sid(req))));
  r.post('/', validate({ body: fundCreate }), async (req, res) => res.status(201).json({ fund: await b.createFund(req, req.valid.body) }));
  r.patch('/:id', validate({ body: fundUpdate }), async (req, res) => res.json({ fund: await b.updateFund(sid(req), req.params.id, req.valid.body) }));
  r.delete('/:id', async (req, res) => { await b.deleteFund(sid(req), req.params.id); res.status(204).end(); });
  r.post('/:id/contributions', validate({ body: contribution }), async (req, res) => res.status(201).json({ fund: await b.addContribution(sid(req), req.params.id, req.valid.body) }));
  r.post('/:id/paid', validate({ body: payment }), async (req, res) => res.json({ fund: await b.payFund(req, req.params.id, req.valid.body) }));
  return r;
}

export function wishlistRouter() {
  const r = spaceRouter();
  r.get('/', async (req, res) => res.json(await b.listWishes(sid(req))));
  r.post('/', validate({ body: wishCreate }), async (req, res) => res.status(201).json({ item: await b.createWish(req, req.valid.body) }));
  r.patch('/:id', validate({ body: wishUpdate }), async (req, res) => res.json({ item: await b.updateWish(sid(req), req.params.id, req.valid.body) }));
  r.delete('/:id', async (req, res) => { await b.deleteWish(sid(req), req.params.id); res.status(204).end(); });
  r.post('/:id/decide', validate({ body: wishDecide }), async (req, res) => res.json({ item: await b.decideWish(req, req.params.id, req.valid.body) }));
  return r;
}

// Batch 12P: vehicles, the vault, credit card rewards and the FIRE calculator.
import { Router } from 'express';
import { z } from 'zod';
import { requireDb } from '../db.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireSpace } from '../middleware/requireSpace.js';
import { FUELS, REWARD_TYPES, VAULT_KINDS, VEHICLE_KINDS } from '../models/index.js';
import { amount, day, entryDay, objectId } from '../schemas/transaction.schemas.js';
import * as life from '../services/life.service.js';

const spaceRouter = () => {
  const router = Router();
  router.use(requireDb, requireAuth, requireSpace);
  return router;
};
const sid = (req) => req.space._id;
const name = z.string().trim().min(1, 'Name is required').max(60, 'Up to 60 characters');
const text = (max) => z.string().trim().max(max, `Up to ${max} characters`);
const changes = (shape) => z.object(shape).partial().refine((v) => Object.keys(v).length > 0, 'Send at least one field to change');
const num = (msg) => z.coerce.number({ error: msg });

const service = z.object({
  everyKm: num('Kilometres must be a number').int('Whole km').min(100, 'At least 100 km').max(100_000).nullable(),
  everyMonths: num('Months must be a number').int('Whole months').min(1).max(60).nullable(),
  lastKm: num('Kilometres must be a number').min(0).max(5_000_000).nullable(),
  lastDate: day.nullable(),
}).partial();
const vehicleFields = { name, kind: z.enum(VEHICLE_KINDS), fuel: z.enum(FUELS), service };
const vehicleCreate = z.object({ ...vehicleFields, kind: vehicleFields.kind.default('car'), fuel: vehicleFields.fuel.default('petrol'), service: service.optional() });
const fill = z.object({
  date: entryDay,
  odometerKm: num('Odometer must be a number').min(0, 'Odometer can’t be negative').max(5_000_000),
  quantity: num('Quantity must be a number').positive('More than 0').max(10_000),
  amount,
  fullTank: z.boolean().default(true),
  account: objectId().optional(),
});
const serviced = z.object({ date: entryDay.optional(), odometerKm: num('Odometer must be a number').min(0).max(5_000_000).optional() });

const vaultFields = {
  kind: z.enum(VAULT_KINDS, { error: 'Warranty or insurance' }), name, provider: text(60), number: text(60),
  purchaseDate: day.nullable(), expiryDate: day, amount: amount.nullable(), sumInsured: amount.nullable(), nominee: text(60), note: text(200),
  transactionId: objectId().nullable(),
};
const vaultCreate = z.object(
  Object.fromEntries(Object.entries(vaultFields).map(([k, v]) => [k, ['kind', 'name', 'expiryDate'].includes(k) ? v : v.optional()])),
);

const rewardRate = num('Rate must be a number').min(0, 'Can’t be negative').max(100, 'At most 100');
const cardRewards = z.object({
  type: z.enum(REWARD_TYPES, { error: 'Cashback or points' }),
  defaultRate: rewardRate,
  pointValue: num('Point value must be a number').positive('More than ₹0').max(100).optional(),
  rules: z.array(z.object({ category: z.string().trim().min(1).max(40), rate: rewardRate })).max(30).optional(),
}).refine((v) => v.type !== 'points' || v.pointValue !== undefined, { message: 'Enter what one point is worth', path: ['pointValue'] });

const pct = (lo, hi) => num('Must be a number').min(lo).max(hi);
// Rupees, and zero is fine here (nothing invested yet, nothing saved).
const rupeesOrZero = num('Enter an amount in rupees').min(0, 'Can’t be negative').max(10_000_000_000).transform((r) => Math.round(r * 100));
const fireQuery = z.object({
  annualSpend: amount.optional(), annualSaving: rupeesOrZero.optional(), corpus: rupeesOrZero.optional(),
  returnPct: pct(0, 30).optional(), inflationPct: pct(0, 20).optional(), withdrawalPct: pct(1, 10).optional(),
});

export function vehicleRouter() {
  const r = spaceRouter();
  r.get('/', async (req, res) => res.json(await life.listVehicles(sid(req))));
  r.post('/', validate({ body: vehicleCreate }), async (req, res) => res.status(201).json({ vehicle: await life.createVehicle(req, req.valid.body) }));
  r.patch('/:id', validate({ body: changes(vehicleFields) }), async (req, res) => res.json({ vehicle: await life.updateVehicle(sid(req), req.params.id, req.valid.body) }));
  r.delete('/:id', async (req, res) => { await life.deleteVehicle(sid(req), req.params.id); res.status(204).end(); });
  r.post('/:id/fills', validate({ body: fill }), async (req, res) => res.status(201).json({ vehicle: await life.addFill(req, req.params.id, req.valid.body) }));
  r.delete('/:id/fills/:fillId', async (req, res) => res.json({ vehicle: await life.removeFill(sid(req), req.params.id, req.params.fillId) }));
  r.post('/:id/serviced', validate({ body: serviced }), async (req, res) => res.json({ vehicle: await life.markServiced(sid(req), req.params.id, req.valid.body) }));
  return r;
}

export function vaultRouter() {
  const r = spaceRouter();
  r.get('/', async (req, res) => res.json(await life.listVault(sid(req))));
  r.post('/', validate({ body: vaultCreate }), async (req, res) => res.status(201).json({ item: await life.createVaultItem(req, req.valid.body) }));
  r.patch('/:id', validate({ body: changes(vaultFields) }), async (req, res) => res.json({ item: await life.updateVaultItem(sid(req), req.params.id, req.valid.body) }));
  r.delete('/:id', async (req, res) => { await life.deleteVaultItem(sid(req), req.params.id); res.status(204).end(); });
  return r;
}

export function cardRewardRouter() {
  const r = spaceRouter();
  r.get('/', validate({ query: z.object({ months: z.coerce.number().int().min(1).max(36).default(12) }) }), async (req, res) => res.json(await life.rewardsReport(sid(req), req.valid.query)));
  r.put('/:accountId', validate({ body: cardRewards }), async (req, res) => res.json({ rates: await life.saveCardRewards(sid(req), req.params.accountId, req.valid.body) }));
  r.delete('/:accountId', async (req, res) => { await life.removeCardRewards(sid(req), req.params.accountId); res.status(204).end(); });
  return r;
}

export function fireRouter() {
  const r = spaceRouter();
  r.get('/', validate({ query: fireQuery }), async (req, res) => res.json(await life.fire(sid(req), req.valid.query)));
  return r;
}

import { Router } from 'express';
import { z } from 'zod';
import { requireDb } from '../db.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireSpace } from '../middleware/requireSpace.js';
import { rupeesToPaise } from '../money.js';
import { TAX_YEAR_KEYS } from '../tax.js';
import { CG_YEAR_KEYS } from '../capitalGains.js';
import { PAN_PATTERN, TDS_KINDS } from '../models/index.js';
import { SLAB_RATES } from '../services/capitalGains.service.js';
import { amount, day, entryDay } from '../schemas/transaction.schemas.js';
import * as ctrl from '../controllers/tax.controller.js';

const fy = z.enum(TAX_YEAR_KEYS, { error: `Tax year must be one of ${TAX_YEAR_KEYS.join(', ')}` });
const cgFy = z.enum(CG_YEAR_KEYS, { error: `Capital gains are worked out for ${CG_YEAR_KEYS.join(', ')}` });
const fyQuery = z.object({ fy: fy.optional() });

// Batch 12M: TDS records, and the landlord's details for rent receipts.
const tdsFields = {
  date: entryDay,
  deductor: z.string().trim().min(1, 'Who deducted it?').max(80, 'Up to 80 characters'),
  kind: z.enum(TDS_KINDS, { error: 'Interest, salary, rent, professional or other' }),
  income: amount.nullable(),
  tds: amount,
  note: z.string().trim().max(200, 'Up to 200 characters'),
};
const notOverIncome = (v) => !(v.income && v.tds && v.tds > v.income);
const tdsCreate = z.object({ ...tdsFields, income: tdsFields.income.optional(), note: tdsFields.note.optional() })
  .refine(notOverIncome, { message: 'TDS can’t be more than the income', path: ['tds'] });
const tdsUpdate = z.object(tdsFields).partial()
  .refine((v) => Object.keys(v).length > 0, 'Send at least one field to change')
  .refine(notOverIncome, { message: 'TDS can’t be more than the income', path: ['tds'] });
const rentProfile = z.object({
  tenantName: z.string().trim().min(1, 'Your name as it should appear').max(80, 'Up to 80 characters'),
  landlordName: z.string().trim().min(1, 'The landlord’s name').max(80, 'Up to 80 characters'),
  landlordPan: z.string().trim().toUpperCase().refine((v) => v === '' || PAN_PATTERN.test(v), 'PAN looks like ABCDE1234F').nullable().optional(),
  propertyAddress: z.string().trim().min(5, 'The rented property’s address').max(300, 'Up to 300 characters'),
});
const flag = z.enum(['true', 'false']).optional().transform((v) => v === 'true');
// Rupees, zero allowed ("I pay no rent").
const rupees = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const p = rupeesToPaise(v);
  if (p === null || p > 1_000_000_000_00) { ctx.addIssue({ code: 'custom', message: 'Enter an amount in rupees' }); return z.NEVER; }
  return p;
});

const salarySchema = z.object({
  fy: fy.optional(),
  ctc: amount,
  basicPct: z.coerce.number().min(10, 'Basic is usually 30–60% of CTC').max(80, 'Basic is usually 30–60% of CTC').default(40),
  hra: rupees.optional(),
  pf: z.enum(['full', 'capped', 'none']).default('capped'),
  gratuityInCtc: z.boolean().default(false),
  professionalTax: rupees.default(250000),
  rentPaid: rupees.default(0),
  city: z.string().trim().max(40).default(''),
  age: z.enum(['below60', 'senior', 'superSenior']).default('below60'),
  investments: rupees.default(0),
  healthSelf: rupees.default(0),
  healthParents: rupees.default(0),
  selfSenior: z.boolean().default(false),
  parentsSenior: z.boolean().default(false),
});

export function taxRouter() {
  const r = Router();
  r.use(requireDb, requireAuth, requireSpace);
  r.get('/rules', validate({ query: z.object({ fy: fy.optional() }) }), ctrl.rules);
  r.get('/summary', validate({ query: z.object({ fy: fy.optional(), selfSenior: flag, parentsSenior: flag }) }), ctrl.summary);
  r.post('/salary', validate({ body: salarySchema }), ctrl.salary);
  r.get('/capital-gains', validate({
    query: z.object({
      fy: cgFy.optional(),
      slabPct: z.coerce.number().refine((v) => SLAB_RATES.includes(v), `Slab rate must be one of ${SLAB_RATES.join(', ')}`).optional(),
    }),
  }), ctrl.capitalGains);
  r.get('/interest', validate({ query: fyQuery }), ctrl.interest);
  r.post('/tds', validate({ body: tdsCreate }), ctrl.addTds);
  r.patch('/tds/:id', validate({ body: tdsUpdate }), ctrl.updateTds);
  r.delete('/tds/:id', ctrl.removeTds);
  r.get('/rent-profile', ctrl.rentProfile);
  r.put('/rent-profile', validate({ body: rentProfile }), ctrl.saveRentProfile);
  r.get('/rent-receipts', validate({ query: fyQuery }), ctrl.rentReceipts);
  r.get('/rent-receipts.pdf', validate({ query: fyQuery }), ctrl.rentReceiptsPdf);
  return r;
}

export function cashflowRouter() {
  const r = Router();
  r.use(requireDb, requireAuth, requireSpace);
  r.get('/', validate({ query: z.object({ days: z.coerce.number().int().min(7).max(120).default(60) }) }), ctrl.cashflow);
  r.get('/afford', validate({ query: z.object({ amount, date: day.optional() }) }), ctrl.afford);
  return r;
}

import { z } from 'zod';
import { FD_COMPOUNDING, HOLDING_KINDS, TAX_CLASSES } from '../models/index.js';
import { amount, day, entryDay, objectId } from './transaction.schemas.js';

const name = z.string().trim().min(1, 'Name is required').max(120, 'Up to 120 characters');
const note = z.string().trim().max(200, 'Up to 200 characters');
const rate = z.coerce.number({ error: 'Interest rate must be a number' }).min(0, 'Interest rate can’t be negative').max(30, 'Interest rate must be at most 30% a year');
const tenure = z.coerce.number({ error: 'Term must be a number of months' }).int('Whole months').min(1, 'At least 1 month').max(600, 'At most 600 months');
const fourDecimals = (v) => Math.abs(Math.round(v * 10000) - v * 10000) < 1e-6;
// Price per unit in rupees, up to 4 decimals (NAVs have 4).
const price = z.coerce.number({ error: 'Price must be a number' }).positive('Price must be more than ₹0').max(10_000_000, 'Price is too large')
  .refine(fourDecimals, 'At most 4 decimal places');
const units = z.coerce.number({ error: 'Units must be a number' }).positive('Units must be more than 0').max(1e9, 'Too many units')
  .refine(fourDecimals, 'At most 4 decimal places');
const need = (ctx, path, message) => ctx.addIssue({ code: 'custom', path: [path], message });
// How sales are taxed (null = from the fund's category or the kind), and the 31 January 2018 value per unit.
const taxClass = z.enum(TAX_CLASSES, { error: 'Equity, debt, listed or other' }).nullable();
const fmv2018 = price.nullable();

export const holdingCreate = z
  .object({
    kind: z.enum(HOLDING_KINDS, { error: 'Pick mutual fund, stock, gold, FD, RD, PPF, EPF, NPS or other' }),
    taxClass: taxClass.optional(),
    fmv2018: fmv2018.optional(),
    name: name.optional(),
    note: note.optional(),
    schemeCode: z.coerce.number().int().positive().optional(),
    manualPrice: price.optional(),
    principal: amount.optional(),
    monthly: amount.optional(),
    ratePct: rate.optional(),
    startDate: day.optional(),
    tenureMonths: tenure.optional(),
    compounding: z.enum(FD_COMPOUNDING, { error: 'Quarterly, monthly, half-yearly, yearly or simple' }).optional(),
  })
  .superRefine((h, ctx) => {
    if (h.kind === 'mf' && !h.schemeCode) need(ctx, 'schemeCode', 'Pick a fund');
    if (h.kind !== 'mf' && !h.name) need(ctx, 'name', 'Name is required');
    if (['fd', 'rd', 'ppf'].includes(h.kind) && h.ratePct === undefined) need(ctx, 'ratePct', 'Enter the interest rate');
    if (h.kind === 'fd' || h.kind === 'rd') {
      if (!h.startDate) need(ctx, 'startDate', 'Enter the start date');
      if (!h.tenureMonths) need(ctx, 'tenureMonths', 'Enter the term');
    }
    if (h.kind === 'fd' && !h.principal) need(ctx, 'principal', 'Enter the amount deposited');
    if (h.kind === 'rd' && !h.monthly) need(ctx, 'monthly', 'Enter the monthly instalment');
  });

export const holdingUpdate = z
  .object({
    name, note, closed: z.boolean(), manualPrice: price, taxClass, fmv2018,
    principal: amount, monthly: amount, ratePct: rate, startDate: day, tenureMonths: tenure, compounding: z.enum(FD_COMPOUNDING),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Send at least one field to change');

// Two of amount, units and price (a fund's price can come from AMFI instead).
export const trade = z
  .object({
    type: z.enum(['buy', 'sell'], { error: 'Buy or sell' }).default('buy'),
    date: entryDay,
    amount: amount.optional(),
    units: units.optional(),
    price: price.optional(),
    // Also record a purchase as an "Investments" expense from this account.
    account: objectId().optional(),
    note: note.optional(),
  })
  .refine((t) => t.amount !== undefined || t.units !== undefined, { message: 'Enter the amount or the units', path: ['amount'] })
  .refine((t) => !(t.amount !== undefined && t.units !== undefined && t.price !== undefined), { message: 'Enter two of amount, units and price; the third follows', path: ['price'] });

export const sip = z.object({ amount, startDate: day, account: objectId().nullable().optional() });

export const deposit = z.object({
  direction: z.enum(['deposit', 'withdraw'], { error: 'Deposit or withdraw' }).default('deposit'),
  amount,
  date: entryDay,
  note: note.optional(),
});

// EPF: the balance shown in the EPFO passbook on a day.
export const passbook = z.object({
  balance: amount,
  date: entryDay,
  note: note.optional(),
});

export const schemeQuery = z.object({ q: z.string().trim().min(2, 'Type at least 2 letters').max(100) });
export const timelineQuery = z.object({ months: z.coerce.number().int().min(1).max(60).default(12) });

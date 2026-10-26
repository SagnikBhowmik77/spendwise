import { z } from 'zod';
import { amount, currency, day } from './transaction.schemas.js';

const name = z.string().trim().min(1, 'Name is required').max(40, 'Name must be at most 40 characters');

export const startTripSchema = z.object({ name, budget: amount.nullable().optional() });
export const updateTripSchema = z
  .object({ name, budget: amount.nullable(), end: z.literal(true) })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Send at least one field to change');

export const rateQuery = z.object({ currency, date: day });

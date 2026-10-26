import { z } from 'zod';
import { amount, category, day } from './transaction.schemas.js';
import { isMonth, currentMonth, shiftMonth } from '../money.js';

// "YYYY-MM" from 2000-01 up to 12 months ahead (budgets can be planned in advance).
const month = z
  .string({ error: 'Month is required' })
  .refine(isMonth, 'Month must be in YYYY-MM format')
  .refine((m) => m >= '2000-01', 'Month must be in 2000 or later')
  .refine((m) => m <= shiftMonth(currentMonth(), 12), 'Month can be at most 12 months ahead');

// Leave category out (or send null) for an overall limit on all expenses that month.
export const upsertBudgetSchema = z.object({
  month,
  category: category.nullable().optional().transform((c) => c ?? null),
  limit: amount,
  // Add last month's unspent money to this month's limit.
  rollover: z.boolean({ error: 'rollover must be true or false' }).optional(),
});

export const updateBudgetSchema = z
  .object({ limit: amount, rollover: z.boolean({ error: 'rollover must be true or false' }) })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Send at least one field to change');

// A standing limit for every week; leave category out for all expenses.
export const upsertWeeklySchema = z.object({
  category: category.nullable().optional().transform((c) => c ?? null),
  limit: amount,
});
export const weeklyQuery = z.object({ date: day.optional() });

export const listBudgetsQuery = z.object({ month: month.optional() });

export const copyBudgetsSchema = z
  .object({ from: month, to: month })
  .refine((v) => v.from !== v.to, { message: 'Choose two different months', path: ['to'] });

export const historyQuery = z.object({
  to: month.optional(),
  months: z.coerce.number().int().min(1).max(24).default(6),
  category: category.optional(),
});

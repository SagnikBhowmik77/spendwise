import { z } from 'zod';
import { REPORT_GROUPS, REPORT_PERIODS } from '../models/index.js';
import { isMonth } from '../money.js';
import { category, day, objectId, paymentMethod } from './transaction.schemas.js';

const months = (max, fallback) => z.coerce.number({ error: 'months must be a number' }).int().min(1).max(max).default(fallback);

export const rangeQuery = z.object({ from: day.optional(), to: day.optional() });
export const monthQuery = z.object({ month: z.string().refine(isMonth, 'Month must be YYYY-MM').optional() });
export const monthsQuery = (max, fallback) => z.object({ months: months(max, fallback) });
export const compareQuery = z.object({ aFrom: day, aTo: day, bFrom: day, bTo: day });
export const yearQuery = z.object({ year: z.coerce.number({ error: 'Year must be a number' }).int().min(2000).max(2100) });

const reportFields = z
  .object({
    name: z.string().trim().min(1, 'Name the report').max(60, 'Up to 60 characters'),
    groupBy: z.enum(REPORT_GROUPS, { error: 'Pick how to group it' }),
    period: z.enum(REPORT_PERIODS, { error: 'Pick a period' }),
    from: day.nullable().optional(),
    to: day.nullable().optional(),
    filters: z.object({
      type: z.enum(['income', 'expense']).nullable().optional(),
      category: z.array(category).max(20).optional(),
      account: objectId().nullable().optional(),
      tag: z.string().trim().toLowerCase().max(30).nullable().optional(),
      paymentMethod: paymentMethod.nullable().optional(),
      q: z.string().trim().max(80).nullable().optional(),
    }).default({}),
  });
const customNeedsDates = (r) => r.period !== 'custom' || (r.from && r.to);
const datesMessage = { message: 'Pick a start and end date', path: ['from'] };
export const reportBody = reportFields.refine(customNeedsDates, datesMessage);
// Trying a report before saving it: the same, without a name.
export const reportPreview = reportFields.partial({ name: true }).refine(customNeedsDates, datesMessage);

export const challengeBody = z.object({
  days: z.coerce.number().refine((d) => [3, 5, 7, 14, 21, 30].includes(d), 'Pick 3, 5, 7, 14, 21 or 30 days'),
  // At most tomorrow in India time; the service checks that, since it knows today's local date.
  startDate: day.optional(),
  allowed: z.array(category).max(20).default([]),
});

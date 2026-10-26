import { z } from 'zod';
import { moneyType as type, amount, category, note, day, objectId, paymentMethod } from './transaction.schemas.js';
import { FREQUENCIES, todayIn, addDays } from '../schedule.js';
import { config } from '../config.js';

// A start date up to a year back (past entries are created at once) or a year ahead.
const startDate = day
  .refine((d) => d >= addDays(todayIn(config.timeZone), -366), 'Start date can be at most a year ago')
  .refine((d) => d <= addDays(todayIn(config.timeZone), 366), 'Start date can be at most a year ahead');

export const createRecurringSchema = z
  .object({
    type,
    amount,
    category,
    note: note.optional().default(''),
    // Leave out to use the space's default account.
    account: objectId().optional(),
    paymentMethod: paymentMethod.nullable().optional(),
    frequency: z.enum(FREQUENCIES, { error: `Frequency must be one of ${FREQUENCIES.join(', ')}` }),
    interval: z.coerce.number().int().min(1, 'Interval must be 1 to 12').max(12, 'Interval must be 1 to 12').default(1),
    startDate,
    endDate: day.nullable().optional().transform((d) => d ?? null),
  })
  .refine((v) => !v.endDate || v.endDate >= v.startDate, { message: 'End date must be on or after the start date', path: ['endDate'] });

// The schedule itself (frequency, interval, start) can't change: create a new rule instead,
// so entries that already exist keep making sense.
export const updateRecurringSchema = z
  .object({
    amount, category, note, account: objectId(), paymentMethod: paymentMethod.nullable(),
    endDate: day.nullable(), active: z.boolean({ error: 'active must be true or false' }),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Send at least one field to change');

export const upcomingQuery = z.object({ days: z.coerce.number().int().min(1).max(90).default(30) });

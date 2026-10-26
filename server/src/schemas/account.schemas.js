import { z } from 'zod';
import { ACCOUNT_TYPES, MAX_AMOUNT_PAISE } from '../models/index.js';
import { signedRupeesToPaise } from '../money.js';

const name = z.string().trim().min(1, 'Name is required').max(40, 'Name must be at most 40 characters');
const type = z.enum(ACCOUNT_TYPES, { error: 'Type must be cash, bank, credit card, wallet or other' });

// Rupees, may be negative (a credit card that starts with ₹5,000 owed is -5000) or zero.
const openingBalance = z.union([z.string(), z.number()]).transform((value, ctx) => {
  const paise = signedRupeesToPaise(value);
  if (paise === null) {
    ctx.addIssue({ code: 'custom', message: 'Enter an amount like 5000, 1250.50 or -2000' });
    return z.NEVER;
  }
  if (Math.abs(paise) > MAX_AMOUNT_PAISE) {
    ctx.addIssue({ code: 'custom', message: 'Opening balance must be within ₹1,00,00,000' });
    return z.NEVER;
  }
  return paise;
});

// Credit cards: day of the month (1-31; short months use their last day). null clears it.
const cardDay = z.number({ error: 'Pick a day from 1 to 31' }).int().min(1, 'Pick a day from 1 to 31').max(31, 'Pick a day from 1 to 31').nullable();

export const createAccountSchema = z.object({ name, type, openingBalance: openingBalance.optional().default(0) });

export const updateAccountSchema = z
  .object({ name, type, openingBalance, archived: z.boolean(), isDefault: z.literal(true), statementDay: cardDay, dueDay: cardDay, private: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Send at least one field to change');

export const listAccountsQuery = z.object({ includeArchived: z.enum(['true', 'false']).optional().transform((v) => v === 'true') });

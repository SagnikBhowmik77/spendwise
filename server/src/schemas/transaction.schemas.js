import { z } from 'zod';
import { TRANSACTION_TYPES, MONEY_TYPES, PAYMENT_METHODS, MAX_AMOUNT_PAISE } from '../models/index.js';
import { rupeesToPaise, parseDay, latestAllowedDay } from '../money.js';

const EARLIEST_DAY = '2000-01-01';

export const type = z.enum(TRANSACTION_TYPES, { error: 'Type must be income, expense or transfer' });
// Income and expense only: what budgets, stats and recurring rules work with.
export const moneyType = z.enum(MONEY_TYPES, { error: 'Type must be income or expense' });
export const paymentMethod = z.enum(PAYMENT_METHODS, { error: 'Payment method must be UPI, card, cash, net banking or other' });
// A MongoDB id, e.g. an account.
export const objectId = (message = 'Choose one of your accounts') => z.string().regex(/^[a-f\d]{24}$/i, message);

// Amount in rupees ("1250.50", 1250.5 or "1,250.50"); becomes whole paise.
export const amount = z.union([z.string(), z.number()], { error: 'Amount is required' }).transform((value, ctx) => {
  const paise = rupeesToPaise(value);
  if (paise === null) {
    ctx.addIssue({ code: 'custom', message: 'Amount must be a number with at most 2 decimal places' });
    return z.NEVER;
  }
  if (paise < 1) {
    ctx.addIssue({ code: 'custom', message: 'Amount must be more than ₹0' });
    return z.NEVER;
  }
  if (paise > MAX_AMOUNT_PAISE) {
    ctx.addIssue({ code: 'custom', message: 'Amount must be at most ₹1,00,00,000' });
    return z.NEVER;
  }
  return paise;
});

export const category = z.string().trim().min(1, 'Category is required').max(40, 'Category must be at most 40 characters');
export const note = z.string().trim().max(500, 'Note must be at most 500 characters');

// A calendar day "YYYY-MM-DD".
export const day = z.string().transform((value, ctx) => {
  const date = parseDay(value);
  if (!date) {
    ctx.addIssue({ code: 'custom', message: 'Date must be a real day in YYYY-MM-DD format' });
    return z.NEVER;
  }
  return date;
});
// Entry dates run from 2000-01-01 to today.
export const entryDay = day.refine((d) => d >= parseDay(EARLIEST_DAY), 'Date must be in 2000 or later')
  .refine((d) => d <= parseDay(latestAllowedDay()), 'Date cannot be in the future');

// "#Trip-Goa" -> "trip-goa"; up to 10 per entry.
export const tags = z
  .array(z.string().trim().toLowerCase().transform((t) => t.replace(/^#/, ''))
    .pipe(z.string().regex(/^[a-z0-9][a-z0-9-]{0,29}$/, 'Tags use letters, numbers and dashes (up to 30)')))
  .max(10, 'Up to 10 tags');
export const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:MM').nullable();
// One bill across categories: 2–10 parts that add up to the amount (checked by the service).
export const splits = z.array(z.object({ category, amount })).min(2, 'A split needs at least 2 parts').max(10, 'Up to 10 parts');
export const worth = z.enum(['yes', 'meh', 'no'], { error: 'Worth it must be yes, meh or no' }).nullable();
export const merchant = z.string().trim().max(60, 'Merchant must be at most 60 characters').nullable();
export const currency = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter code like USD')
  .refine((c) => c !== 'INR', 'For rupees, enter the amount directly');

// Income/expense need a category (or splits); a transfer needs the account the money went to.
// A foreign-currency entry sends currency + originalAmount instead of amount.
export const createTransactionSchema = z
  .object({
    type,
    amount: amount.optional(),
    currency: currency.optional(),
    originalAmount: amount.optional(),
    tags: tags.optional(),
    time: time.optional(),
    splits: splits.optional(),
    category: category.optional(),
    note: note.optional().default(''),
    date: entryDay,
    // Leave out to use the space's default account.
    account: objectId().optional(),
    toAccount: objectId().optional(),
    paymentMethod: paymentMethod.nullable().optional(),
    merchant: merchant.optional(),
    worth: worth.optional(),
    // Income only: tax deducted at source, in rupees.
    tds: amount.nullable().optional(),
    // Batch 12Q: set by the offline queue so a retry doesn't add the entry twice.
    clientRef: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'Invalid client reference').optional(),
  })
  .superRefine((v, ctx) => {
    if (v.tds && v.amount !== undefined && v.tds > v.amount) ctx.addIssue({ code: 'custom', path: ['tds'], message: 'TDS can’t be more than the amount' });
    if (v.currency) {
      if (!v.originalAmount) ctx.addIssue({ code: 'custom', path: ['originalAmount'], message: `Enter the amount in ${v.currency}` });
    } else if (v.amount === undefined) {
      ctx.addIssue({ code: 'custom', path: ['amount'], message: 'Amount is required' });
    }
    if (v.splits && v.type === 'transfer') ctx.addIssue({ code: 'custom', path: ['splits'], message: "A transfer can't be split" });
    if (v.type === 'transfer') {
      if (!v.toAccount) ctx.addIssue({ code: 'custom', path: ['toAccount'], message: 'Choose the account the money went to' });
      else if (v.account === v.toAccount) ctx.addIssue({ code: 'custom', path: ['toAccount'], message: 'Pick two different accounts' });
    } else if (!v.category && !v.splits) {
      ctx.addIssue({ code: 'custom', path: ['category'], message: 'Category is required' });
    }
  });

export const updateTransactionSchema = z
  .object({
    type, amount, category, note, date: entryDay, account: objectId(), toAccount: objectId(), paymentMethod: paymentMethod.nullable(),
    tags, time, splits: splits.nullable(), currency, originalAmount: amount, merchant, worth, tds: amount.nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Send at least one field to change');

const SORTS = ['date', '-date', 'amount', '-amount'];

// Filters shared by the transaction list and every stats endpoint, so a chart always matches the list.
export const filterFields = {
  type: type.optional(),
  // One category or several, comma-separated.
  category: z.string().trim().max(400).optional()
    .transform((v) => (v ? v.split(',').map((c) => c.trim()).filter(Boolean) : undefined)),
  from: day.optional(),
  to: day.optional(),
  // Searches the note and category text.
  q: z.string().trim().max(100).optional(),
  account: objectId('Unknown account').optional(),
  paymentMethod: paymentMethod.optional(),
  tag: z.string().trim().toLowerCase().transform((t) => t.replace(/^#/, '')).optional(),
};

export const fromBeforeTo = [
  (v) => !v.from || !v.to || v.from <= v.to,
  { message: '"from" must be on or before "to"', path: ['from'] },
];

export const listTransactionsQuery = z
  .object({
    ...filterFields,
    sort: z.enum(SORTS, { error: `Sort must be one of ${SORTS.join(', ')}` }).default('-date'),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine(...fromBeforeTo);

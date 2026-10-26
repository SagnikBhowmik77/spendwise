import { z } from 'zod';
import { BILL_FREQUENCIES } from '../models/index.js';
import { isMonth } from '../money.js';
import { amount, category, day, entryDay, objectId } from './transaction.schemas.js';

const name = z.string().trim().min(1, 'Name is required').max(60, 'Up to 60 characters');
const note = z.string().trim().max(200, 'Up to 200 characters');
const changes = (shape) => z.object(shape).partial().refine((v) => Object.keys(v).length > 0, 'Send at least one field to change');

// Goals
const goalFields = { name, target: amount, targetDate: day.nullable() };
export const goalCreate = z.object({ ...goalFields, kind: z.enum(['custom', 'emergency']).default('custom'), target: amount.optional(), targetDate: day.nullable().optional() });
export const goalUpdate = changes(goalFields);
export const goalEntry = z.object({ direction: z.enum(['add', 'withdraw'], { error: 'Add or withdraw' }), amount, date: entryDay.optional(), note: note.optional() });

// Loans
const rate = z.coerce.number({ error: 'Interest rate must be a number' }).min(0, 'Interest rate can’t be negative').max(60, 'Interest rate must be at most 60% a year');
const tenure = z.coerce.number({ error: 'Tenure must be a number of months' }).int('Whole months').min(1, 'At least 1 month').max(480, 'At most 480 months (40 years)');
const loanFields = {
  name, lender: z.string().trim().max(60), principal: amount, annualRatePct: rate, tenureMonths: tenure,
  firstEmiDate: day, emi: amount, account: objectId().nullable(),
};
export const loanCreate = z.object({ ...loanFields, lender: loanFields.lender.optional(), emi: amount.optional(), account: objectId().nullable().optional() });
export const loanUpdate = changes(loanFields);
export const loanPayment = z
  .object({
    kind: z.enum(['emi', 'prepayment']).default('emi'),
    amount: amount.optional(),
    date: entryDay.optional(),
    note: note.optional(),
    // Also record it as an "EMI & Loans" expense.
    addEntry: z.boolean().default(true),
    account: objectId().optional(),
  })
  .refine((p) => p.kind === 'emi' || p.amount, { message: 'Enter the prepayment amount', path: ['amount'] });
export const prepaymentQuery = z.object({ amount });

// Money lent and borrowed
const debtFields = { person: name, direction: z.enum(['lent', 'borrowed'], { error: 'Lent or borrowed' }), amount, date: entryDay, dueDate: day.nullable(), note };
export const debtCreate = z.object({ ...debtFields, date: entryDay.optional(), dueDate: day.nullable().optional(), note: note.optional() });
export const debtUpdate = changes(debtFields);
export const debtSettle = z.object({ amount: amount.optional(), date: entryDay.optional(), note: note.optional() });

// Group expenses
const upiId = z.string().trim().max(100).refine((v) => v === '' || /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/.test(v), 'Enter a UPI ID like name@okaxis');
const memberName = z.string().trim().min(1, 'Name is required').max(40, 'Up to 40 characters');
export const groupCreate = z.object({
  name,
  members: z.array(z.object({ name: memberName, upiId: upiId.optional() })).min(2, 'Add at least 2 people').max(50, 'Up to 50 people'),
});
export const groupUpdate = changes({
  name,
  members: z.array(z.object({ id: objectId('Unknown member').optional(), name: memberName, upiId: upiId.optional() })).min(2, 'Keep at least 2 people').max(50),
});
export const groupExpense = z
  .object({
    description: z.string().trim().min(1, 'What was it for?').max(100),
    amount,
    paidBy: objectId('Pick who paid'),
    date: entryDay.optional(),
    split: z.enum(['equal', 'exact']).default('equal'),
    // Equal split: who shares it (default: everyone).
    among: z.array(objectId('Pick people in this group')).max(50).optional(),
    // Exact split: each person's amount.
    exact: z.array(z.object({ member: objectId('Pick people in this group'), amount })).max(50).optional(),
  })
  .refine((e) => e.split !== 'exact' || e.exact?.length, { message: 'Enter each person’s share', path: ['exact'] });
export const groupSettlement = z.object({ from: objectId('Pick who paid'), to: objectId('Pick who was paid'), amount, date: entryDay.optional() });

// Bills
const billFields = {
  name, amount: amount.nullable(), category, account: objectId().nullable(),
  frequency: z.enum(Object.keys(BILL_FREQUENCIES), { error: 'Monthly, quarterly, half-yearly or yearly' }), firstDue: day, active: z.boolean(),
};
export const billCreate = z.object({ ...billFields, amount: amount.nullable().optional(), account: objectId().nullable().optional(), active: z.boolean().optional() });
export const billUpdate = changes(billFields);
export const billPay = z.object({ amount: amount.optional(), date: entryDay.optional(), account: objectId().optional(), addEntry: z.boolean().default(true) });
export const calendarQuery = z.object({ month: z.string().refine(isMonth, 'Month must be YYYY-MM') });

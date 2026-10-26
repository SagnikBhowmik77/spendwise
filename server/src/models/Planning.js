// Batch 12E: savings goals, loans, money lent or borrowed, group expenses and bills.
// Each belongs to a space; their history (contributions, payments, expenses) is kept inside the document.
import mongoose from 'mongoose';
import { MAX_AMOUNT_PAISE } from './Transaction.js';

const { ObjectId } = mongoose.Schema.Types;
const paise = (extra = {}) => ({
  type: Number, required: true, min: 1, max: MAX_AMOUNT_PAISE,
  validate: { validator: Number.isInteger, message: 'whole paise' }, ...extra,
});
const name = { type: String, required: true, trim: true, minlength: 1, maxlength: 60 };
const note = { type: String, trim: true, maxlength: 200, default: '' };

// Saving towards something: money put aside (or taken back out) is recorded as entries.
const goalSchema = new mongoose.Schema(
  {
    space: { type: ObjectId, ref: 'Space', required: true },
    name,
    // "emergency" goals get a suggested target from the space's real spending.
    kind: { type: String, enum: ['custom', 'emergency'], default: 'custom' },
    targetPaise: paise(),
    targetDate: { type: Date, default: null },
    entries: [new mongoose.Schema({
      // Positive = added to the goal, negative = taken out.
      amountPaise: { type: Number, required: true, validate: { validator: (v) => Number.isInteger(v) && v !== 0, message: 'whole paise, not zero' } },
      date: { type: Date, required: true },
      note,
      by: { type: ObjectId, ref: 'User' },
    })],
    createdBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
goalSchema.index({ space: 1, createdAt: 1 });

// A loan repaid in EMIs: balance, payoff date and interest come from the payments recorded.
const loanSchema = new mongoose.Schema(
  {
    space: { type: ObjectId, ref: 'Space', required: true },
    name,
    lender: { type: String, trim: true, maxlength: 60, default: '' },
    principalPaise: paise(),
    annualRatePct: { type: Number, required: true, min: 0, max: 60 },
    tenureMonths: { type: Number, required: true, min: 1, max: 480, validate: Number.isInteger },
    firstEmiDate: { type: Date, required: true },
    emiPaise: paise(),
    // Where EMIs are paid from, for the entries recorded with them.
    account: { type: ObjectId, ref: 'Account', default: null },
    payments: [new mongoose.Schema({
      kind: { type: String, enum: ['emi', 'prepayment'], required: true },
      amountPaise: paise(),
      date: { type: Date, required: true },
      note,
      // The expense entry recorded with it, if any.
      transaction: { type: ObjectId, ref: 'Transaction', default: null },
    })],
    createdBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
loanSchema.index({ space: 1, createdAt: 1 });

// Money lent to or borrowed from a person, settled in one or more repayments.
const debtSchema = new mongoose.Schema(
  {
    space: { type: ObjectId, ref: 'Space', required: true },
    person: name,
    direction: { type: String, enum: ['lent', 'borrowed'], required: true },
    amountPaise: paise(),
    date: { type: Date, required: true },
    dueDate: { type: Date, default: null },
    note,
    settlements: [new mongoose.Schema({ amountPaise: paise(), date: { type: Date, required: true }, note })],
    createdBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
debtSchema.index({ space: 1, person: 1 });

// Shared expenses with friends (a trip, a flat): who paid, how it's split, and settle-ups.
const groupSchema = new mongoose.Schema(
  {
    space: { type: ObjectId, ref: 'Space', required: true },
    name,
    members: [new mongoose.Schema({
      name: { type: String, required: true, trim: true, minlength: 1, maxlength: 40 },
      // For "pay with UPI" links, e.g. riya@okaxis.
      upiId: { type: String, trim: true, maxlength: 100, default: '' },
    })],
    expenses: [new mongoose.Schema({
      description: { type: String, required: true, trim: true, minlength: 1, maxlength: 100 },
      amountPaise: paise(),
      paidBy: { type: ObjectId, required: true },
      date: { type: Date, required: true },
      // Each person's share; they add up to the amount.
      shares: [new mongoose.Schema({ member: { type: ObjectId, required: true }, amountPaise: { type: Number, required: true, min: 0 } }, { _id: false })],
    })],
    settlements: [new mongoose.Schema({
      from: { type: ObjectId, required: true },
      to: { type: ObjectId, required: true },
      amountPaise: paise(),
      date: { type: Date, required: true },
    })],
    createdBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
groupSchema.index({ space: 1, updatedAt: -1 });

export const BILL_FREQUENCIES = { monthly: 1, quarterly: 3, 'half-yearly': 6, yearly: 12 };

// A bill you pay by hand (electricity, rent, insurance). Due dates follow from the first due date and
// how many have been paid; "mark as paid" records the expense and moves to the next due date.
const billSchema = new mongoose.Schema(
  {
    space: { type: ObjectId, ref: 'Space', required: true },
    name,
    // Null for bills that change every time (electricity): the amount is entered when paying.
    amountPaise: { type: Number, min: 1, max: MAX_AMOUNT_PAISE, default: null, validate: { validator: (v) => v === null || Number.isInteger(v), message: 'whole paise' } },
    category: { type: String, required: true, trim: true, maxlength: 40 },
    account: { type: ObjectId, ref: 'Account', default: null },
    frequency: { type: String, enum: Object.keys(BILL_FREQUENCIES), required: true },
    firstDue: { type: Date, required: true },
    // Due dates handled so far (paid or skipped); the next one is occurrence number paidCount.
    paidCount: { type: Number, default: 0, min: 0 },
    active: { type: Boolean, default: true },
    payments: [new mongoose.Schema({
      dueDate: { type: Date, required: true },
      paidOn: { type: Date, default: null },
      amountPaise: { type: Number, default: 0, min: 0 },
      skipped: { type: Boolean, default: false },
      transaction: { type: ObjectId, ref: 'Transaction', default: null },
    })],
    // "YYYY-MM-DD" of the due date a reminder was last sent for.
    remindedFor: { type: String, default: null },
    createdBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
billSchema.index({ space: 1, active: 1 });

export const Goal = mongoose.models.Goal || mongoose.model('Goal', goalSchema);
export const Loan = mongoose.models.Loan || mongoose.model('Loan', loanSchema);
export const Debt = mongoose.models.Debt || mongoose.model('Debt', debtSchema);
export const Group = mongoose.models.Group || mongoose.model('Group', groupSchema);
export const Bill = mongoose.models.Bill || mongoose.model('Bill', billSchema);

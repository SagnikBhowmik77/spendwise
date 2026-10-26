// Batch 12O: other ways to budget. Envelopes (every rupee of a month's income given a job), sinking funds
// (yearly costs spread into monthly set-asides) and a wishlist with a cooling-off period.
import mongoose from 'mongoose';
import { MAX_AMOUNT_PAISE } from './Transaction.js';

const { ObjectId } = mongoose.Schema.Types;
const paise = (extra = {}) => ({
  type: Number, required: true, min: 1, max: MAX_AMOUNT_PAISE,
  validate: { validator: Number.isInteger, message: 'whole paise' }, ...extra,
});
const name = { type: String, required: true, trim: true, minlength: 1, maxlength: 60 };
const note = { type: String, trim: true, maxlength: 200, default: '' };

// One month's envelopes. Spending in an envelope's categories comes out of it.
const envelopePlanSchema = new mongoose.Schema(
  {
    space: { type: ObjectId, ref: 'Space', required: true },
    month: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
    // The money to give jobs to: null = the income actually recorded in the month.
    incomePaise: { type: Number, min: 0, max: MAX_AMOUNT_PAISE, default: null },
    envelopes: [new mongoose.Schema({
      name,
      categories: { type: [String], default: [] },
      amountPaise: { type: Number, required: true, min: 0, max: MAX_AMOUNT_PAISE, validate: { validator: Number.isInteger, message: 'whole paise' } },
    })],
  },
  { timestamps: true },
);
envelopePlanSchema.index({ space: 1, month: 1 }, { unique: true });

// A cost that comes round every few months (insurance, Diwali, school fees): money is put aside for it each month.
const sinkingFundSchema = new mongoose.Schema(
  {
    space: { type: ObjectId, ref: 'Space', required: true },
    name,
    amountPaise: paise(),
    nextDue: { type: Date, required: true },
    everyMonths: { type: Number, required: true, min: 1, max: 120, default: 12 },
    category: { type: String, trim: true, maxlength: 40, default: '' },
    // Money put aside since the last time it was paid (negative = taken back out).
    contributions: [new mongoose.Schema({
      date: { type: Date, required: true },
      amountPaise: { type: Number, required: true, validate: { validator: (v) => Number.isInteger(v) && v !== 0, message: 'whole paise, not zero' } },
    })],
    // Each time it was paid: when, how much, and the expense recorded.
    paid: [new mongoose.Schema({
      date: { type: Date, required: true },
      amountPaise: paise(),
      transaction: { type: ObjectId, ref: 'Transaction', default: null },
    })],
    createdBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
sinkingFundSchema.index({ space: 1, nextDue: 1 });

// Something you want: it's "ready to buy" only once the cooling-off days have passed.
export const WISH_STATUSES = ['waiting', 'bought', 'dropped'];
const wishItemSchema = new mongoose.Schema(
  {
    space: { type: ObjectId, ref: 'Space', required: true },
    name,
    pricePaise: paise(),
    url: { type: String, trim: true, maxlength: 500, default: '' },
    note,
    coolDays: { type: Number, required: true, min: 1, max: 365, default: 30 },
    status: { type: String, enum: WISH_STATUSES, default: 'waiting' },
    decidedAt: { type: Date, default: null },
    transaction: { type: ObjectId, ref: 'Transaction', default: null },
    createdBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
wishItemSchema.index({ space: 1, status: 1, createdAt: -1 });

export const EnvelopePlan = mongoose.model('EnvelopePlan', envelopePlanSchema);
export const SinkingFund = mongoose.model('SinkingFund', sinkingFundSchema);
export const WishItem = mongoose.model('WishItem', wishItemSchema);

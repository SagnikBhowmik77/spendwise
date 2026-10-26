import mongoose from 'mongoose';
import { MONEY_TYPES, MAX_AMOUNT_PAISE, PAYMENT_METHODS } from './Transaction.js';
import { FREQUENCIES } from '../schedule.js';

// "Rent ₹12,000 every month from 2026-10-01": the server creates the real transaction on each due date.
const recurringRuleSchema = new mongoose.Schema(
  {
    space: { type: mongoose.Schema.Types.ObjectId, ref: 'Space', required: true, index: true },
    // Who set it up; created entries are "added by" this person.
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, required: true, enum: MONEY_TYPES },
    amountPaise: {
      type: Number,
      required: true,
      min: 1,
      max: MAX_AMOUNT_PAISE,
      validate: { validator: Number.isInteger, message: 'amountPaise must be a whole number of paise' },
    },
    category: { type: String, required: true, trim: true, minlength: 1, maxlength: 40 },
    note: { type: String, trim: true, maxlength: 500, default: '' },
    account: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
    paymentMethod: { type: String, enum: [...PAYMENT_METHODS, null], default: null },
    frequency: { type: String, required: true, enum: FREQUENCIES },
    // Every `interval` days/weeks/months/years.
    interval: { type: Number, required: true, min: 1, max: 12, default: 1 },
    startDate: { type: Date, required: true },
    endDate: { type: Date, default: null },
    // Index of the next occurrence to create (0 = startDate) and its date; null once the rule has ended.
    nextIndex: { type: Number, required: true, default: 0 },
    nextRunDate: { type: Date, default: null },
    // Paused rules create nothing; occurrences missed while paused are skipped, not back-filled.
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

// The runner looks for "active rules due on or before today".
recurringRuleSchema.index({ active: 1, nextRunDate: 1 });

export const RecurringRule = mongoose.models.RecurringRule || mongoose.model('RecurringRule', recurringRuleSchema);

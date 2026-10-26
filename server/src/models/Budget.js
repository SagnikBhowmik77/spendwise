import mongoose from 'mongoose';
import { MAX_AMOUNT_PAISE } from './Transaction.js';

// A spending limit for one calendar month in a space: per category, or for all expenses when category is null.
const budgetSchema = new mongoose.Schema(
  {
    space: { type: mongoose.Schema.Types.ObjectId, ref: 'Space', required: true },
    // Who set it.
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    month: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
    category: { type: String, trim: true, maxlength: 40, default: null },
    limitPaise: {
      type: Number,
      required: true,
      min: 1,
      max: MAX_AMOUNT_PAISE,
      validate: { validator: Number.isInteger, message: 'limitPaise must be a whole number of paise' },
    },
    // Money left unspent last month (in last month's budget for the same category) is added to this month's limit.
    rollover: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// One budget per space, month and category (null counts as its own value: the overall budget).
budgetSchema.index({ space: 1, month: 1, category: 1 }, { unique: true });

export const Budget = mongoose.models.Budget || mongoose.model('Budget', budgetSchema);

// A standing limit for every week (Monday to Sunday): per category, or for all expenses when category is null.
const weeklyBudgetSchema = new mongoose.Schema(
  {
    space: { type: mongoose.Schema.Types.ObjectId, ref: 'Space', required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    category: { type: String, trim: true, maxlength: 40, default: null },
    limitPaise: {
      type: Number, required: true, min: 1, max: MAX_AMOUNT_PAISE,
      validate: { validator: Number.isInteger, message: 'limitPaise must be a whole number of paise' },
    },
  },
  { timestamps: true },
);
weeklyBudgetSchema.index({ space: 1, category: 1 }, { unique: true });

export const WeeklyBudget = mongoose.models.WeeklyBudget || mongoose.model('WeeklyBudget', weeklyBudgetSchema);

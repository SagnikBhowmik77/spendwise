// Batch 12F: saved custom reports, no-spend challenges and the official CPI figures used for
// inflation-adjusted spending.
import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

export const REPORT_GROUPS = ['category', 'month', 'merchant', 'tag', 'account', 'paymentMethod', 'weekday'];
export const REPORT_PERIODS = ['this-month', 'last-month', 'last-3-months', 'last-6-months', 'this-year', 'last-12-months', 'this-fy', 'last-fy', 'custom'];

// A report someone built once (filters + grouping) and wants to open again.
const savedReportSchema = new mongoose.Schema(
  {
    space: { type: ObjectId, ref: 'Space', required: true },
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 60 },
    groupBy: { type: String, enum: REPORT_GROUPS, required: true },
    period: { type: String, enum: REPORT_PERIODS, required: true },
    // Only for period "custom".
    from: { type: Date, default: null },
    to: { type: Date, default: null },
    // Same meaning as the transaction list filters.
    filters: {
      type: { type: String, enum: ['income', 'expense', null], default: 'expense' },
      category: { type: [String], default: undefined },
      account: { type: ObjectId, default: null },
      tag: { type: String, default: null },
      paymentMethod: { type: String, default: null },
      q: { type: String, default: null },
    },
    createdBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
savedReportSchema.index({ space: 1, name: 1 });

// "No spending for 7 days": started on a day, checked against real entries (fixed costs don't count).
const challengeSchema = new mongoose.Schema(
  {
    space: { type: ObjectId, ref: 'Space', required: true },
    kind: { type: String, enum: ['no-spend'], default: 'no-spend' },
    days: { type: Number, required: true, enum: [3, 5, 7, 14, 21, 30] },
    startDate: { type: Date, required: true },
    // Categories that don't break the challenge (rent, bills): essentials the person chose.
    allowed: { type: [String], default: [] },
    createdBy: { type: ObjectId, ref: 'User' },
    endedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
challengeSchema.index({ space: 1, startDate: -1 });

// One month of the all-India Consumer Price Index (MoSPI, Combined, CPI General), as published.
const cpiSchema = new mongoose.Schema({
  month: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
  index: { type: Number, required: true, min: 0 },
  baseYear: { type: String, required: true },
  // MoSPI's "Current" series, or the "Back" series it published to link older months to the same base.
  series: { type: String, required: true },
  fetchedAt: { type: Date, default: Date.now },
});
cpiSchema.index({ month: 1, baseYear: 1 }, { unique: true });

export const SavedReport = mongoose.models.SavedReport || mongoose.model('SavedReport', savedReportSchema);
export const Challenge = mongoose.models.Challenge || mongoose.model('Challenge', challengeSchema);
export const CpiIndex = mongoose.models.CpiIndex || mongoose.model('CpiIndex', cpiSchema);

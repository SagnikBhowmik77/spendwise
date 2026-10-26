import mongoose from 'mongoose';
import { MONEY_TYPES } from './Transaction.js';

const { ObjectId } = mongoose.Schema.Types;

// "Narrations containing SWIGGY are Food & Dining": applied to every statement imported into the space.
const importRuleSchema = new mongoose.Schema(
  {
    space: { type: ObjectId, ref: 'Space', required: true },
    // Lower-case text looked for anywhere in the narration.
    pattern: { type: String, required: true, minlength: 2, maxlength: 60 },
    type: { type: String, enum: MONEY_TYPES, required: true },
    category: { type: String, required: true, trim: true, minlength: 1, maxlength: 40 },
    createdBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
importRuleSchema.index({ space: 1, pattern: 1, type: 1 }, { unique: true });

// A bank's column layout, found again by its header row the next time that bank's file is imported.
const importProfileSchema = new mongoose.Schema(
  {
    space: { type: ObjectId, ref: 'Space', required: true },
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 40 },
    signature: { type: String, required: true, maxlength: 4000 },
    // Column numbers and options, checked by the import schemas before saving.
    mapping: { type: mongoose.Schema.Types.Mixed, required: true },
    createdBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
importProfileSchema.index({ space: 1, name: 1 }, { unique: true });

// One import of one file: its entries carry this id, so the whole import can be undone at once.
const importBatchSchema = new mongoose.Schema(
  {
    space: { type: ObjectId, ref: 'Space', required: true },
    user: { type: ObjectId, ref: 'User', required: true },
    account: { type: ObjectId, ref: 'Account', required: true },
    fileName: { type: String, trim: true, maxlength: 120, default: '' },
    count: { type: Number, required: true, min: 0 },
    undoneAt: { type: Date, default: null },
  },
  { timestamps: true },
);
importBatchSchema.index({ space: 1, createdAt: -1 });

export const ImportRule = mongoose.models.ImportRule || mongoose.model('ImportRule', importRuleSchema);
export const ImportProfile = mongoose.models.ImportProfile || mongoose.model('ImportProfile', importProfileSchema);
export const ImportBatch = mongoose.models.ImportBatch || mongoose.model('ImportBatch', importBatchSchema);

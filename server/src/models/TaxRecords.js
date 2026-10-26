// Batch 12M: tax records that aren't entries. TDS you were told about (Form 16A / 26AS) that isn't tied to an
// income entry, and the landlord's details used on rent receipts.
import mongoose from 'mongoose';
import { MAX_AMOUNT_PAISE } from './Transaction.js';

const { ObjectId } = mongoose.Schema.Types;
const paise = (required) => ({
  type: Number, required, min: required ? 1 : 0, max: MAX_AMOUNT_PAISE, default: required ? undefined : null,
  validate: { validator: (v) => v === null || Number.isInteger(v), message: 'whole paise' },
});
export const TDS_KINDS = ['interest', 'salary', 'rent', 'professional', 'other'];

const tdsEntrySchema = new mongoose.Schema(
  {
    space: { type: ObjectId, ref: 'Space', required: true },
    date: { type: Date, required: true },
    // Who deducted it: a bank, an employer, a client…
    deductor: { type: String, required: true, trim: true, minlength: 1, maxlength: 80 },
    kind: { type: String, enum: TDS_KINDS, required: true },
    // The income it was deducted from (optional) and the tax deducted.
    incomePaise: paise(false),
    tdsPaise: paise(true),
    note: { type: String, trim: true, maxlength: 200, default: '' },
    createdBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
tdsEntrySchema.index({ space: 1, date: -1 });

// PAN: five letters, four digits, a letter (stored upper-case).
export const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const rentProfileSchema = new mongoose.Schema(
  {
    space: { type: ObjectId, ref: 'Space', required: true },
    user: { type: ObjectId, ref: 'User', required: true },
    tenantName: { type: String, required: true, trim: true, maxlength: 80 },
    landlordName: { type: String, required: true, trim: true, maxlength: 80 },
    landlordPan: { type: String, trim: true, uppercase: true, default: null, validate: { validator: (v) => v === null || PAN_PATTERN.test(v), message: 'PAN looks like ABCDE1234F' } },
    propertyAddress: { type: String, required: true, trim: true, maxlength: 300 },
  },
  { timestamps: true },
);
rentProfileSchema.index({ space: 1, user: 1 }, { unique: true });

export const TdsEntry = mongoose.model('TdsEntry', tdsEntrySchema);
export const RentProfile = mongoose.model('RentProfile', rentProfileSchema);

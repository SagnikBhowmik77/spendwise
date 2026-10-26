// Batch 12P: the money side of everyday life. Vehicles (fuel, mileage, servicing), a vault of warranties and
// insurance policies, and the reward rates of your credit cards.
import mongoose from 'mongoose';
import { MAX_AMOUNT_PAISE } from './Transaction.js';

const { ObjectId } = mongoose.Schema.Types;
const paise = (extra = {}) => ({
  type: Number, required: true, min: 1, max: MAX_AMOUNT_PAISE,
  validate: { validator: Number.isInteger, message: 'whole paise' }, ...extra,
});
const optionalPaise = { type: Number, min: 0, max: MAX_AMOUNT_PAISE, default: null, validate: { validator: (v) => v === null || Number.isInteger(v), message: 'whole paise' } };
const name = { type: String, required: true, trim: true, minlength: 1, maxlength: 60 };
const note = { type: String, trim: true, maxlength: 200, default: '' };

export const VEHICLE_KINDS = ['car', 'bike', 'scooter', 'other'];
export const FUELS = ['petrol', 'diesel', 'cng', 'electric'];
const vehicleSchema = new mongoose.Schema(
  {
    space: { type: ObjectId, ref: 'Space', required: true },
    name,
    kind: { type: String, enum: VEHICLE_KINDS, default: 'car' },
    fuel: { type: String, enum: FUELS, default: 'petrol' },
    // Fill-ups (or charges, in kWh for electric) with the odometer reading at the time.
    fills: [new mongoose.Schema({
      date: { type: Date, required: true },
      odometerKm: { type: Number, required: true, min: 0, max: 5_000_000 },
      quantity: { type: Number, required: true, min: 0.01, max: 10_000 },
      amountPaise: paise(),
      // Mileage is worked out between full tanks.
      fullTank: { type: Boolean, default: true },
      transaction: { type: ObjectId, ref: 'Transaction', default: null },
    })],
    // Servicing: every so many km or months, whichever comes first.
    service: {
      everyKm: { type: Number, min: 100, max: 100_000, default: null },
      everyMonths: { type: Number, min: 1, max: 60, default: null },
      lastKm: { type: Number, min: 0, default: null },
      lastDate: { type: Date, default: null },
    },
    remindedFor: { type: String, default: null },
    createdBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
vehicleSchema.index({ space: 1, createdAt: 1 });

export const VAULT_KINDS = ['warranty', 'insurance'];
const vaultItemSchema = new mongoose.Schema(
  {
    space: { type: ObjectId, ref: 'Space', required: true },
    kind: { type: String, enum: VAULT_KINDS, required: true },
    name,
    provider: { type: String, trim: true, maxlength: 60, default: '' },
    // Serial number or policy number.
    number: { type: String, trim: true, maxlength: 60, default: '' },
    purchaseDate: { type: Date, default: null },
    // Warranty end, or the policy's renewal date.
    expiryDate: { type: Date, required: true },
    // Price paid, or the premium.
    amountPaise: optionalPaise,
    sumInsuredPaise: optionalPaise,
    nominee: { type: String, trim: true, maxlength: 60, default: '' },
    note,
    // The expense it was bought or paid with (its receipt photo is the proof).
    transaction: { type: ObjectId, ref: 'Transaction', default: null },
    // "YYYY-MM-DD:30" / ":7": reminders already sent for this expiry date.
    reminded: { type: [String], default: [] },
    createdBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
vaultItemSchema.index({ space: 1, expiryDate: 1 });

// A credit card's rewards: cashback as a % of spending, or points per ₹100 worth so much each.
export const REWARD_TYPES = ['cashback', 'points'];
const rate = { type: Number, min: 0, max: 100 };
const cardRewardSchema = new mongoose.Schema(
  {
    space: { type: ObjectId, ref: 'Space', required: true },
    account: { type: ObjectId, ref: 'Account', required: true },
    type: { type: String, enum: REWARD_TYPES, required: true },
    // cashback: % back; points: points per ₹100 spent.
    defaultRate: { ...rate, required: true },
    // Points only: what one point is worth, in rupees.
    pointValue: { type: Number, min: 0, max: 100, default: null },
    rules: [new mongoose.Schema({ category: { type: String, required: true, trim: true, maxlength: 40 }, rate: { ...rate, required: true } }, { _id: false })],
  },
  { timestamps: true },
);
cardRewardSchema.index({ space: 1, account: 1 }, { unique: true });

export const Vehicle = mongoose.model('Vehicle', vehicleSchema);
export const VaultItem = mongoose.model('VaultItem', vaultItemSchema);
export const CardReward = mongoose.model('CardReward', cardRewardSchema);

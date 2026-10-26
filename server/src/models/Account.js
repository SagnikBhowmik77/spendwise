import mongoose from 'mongoose';
import { MAX_AMOUNT_PAISE } from './Transaction.js';
import { accountPrivacy } from '../access.js';

// Where money sits: cash, a bank account, a credit card, a wallet like Paytm.
export const ACCOUNT_TYPES = ['cash', 'bank', 'credit_card', 'wallet', 'other'];

const accountSchema = new mongoose.Schema(
  {
    space: { type: mongoose.Schema.Types.ObjectId, ref: 'Space', required: true },
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 40 },
    type: { type: String, required: true, enum: ACCOUNT_TYPES },
    // Balance before the first entry in Spendwise. Negative for a credit card with an amount owed.
    openingBalancePaise: {
      type: Number,
      default: 0,
      min: -MAX_AMOUNT_PAISE,
      max: MAX_AMOUNT_PAISE,
      validate: { validator: Number.isInteger, message: 'openingBalancePaise must be a whole number of paise' },
    },
    // Archived accounts are hidden from pickers but keep their history and still count in net worth.
    archived: { type: Boolean, default: false },
    // Credit cards: the day of the month the statement is made and the day payment is due.
    statementDay: { type: Number, min: 1, max: 31, default: null },
    dueDay: { type: Number, min: 1, max: 31, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    // Batch 12R: in a shared space, an account only this member sees (with its entries).
    privateTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

// Account names are unique within a space, ignoring case ("HDFC" and "hdfc" are the same).
accountSchema.index({ space: 1, privateTo: 1 }, { partialFilterExpression: { privateTo: { $type: 'objectId' } } });
accountSchema.plugin(accountPrivacy);
accountSchema.index({ space: 1, name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

export function serializeAccount(a, { balancePaise = a.openingBalancePaise, entries = 0, isDefault = false } = {}) {
  return {
    id: String(a._id),
    name: a.name,
    type: a.type,
    openingBalance: { paise: a.openingBalancePaise, rupees: a.openingBalancePaise / 100 },
    balance: { paise: balancePaise, rupees: balancePaise / 100 },
    entries,
    archived: a.archived,
    isDefault,
    statementDay: a.statementDay ?? null,
    dueDay: a.dueDay ?? null,
    private: Boolean(a.privateTo),
    createdAt: a.createdAt,
  };
}

export const Account = mongoose.models.Account || mongoose.model('Account', accountSchema);

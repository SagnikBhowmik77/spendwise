import mongoose from 'mongoose';
import { transactionPrivacy } from '../access.js';

// income/expense move money in or out; a transfer moves it between two of your own accounts
// (ATM withdrawal, paying a card bill) and never counts as income or spending.
export const TRANSACTION_TYPES = ['income', 'expense', 'transfer'];
export const MONEY_TYPES = ['income', 'expense'];
export const PAYMENT_METHODS = ['upi', 'card', 'cash', 'netbanking', 'other'];
// ₹1 crore per entry is far beyond a personal transaction; it guards against typos like extra zeros.
export const MAX_AMOUNT_PAISE = 1_000_000_000;
// Deleted entries can be restored for this long, then MongoDB removes them for good.
export const UNDO_DAYS = 30;

const transactionSchema = new mongoose.Schema(
  {
    space: { type: mongoose.Schema.Types.ObjectId, ref: 'Space', required: true },
    // Who added it (shown as "added by" in shared spaces).
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, required: true, enum: TRANSACTION_TYPES },
    // Money is stored as whole paise (₹12.50 → 1250) so totals never pick up float rounding errors.
    amountPaise: {
      type: Number,
      required: true,
      min: 1,
      max: MAX_AMOUNT_PAISE,
      validate: { validator: Number.isInteger, message: 'amountPaise must be a whole number of paise' },
    },
    category: { type: String, required: true, trim: true, minlength: 1, maxlength: 40 },
    note: { type: String, trim: true, maxlength: 500, default: '' },
    date: { type: Date, required: true },
    account: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
    // Transfers only: where the money went.
    toAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', default: null },
    paymentMethod: { type: String, enum: [...PAYMENT_METHODS, null], default: null },
    // Set when a recurring rule created this entry (left out for entries typed by hand).
    recurringRule: { type: mongoose.Schema.Types.ObjectId, ref: 'RecurringRule' },
    // Soft delete: set on delete so it can be undone.
    deletedAt: { type: Date, default: null },
    // Labels across categories, e.g. "office", "trip-goa" (lowercase, no "#").
    tags: { type: [{ type: String, match: /^[a-z0-9][a-z0-9-]{0,29}$/ }], default: [] },
    // One bill across categories: the parts add up to amountPaise and `category` is "Split".
    splits: {
      type: [new mongoose.Schema({
        category: { type: String, required: true, trim: true, minlength: 1, maxlength: 40 },
        amountPaise: { type: Number, required: true, min: 1, validate: { validator: Number.isInteger, message: 'whole paise' } },
      }, { _id: false })],
      default: undefined,
    },
    // Optional time of day, "HH:MM" (local time).
    time: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/, default: null },
    // Paid in another currency: the foreign amount (minor units) and the ECB rate used for amountPaise.
    original: {
      type: new mongoose.Schema({
        currency: { type: String, required: true, match: /^[A-Z]{3}$/ },
        amountMinor: { type: Number, required: true, min: 1 },
        rate: { type: Number, required: true, min: 0 },
        rateDate: { type: String, required: true },
      }, { _id: false }),
      default: null,
    },
    // Receipt photo in GridFS (bucket "receipts").
    receipt: { type: mongoose.Schema.Types.ObjectId, default: null },
    // From an imported statement: the name pulled from the narration, a fingerprint of the line
    // (so the same statement isn't imported twice) and the import it came in with.
    merchant: { type: String, trim: true, maxlength: 60, default: null },
    importRef: { type: String, default: undefined },
    importBatch: { type: mongoose.Schema.Types.ObjectId, ref: 'ImportBatch', default: undefined },
    // "Was it worth it?" after the fact: yes, meh or no (for regret insights).
    worth: { type: String, enum: ['yes', 'meh', 'no', null], default: null },
    // Income only: tax deducted at source (TDS) from this payment, e.g. by a bank on FD interest (batch 12M).
    tdsPaise: { type: Number, min: 1, max: MAX_AMOUNT_PAISE, default: null, validate: { validator: (v) => v === null || Number.isInteger(v), message: 'whole paise' } },
    // Batch 12R: a big expense by a member waits for the owner's approval and counts nowhere until then.
    pending: { type: Boolean, default: undefined },
    // Batch 12Q: an id the phone made for an entry saved offline, so sending it twice adds it once.
    clientRef: { type: String, maxlength: 64, default: undefined },
  },
  { timestamps: true },
);

// History, filters and charts all read "this space's live entries, newest first".
transactionSchema.index({ space: 1, deletedAt: 1, date: -1 });
transactionSchema.index({ space: 1, deletedAt: 1, type: 1, category: 1, date: -1 });
transactionSchema.index({ space: 1, account: 1 });
transactionSchema.index({ space: 1, tags: 1 });
transactionSchema.index({ space: 1, importRef: 1 }, { partialFilterExpression: { importRef: { $type: 'string' } } });
transactionSchema.index({ space: 1, clientRef: 1 }, { unique: true, partialFilterExpression: { clientRef: { $type: 'string' } } });
transactionSchema.index({ space: 1, pending: 1 }, { partialFilterExpression: { pending: true } });
transactionSchema.index({ importBatch: 1 }, { partialFilterExpression: { importBatch: { $type: 'objectId' } } });
// A rule can create at most one entry per due date, even if two runs overlap.
transactionSchema.index(
  { recurringRule: 1, date: 1 },
  { unique: true, partialFilterExpression: { recurringRule: { $type: 'objectId' } } },
);
// Deleted entries are purged UNDO_DAYS after deletion (entries without deletedAt are never touched).
transactionSchema.index({ deletedAt: 1 }, { expireAfterSeconds: UNDO_DAYS * 24 * 60 * 60 });

const idOrNull = (v) => (v ? String(v) : null);

// API shape, used for both documents (toJSON) and .lean() results.
// Dates are stored as UTC midnight of the chosen day, so the first 10 characters are that day.
export function serializeTransaction(t) {
  return {
    id: String(t._id),
    space: idOrNull(t.space),
    createdBy: idOrNull(t.user),
    type: t.type,
    amountPaise: t.amountPaise,
    amount: t.amountPaise / 100,
    category: t.category,
    note: t.note ?? '',
    date: t.date.toISOString().slice(0, 10),
    account: idOrNull(t.account),
    toAccount: idOrNull(t.toAccount),
    paymentMethod: t.paymentMethod ?? null,
    recurringRuleId: idOrNull(t.recurringRule),
    tags: t.tags ?? [],
    splits: t.splits?.length ? t.splits.map((s) => ({ category: s.category, amountPaise: s.amountPaise, amount: s.amountPaise / 100 })) : null,
    time: t.time ?? null,
    original: t.original
      ? { currency: t.original.currency, amount: t.original.amountMinor / 100, amountMinor: t.original.amountMinor, rate: t.original.rate, rateDate: t.original.rateDate }
      : null,
    hasReceipt: Boolean(t.receipt),
    merchant: t.merchant ?? null,
    worth: t.worth ?? null,
    tdsPaise: t.tdsPaise ?? null,
    pending: Boolean(t.pending),
    importBatchId: idOrNull(t.importBatch),
    deletedAt: t.deletedAt ?? null,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

transactionSchema.plugin(transactionPrivacy);
transactionSchema.set('toJSON', { transform: (doc) => serializeTransaction(doc) });

export const Transaction = mongoose.models.Transaction || mongoose.model('Transaction', transactionSchema);

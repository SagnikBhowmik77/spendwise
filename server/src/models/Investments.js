// Batch 12H: investments (mutual funds, stocks, gold, fixed and recurring deposits, PPF), AMFI's
// scheme list and NAVs, and month-end net-worth snapshots.
import mongoose from 'mongoose';
import { MAX_AMOUNT_PAISE } from './Transaction.js';
import { TAX_CLASSES } from '../capitalGains.js';

const { ObjectId } = mongoose.Schema.Types;
const paise = (extra = {}) => ({
  type: Number, required: true, min: 1, max: MAX_AMOUNT_PAISE,
  validate: { validator: Number.isInteger, message: 'whole paise' }, ...extra,
});
const optionalPaise = { ...paise(), required: false, default: null, validate: { validator: (v) => v === null || Number.isInteger(v), message: 'whole paise' } };
const note = { type: String, trim: true, maxlength: 200, default: '' };

export const HOLDING_KINDS = ['mf', 'stock', 'gold', 'fd', 'rd', 'ppf', 'epf', 'nps', 'other'];
// Bought and sold in units at a price (NPS: contributions buy units at the NAV you enter); the rest grow from a rate.
export const MARKET_KINDS = ['mf', 'stock', 'gold', 'nps', 'other'];
export const FD_COMPOUNDING = ['quarterly', 'monthly', 'half-yearly', 'yearly', 'simple'];

const holdingSchema = new mongoose.Schema(
  {
    space: { type: ObjectId, ref: 'Space', required: true },
    kind: { type: String, enum: HOLDING_KINDS, required: true },
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 120 },
    note,
    // Mutual funds: AMFI's scheme code; prices come from AMFI's daily NAVs.
    schemeCode: { type: Number, default: null },
    // Stocks, gold and others: the price per unit (rupees, up to 4 decimals) you last entered, and when.
    manualPrice: { type: Number, min: 0, default: null },
    manualPriceDate: { type: Date, default: null },
    // Capital gains (batch 12M): how sales are taxed (null = from the fund's AMFI category or the kind), and for equity bought before 1 February 2018 its value per unit
    // on 31 January 2018 (funds use AMFI's NAV for that day when this is empty).
    taxClass: { type: String, enum: [...TAX_CLASSES, null], default: null },
    fmv2018: { type: Number, min: 0, default: null },
    trades: [new mongoose.Schema({
      type: { type: String, enum: ['buy', 'sell'], required: true },
      date: { type: Date, required: true },
      units: { type: Number, required: true, min: 0.0001 },
      // Price per unit in rupees (NAVs have 4 decimals); amountPaise is what was paid or received.
      price: { type: Number, required: true, min: 0 },
      amountPaise: paise(),
      sip: { type: Boolean, default: false },
      note,
      // The "Investments" expense recorded with a purchase, if any.
      transaction: { type: ObjectId, ref: 'Transaction', default: null },
    })],
    // A monthly SIP (mutual funds): bought at the NAV of each SIP date once AMFI publishes it.
    sip: {
      type: new mongoose.Schema({
        amountPaise: paise(),
        dayOfMonth: { type: Number, min: 1, max: 31, required: true },
        // Instalments from this day on are also recorded as expenses (older ones were paid before Spendwise knew).
        entriesFrom: { type: Date, default: null },
        startDate: { type: Date, required: true },
        // How many instalments have been bought; the next is startDate + count months.
        count: { type: Number, default: 0 },
        active: { type: Boolean, default: true },
        // Where it's paid from: each instalment is also recorded as an "Investments" expense there.
        account: { type: ObjectId, ref: 'Account', default: null },
      }, { _id: false }),
      default: null,
    },
    // Fixed deposit: principal; recurring deposit: monthly instalment. Both: rate, start and term.
    principalPaise: optionalPaise,
    monthlyPaise: optionalPaise,
    ratePct: { type: Number, min: 0, max: 30, default: null },
    startDate: { type: Date, default: null },
    tenureMonths: { type: Number, min: 1, max: 600, default: null },
    compounding: { type: String, enum: FD_COMPOUNDING, default: 'quarterly' },
    // PPF and EPF deposits (and withdrawals as negative amounts).
    deposits: [new mongoose.Schema({
      date: { type: Date, required: true },
      amountPaise: { type: Number, required: true, validate: { validator: (v) => Number.isInteger(v) && v !== 0, message: 'whole paise, not zero' } },
      note,
    })],
    // EPF: balances read from your EPFO passbook, which include the interest EPFO has credited.
    passbook: [new mongoose.Schema({
      date: { type: Date, required: true },
      balancePaise: { type: Number, required: true, min: 0, max: MAX_AMOUNT_PAISE, validate: { validator: Number.isInteger, message: 'whole paise' } },
      note,
    })],
    // Maturity reminder already sent for this maturity date ("YYYY-MM-DD").
    remindedFor: { type: String, default: null },
    closed: { type: Boolean, default: false },
    createdBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
holdingSchema.index({ space: 1, createdAt: 1 });
holdingSchema.index({ 'sip.active': 1 });

// Every scheme in AMFI's daily file, with its latest NAV. Refreshed at most once a day.
const amfiSchemeSchema = new mongoose.Schema({
  code: { type: Number, required: true, unique: true },
  name: { type: String, required: true },
  plan: { type: String, default: '' },
  option: { type: String, default: '' },
  isin: { type: String, default: '' },
  isinReinv: { type: String, default: '' },
  // AMFI's category heading, e.g. "Equity Scheme - Large Cap Fund" (decides the default tax class).
  category: { type: String, default: '' },
  nav: { type: Number, required: true },
  navDate: { type: Date, required: true },
  fetchedAt: { type: Date, required: true },
});

// NAVs on past days, from AMFI's history report, kept for the schemes people hold.
const navHistorySchema = new mongoose.Schema({
  code: { type: Number, required: true },
  date: { type: Date, required: true },
  nav: { type: Number, required: true },
});
navHistorySchema.index({ code: 1, date: 1 }, { unique: true });

// What a space's investments were worth at the end of a month (the last daily snapshot in it).
const netWorthSnapshotSchema = new mongoose.Schema({
  space: { type: ObjectId, ref: 'Space', required: true },
  month: { type: String, required: true },
  day: { type: Date, required: true },
  investedPaise: { type: Number, required: true },
  valuePaise: { type: Number, required: true },
});
netWorthSnapshotSchema.index({ space: 1, month: 1 }, { unique: true });

export const Holding = mongoose.model('Holding', holdingSchema);
export const AmfiScheme = mongoose.model('AmfiScheme', amfiSchemeSchema);
export const NavHistory = mongoose.model('NavHistory', navHistorySchema);
export const NetWorthSnapshot = mongoose.model('NetWorthSnapshot', netWorthSnapshotSchema);

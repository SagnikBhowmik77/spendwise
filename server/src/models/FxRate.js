import mongoose from 'mongoose';

// Cached ECB reference rates (via Frankfurter): 1 unit of `currency` = `rate` INR on `rateDate`
// (the last business day on or before the requested `day`). Rates for a past day never change.
const fxRateSchema = new mongoose.Schema({
  currency: { type: String, required: true },
  day: { type: String, required: true },
  rate: { type: Number, required: true },
  rateDate: { type: String, required: true },
  fetchedAt: { type: Date, default: Date.now },
});

fxRateSchema.index({ currency: 1, day: 1 }, { unique: true });

export const FxRate = mongoose.models.FxRate || mongoose.model('FxRate', fxRateSchema);

import mongoose from 'mongoose';
import { MAX_AMOUNT_PAISE } from './Transaction.js';

// Trip mode: a temporary budget plus a tag ("trip-goa") that new entries get until the trip ends.
const tripSchema = new mongoose.Schema(
  {
    space: { type: mongoose.Schema.Types.ObjectId, ref: 'Space', required: true },
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 40 },
    tag: { type: String, required: true },
    budgetPaise: {
      type: Number, default: null, min: 1, max: MAX_AMOUNT_PAISE,
      validate: { validator: (v) => v === null || Number.isInteger(v), message: 'budgetPaise must be whole paise' },
    },
    startDate: { type: Date, required: true },
    // Set when the trip is ended; null while it's running.
    endedAt: { type: Date, default: null },
    active: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

tripSchema.index({ space: 1, tag: 1 }, { unique: true });
// At most one running trip per space.
tripSchema.index({ space: 1, active: 1 }, { unique: true, partialFilterExpression: { active: true } });

export const Trip = mongoose.models.Trip || mongoose.model('Trip', tripSchema);

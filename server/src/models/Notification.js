import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

// One browser (or installed app) that agreed to receive push notifications for a user.
const pushSubscriptionSchema = new mongoose.Schema(
  {
    user: { type: ObjectId, ref: 'User', required: true },
    // The push service URL for this browser (Google, Mozilla or Apple). Secret-ish: anyone with it and the keys can push.
    endpoint: { type: String, required: true, maxlength: 1000 },
    p256dh: { type: String, required: true, maxlength: 200 },
    auth: { type: String, required: true, maxlength: 100 },
    userAgent: { type: String, maxlength: 300, default: '' },
    lastSentAt: { type: Date, default: null },
  },
  { timestamps: true },
);
pushSubscriptionSchema.index({ endpoint: 1 }, { unique: true });
pushSubscriptionSchema.index({ user: 1 });

// "Alert sent": a budget reaching 80% or 100% in one month or week is announced once, however often it's checked.
const budgetAlertSchema = new mongoose.Schema({
  space: { type: ObjectId, ref: 'Space', required: true },
  // "month:<budget id>:2026-10" or "week:<weekly budget id>:2026-10-19".
  key: { type: String, required: true, maxlength: 100 },
  level: { type: Number, required: true, enum: [80, 100] },
  at: { type: Date, default: Date.now },
});
budgetAlertSchema.index({ key: 1, level: 1 }, { unique: true });
// Old alert records are only needed while their period can still change.
budgetAlertSchema.index({ at: 1 }, { expireAfterSeconds: 120 * 24 * 60 * 60 });

export const PushSubscription = mongoose.models.PushSubscription || mongoose.model('PushSubscription', pushSubscriptionSchema);
export const BudgetAlert = mongoose.models.BudgetAlert || mongoose.model('BudgetAlert', budgetAlertSchema);

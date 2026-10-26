import mongoose from 'mongoose';

// Who changed what, and when. For entries, `before`/`after` hold the fields at that moment,
// which is what lets an older version be restored.
const activityLogSchema = new mongoose.Schema({
  space: { type: mongoose.Schema.Types.ObjectId, ref: 'Space', required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  entity: { type: String, required: true, enum: ['transaction', 'account', 'budget', 'recurring', 'space', 'import'] },
  entityId: { type: mongoose.Schema.Types.ObjectId, required: true },
  action: { type: String, required: true, enum: ['create', 'update', 'delete', 'restore', 'revert', 'join', 'leave', 'remove', 'approve', 'reject'] },
  summary: { type: String, required: true, maxlength: 300 },
  before: { type: mongoose.Schema.Types.Mixed, default: null },
  after: { type: mongoose.Schema.Types.Mixed, default: null },
  at: { type: Date, default: Date.now },
});

activityLogSchema.index({ space: 1, at: -1 });
activityLogSchema.index({ entityId: 1, at: -1 });

export const ActivityLog = mongoose.models.ActivityLog || mongoose.model('ActivityLog', activityLogSchema);

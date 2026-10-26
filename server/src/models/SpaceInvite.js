import mongoose from 'mongoose';

// An emailed invitation to a shared space. Only a SHA-256 hash of the link's token is stored,
// so a database leak can't be used to join anyone's household. MongoDB deletes it once expired.
const spaceInviteSchema = new mongoose.Schema(
  {
    space: { type: mongoose.Schema.Types.ObjectId, ref: 'Space', required: true, index: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // The role they join with (batch 12R).
    role: { type: String, enum: ['editor', 'viewer', 'child'], default: 'editor' },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
  },
  { timestamps: true },
);

// One open invite per email per space; inviting again replaces it.
spaceInviteSchema.index({ space: 1, email: 1 }, { unique: true });

export const SpaceInvite = mongoose.models.SpaceInvite || mongoose.model('SpaceInvite', spaceInviteSchema);

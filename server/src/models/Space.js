import mongoose from 'mongoose';

// A space owns money data. Every user has one personal space; shared spaces (a household, flatmates)
// have several members who all see and edit the same accounts, entries and budgets.
export const SPACE_KINDS = ['personal', 'shared'];
export const MAX_MEMBERS = 10;
// Batch 12R: owner (everything), editor (adds and changes data), viewer (only looks), child (only adds their
// own expenses, within a monthly pocket-money limit). 'member' is the old name for editor.
export const ROLES = ['owner', 'editor', 'viewer', 'child'];
export const MEMBER_ROLES = ['editor', 'viewer', 'child'];
export const roleName = (role) => (role === 'member' ? 'editor' : role);

const memberSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: [...ROLES, 'member'], required: true },
    // Children: what they can spend a month (null: no limit).
    pocketMoneyPaise: { type: Number, min: 1, default: null },
    joinedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const spaceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 40 },
    kind: { type: String, enum: SPACE_KINDS, required: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    members: { type: [memberSchema], default: [] },
    // New entries go here when no account is chosen.
    defaultAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', default: null },
    // Batch 12R: expenses above this by anyone but the owner wait for the owner's approval (null: off).
    approvalAbovePaise: { type: Number, min: 1, default: null },
  },
  { timestamps: true },
);

spaceSchema.index({ 'members.user': 1 });
// Exactly one personal space per user, even if two requests race to create it.
spaceSchema.index({ owner: 1 }, { unique: true, partialFilterExpression: { kind: 'personal' } });

export const Space = mongoose.models.Space || mongoose.model('Space', spaceSchema);

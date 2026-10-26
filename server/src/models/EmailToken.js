import mongoose from 'mongoose';

// One-time links sent by email: "reset" (30 minutes) and "verify" (24 hours).
// Only the SHA-256 of the token is kept, so a copy of the database can't be used to take over an account.
export const EMAIL_TOKEN_PURPOSES = ['reset', 'verify'];

const emailTokenSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    purpose: { type: String, required: true, enum: EMAIL_TOKEN_PURPOSES },
    tokenHash: { type: String, required: true, unique: true },
    // The address the link went to; a verify link only counts for that address.
    email: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

emailTokenSchema.index({ user: 1, purpose: 1 });
// MongoDB removes rows once they expire; the service also checks expiresAt, since that sweep runs about once a minute.
emailTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const EmailToken = mongoose.models.EmailToken || mongoose.model('EmailToken', emailTokenSchema);

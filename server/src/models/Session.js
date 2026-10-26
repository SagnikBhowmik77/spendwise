import mongoose from 'mongoose';

// One signed-in device: each login token (by its jti) has a row. Signing a device out deletes its row,
// which makes its token stop working. MongoDB removes rows once the token would have expired anyway.
const sessionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    jti: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
    // "Chrome on Windows", from the User-Agent; the raw header is kept (shortened) for the detail view.
    label: { type: String, default: 'Unknown device' },
    userAgent: { type: String, maxlength: 300, default: '' },
    ip: { type: String, maxlength: 64, default: '' },
    lastSeenAt: { type: Date, default: Date.now },
    // App lock: when this device last did something, whether it is locked now, and failed PIN tries.
    lastActiveAt: { type: Date, default: Date.now },
    locked: { type: Boolean, default: false },
    lockFailures: { type: Number, default: 0 },
    // A fingerprint (WebAuthn) challenge waiting for its answer.
    challenge: {
      type: new mongoose.Schema({ value: String, purpose: String, expiresAt: Date }, { _id: false }),
      default: null,
    },
  },
  { timestamps: true },
);

export const Session = mongoose.models.Session || mongoose.model('Session', sessionSchema);

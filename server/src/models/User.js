import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 60 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254, unique: true },
    // When the owner of the address clicked the link we sent it. Until then nothing is emailed to it
    // (reports, alerts, sign-in warnings) and invites for it can't be accepted.
    emailVerifiedAt: { type: Date, default: null },
    // "Get started" checklist on the dashboard: hidden for good once dismissed.
    checklistDismissedAt: { type: Date, default: null },
    // The app's language; the Telegram bot answers in it too.
    language: { type: String, enum: ['en', 'hi'], default: 'en' },
    // bcrypt hash; never returned unless a query asks for it with .select('+passwordHash').
    passwordHash: { type: String, required: true, select: false },
    // Bumped on "log out everywhere" and password change; tokens carrying an older value stop working.
    tokenVersion: { type: Number, default: 0 },
    // Opt-in monthly summary email. lastSentMonth ("YYYY-MM") makes sure each month goes out at most once.
    monthlyReport: {
      enabled: { type: Boolean, default: false },
      lastSentMonth: { type: String, default: null },
    },
    // Budget alerts (80% and 100%) by push and/or email, and a daily "log your spending" push.
    notify: {
      budgetPush: { type: Boolean, default: true },
      budgetEmail: { type: Boolean, default: false },
      // Bills: a reminder 3 days before each due date.
      billPush: { type: Boolean, default: true },
      billEmail: { type: Boolean, default: false },
      reminder: { type: Boolean, default: false },
      reminderTime: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/, default: '21:00' },
      // "YYYY-MM-DD" of the last day the reminder was handled, so it goes out at most once a day.
      lastReminderDay: { type: String, default: null },
      // An email when someone signs in from a device not seen before.
      loginEmail: { type: Boolean, default: true },
    },
    // Two-factor login with an authenticator app. Secrets are encrypted; backup codes are keyed hashes.
    twoFactor: {
      enabled: { type: Boolean, default: false },
      enabledAt: { type: Date, default: null },
      secretEnc: { type: String, default: null, select: false },
      // Set up but not confirmed with a code yet.
      pendingSecretEnc: { type: String, default: null, select: false },
      // The last 30-second step used, so a code works only once.
      lastStep: { type: Number, default: -1, select: false },
      backupCodes: { type: [{ hash: String, usedAt: { type: Date, default: null }, _id: false }], default: [], select: false },
      // Wrong codes in the current 15-minute window.
      failures: { type: Number, default: 0, select: false },
      failuresSince: { type: Date, default: null, select: false },
    },
    // Devices seen at login (a random id the app keeps, or the browser and system), for new-device alerts.
    knownDevices: {
      type: [{ key: String, label: String, firstSeen: Date, lastSeen: Date, _id: false }],
      default: [],
      select: false,
    },
    // App lock: a PIN (bcrypt) and/or fingerprint passkeys, asked for after a while without use.
    appLock: {
      enabled: { type: Boolean, default: false },
      pinHash: { type: String, default: null, select: false },
      timeoutMinutes: { type: Number, min: 1, max: 240, default: 5 },
      passkeys: [new mongoose.Schema({
        credentialId: { type: String, required: true },
        publicKey: { type: String, required: true },
        counter: { type: Number, default: 0 },
        transports: { type: [String], default: [] },
        label: { type: String, default: 'This device' },
        lastUsedAt: { type: Date, default: null },
      }, { timestamps: { createdAt: true, updatedAt: false } })],
    },
  },
  { timestamps: true },
);

userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.__v;
    delete ret.passwordHash;
    delete ret.tokenVersion;
    delete ret.knownDevices;
    ret.emailVerified = Boolean(ret.emailVerifiedAt);
    // Only what the app needs to know at start-up; secrets never leave the server.
    ret.twoFactor = { enabled: Boolean(ret.twoFactor?.enabled) };
    ret.appLock = {
      enabled: Boolean(ret.appLock?.enabled),
      timeoutMinutes: ret.appLock?.timeoutMinutes ?? 5,
      passkeys: (ret.appLock?.passkeys ?? []).map((p) => ({ id: String(p._id), label: p.label, createdAt: p.createdAt, lastUsedAt: p.lastUsedAt })),
    };
    return ret;
  },
});

export const User = mongoose.models.User || mongoose.model('User', userSchema);

// Batch 12J: personal API tokens, webhooks, Google Sheets sync and the Telegram bot.
import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

export const TOKEN_SCOPES = ['read', 'write'];
export const WEBHOOK_EVENTS = [
  'transaction.created', 'transaction.updated', 'transaction.deleted', 'transaction.restored',
  'transactions.imported', 'transactions.recurring', 'budget.alert',
];

// A token for scripts and other apps ("sw_…"). Only its SHA-256 is stored; it's shown once.
const apiTokenSchema = new mongoose.Schema(
  {
    user: { type: ObjectId, ref: 'User', required: true },
    space: { type: ObjectId, ref: 'Space', required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    hash: { type: String, required: true, unique: true },
    // The first characters, so you can tell tokens apart ("sw_k3Fq…").
    prefix: { type: String, required: true },
    scope: { type: String, enum: TOKEN_SCOPES, default: 'read' },
    lastUsedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true },
);
apiTokenSchema.index({ user: 1, createdAt: -1 });

// A URL that gets a signed POST when something happens in a space.
const webhookSchema = new mongoose.Schema(
  {
    space: { type: ObjectId, ref: 'Space', required: true, index: true },
    url: { type: String, required: true, maxlength: 500 },
    events: { type: [{ type: String, enum: WEBHOOK_EVENTS }], default: WEBHOOK_EVENTS },
    // HMAC-SHA256 key for the X-Spendwise-Signature header.
    secret: { type: String, required: true, select: false },
    active: { type: Boolean, default: true },
    // Failed deliveries in a row; at 20 the webhook is switched off.
    failures: { type: Number, default: 0 },
    disabledReason: { type: String, default: null },
    createdBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

// What happened to each delivery attempt (kept 30 days).
const webhookDeliverySchema = new mongoose.Schema({
  webhook: { type: ObjectId, ref: 'Webhook', required: true },
  deliveryId: { type: String, required: true },
  event: { type: String, required: true },
  attempt: { type: Number, default: 1 },
  status: { type: Number, default: null },
  ok: { type: Boolean, default: false },
  error: { type: String, default: null },
  durationMs: { type: Number, default: null },
  at: { type: Date, default: Date.now, expires: 30 * 24 * 60 * 60 },
});
webhookDeliverySchema.index({ webhook: 1, at: -1 });

// A Google Sheet a space's entries are copied into. The refresh token is encrypted.
const sheetLinkSchema = new mongoose.Schema(
  {
    space: { type: ObjectId, ref: 'Space', required: true, unique: true },
    user: { type: ObjectId, ref: 'User', required: true },
    googleEmail: { type: String, default: '' },
    refreshTokenEnc: { type: String, required: true, select: false },
    spreadsheetId: { type: String, default: null },
    spreadsheetUrl: { type: String, default: null },
    lastSyncAt: { type: Date, default: null },
    rowsSynced: { type: Number, default: 0 },
    lastError: { type: String, default: null },
  },
  { timestamps: true },
);

// A Telegram chat linked to a person and the space its entries go to.
const telegramLinkSchema = new mongoose.Schema(
  {
    user: { type: ObjectId, ref: 'User', required: true },
    space: { type: ObjectId, ref: 'Space', required: true },
    chatId: { type: Number, required: true, unique: true },
    username: { type: String, default: '' },
    firstName: { type: String, default: '' },
    // The last entry added from the chat, for /undo.
    lastTransaction: { type: ObjectId, default: null },
    dailySummary: { type: Boolean, default: false },
    summaryTime: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/, default: '21:30' },
    lastSummaryDay: { type: String, default: null },
  },
  { timestamps: true },
);
telegramLinkSchema.index({ user: 1 });

// One-time codes for linking a chat (/start <code>), valid 15 minutes.
const telegramLinkCodeSchema = new mongoose.Schema({
  hash: { type: String, required: true, unique: true },
  user: { type: ObjectId, ref: 'User', required: true },
  space: { type: ObjectId, ref: 'Space', required: true },
  expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
});

// Batch 12S: a private calendar address (webcal) for one person in one space. Only the SHA-256 of its secret is
// stored, so the address is shown once; resetting makes a new one and the old one stops working.
const calendarFeedSchema = new mongoose.Schema(
  {
    user: { type: ObjectId, ref: 'User', required: true },
    space: { type: ObjectId, ref: 'Space', required: true },
    hash: { type: String, required: true, unique: true },
    lastFetchedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
calendarFeedSchema.index({ user: 1, space: 1 }, { unique: true });

export const ApiToken = mongoose.model('ApiToken', apiTokenSchema);
export const CalendarFeed = mongoose.model('CalendarFeed', calendarFeedSchema);
export const Webhook = mongoose.model('Webhook', webhookSchema);
export const WebhookDelivery = mongoose.model('WebhookDelivery', webhookDeliverySchema);
export const SheetLink = mongoose.model('SheetLink', sheetLinkSchema);
export const TelegramLink = mongoose.model('TelegramLink', telegramLinkSchema);
export const TelegramLinkCode = mongoose.model('TelegramLinkCode', telegramLinkCodeSchema);

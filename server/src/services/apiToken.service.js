// Batch 12J: personal API tokens. "sw_" + 32 random bytes; only the SHA-256 is stored, so a token is
// shown once. Each token belongs to one person and one space, and is read-only or read-and-write.
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { HttpError } from '../errors.js';
import { ApiToken, Space, User } from '../models/index.js';
import { sha256 } from '../security.js';

export const TOKEN_PREFIX = 'sw_';
const MAX_TOKENS = 20;
const TOUCH_MS = 60_000;
// Requests one token may make per minute.
export const TOKEN_RATE_PER_MIN = 120;
const BAD = () => new HttpError(401, 'invalid_token', 'This API token is not valid: it was revoked, has expired, or was typed wrong.');

const serialize = (t, spaceName) => ({
  id: String(t._id), name: t.name, prefix: `${t.prefix}…`, scope: t.scope, space: String(t.space), spaceName,
  createdAt: t.createdAt, lastUsedAt: t.lastUsedAt, expiresAt: t.expiresAt,
});

export async function create({ space, user }, { name, scope = 'read', expiresInDays = null }) {
  if ((await ApiToken.countDocuments({ user: user._id })) >= MAX_TOKENS) throw new HttpError(409, 'too_many_tokens', `You can have up to ${MAX_TOKENS} tokens; revoke one you no longer use`);
  const raw = TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
  const doc = await ApiToken.create({
    user: user._id, space: space._id, name, hash: sha256(raw), prefix: raw.slice(0, 10), scope,
    expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000) : null,
  });
  return { token: raw, ...serialize(doc, space.kind === 'personal' ? 'Personal' : space.name) };
}

export async function list(user) {
  const tokens = await ApiToken.find({ user: user._id }).sort({ createdAt: -1 }).lean();
  const spaces = await Space.find({ _id: { $in: tokens.map((t) => t.space) } }).select('name kind').lean();
  const names = new Map(spaces.map((s) => [String(s._id), s.kind === 'personal' ? 'Personal' : s.name]));
  return tokens.map((t) => serialize(t, names.get(String(t.space)) ?? 'A space you left'));
}

export async function revoke(user, id) {
  const res = mongoose.isValidObjectId(id) ? await ApiToken.deleteOne({ _id: id, user: user._id }) : { deletedCount: 0 };
  if (!res.deletedCount) throw new HttpError(404, 'token_not_found', 'That token is already revoked');
}

// Per-token request counts in the current minute (in memory: enough for one server).
const windows = new Map();
function countRequest(id) {
  const minute = Math.floor(Date.now() / 60_000);
  const w = windows.get(id);
  if (!w || w.minute !== minute) { windows.set(id, { minute, n: 1 }); return 1; }
  w.n += 1;
  return w.n;
}

export async function verifyApiToken(raw) {
  const token = await ApiToken.findOne({ hash: sha256(raw) });
  if (!token || (token.expiresAt && token.expiresAt < new Date())) throw BAD();
  const user = await User.findById(token.user);
  if (!user) throw BAD();
  if (countRequest(String(token._id)) > TOKEN_RATE_PER_MIN) {
    throw new HttpError(429, 'rate_limited', `This token made more than ${TOKEN_RATE_PER_MIN} requests in a minute. Slow down and try again shortly.`);
  }
  if (!token.lastUsedAt || Date.now() - token.lastUsedAt > TOUCH_MS) await ApiToken.updateOne({ _id: token._id }, { $set: { lastUsedAt: new Date() } });
  return { user, token };
}

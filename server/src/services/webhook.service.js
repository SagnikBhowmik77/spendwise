// Batch 12J: webhooks. When something happens in a space, each matching webhook gets a POST with a JSON body,
// signed with HMAC-SHA256 so the receiver can check it came from Spendwise. Failed deliveries are tried
// twice more (after 30 seconds and 5 minutes); 20 failures in a row switch the webhook off.
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import mongoose from 'mongoose';
import { HttpError } from '../errors.js';
import { config } from '../config.js';
import { Webhook, WebhookDelivery } from '../models/index.js';
import { onSpaceEvent } from '../events.js';

const MAX_WEBHOOKS = 10;
export const DISABLE_AFTER = 20;
const TIMEOUT_MS = 10_000;
// Waits before attempts 2 and 3 (tests shorten them).
export const retryDelays = [30_000, 5 * 60_000];
const NOT_FOUND = () => new HttpError(404, 'webhook_not_found', 'Webhook not found');
const fieldError = (field, message) => new HttpError(400, 'validation_failed', 'Some fields are missing or invalid', [{ field, message }]);

// Addresses a webhook may not call outside development: this machine, private networks, link-local.
export function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || /^fe[89ab]/.test(v6);
}

async function checkUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw fieldError('url', 'Enter a full address like https://example.com/hooks/spendwise'); }
  if (!['https:', 'http:'].includes(url.protocol)) throw fieldError('url', 'The address must start with https://');
  if (url.username || url.password) throw fieldError('url', 'Put credentials in your receiver, not in the address');
  if (config.webhooksAllowPrivate) return url;
  if (url.protocol !== 'https:') throw fieldError('url', 'The address must start with https://');
  let addresses;
  try { addresses = await dns.lookup(url.hostname, { all: true }); } catch { throw fieldError('url', `${url.hostname} can’t be found`); }
  if (addresses.some((a) => isPrivateAddress(a.address))) throw fieldError('url', 'Webhooks can only call public internet addresses');
  return url;
}

const newSecret = () => `whsec_${crypto.randomBytes(24).toString('base64url')}`;
export const sign = (secret, timestamp, body) => crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

const serialize = (h) => ({
  id: String(h._id), url: h.url, events: h.events, active: h.active, failures: h.failures,
  disabledReason: h.disabledReason, createdAt: h.createdAt,
});

async function owned(spaceId, id, withSecret = false) {
  if (!mongoose.isValidObjectId(id)) throw NOT_FOUND();
  const q = Webhook.findOne({ _id: id, space: spaceId });
  const h = await (withSecret ? q.select('+secret') : q);
  if (!h) throw NOT_FOUND();
  return h;
}

export async function list(spaceId) {
  const hooks = await Webhook.find({ space: spaceId }).sort({ createdAt: 1 }).lean();
  const last = await WebhookDelivery.aggregate([
    { $match: { webhook: { $in: hooks.map((h) => h._id) } } },
    { $sort: { at: -1 } },
    { $group: { _id: '$webhook', d: { $first: '$$ROOT' } } },
  ]);
  const lastBy = new Map(last.map((r) => [String(r._id), r.d]));
  return hooks.map((h) => {
    const d = lastBy.get(String(h._id));
    return { ...serialize(h), lastDelivery: d ? { event: d.event, ok: d.ok, status: d.status, error: d.error, at: d.at } : null };
  });
}

// The secret is shown when the webhook is made (and when it's replaced), never again.
export async function create({ space, user }, { url, events }) {
  if ((await Webhook.countDocuments({ space: space._id })) >= MAX_WEBHOOKS) throw new HttpError(409, 'too_many_webhooks', `Up to ${MAX_WEBHOOKS} webhooks per space`);
  const checked = await checkUrl(url);
  const secret = newSecret();
  const h = await Webhook.create({ space: space._id, url: checked.href, events, secret, createdBy: user._id });
  return { ...serialize(h), secret };
}

export async function update(spaceId, id, { url, events, active }) {
  const h = await owned(spaceId, id);
  if (url !== undefined) h.url = (await checkUrl(url)).href;
  if (events !== undefined) h.events = events;
  if (active !== undefined) {
    h.active = active;
    if (active) { h.failures = 0; h.disabledReason = null; }
  }
  await h.save();
  return serialize(h);
}

export async function rotateSecret(spaceId, id) {
  const h = await owned(spaceId, id);
  const secret = newSecret();
  await Webhook.updateOne({ _id: h._id }, { $set: { secret } });
  return { ...serialize(h), secret };
}

export async function remove(spaceId, id) {
  const h = await owned(spaceId, id);
  await Promise.all([Webhook.deleteOne({ _id: h._id }), WebhookDelivery.deleteMany({ webhook: h._id })]);
}

export async function deliveries(spaceId, id) {
  const h = await owned(spaceId, id);
  const rows = await WebhookDelivery.find({ webhook: h._id }).sort({ at: -1 }).limit(30).lean();
  return rows.map((d) => ({ id: String(d._id), deliveryId: d.deliveryId, event: d.event, attempt: d.attempt, ok: d.ok, status: d.status, error: d.error, durationMs: d.durationMs, at: d.at }));
}

// One POST. The address is checked again each time (its DNS may have changed since it was saved).
async function attempt(hook, { deliveryId, event, data, createdAt }, n) {
  const body = JSON.stringify({ id: deliveryId, event, createdAt, spaceId: String(hook.space), data });
  const timestamp = Math.floor(Date.now() / 1000);
  const started = Date.now();
  let status = null;
  let error = null;
  try {
    await checkUrl(hook.url);
    const res = await fetch(hook.url, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Spendwise-Webhooks/1',
        'x-spendwise-event': event,
        'x-spendwise-delivery': deliveryId,
        'x-spendwise-timestamp': String(timestamp),
        'x-spendwise-signature': `sha256=${sign(hook.secret, timestamp, body)}`,
      },
      body,
    });
    status = res.status;
    await res.body?.cancel().catch(() => {});
    if (status < 200 || status >= 300) error = `The receiver answered ${status}`;
  } catch (err) {
    error = err.name === 'TimeoutError' ? `No answer within ${TIMEOUT_MS / 1000} seconds` : err.details?.[0]?.message ?? err.message;
  }
  const ok = !error;
  await WebhookDelivery.create({ webhook: hook._id, deliveryId, event, attempt: n, status, ok, error, durationMs: Date.now() - started });
  if (ok) {
    await Webhook.updateOne({ _id: hook._id }, { $set: { failures: 0 } });
  } else {
    const after = await Webhook.findOneAndUpdate({ _id: hook._id }, { $inc: { failures: 1 } }, { returnDocument: 'after' });
    if (after && after.failures >= DISABLE_AFTER && after.active) {
      await Webhook.updateOne({ _id: hook._id }, { $set: { active: false, disabledReason: `Switched off after ${DISABLE_AFTER} failed deliveries in a row. Last error: ${error}` } });
    }
  }
  return { ok, status, error };
}

// Sends one event, retrying in the background. Resolves after the first attempt.
export async function send(hook, event, data) {
  const delivery = { deliveryId: crypto.randomUUID(), event, data, createdAt: new Date().toISOString() };
  const first = await attempt(hook, delivery, 1);
  if (!first.ok) {
    let n = 1;
    const retry = () => {
      n += 1;
      setTimeout(async () => {
        try {
          const fresh = await Webhook.findById(hook._id).select('+secret');
          if (!fresh?.active) return;
          const r = await attempt(fresh, delivery, n);
          if (!r.ok && n <= retryDelays.length) retry();
        } catch (err) {
          console.error(`Webhook retry failed: ${err.message}`);
        }
      }, retryDelays[n - 2]).unref();
    };
    retry();
  }
  return first;
}

// "Send test": a ping now, so you can see the receiver gets it and checks the signature.
export async function test(spaceId, id) {
  const h = await owned(spaceId, id, true);
  return send(h, 'ping', { message: 'A test delivery from Spendwise' });
}

onSpaceEvent(async ({ spaceId, event, data }) => {
  const hooks = await Webhook.find({ space: spaceId, active: true, events: event }).select('+secret');
  await Promise.all(hooks.map((h) => send(h, event, data)));
});

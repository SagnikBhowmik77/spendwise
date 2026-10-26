// Browser push notifications (Web Push, RFC 8030) signed with this app's VAPID keys.
// web-push encrypts the message; the request itself is sent with fetch so any push service URL works.
import webpush from 'web-push';
import { config } from '../config.js';
import { PushSubscription } from '../models/index.js';

export const pushConfigured = () => Boolean(config.push.publicKey && config.push.privateKey);
export const publicKey = () => (pushConfigured() ? config.push.publicKey : null);

// A browser can only belong to one person at a time: subscribing again from it moves it to whoever is signed in.
export async function subscribe(user, { endpoint, keys, userAgent = '' }) {
  await PushSubscription.findOneAndUpdate(
    { endpoint },
    { $set: { user: user._id, p256dh: keys.p256dh, auth: keys.auth, userAgent: userAgent.slice(0, 300) } },
    { upsert: true },
  );
}

export async function unsubscribe(user, endpoint) {
  await PushSubscription.deleteOne({ endpoint, user: user._id });
}

export const countFor = (userId) => PushSubscription.countDocuments({ user: userId });

// payload: { title, body, url, tag }. Subscriptions the push service reports as gone (404/410) are removed.
export async function sendToUser(userId, payload) {
  if (!pushConfigured()) return { sent: 0, failed: 0 };
  const subs = await PushSubscription.find({ user: userId }).lean();
  let sent = 0;
  let failed = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      const req = webpush.generateRequestDetails(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
        { TTL: 12 * 60 * 60, vapidDetails: { subject: config.push.subject, publicKey: config.push.publicKey, privateKey: config.push.privateKey } },
      );
      delete req.headers['Content-Length'];
      const res = await fetch(req.endpoint, { method: req.method, headers: req.headers, body: req.body, signal: AbortSignal.timeout(10_000) });
      if (res.status === 404 || res.status === 410) {
        await PushSubscription.deleteOne({ _id: s._id });
        failed += 1;
      } else if (!res.ok) {
        failed += 1;
      } else {
        sent += 1;
        await PushSubscription.updateOne({ _id: s._id }, { $set: { lastSentAt: new Date() } });
      }
    } catch {
      failed += 1;
    }
  }));
  return { sent, failed };
}

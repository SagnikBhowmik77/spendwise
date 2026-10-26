import { HttpError } from '../errors.js';
import { emailConfigured } from '../mailer.js';
import { User } from '../models/index.js';
import * as push from '../services/push.service.js';

const DEFAULTS = { budgetPush: true, budgetEmail: false, billPush: true, billEmail: false, reminder: false, reminderTime: '21:00', loginEmail: true };

async function settingsFor(user) {
  const n = { ...DEFAULTS, ...user.notify };
  return {
    budgetPush: n.budgetPush,
    budgetEmail: n.budgetEmail,
    billPush: n.billPush,
    billEmail: n.billEmail,
    reminder: n.reminder,
    reminderTime: n.reminderTime,
    loginEmail: n.loginEmail,
    push: { configured: push.pushConfigured(), publicKey: push.publicKey() },
    email: { configured: emailConfigured() },
    // How many browsers or installed apps of this person receive push.
    devices: await push.countFor(user._id),
  };
}

export async function getSettings(req, res) {
  res.json(await settingsFor(req.user.toObject?.() ?? req.user));
}

export async function updateSettings(req, res) {
  const $set = Object.fromEntries(Object.entries(req.valid.body).map(([k, v]) => [`notify.${k}`, v]));
  // A new reminder time today should still fire today.
  if ('reminderTime' in req.valid.body || req.valid.body.reminder) $set['notify.lastReminderDay'] = null;
  const user = await User.findByIdAndUpdate(req.user._id, { $set }, { returnDocument: 'after', runValidators: true }).lean();
  res.json(await settingsFor(user));
}

export async function subscribe(req, res) {
  if (!push.pushConfigured()) throw new HttpError(503, 'push_not_configured', 'Push notifications are not set up on this server');
  await push.subscribe(req.user, { ...req.valid.body, userAgent: req.get('user-agent') ?? '' });
  res.status(201).json({ devices: await push.countFor(req.user._id) });
}

export async function unsubscribe(req, res) {
  await push.unsubscribe(req.user, req.valid.body.endpoint);
  res.status(204).end();
}

export async function sendTest(req, res) {
  if (!push.pushConfigured()) throw new HttpError(503, 'push_not_configured', 'Push notifications are not set up on this server');
  const result = await push.sendToUser(req.user._id, {
    title: 'Spendwise notifications work',
    body: 'Budget alerts and reminders will appear like this.',
    url: '/settings',
    tag: 'test',
  });
  if (!result.sent && !result.failed) throw new HttpError(400, 'no_devices', 'Turn on notifications in this browser first');
  res.json(result);
}

// Budget alerts at 80% and 100% (push and/or email to everyone in the space who wants them),
// and the daily "anything to log today?" reminder.
import { config } from '../config.js';
import { Budget, BudgetAlert, Space, Transaction, User, WeeklyBudget } from '../models/index.js';
import { currentMonth, dayString, formatPaise } from '../money.js';
import { todayIn } from '../schedule.js';
import { emailConfigured, sendMail } from '../mailer.js';
import { emitSpaceEvent } from '../events.js';
import { list as monthBudgets, weekly as weekBudgets } from './budget.service.js';
import { pushConfigured, sendToUser } from './push.service.js';

const inr = (paise) => `₹${formatPaise(paise)}`;
const monthLabel = (month) => new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`));
const shortDay = (day) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const NOTIFY_DEFAULTS = { budgetPush: true, budgetEmail: false, billPush: true, billEmail: false };

// Sends one message to everyone in a space, by push and/or email as each person chose.
// `kind` is "budget" or "bill" (each has its own on/off settings); `path` is the page to open.
export async function notifySpace(space, { kind, title, body, path, tag, linkText }) {
  const users = await User.find({ _id: { $in: space.members.map((m) => m.user) } }).lean();
  for (const u of users) {
    const n = { ...NOTIFY_DEFAULTS, ...u.notify };
    try {
      if (n[`${kind}Push`]) await sendToUser(u._id, { title, body, url: path, tag });
      // Only to an address its owner has confirmed.
      if (n[`${kind}Email`] && u.emailVerifiedAt && emailConfigured()) {
        const link = `${config.appUrl}${path}`;
        const why = `You get this because ${kind} emails are on in Settings → Notifications.`;
        await sendMail({
          to: u.email,
          subject: `Spendwise: ${title}`,
          text: `${body}\n\n${linkText}: ${link}\n\n${why}`,
          html: `<p style="font-family:sans-serif;font-size:15px">${escapeHtml(body)}</p><p style="font-family:sans-serif"><a href="${escapeHtml(link)}">${escapeHtml(linkText)}</a></p><p style="font-family:sans-serif;color:#64748b;font-size:12px">${escapeHtml(why)}</p>`,
        });
      }
    } catch (err) {
      console.error(`A ${kind} notification to a member failed: ${err.message}`);
    }
  }
}

async function notifyMembers(space, item, level) {
  const { b } = item;
  const title = level === 100 ? `${item.name} budget used up` : `${item.name} budget at ${Math.floor(b.percentUsed)}%`;
  const where = space.kind === 'shared' ? ` in ${space.name}` : '';
  const over = b.spent.paise - b.limit.paise;
  const body = `${inr(b.spent.paise)} of ${inr(b.limit.paise)} spent ${item.period}${where}.${over > 0 ? ` ${inr(over)} over.` : ''}`;
  await notifySpace(space, { kind: 'budget', title, body, path: '/budgets', tag: `budget-${item.key}`, linkText: 'See your budgets' });
  emitSpaceEvent(space._id, 'budget.alert', { budget: item.name, period: item.period, level, spent: b.spent, limit: b.limit, percentUsed: b.percentUsed });
}

// Looks at this month's and this week's budgets and announces each 80% / 100% crossing once.
// Jumping straight past 100% sends only the 100% alert.
export async function checkSpace(spaceId, { today = todayIn(config.timeZone) } = {}) {
  const month = dayString(today).slice(0, 7);
  const [space, view, week] = await Promise.all([
    Space.findById(spaceId).lean(),
    monthBudgets(spaceId, { month }),
    weekBudgets(spaceId, { date: today }),
  ]);
  if (!space) return { sent: 0 };
  const items = [
    ...[view.overall, ...view.categories].filter(Boolean)
      .map((b) => ({ key: `month:${b.id}:${month}`, name: b.category ?? 'Overall', period: `in ${monthLabel(month)}`, b })),
    ...week.budgets
      .map((b) => ({ key: `week:${b.id}:${week.week.from}`, name: `${b.category ?? 'Overall'} weekly`, period: `in the week of ${shortDay(week.week.from)}`, b })),
  ];
  let sent = 0;
  for (const item of items) {
    const level = item.b.spent.paise >= item.b.limit.paise ? 100 : item.b.percentUsed >= 80 ? 80 : null;
    if (!level) continue;
    const claimed = [];
    for (const l of level === 100 ? [80, 100] : [80]) {
      try {
        await BudgetAlert.create({ space: spaceId, key: item.key, level: l });
        claimed.push(l);
      } catch (err) {
        if (err.code !== 11000) throw err;
      }
    }
    if (!claimed.includes(level)) continue;
    await notifyMembers(space, item, level);
    sent += 1;
  }
  return { sent };
}

// Called after anything that changes spending or budgets. Checks run shortly after, once per burst
// (an import of 300 lines is one check), and never slow down the request that caused them.
const pending = new Map();
export function scheduleAlertCheck(spaceId) {
  const key = String(spaceId);
  const entry = pending.get(key);
  if (entry) {
    if (entry.started) entry.again = true;
    return;
  }
  const state = { started: false, again: false };
  state.done = new Promise((resolve) => setTimeout(resolve, config.alertDelayMs))
    .then(() => { state.started = true; return checkSpace(key); })
    .catch((err) => console.error(`Budget alert check failed: ${err.message}`))
    .finally(() => {
      pending.delete(key);
      if (state.again) scheduleAlertCheck(key);
    });
  pending.set(key, state);
}

// For tests: waits until every scheduled check has run.
export async function flushAlertChecks() {
  while (pending.size) await Promise.all([...pending.values()].map((s) => s.done));
}

// Safety net for the hourly job (recurring entries are created there): every space with a budget now.
export async function checkAllSpaces() {
  const month = currentMonth(todayIn(config.timeZone));
  const ids = new Set([
    ...(await Budget.distinct('space', { month })).map(String),
    ...(await WeeklyBudget.distinct('space')).map(String),
  ]);
  let sent = 0;
  for (const id of ids) sent += (await checkSpace(id)).sent;
  return { spaces: ids.size, sent };
}

// The clock in the app's time zone: { day: "YYYY-MM-DD", time: "HH:MM", dayStart: Date (that midnight) }.
function localClock(now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: config.timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map((p) => [p.type, p.value]));
  const sinceMidnight = ((Number(parts.hour) * 60 + Number(parts.minute)) * 60 + Number(parts.second)) * 1000 + now.getMilliseconds();
  return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`, dayStart: new Date(now.getTime() - sinceMidnight) };
}

// At each person's reminder time (default 9 pm), a push if they haven't added anything today.
// Handled once a day per person, whichever server instance gets there first.
export async function sendReminders({ now = new Date() } = {}) {
  if (!pushConfigured()) return { due: 0, sent: 0 };
  const { day, time, dayStart } = localClock(now);
  const due = await User.find({ 'notify.reminder': true, 'notify.reminderTime': { $lte: time }, 'notify.lastReminderDay': { $ne: day } }).lean();
  let sent = 0;
  for (const u of due) {
    const claim = await User.updateOne({ _id: u._id, 'notify.lastReminderDay': { $ne: day } }, { $set: { 'notify.lastReminderDay': day } });
    if (!claim.modifiedCount) continue;
    const logged = await Transaction.exists({ user: u._id, $or: [{ createdAt: { $gte: dayStart } }, { date: new Date(`${day}T00:00:00Z`) }] });
    if (logged) continue;
    const res = await sendToUser(u._id, {
      title: 'Anything to log today?',
      body: "You haven't added any spending today. It takes a few seconds.",
      url: '/?add=expense',
      tag: 'daily-reminder',
    });
    sent += res.sent;
  }
  return { due: due.length, sent };
}

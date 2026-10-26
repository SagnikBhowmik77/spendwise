// No-spend streaks and challenges, logging streaks and low-key achievements, all worked out from the
// space's entries. Fixed costs (recurring entries, bills and EMIs paid) never break a no-spend day.
import mongoose from 'mongoose';
import { HttpError } from '../errors.js';
import { config } from '../config.js';
import { Budget, Challenge, Goal, ImportBatch, Loan, Transaction } from '../models/index.js';
import { currentMonth, dayString, monthRange, shiftMonth } from '../money.js';
import { addDays, todayIn } from '../schedule.js';
import { loanState } from '../finance.js';
import { expenses, fixedIds, isFixed } from './insights.service.js';
import { list as monthBudgets } from './budget.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const today = () => todayIn(config.timeZone);
const daysBetween = (a, b) => Math.round((b - a) / DAY_MS);
const LOOKBACK_DAYS = 400;

async function firstEntry(spaceId) {
  return (await Transaction.findOne({ space: spaceId, deletedAt: null }, { date: 1 }).sort({ date: 1 }).lean())?.date ?? null;
}

// Days with day-to-day spending (Set of "YYYY-MM-DD"), and days with any entry at all.
async function dayMaps(spaceId, from, to) {
  const [rows, fixed, logged] = await Promise.all([
    expenses(spaceId, from, to),
    fixedIds(spaceId),
    Transaction.aggregate([
      { $match: { space: new mongoose.Types.ObjectId(String(spaceId)), deletedAt: null, date: { $gte: from, $lte: to } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } } } },
    ]),
  ]);
  const spending = new Map();
  for (const t of rows.filter((x) => !isFixed(x, fixed))) {
    const d = dayString(t.date);
    spending.set(d, [...(spending.get(d) ?? []), t.category]);
  }
  return { spending, logged: new Set(logged.map((r) => r._id)) };
}

function longestRun(start, end, test) {
  let best = 0;
  let bestEnd = null;
  let run = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (test(dayString(d))) { run += 1; if (run > best) { best = run; bestEnd = d; } } else run = 0;
  }
  return { days: best, ended: bestEnd ? dayString(bestEnd) : null };
}

export async function streaks(spaceId) {
  const now = today();
  const first = await firstEntry(spaceId);
  if (!first) return { since: null, noSpend: { current: 0, longest: { days: 0, ended: null }, thisMonth: 0, todaySoFar: true }, logging: { current: 0, longest: { days: 0, ended: null } } };
  const start = first > addDays(now, -LOOKBACK_DAYS) ? first : addDays(now, -LOOKBACK_DAYS);
  const { spending, logged } = await dayMaps(spaceId, start, now);
  const noSpend = (d) => !spending.has(d);
  let current = 0;
  for (let d = now; d >= start && noSpend(dayString(d)); d = addDays(d, -1)) current += 1;
  const monthStart = monthRange(currentMonth(now)).from;
  let thisMonth = 0;
  for (let d = monthStart > start ? monthStart : start; d <= now; d = addDays(d, 1)) if (noSpend(dayString(d))) thisMonth += 1;
  // Logging: today counts once something is added; until then the streak up to yesterday stands.
  let logging = 0;
  for (let d = logged.has(dayString(now)) ? now : addDays(now, -1); d >= start && logged.has(dayString(d)); d = addDays(d, -1)) logging += 1;
  return {
    since: dayString(start),
    noSpend: { current, todaySoFar: noSpend(dayString(now)), longest: longestRun(addDays(now, -364) > start ? addDays(now, -364) : start, now, noSpend), thisMonth },
    logging: { current: logging, longest: longestRun(start, now, (d) => logged.has(d)) },
  };
}

function serializeChallenge(c, spending, now) {
  const end = addDays(c.startDate, c.days - 1);
  const until = [end, now, c.endedAt ? todayLike(c.endedAt) : null].filter(Boolean).reduce((a, b) => (b < a ? b : a));
  let failedOn = null;
  let clean = 0;
  for (let d = c.startDate; d <= until; d = addDays(d, 1)) {
    const cats = (spending.get(dayString(d)) ?? []).filter((x) => !c.allowed.includes(x));
    if (cats.length) { failedOn = dayString(d); break; }
    clean += 1;
  }
  let status = 'active';
  if (failedOn) status = 'failed';
  else if (c.endedAt && todayLike(c.endedAt) < end) status = 'stopped';
  else if (now > end) status = 'completed';
  else if (c.startDate > now) status = 'scheduled';
  return {
    id: String(c._id), kind: c.kind, days: c.days, startDate: dayString(c.startDate), endDate: dayString(end), allowed: c.allowed,
    status, failedOn, cleanDays: clean, daysLeft: status === 'active' ? daysBetween(now, end) + 1 : status === 'scheduled' ? c.days : 0,
  };
}
const todayLike = (date) => new Date(`${dayString(date)}T00:00:00Z`);
const niceDay = (d) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d);
const niceMonth = (m) => new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${m}-01T00:00:00Z`));

export async function listChallenges(spaceId) {
  const now = today();
  const list = await Challenge.find({ space: spaceId }).sort({ startDate: -1 }).limit(20).lean();
  if (!list.length) return [];
  const from = list.reduce((a, c) => (c.startDate < a ? c.startDate : a), now);
  const { spending } = await dayMaps(spaceId, from, now);
  return list.map((c) => serializeChallenge(c, spending, now));
}

export async function startChallenge({ space, user }, { days, startDate, allowed = [] }) {
  const now = today();
  const start = startDate ?? now;
  // Tomorrow is allowed: after spending today, a challenge can start fresh the next day.
  if (start > addDays(now, 1)) throw new HttpError(400, 'validation_failed', 'Some fields are missing or invalid', [{ field: 'startDate', message: 'Start today, tomorrow or on a day that has passed' }]);
  const running = (await listChallenges(space._id)).find((c) => c.status === 'active' || c.status === 'scheduled');
  if (running) throw new HttpError(409, 'challenge_running', `A ${running.days}-day challenge is already running until ${running.endDate}`);
  const c = await Challenge.create({ space: space._id, days, startDate: start, allowed, createdBy: user._id });
  return (await listChallenges(space._id)).find((x) => x.id === String(c._id));
}

export async function stopChallenge(spaceId, id) {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(404, 'challenge_not_found', 'Challenge not found');
  const c = await Challenge.findOneAndUpdate({ _id: id, space: spaceId, endedAt: null }, { $set: { endedAt: new Date() } });
  if (!c) throw new HttpError(404, 'challenge_not_found', 'Challenge not found');
}

// Quiet milestones: shown on the Insights page, never pushed or emailed.
export async function achievements(spaceId) {
  const now = today();
  const [first, count, s, goals, loans, imported] = await Promise.all([
    firstEntry(spaceId),
    Transaction.countDocuments({ space: spaceId, deletedAt: null }),
    streaks(spaceId),
    Goal.find({ space: spaceId }).lean(),
    Loan.find({ space: spaceId }).lean(),
    ImportBatch.exists({ space: spaceId, undoneAt: null }),
  ]);
  // Complete months of the last year: savings rate and budgets kept.
  const months = Array.from({ length: 12 }, (_, i) => shiftMonth(currentMonth(now), -(i + 1)));
  const flows = await Transaction.aggregate([
    { $match: { space: new mongoose.Types.ObjectId(String(spaceId)), deletedAt: null, type: { $in: ['income', 'expense'] }, date: { $gte: monthRange(months.at(-1)).from, $lte: monthRange(months[0]).to } } },
    { $group: { _id: { m: { $dateToString: { format: '%Y-%m', date: '$date' } }, t: '$type' }, total: { $sum: '$amountPaise' } } },
  ]);
  const flow = (m, t) => flows.find((r) => r._id.m === m && r._id.t === t)?.total ?? 0;
  const saver = months.find((m) => flow(m, 'income') > 0 && (flow(m, 'income') - flow(m, 'expense')) * 5 >= flow(m, 'income'));
  const budgetMonths = await Budget.distinct('month', { space: spaceId, month: { $in: months } });
  let kept = null;
  for (const m of budgetMonths.sort().reverse()) {
    const v = await monthBudgets(spaceId, { month: m });
    const all = [v.overall, ...v.categories].filter(Boolean);
    if (all.length && all.every((b) => b.status !== 'over')) { kept = m; break; }
  }
  const saved = (g) => g.entries.reduce((x, e) => x + e.amountPaise, 0) >= g.targetPaise;
  const loanDone = loans.find((l) => loanState({ principalPaise: l.principalPaise, annualRatePct: l.annualRatePct, emiPaise: l.emiPaise, firstEmiDate: l.firstEmiDate, payments: l.payments }).balancePaise === 0);
  // The detail is a template and its values, so the app can show it in Hindi (12K); `detail` is the English.
  const run = (days) => ['Longest run: {n} days', { n: days }];
  const list = [
    ['first-entry', 'First step', 'Added your first entry', Boolean(first), first && ['On {date}', { date: dayString(first) }]],
    ['logging-7', 'Week of logging', 'Added something 7 days in a row', s.logging.longest.days >= 7, run(s.logging.longest.days)],
    ['logging-30', 'Month of logging', 'Added something 30 days in a row', s.logging.longest.days >= 30, run(s.logging.longest.days)],
    ['no-spend-week', 'Quiet week', '7 days in a row without day-to-day spending', s.noSpend.longest.days >= 7, run(s.noSpend.longest.days)],
    ['budget-kept', 'Within budget', 'Finished a month with every budget kept', Boolean(kept), kept && ['In {month}', { month: kept }]],
    ['saver-20', 'Saver', 'Kept at least 20% of a month’s income', Boolean(saver), saver && ['In {month}', { month: saver }]],
    ['goal-reached', 'Goal reached', 'Saved the full amount for a goal', goals.some(saved), null],
    ['emergency-fund', 'Safety net', 'Filled an emergency fund goal', goals.some((g) => g.kind === 'emergency' && saved(g)), null],
    ['loan-repaid', 'Loan repaid', 'Paid off a loan completely', Boolean(loanDone), loanDone && ['{name}', { name: loanDone.name }]],
    ['first-import', 'Statement in', 'Imported a bank or card statement', Boolean(imported), null],
    ['hundred-entries', 'Hundred entries', 'Recorded 100 entries', count >= 100, ['{n} so far', { n: count }]],
  ];
  const english = ([text, vars]) => text.replace(/\{(\w+)\}/g, (_, k) => (k === 'date' ? niceDay(new Date(`${vars.date}T00:00:00Z`)) : k === 'month' ? niceMonth(vars.month) : String(vars[k])));
  return {
    achievements: list.map(([id, title, description, achieved, d]) => ({
      id, title, description, achieved, detail: d ? english(d) : null, detailText: d ? d[0] : null, detailVars: d ? d[1] : null,
    })),
  };
}

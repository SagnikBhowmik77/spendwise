// Insights, saved reports and no-spend challenges (batch 12F).
import { config } from '../config.js';
import { addDays, todayIn } from '../schedule.js';
import { currentMonth, monthRange, shiftMonth } from '../money.js';
import * as insights from '../services/insights.service.js';
import * as habits from '../services/habit.service.js';
import * as reports from '../services/savedReport.service.js';

const sid = (req) => req.space._id;
const ctx = (req) => ({ space: req.space, user: req.user });
// A from/to range, defaulting to the last `days` days.
const range = (q, days) => {
  const to = q.to ?? todayIn(config.timeZone);
  return { from: q.from ?? addDays(to, -(days - 1)), to };
};

export const forecast = async (req, res) => res.json(await insights.forecast(sid(req)));
export const unusual = async (req, res) => res.json(await insights.unusual(sid(req), req.valid.query));
export const savingsRate = async (req, res) => res.json(await insights.savingsRate(sid(req), req.valid.query));
export const patterns = async (req, res) => res.json(await insights.patterns(sid(req), range(req.valid.query, 90)));
export const compare = async (req, res) => res.json(await insights.compare(sid(req), req.valid.query));
export const merchants = async (req, res) => {
  const q = req.valid.query;
  const from = q.from ?? monthRange(shiftMonth(currentMonth(todayIn(config.timeZone)), -5)).from;
  res.json(await insights.merchants(sid(req), { from, to: q.to ?? todayIn(config.timeZone) }));
};
export const merchant = async (req, res) => res.json(await insights.merchant(sid(req), req.params.name));
export const subscriptions = async (req, res) => res.json(await insights.subscriptions(sid(req)));
export const year = async (req, res) => res.json(await insights.yearReview(sid(req), req.valid.query));
export const inflation = async (req, res) => res.json(await insights.inflation(sid(req), req.valid.query));
export const regret = async (req, res) => res.json(await insights.regret(sid(req), req.valid.query));
export const streaks = async (req, res) => res.json(await habits.streaks(sid(req)));
export const achievements = async (req, res) => res.json(await habits.achievements(sid(req)));

export const listChallenges = async (req, res) => res.json({ challenges: await habits.listChallenges(sid(req)) });
export const startChallenge = async (req, res) => res.status(201).json({ challenge: await habits.startChallenge(ctx(req), req.valid.body) });
export const stopChallenge = async (req, res) => { await habits.stopChallenge(sid(req), req.params.id); res.status(204).end(); };

export const listReports = async (req, res) => res.json({ reports: await reports.list(sid(req)) });
export const previewReport = async (req, res) => res.json(await reports.run(sid(req), req.valid.body));
export const createReport = async (req, res) => res.status(201).json({ report: await reports.create(ctx(req), req.valid.body) });
export const updateReport = async (req, res) => res.json({ report: await reports.update(sid(req), req.params.id, req.valid.body) });
export const deleteReport = async (req, res) => { await reports.remove(sid(req), req.params.id); res.status(204).end(); };
export const runReport = async (req, res) => res.json(await reports.runSaved(sid(req), req.params.id));

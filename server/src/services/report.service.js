import { HttpError } from '../errors.js';
import { config } from '../config.js';
import { User } from '../models/index.js';
import { emailConfigured, sendMail } from '../mailer.js';
import { dayString, formatPaise, monthRange, shiftMonth } from '../money.js';
import { todayIn } from '../schedule.js';
import * as stats from './stats.service.js';
import * as budgets from './budget.service.js';
import { ensurePersonalSpace } from './space.service.js';

const NOT_CONFIGURED = () => new HttpError(503, 'email_not_configured', 'Email is not configured on this server');
const NOT_VERIFIED = () => new HttpError(409, 'email_not_verified', 'Confirm your email address first: open the link we sent you, or send a new one from Settings.');

// The report sent during a month covers the month before it.
export const reportMonthFor = (today = todayIn(config.timeZone)) => shiftMonth(dayString(today).slice(0, 7), -1);

export const monthLabel = (month) =>
  new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(monthRange(month).from);

const inr = (paise) => `₹${formatPaise(paise)}`;
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The monthly report covers the user's personal space (shared spaces have several people's money).
export async function buildReport(user, month) {
  const { _id: spaceId } = await ensurePersonalSpace(user);
  const { from, to } = monthRange(month);
  const prevMonth = shiftMonth(month, -1);
  const prev = monthRange(prevMonth);
  const [summary, previous, byCategory, budgetView] = await Promise.all([
    stats.summary(spaceId, { from, to }),
    stats.summary(spaceId, { from: prev.from, to: prev.to }),
    stats.byCategory(spaceId, { from, to, type: 'expense' }),
    budgets.list(spaceId, { month }),
  ]);
  const change = previous.expense.paise
    ? Math.round(((summary.expense.paise - previous.expense.paise) * 1000) / previous.expense.paise) / 10
    : null;
  return {
    month,
    label: monthLabel(month),
    name: user.name,
    summary,
    previous: { month: prevMonth, label: monthLabel(prevMonth), expense: previous.expense },
    // Percent change in spending vs the month before; null when there was nothing to compare with.
    expenseChangePercent: change,
    topCategories: byCategory.categories.slice(0, 5),
    budgets: { overall: budgetView.overall, categories: budgetView.categories },
  };
}

function budgetLine(b) {
  const label = b.category ?? 'Overall';
  const status = { ok: 'on track', warning: 'close to the limit', over: 'over budget' }[b.status];
  return { label, text: `${inr(b.spent.paise)} of ${inr(b.limit.paise)} (${b.percentUsed}%, ${status})`, status: b.status };
}

export function renderReport(r) {
  const subject = `Your Spendwise summary for ${r.label}`;
  const settingsUrl = `${config.appUrl}/settings`;
  const { income, expense, balance, count } = r.summary;
  const budgetLines = [r.budgets.overall, ...r.budgets.categories].filter(Boolean).map(budgetLine);
  let changeText = null;
  if (r.expenseChangePercent !== null) {
    const dir = r.expenseChangePercent > 0 ? 'more' : 'less';
    changeText = r.expenseChangePercent === 0
      ? `You spent the same as in ${r.previous.label}.`
      : `You spent ${Math.abs(r.expenseChangePercent)}% ${dir} than in ${r.previous.label} (${inr(r.previous.expense.paise)}).`;
  }

  // Plain-text version for mail apps that don't show HTML.
  const text = [
    `Hi ${r.name},`,
    '',
    `Here is your Spendwise summary for ${r.label}.`,
    '',
    ...(count === 0
      ? [`You didn't record any transactions in ${r.label}.`]
      : [
        `Income:   ${inr(income.paise)}`,
        `Expenses: ${inr(expense.paise)}`,
        `Balance:  ${inr(balance.paise)}`,
        `${count} transaction${count === 1 ? '' : 's'}`,
        ...(changeText ? ['', changeText] : []),
        ...(r.topCategories.length
          ? ['', 'Where the money went:', ...r.topCategories.map((c) => `- ${c.category}: ${inr(c.total.paise)} (${c.share}%)`)]
          : []),
      ]),
    ...(budgetLines.length ? ['', 'Budgets:', ...budgetLines.map((b) => `- ${b.label}: ${b.text}`)] : []),
    '',
    `You get this email because monthly reports are turned on. Turn them off in Spendwise settings: ${settingsUrl}`,
  ].join('\n');

  const card = (label, paise, color) => `
    <td style="padding:12px;border:1px solid #e5e7eb;border-radius:8px;width:33%">
      <div style="font-size:12px;color:#6b7280">${label}</div>
      <div style="font-size:18px;font-weight:700;color:${color}">${inr(paise)}</div>
    </td>`;
  const row = (cells) => `<tr>${cells.map(([content, style = '']) =>
    `<td style="padding:8px;border-bottom:1px solid #f3f4f6;${style}">${content}</td>`).join('')}</tr>`;
  const statusColor = { ok: '#047857', warning: '#b45309', over: '#b91c1c' };

  const summaryHtml = count === 0
    ? `<p style="padding:16px;background:#fff;border:1px solid #e5e7eb;border-radius:8px">You didn't record any transactions in ${escapeHtml(r.label)}.</p>`
    : `<table role="presentation" style="width:100%;border-collapse:separate;border-spacing:6px;background:#fff"><tr>
        ${card('Income', income.paise, '#047857')}${card('Expenses', expense.paise, '#b91c1c')}${card('Balance', balance.paise, balance.paise < 0 ? '#b91c1c' : '#111827')}
      </tr></table>
      <p style="color:#4b5563;font-size:14px">${count} transaction${count === 1 ? '' : 's'}${changeText ? ` · ${escapeHtml(changeText)}` : ''}</p>`;
  const categoriesHtml = count && r.topCategories.length
    ? `<h2 style="font-size:16px;margin:20px 0 8px">Where the money went</h2>
      <table role="presentation" style="width:100%;border-collapse:collapse;background:#fff;font-size:14px">
        ${r.topCategories.map((c) => row([[escapeHtml(c.category)], [inr(c.total.paise), 'text-align:right'], [`${c.share}%`, 'text-align:right;color:#6b7280']])).join('')}
      </table>`
    : '';
  const budgetsHtml = budgetLines.length
    ? `<h2 style="font-size:16px;margin:20px 0 8px">Budgets</h2>
      <table role="presentation" style="width:100%;border-collapse:collapse;background:#fff;font-size:14px">
        ${budgetLines.map((b) => row([[escapeHtml(b.label)], [escapeHtml(b.text), `text-align:right;color:${statusColor[b.status]}`]])).join('')}
      </table>`
    : '';

  const html = `<!doctype html>
<html><body style="margin:0;background:#f9fafb;font-family:Arial,Helvetica,sans-serif;color:#111827">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px">
    <h1 style="font-size:20px;margin:0 0 4px">Your summary for ${escapeHtml(r.label)}</h1>
    <p style="margin:0 0 20px;color:#4b5563">Hi ${escapeHtml(r.name)}, here's how ${escapeHtml(r.label)} went.</p>
    ${summaryHtml}
    ${categoriesHtml}
    ${budgetsHtml}
    <p style="margin-top:28px;font-size:12px;color:#6b7280">You get this email because monthly reports are turned on.
      <a href="${escapeHtml(settingsUrl)}" style="color:#4f46e5">Turn them off in Spendwise settings</a>.</p>
  </div>
</body></html>`;
  return { subject, text, html };
}

async function deliver(user, month) {
  const message = renderReport(await buildReport(user, month));
  await sendMail({ to: user.email, ...message });
  return message;
}

export function getSettings(user) {
  return {
    enabled: Boolean(user.monthlyReport?.enabled),
    lastSentMonth: user.monthlyReport?.lastSentMonth ?? null,
    emailConfigured: emailConfigured(),
    emailVerified: Boolean(user.emailVerifiedAt),
  };
}

export async function updateSettings(user, { enabled }) {
  if (enabled && !emailConfigured()) throw NOT_CONFIGURED();
  if (enabled && !user.emailVerifiedAt) throw NOT_VERIFIED();
  const set = { 'monthlyReport.enabled': enabled };
  // Turning reports on starts with this month's report (sent next month), not an immediate one for a
  // month the user may not have tracked.
  if (enabled && !user.monthlyReport?.enabled) set['monthlyReport.lastSentMonth'] = reportMonthFor();
  const updated = await User.findByIdAndUpdate(user._id, { $set: set }, { new: true });
  return getSettings(updated);
}

export async function preview(user, month = reportMonthFor()) {
  const report = await buildReport(user, month);
  return { report, ...renderReport(report) };
}

// Sends a report to the user's own address right away (it doesn't count as the monthly send).
export async function sendTest(user, month = reportMonthFor()) {
  if (!emailConfigured()) throw NOT_CONFIGURED();
  if (!user.emailVerifiedAt) throw NOT_VERIFIED();
  const { subject } = await deliver(user, month);
  return { sentTo: user.email, month, subject };
}

// Background job: during each month, send last month's report once to everyone who opted in.
// The user row is "claimed" before sending, so two overlapping runs can't both send.
export async function sendMonthlyReports({ today, log = console } = {}) {
  if (!emailConfigured()) return { month: null, sent: 0, failed: 0 };
  const month = reportMonthFor(today);
  // Only to confirmed addresses; an unconfirmed one keeps its turn for when it is confirmed.
  const due = await User.find({ 'monthlyReport.enabled': true, 'monthlyReport.lastSentMonth': { $ne: month }, emailVerifiedAt: { $ne: null } }).lean();
  let sent = 0;
  let failed = 0;
  for (const u of due) {
    const before = await User.findOneAndUpdate(
      { _id: u._id, 'monthlyReport.enabled': true, 'monthlyReport.lastSentMonth': { $ne: month } },
      { $set: { 'monthlyReport.lastSentMonth': month } },
      { new: false, lean: true },
    );
    if (!before) continue;
    try {
      await deliver(before, month);
      sent += 1;
    } catch (err) {
      failed += 1;
      log.error(`Monthly report to user ${u._id} failed: ${err.message}`);
      // Give it back so the next run tries again.
      await User.updateOne(
        { _id: u._id, 'monthlyReport.lastSentMonth': month },
        { $set: { 'monthlyReport.lastSentMonth': before.monthlyReport?.lastSentMonth ?? null } },
      );
    }
  }
  return { month, sent, failed };
}

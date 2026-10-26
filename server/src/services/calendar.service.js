// Batch 12S: money dates as a calendar (iCalendar, RFC 5545) that Google Calendar, Apple Calendar or Outlook can
// subscribe to: bills, EMIs, SIPs, credit card due dates, FD/RD/PPF maturities, policy and warranty expiries and
// sinking-fund due dates, from a month back to a year ahead. All-day events, each with a reminder the day before.
import crypto from 'node:crypto';
import { HttpError } from '../errors.js';
import { config } from '../config.js';
import { runAs } from '../access.js';
import {
  Account, Bill, BILL_FREQUENCIES, CalendarFeed, Holding, Loan, SinkingFund, Space, User, VaultItem,
} from '../models/index.js';
import { loanState } from '../finance.js';
import { addMonths } from '../invest.js';
import { dayString, formatPaise } from '../money.js';
import { addDays, occurrenceDate, todayIn } from '../schedule.js';
import { sha256 } from '../security.js';
import { maturityOf } from './investment.service.js';

const PREFIX = 'cal_';
export const FEED_FILE = /^(cal_[A-Za-z0-9_-]{43})\.ics$/;
const MAX_PER_ITEM = 60;
const inr = (paise) => (paise ? `₹${formatPaise(paise)}` : null);
const feedUrl = (token) => `${config.apiUrl}/api/calendar/${token}.ics`;

// ── iCalendar text ──

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const ymd = (d) => dayString(d).replaceAll('-', '');
// Lines longer than 75 bytes are folded: CRLF and a space, never splitting a character.
function fold(line) {
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
    if (bytes + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

function vevent({ uid, date, summary, description, path, category }, stamp) {
  return [
    'BEGIN:VEVENT',
    `UID:${uid}@spendwise`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${ymd(date)}`,
    `DTEND;VALUE=DATE:${ymd(addDays(date, 1))}`,
    `SUMMARY:${esc(summary)}`,
    description ? `DESCRIPTION:${esc(description)}` : null,
    `URL:${config.appUrl}${path}`,
    `CATEGORIES:${esc(category)}`,
    'TRANSP:TRANSPARENT',
    // 9 am the day before (all-day events start at midnight).
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(summary)}`, 'TRIGGER:-PT15H', 'END:VALARM',
    'END:VEVENT',
  ].filter(Boolean);
}

export function toIcs(name, events, now = new Date()) {
  const stamp = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Spendwise//Money calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(name)}`, `X-WR-TIMEZONE:${config.timeZone}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H', 'X-PUBLISHED-TTL:PT6H',
    ...events.flatMap((e) => vevent(e, stamp)),
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

// ── The dates ──

// The dates nth(0), nth(1), … that fall in [from, to] (nth returns null once there are no more).
function within(from, to, nth) {
  const out = [];
  for (let i = 0; out.length < MAX_PER_ITEM && i < 600; i += 1) {
    const d = nth(i);
    if (!d || d > to) break;
    if (d >= from) out.push(d);
  }
  return out;
}

// A card's due day in a month (the 31st becomes the last day of a short month).
const dueInMonth = (y, m, day) => new Date(Date.UTC(y, m, Math.min(day, new Date(Date.UTC(y, m + 1, 0)).getUTCDate())));

export async function events(spaceId, { today = todayIn(config.timeZone) } = {}) {
  const from = addDays(today, -31);
  const to = addDays(today, 365);
  const [bills, loans, holdings, cards, vault, funds] = await Promise.all([
    Bill.find({ space: spaceId, active: true }).lean(),
    Loan.find({ space: spaceId }).lean(),
    Holding.find({ space: spaceId, closed: false }).lean(),
    Account.find({ space: spaceId, type: 'credit_card', archived: false, dueDay: { $ne: null } }).lean(),
    VaultItem.find({ space: spaceId, expiryDate: { $gte: from, $lte: to } }).lean(),
    SinkingFund.find({ space: spaceId }).lean(),
  ]);
  const out = [];
  for (const b of bills) {
    const step = BILL_FREQUENCIES[b.frequency];
    for (const d of within(from, to, (i) => occurrenceDate(b.firstDue, 'monthly', step, b.paidCount + i))) {
      out.push({ uid: `bill-${b._id}-${ymd(d)}`, date: d, summary: `Bill: ${b.name}${b.amountPaise ? ` ${inr(b.amountPaise)}` : ''}`, description: `${b.category}, ${b.frequency}`, path: '/bills', category: 'Bill' });
    }
  }
  for (const l of loans) {
    const s = loanState({ principalPaise: l.principalPaise, annualRatePct: l.annualRatePct, emiPaise: l.emiPaise, firstEmiDate: l.firstEmiDate, payments: l.payments });
    if (!s.nextEmiDate) continue;
    for (const d of within(from, to, (i) => (i < s.monthsLeft ? addMonths(s.nextEmiDate, i) : null))) {
      out.push({ uid: `emi-${l._id}-${ymd(d)}`, date: d, summary: `EMI: ${l.name} ${inr(l.emiPaise)}`, description: l.lender ? `To ${l.lender}` : '', path: '/plan?tab=loans', category: 'EMI' });
    }
  }
  for (const h of holdings) {
    if (h.sip?.active) {
      for (const d of within(from, to, (i) => addMonths(h.sip.startDate, h.sip.count + i))) {
        out.push({ uid: `sip-${h._id}-${ymd(d)}`, date: d, summary: `SIP: ${h.name} ${inr(h.sip.amountPaise)}`, description: 'Monthly SIP instalment', path: '/investments', category: 'SIP' });
      }
    }
    const maturity = ['fd', 'rd', 'ppf'].includes(h.kind) ? maturityOf(h) : null;
    if (maturity && maturity >= from && maturity <= to) {
      out.push({ uid: `maturity-${h._id}-${ymd(maturity)}`, date: maturity, summary: `${h.kind.toUpperCase()} matures: ${h.name}`, description: 'Decide whether to renew it or move the money', path: '/investments', category: 'Maturity' });
    }
  }
  for (const c of cards) {
    const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
    for (const d of within(from, to, (i) => { const m = addMonths(start, i); return dueInMonth(m.getUTCFullYear(), m.getUTCMonth(), c.dueDay); })) {
      out.push({ uid: `card-${c._id}-${ymd(d)}`, date: d, summary: `Card bill due: ${c.name}`, description: 'Pay at least the minimum to avoid late fees and interest', path: '/accounts', category: 'Credit card' });
    }
  }
  for (const x of vault) {
    const what = x.kind === 'insurance' ? 'Policy renewal' : 'Warranty ends';
    out.push({ uid: `vault-${x._id}-${ymd(x.expiryDate)}`, date: x.expiryDate, summary: `${what}: ${x.name}`, description: [x.provider, x.number].filter(Boolean).join(', '), path: '/vault', category: x.kind === 'insurance' ? 'Insurance' : 'Warranty' });
  }
  for (const f of funds) {
    if (f.nextDue >= from && f.nextDue <= to) {
      out.push({ uid: `fund-${f._id}-${ymd(f.nextDue)}`, date: f.nextDue, summary: `Due: ${f.name} ${inr(f.amountPaise)}`, description: 'Sinking fund', path: '/budgets?tab=funds', category: 'Sinking fund' });
    }
  }
  return out.sort((a, b) => a.date - b.date || a.summary.localeCompare(b.summary));
}

// The person's view of the space: their private accounts in, other members' private accounts out.
async function asMember(space, userId, fn) {
  const hidden = space.kind === 'shared'
    ? (await runAs({ hidden: [] }, () => Account.find({ space: space._id, privateTo: { $nin: [null, userId] } }).select('_id').lean().exec())).map((a) => a._id)
    : [];
  return runAs({ userId, hidden }, fn);
}

const calendarName = (space) => (space.kind === 'personal' ? 'Spendwise' : `Spendwise – ${space.name}`);

export async function icsFor(space, user) {
  return asMember(space, user._id, async () => toIcs(calendarName(space), await events(space._id)));
}

// ── The private address ──

export async function status({ space, user }) {
  const f = await CalendarFeed.findOne({ user: user._id, space: space._id }).lean();
  return { feed: f ? { createdAt: f.createdAt, lastFetchedAt: f.lastFetchedAt } : null };
}

// Makes the address, or a new one in place of the old (which stops working). Shown only now.
export async function reset({ space, user }) {
  const token = PREFIX + crypto.randomBytes(32).toString('base64url');
  const f = await CalendarFeed.findOneAndUpdate(
    { user: user._id, space: space._id },
    { $set: { hash: sha256(token), lastFetchedAt: null } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  ).lean();
  return { url: feedUrl(token), feed: { createdAt: f.createdAt, lastFetchedAt: null } };
}

export async function remove({ space, user }) {
  await CalendarFeed.deleteOne({ user: user._id, space: space._id });
}

// Public: the calendar behind a private address, if it's still valid and its owner is still in the space.
export async function publicIcs(token) {
  const f = await CalendarFeed.findOne({ hash: sha256(token) }).lean();
  if (!f) throw new HttpError(404, 'calendar_not_found', 'This calendar address is not valid any more');
  const [space, user] = await Promise.all([
    Space.findOne({ _id: f.space, 'members.user': f.user }),
    User.findById(f.user).select('_id').lean(),
  ]);
  if (!space || !user) {
    await CalendarFeed.deleteOne({ _id: f._id });
    throw new HttpError(404, 'calendar_not_found', 'This calendar address is not valid any more');
  }
  await CalendarFeed.updateOne({ _id: f._id }, { $set: { lastFetchedAt: new Date() } });
  return icsFor(space, user);
}

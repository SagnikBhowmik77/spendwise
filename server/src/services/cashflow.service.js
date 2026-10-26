// The next weeks of money in and out of cash, bank and wallet accounts: scheduled income and
// payments, card bills and usual day-to-day spending, with the lowest point and any day below zero.
import { config } from '../config.js';
import { Bill, BILL_FREQUENCIES, Loan } from '../models/index.js';
import { dayString } from '../money.js';
import { addDays, occurrenceDate, todayIn } from '../schedule.js';
import { cardCycle, loanState } from '../finance.js';
import { list as listAccounts, cycle as cardCycleOf } from './account.service.js';
import { upcoming as upcomingRecurring } from './recurring.service.js';
import { dayToDayRate, savingsRate } from './insights.service.js';

const LIQUID = ['cash', 'bank', 'wallet'];
const money = (paise) => (paise === null || paise === undefined ? null : { paise, rupees: paise / 100 });
const later = (a, b) => (a > b ? a : b);

export async function cashflow(space, { days = 60 } = {}) {
  const now = todayIn(config.timeZone);
  const end = addDays(now, days);
  const today = dayString(now);
  const { accounts } = await listAccounts(space, { includeArchived: false });
  const liquid = accounts.filter((a) => LIQUID.includes(a.type));
  const liquidIds = new Set(liquid.map((a) => a.id));
  const cards = accounts.filter((a) => a.type === 'credit_card');
  const start = liquid.reduce((s, a) => s + a.balance.paise, 0);
  const events = [];
  const unknown = [];
  // Overdue items are counted as due today.
  const push = (date, kind, name, paise) => events.push({ date: later(dayString(date), today), kind, name, amount: money(paise) });

  for (const r of (await upcomingRecurring(space._id, { days })).items) {
    if (r.type === 'transfer' || !liquidIds.has(r.account)) continue;
    push(new Date(`${r.date}T00:00:00Z`), r.type === 'income' ? 'income' : 'recurring', r.note || r.category, r.type === 'income' ? r.amountPaise : -r.amountPaise);
  }
  for (const b of await Bill.find({ space: space._id, active: true }).lean()) {
    if (b.account && cards.some((c) => c.id === String(b.account))) continue; // paid by card: shows up in the card bill
    const amount = b.amountPaise ?? [...b.payments].reverse().find((p) => !p.skipped)?.amountPaise ?? null;
    for (let i = b.paidCount; i < b.paidCount + 24; i += 1) {
      const due = occurrenceDate(b.firstDue, 'monthly', BILL_FREQUENCIES[b.frequency], i);
      if (due > end) break;
      if (amount === null) unknown.push({ date: later(dayString(due), today), name: b.name });
      else push(due, 'bill', b.name, -amount);
    }
  }
  for (const l of await Loan.find({ space: space._id }).lean()) {
    if (l.account && cards.some((c) => c.id === String(l.account))) continue;
    const s = loanState({ principalPaise: l.principalPaise, annualRatePct: l.annualRatePct, emiPaise: l.emiPaise, firstEmiDate: l.firstEmiDate, payments: l.payments });
    for (let n = 0; s.monthsLeft && n < s.monthsLeft; n += 1) {
      const due = occurrenceDate(l.firstEmiDate, 'monthly', 1, s.emisPaid + n);
      if (due > end) break;
      push(due, 'emi', l.name, -l.emiPaise);
    }
  }
  for (const c of cards.filter((x) => x.statementDay && x.dueDay)) {
    const cyc = await cardCycleOf(space, c.id);
    if (cyc.lastStatement.remaining.paise > 0) push(new Date(`${cyc.lastStatement.dueDate}T00:00:00Z`), 'card', `${c.name} bill`, -cyc.lastStatement.remaining.paise);
    // This cycle's purchases so far fall due after the next statement.
    const next = cardCycle({ statementDay: c.statementDay, dueDay: c.dueDay, today: addDays(new Date(`${cyc.currentCycle.to}T00:00:00Z`), 1) });
    if (cyc.currentCycle.purchases.paise > 0 && next.dueDate <= end) push(next.dueDate, 'card', `${c.name} bill (spent so far)`, -cyc.currentCycle.purchases.paise);
  }

  const rate = await dayToDayRate(space._id);
  let balance = start;
  let lowest = { date: today, balance: start };
  let firstNegative = start < 0 ? today : null;
  const out = [];
  for (let d = now; d <= end; d = addDays(d, 1)) {
    const day = dayString(d);
    const todays = events.filter((e) => e.date === day);
    // Today's day-to-day spending is mostly in already; from tomorrow the usual daily amount is assumed.
    const dayToDay = day === today ? 0 : rate.perDay;
    balance += todays.reduce((s, e) => s + e.amount.paise, 0) - dayToDay;
    if (balance < lowest.balance) lowest = { date: day, balance };
    if (balance < 0 && !firstNegative) firstNegative = day;
    out.push({ date: day, events: todays, dayToDay: money(dayToDay), balance: money(balance) });
  }
  return {
    from: today, to: dayString(end),
    start: money(start),
    accounts: liquid.map((a) => ({ id: a.id, name: a.name, balance: a.balance })),
    perDay: money(rate.perDay),
    days: out,
    lowest: { date: lowest.date, balance: money(lowest.balance) },
    firstNegative,
    end: money(balance),
    unknownAmounts: unknown,
  };
}

// A purchase of `amount` on `date`: does the balance stay above a month of usual spending, stay above
// zero, or go below zero in the next 60 days? Plus how long saving for it would take.
export async function afford(space, { amount, date }) {
  const flow = await cashflow(space, { days: 60 });
  const day = date ? dayString(date) : flow.from;
  const buffer = flow.perDay.paise * 30;
  let lowest = null;
  for (const d of flow.days) {
    const b = d.balance.paise - (d.date >= day ? amount : 0);
    if (!lowest || b < lowest.balance) lowest = { date: d.date, balance: b };
  }
  const verdict = lowest.balance < 0 ? 'no' : lowest.balance < buffer ? 'tight' : 'yes';
  const s = await savingsRate(space._id, { months: 4 });
  const complete = s.months.filter((m) => !m.partial);
  const avgSaved = complete.length ? Math.round(complete.reduce((x, m) => x + m.saved.paise, 0) / complete.length) : 0;
  return {
    amount: money(amount),
    date: day,
    verdict,
    lowestWithout: flow.lowest,
    lowestWith: { date: lowest.date, balance: money(lowest.balance) },
    buffer: money(buffer),
    balanceNow: flow.start,
    averageMonthlySaving: money(avgSaved),
    monthsToSave: avgSaved > 0 ? Math.ceil(amount / avgSaved) : null,
  };
}

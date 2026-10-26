import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import toast from 'react-hot-toast';
import { Award, CalendarRange, Flame, Lightbulb, Repeat2, Store, ThumbsDown, TrendingUp } from 'lucide-react';
import {
  useCategories, useChallenges, useDaily, useInsight, usePlanMutation, usePreviewReport, useRunReport, useSavedReports,
} from '../hooks/api.js';
import { formatDay, formatDayShort, formatINR, formatMonth, formatMonthShort } from '../lib/format.js';
import { addDays, currentMonth, monthBounds, shiftMonth, today } from '../lib/dates.js';
import { TwoLines, ValueBars } from '../components/charts.jsx';
import {
  Badge, Button, Card, CardHeader, EmptyState, ErrorNote, Field, Input, PageHeader, ProgressBar, Segmented, Select, Skeleton, Tabs, cx,
} from '../components/ui.jsx';

// Cards of very different heights flow down two balanced columns, so none leaves a hole beside a taller one.
const Flow = ({ children }) => <div className="gap-4 lg:columns-2 [&>*]:mb-4 [&>*]:break-inside-avoid">{children}</div>;
const note = (good) => cx('rounded-lg px-3 py-2 text-sm ring-1 ring-inset', good
  ? 'bg-emerald-500/[0.07] text-emerald-800 ring-emerald-500/15 dark:bg-emerald-400/[0.07] dark:text-emerald-200 dark:ring-emerald-400/15'
  : 'bg-rose-500/[0.07] text-rose-800 ring-rose-500/15 dark:bg-rose-400/[0.07] dark:text-rose-200 dark:ring-rose-400/15');
import { k, t, tn, tr } from '../lib/i18n.js';
import { catLabel } from '../lib/labels.js';

const TABS = [
  { value: 'overview', label: t('Overview') }, { value: 'patterns', label: t('Patterns') }, { value: 'merchants', label: t('Merchants') },
  { value: 'compare', label: t('Compare') }, { value: 'year', label: t('Year in review') }, { value: 'reports', label: t('Reports') },
];
const Loading = ({ q, h = 'h-32' }) => (q.error ? <ErrorNote error={q.error} onRetry={q.refetch} /> : <Skeleton className={`${h} w-full`} />);
const signed = (paise) => `${paise > 0 ? '+' : paise < 0 ? '−' : ''}${formatINR(Math.abs(paise))}`;

// ───────────── Overview ─────────────

function Forecast() {
  const q = useInsight('forecast');
  const f = q.data;
  return (
    <Card>
      <CardHeader title={t('This month is heading for')} subtitle={f ? `${formatMonth(f.month)} · ${tn(f.daysLeft, '{n} day left', '{n} days left')}` : undefined} />
      {!f ? <Loading q={q} /> : (
        <div className="space-y-3 text-sm">
          <p className="tabular text-title font-semibold text-slate-900 dark:text-white">{formatINR(f.forecast.paise)}</p>
          <ul className="space-y-1 text-slate-600 dark:text-slate-400">
            <li className="flex justify-between"><span>{t('Spent so far')}</span><span className="tabular">{formatINR(f.spent.paise)}</span></li>
            <li className="flex justify-between"><span>{t('Day-to-day at {amount}/day', { amount: formatINR(f.basis.perDay.paise) })}</span><span className="tabular">{formatINR(f.expectedDayToDay.paise)}</span></li>
            <li className="flex justify-between"><span>{t('Bills, EMIs and recurring still due')}</span><span className="tabular">{formatINR(f.scheduledTotal.paise)}</span></li>
          </ul>
          {f.scheduled.length > 0 && (
            <p className="text-xs text-slate-500 dark:text-slate-400">{f.scheduled.map((s) => t('{name} {amount} on {date}', { name: s.name, amount: s.amount ? formatINR(s.amount.paise) : t('(amount varies)'), date: formatDayShort(s.date) })).join(' · ')}</p>
          )}
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {f.basis.method === 'history' ? t('Daily rate from your day-to-day spending {from} to {to}, leaving out rent, EMIs, insurance, investments, bills and one-offs of ₹10,000 or more.', { from: formatDayShort(f.basis.from), to: formatDayShort(f.basis.to) }) : t('Daily rate from this month so far (not enough history yet).')}
            {' '}{t('Last month: {amount}.', { amount: formatINR(f.lastMonth.paise) })}
          </p>
          {f.overBudgetBy && (
            <p className={note(f.overBudgetBy.paise <= 0)}>
              {f.overBudgetBy.paise > 0 ? t('About {amount} over your {budget} budget at this pace.', { amount: formatINR(f.overBudgetBy.paise), budget: formatINR(f.budget.paise) }) : t('About {amount} under your {budget} budget.', { amount: formatINR(-f.overBudgetBy.paise), budget: formatINR(f.budget.paise) })}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

function Unusual() {
  const q = useInsight('unusual');
  const u = q.data;
  return (
    <Card>
      <CardHeader title={t('Unusual this month')} subtitle={t('Compared with your average of the last 3 months')} />
      {!u ? <Loading q={q} /> : !u.baselineMonths ? <p className="text-sm text-slate-500 dark:text-slate-400">{t('Needs at least one earlier month of entries to compare with.')}</p>
        : !u.categories.length && !u.transactions.length ? <p className="text-sm text-slate-500 dark:text-slate-400">{t('Nothing out of the ordinary so far.')}</p> : (
          <div className="space-y-3 text-sm">
            {u.categories.map((c) => (
              <p key={c.category}><span className="font-medium">{catLabel(c.category)}</span>: {c.isNew ? t('{amount} so far, new this month.', { amount: formatINR(c.spent.paise) }) : t('{amount} so far, heading for {pace} vs {usual} usual ({ratio}×).', { amount: formatINR(c.spent.paise), pace: formatINR(c.pace.paise), usual: formatINR(c.average.paise), ratio: c.ratio })}</p>
            ))}
            {u.transactions.length > 0 && (
              <ul className="space-y-1 border-t border-slate-900/[0.06] pt-2 dark:border-white/[0.06]">
                {u.transactions.map((tx) => (
                  <li key={tx.id} className="flex justify-between gap-3"><span className="min-w-0 truncate">{formatDayShort(tx.date)} · {tx.merchant ?? tx.note ?? catLabel(tx.category)} <span className="text-xs text-slate-500 dark:text-slate-400">{t('(usually {amount})', { amount: formatINR(tx.usual.paise) })}</span></span><span className="tabular font-medium">{formatINR(tx.amount.paise)}</span></li>
                ))}
              </ul>
            )}
          </div>
        )}
    </Card>
  );
}

function Savings() {
  const q = useInsight('savings-rate', { months: 12 });
  const s = q.data;
  return (
    <Card>
      <CardHeader title={t('Savings rate')} subtitle={s?.averageRate !== null && s ? t('Average {pct}% of income kept', { pct: s.averageRate }) : t('Share of income you kept each month')} />
      {!s ? <Loading q={q} h="h-48" /> : s.averageRate === null ? <p className="text-sm text-slate-500 dark:text-slate-400">{t('Add your income to see how much of it you keep.')}</p> : (
        <>
          <ValueBars rows={s.months.slice(Math.max(0, s.months.findIndex((m) => m.saved.paise || m.income?.paise))).map((m) => ({ label: m.month, value: m.saved.rupees }))} name={t('Saved')} formatLabel={formatMonthShort} height={180} />
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            {t('Last 3 months: {pct}%', { pct: s.recentRate ?? '—' })}{s.trend !== null && ` (${s.trend >= 0 ? t('up {n} points on the 3 before', { n: Math.abs(s.trend) }) : t('down {n} points on the 3 before', { n: Math.abs(s.trend) })})`}.
          </p>
        </>
      )}
    </Card>
  );
}

function Subscriptions() {
  const q = useInsight('subscriptions');
  const s = q.data;
  return (
    <Card>
      <CardHeader title={t('Subscriptions found')} subtitle={s?.activeYearlyCost.paise ? t('{month} a month · {year} a year', { month: formatINR(s.activeMonthlyCost.paise), year: formatINR(s.activeYearlyCost.paise) }) : t('The same charge every month or year')} />
      {!s ? <Loading q={q} /> : s.subscriptions.length ? (
        <ul className="divide-y divide-slate-900/[0.05] text-sm dark:divide-white/[0.05]">
          {s.subscriptions.map((x) => (
            <li key={`${x.name}-${x.amount.paise}`} className="flex items-center gap-3 py-2">
              <Repeat2 className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{x.name} {!x.active && <Badge>Stopped?</Badge>}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{x.cadence === 'monthly' ? t('Monthly') : t('Yearly')} · {tn(x.count, '{n} charge', '{n} charges')} · {t('next around {date}', { date: formatDayShort(x.nextExpected) })}{x.tracked ? '' : ` · ${t('not in Bills or Recurring')}`}</p>
              </div>
              <span className="tabular font-semibold">{formatINR(x.amount.paise)}</span>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-slate-500 dark:text-slate-400">{t('No repeating charges spotted yet. They show up after 3 monthly charges with the same name.')}</p>}
    </Card>
  );
}

const CHALLENGE_TONE = { active: 'indigo', completed: 'green', failed: 'rose', stopped: 'slate' };
// The server's achievement texts (in English), marked so their Hindi is checked; details come as templates.
const ACHIEVEMENT_TEXT = [
  k('First step'), k('Added your first entry'), k('Week of logging'), k('Added something 7 days in a row'), k('Month of logging'),
  k('Added something 30 days in a row'), k('Quiet week'), k('7 days in a row without day-to-day spending'), k('Within budget'),
  k('Finished a month with every budget kept'), k('Saver'), k('Kept at least 20% of a month’s income'), k('Goal reached'),
  k('Saved the full amount for a goal'), k('Safety net'), k('Filled an emergency fund goal'), k('Loan repaid'), k('Paid off a loan completely'),
  k('Statement in'), k('Imported a bank or card statement'), k('Hundred entries'), k('Recorded 100 entries'),
  k('On {date}'), k('Longest run: {n} days'), k('In {month}'), k('{n} so far'),
];
const achievementDetail = (a) => {
  if (!a.detailText) return a.detail;
  const v = a.detailVars ?? {};
  return t(a.detailText, { ...v, ...(v.date && { date: formatDay(v.date) }), ...(v.month && { month: formatMonth(v.month) }) });
};
const CHALLENGE_STATUS = { active: k('active'), completed: k('completed'), failed: k('failed'), stopped: k('stopped') };
function Streaks() {
  const q = useInsight('streaks');
  const ch = useChallenges();
  const mutate = usePlanMutation('transactions');
  const [days, setDays] = useState('7');
  const s = q.data;
  const active = ch.data?.challenges.find((c) => c.status === 'active' || c.status === 'scheduled');
  // Already spent today? Then a challenge starts clean tomorrow.
  const startTomorrow = s && !s.noSpend.todaySoFar;
  const last = ch.data?.challenges[0];
  async function start() {
    try {
      await mutate.mutateAsync({ path: '/challenges', body: { days: Number(days), allowed: [t('Rent'), t('Bills & Utilities'), t('EMI & Loans'), t('Insurance'), t('Mobile & Internet')], ...(startTomorrow && { startDate: addDays(today(), 1) }) } });
      toast.success(startTomorrow ? t('{n}-day no-spend challenge starts tomorrow', { n: days }) : t('{n}-day no-spend challenge started', { n: days }));
    } catch (err) { toast.error(err.message); }
  }
  return (
    <Card>
      <CardHeader title={t('Streaks')} subtitle={t('Fixed costs (rent, bills, EMIs, recurring) don’t count as spending')} />
      {!s ? <Loading q={q} /> : (
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-3 gap-3">
            <div><p className="text-xs text-slate-500 dark:text-slate-400">{t('No-spend streak')}</p><p className="tabular mt-0.5 text-heading font-semibold"><Flame className="mr-1 inline h-4 w-4 text-amber-500" aria-hidden="true" />{tn(s.noSpend.current, '{n} day', '{n} days')}</p></div>
            <div><p className="text-xs text-slate-500 dark:text-slate-400">{t('No-spend days this month')}</p><p className="tabular mt-0.5 text-heading font-semibold">{s.noSpend.thisMonth}</p></div>
            <div><p className="text-xs text-slate-500 dark:text-slate-400">{t('Logging streak')}</p><p className="tabular mt-0.5 text-heading font-semibold">{tn(s.logging.current, '{n} day', '{n} days')}</p></div>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('Longest no-spend run in the last year: {a} days. Longest logging run: {b} days.', { a: s.noSpend.longest.days, b: s.logging.longest.days })}</p>
          <div className="border-t border-slate-900/[0.06] pt-3 dark:border-white/[0.06]">
            {active ? (
              <div>
                <p className="font-medium">{active.status === 'scheduled' ? t('No-spend challenge starts {date}', { date: formatDay(active.startDate) }) : t('No-spend challenge: day {n} of {total}', { n: active.cleanDays, total: active.days })}</p>
                <div className="my-2"><ProgressBar percent={(active.cleanDays / active.days) * 100} label={t('Challenge progress')} /></div>
                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                  <span>{t('Until {date}. Rent, bills, EMIs, insurance and phone don’t break it.', { date: formatDay(active.endDate) })}</span>
                  <Button size="sm" variant="ghost" onClick={async () => { try { await mutate.mutateAsync({ path: `/challenges/${active.id}/stop` }); toast.success(t('Challenge stopped')); } catch (err) { toast.error(err.message); } }}>{t('Stop')}</Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                {last && <p className="w-full text-xs text-slate-500 dark:text-slate-400">{t('Last challenge:')} <Badge tone={CHALLENGE_TONE[last.status]}>{t(CHALLENGE_STATUS[last.status])}</Badge> {t('{n} days from {date}', { n: last.days, date: formatDayShort(last.startDate) })}{last.failedOn ? `, ${t('spent on {date}', { date: formatDayShort(last.failedOn) })}` : ''}.</p>}
                <Field label={t('No-spend challenge')} htmlFor="challenge-days" className="w-40">
                  <Select id="challenge-days" value={days} onChange={(e) => setDays(e.target.value)}>{[3, 5, 7, 14, 21, 30].map((d) => <option key={d} value={d}>{tn(d, '{n} day', '{n} days')}</option>)}</Select>
                </Field>
                <Button onClick={start} loading={mutate.isPending}>{startTomorrow ? t('Start tomorrow') : t('Start today')}</Button>
                {startTomorrow && <p className="w-full text-xs text-slate-500 dark:text-slate-400">{t('You’ve spent today already, so it starts fresh tomorrow.')}</p>}
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function Achievements() {
  const q = useInsight('achievements');
  return (
    <Card>
      <CardHeader title={t('Achievements')} subtitle={t('Quiet milestones, worked out from your entries')} />
      {!q.data ? <Loading q={q} /> : (
        <ul className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
          {[...q.data.achievements].sort((a, b) => Number(b.achieved) - Number(a.achieved)).map((a) => (
            <li key={a.id} className={cx('flex items-start gap-2.5 rounded-lg px-2 py-2 text-sm', !a.achieved && 'text-slate-600 dark:text-slate-400')}>
              <span className={cx('mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full', a.achieved ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' : 'bg-slate-900/[0.05] text-slate-400 dark:bg-white/[0.06]')}>
                <Award className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
              <span><span className="font-medium">{t(a.title)}</span>{a.achieved ? '' : ` (${t('not yet')})`}<span className="block text-caption text-slate-500 dark:text-slate-400">{t(a.description)}{a.detail ? `. ${achievementDetail(a)}` : ''}</span></span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Regret() {
  const q = useInsight('regret', { months: 3 });
  const r = q.data;
  return (
    <Card>
      <CardHeader title={t('Worth it?')} subtitle={t('From the expenses you rated in the last 3 months')} />
      {!r ? <Loading q={q} /> : !r.rated ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('Rate an expense as worth it, meh or not worth it (under "More" when adding or editing) to see where money goes that you’d rather keep.')}</p>
      ) : (
        <div className="space-y-2 text-sm">
          <p>{tr('<b>{amount}</b> not worth it ({pct}% of rated spending, {rated} of {entries} expenses rated).', { amount: formatINR(r.notWorthIt.paise), pct: r.notWorthItShare, rated: r.rated, entries: r.entries }, { b: (x) => <span className="tabular text-xl font-semibold text-rose-600 dark:text-rose-400">{x}</span> })}</p>
          {r.categories.length > 0 && <p className="text-slate-600 dark:text-slate-400">{t('Most regretted: {list}.', { list: r.categories.map((c) => `${catLabel(c.category)} ${formatINR(c.total.paise)}`).join(', ') })}</p>}
          {r.examples.length > 0 && (
            <ul className="space-y-1 border-t border-slate-900/[0.06] pt-2 dark:border-white/[0.06]">
              {r.examples.map((tx) => <li key={tx.id} className="flex justify-between gap-3"><span className="truncate"><ThumbsDown className="mr-1 inline h-3.5 w-3.5 text-slate-400" aria-hidden="true" />{tx.merchant ?? tx.note ?? catLabel(tx.category)}</span><span className="tabular">{formatINR(tx.amount.paise)}</span></li>)}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

function Inflation() {
  const q = useInsight('inflation', { months: 24 });
  const d = q.data;
  const shown = d?.months.filter((m) => m.spent.paise > 0) ?? [];
  // From the first month with spending, so the chart isn't a long flat line.
  const rows = d ? d.months.slice(d.months.findIndex((m) => m.spent.paise > 0)) : [];
  return (
    <Card>
      <CardHeader title={t('In today’s prices')} subtitle={d ? `${t('Monthly spending at {month} prices', { month: formatMonth(d.priceMonth) })}${d.inflationLastYear !== null ? ` · ${t('prices up {pct}% in a year', { pct: d.inflationLastYear })}` : ''}` : t('Adjusted with India’s official price index')} />
      {!d ? <Loading q={q} h="h-48" /> : !shown.length ? <p className="text-sm text-slate-500 dark:text-slate-400">{t('No spending in the last 2 years yet.')}</p> : (
        <>
          <TwoLines rows={rows.map((m) => ({ month: m.month, a: m.spent.rupees, b: m.inTodaysPrices.rupees }))} aName={t('As spent')} bName={t('In today’s prices')} height={200} />
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{t('Source: {source} (Ministry of Statistics, Government of India), checked {date}. Months after {month} aren’t published yet and are shown as spent.', { source: d.source, date: formatDay(d.fetchedAt.slice(0, 10)), month: formatMonth(d.priceMonth) })}</p>
        </>
      )}
    </Card>
  );
}

function Overview() {
  return (
    <Flow>
      <Forecast />
      <Unusual />
      <Savings />
      <Subscriptions />
      <Streaks />
      <Regret />
      <Inflation />
      <Achievements />
    </Flow>
  );
}

// ───────────── Patterns ─────────────

function Heatmap() {
  const end = today();
  const start = addDays(end, -364);
  const q = useDaily({ from: start, to: end });
  const days = q.data?.days ?? [];
  const max = Math.max(1, ...days.map((d) => d.expense.paise));
  const level = (p) => (p === 0 ? 0 : p < max * 0.15 ? 1 : p < max * 0.35 ? 2 : p < max * 0.65 ? 3 : 4);
  // One hue, darker for more: spending is information here, not an alarm.
  const COLORS = ['bg-slate-900/[0.06] dark:bg-white/[0.06]', 'bg-indigo-100 dark:bg-indigo-950', 'bg-indigo-300 dark:bg-indigo-800', 'bg-indigo-500 dark:bg-indigo-600', 'bg-indigo-700 dark:bg-indigo-400'];
  const lead = (new Date(`${start}T00:00:00Z`).getUTCDay() + 6) % 7;
  const cells = [...Array(lead).fill(null), ...days];
  return (
    <Card>
      <CardHeader title={t('Every day of the last year')} subtitle={t('Darker means more spent that day')} />
      {!q.data ? <Loading q={q} h="h-28" /> : (
        <div className="overflow-x-auto">
          <div className="grid w-max grid-flow-col grid-rows-7 gap-[3px]" role="img" aria-label={t('Calendar heatmap of daily spending for the last year')}>
            {cells.map((d, i) => (
              <div key={d?.date ?? `pad-${i}`} className={cx('h-3 w-3 rounded-sm', d ? COLORS[level(d.expense.paise)] : '')}
                title={d ? `${formatDay(d.date)}: ${formatINR(d.expense.paise)}` : undefined} />
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function Patterns() {
  const [days, setDays] = useState('90');
  const to = today();
  const q = useInsight('patterns', { from: addDays(to, -(Number(days) - 1)), to });
  const p = q.data;
  return (
    <div className="space-y-4">
      <Segmented label={t('Period')} value={days} onChange={setDays} options={[{ value: '30', label: '30 days' }, { value: '90', label: '90 days' }, { value: '180', label: '6 months' }, { value: '365', label: '1 year' }]} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t('By day of the week')} subtitle={p ? (p.weekendShare !== null ? t('Average spent on each day · weekends are {pct}% of spending', { pct: p.weekendShare }) : t('Average spent on each day')) : undefined} />
          {!p ? <Loading q={q} h="h-48" /> : <ValueBars rows={p.weekdays.map((d) => ({ label: t(d.day.slice(0, 3)), value: d.perDay.rupees }))} name={t('Average per day')} height={200} />}
        </Card>
        <Card className="flex flex-col">
          <CardHeader title={t('By time of day')} subtitle={p ? t('{n} of {total} expenses have a time', { n: p.timeOfDay.entriesWithTime, total: p.timeOfDay.entries }) : undefined} />
          {!p ? <Loading q={q} h="h-48" /> : p.timeOfDay.entriesWithTime ? (
            <>
              <ul className="mb-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                {p.timeOfDay.buckets.map((b) => <li key={b.name} className="rounded-lg bg-slate-900/[0.03] p-2.5 dark:bg-white/[0.04]"><p className="text-xs text-slate-500 dark:text-slate-400">{b.name}</p><p className="tabular font-semibold">{formatINR(b.total.paise)}</p><p className="text-xs text-slate-500 dark:text-slate-400">{b.share ?? 0}%</p></li>)}
              </ul>
              <ValueBars rows={p.timeOfDay.hours.map((h) => ({ label: String(h.hour).padStart(2, '0'), value: h.total.rupees }))} name={t('Spent')} height={140} />
            </>
          ) : <div className="grid flex-1 place-items-center"><EmptyState icon={CalendarRange} title={t('No times yet')} compact>{t('Add a time to expenses (under "More") to see when in the day you spend.')}</EmptyState></div>}
        </Card>
      </div>
      <Heatmap />
    </div>
  );
}

// ───────────── Merchants ─────────────

function MerchantDetail({ name }) {
  const q = useInsight(`merchants/${encodeURIComponent(name)}`);
  const m = q.data;
  return !m ? <Loading q={q} h="h-48" /> : (
    <div className="space-y-3">
      <p className="text-sm">{tr('<b>{merchant}</b>: {amount} in the last 12 months', { merchant: m.merchant, amount: formatINR(m.total.paise) }, { b: (x) => <span className="font-semibold">{x}</span> })}</p>
      <ValueBars rows={m.months.map((x) => ({ label: x.month, value: x.total.rupees }))} formatLabel={formatMonthShort} height={160} />
      <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
        {m.recent.map((tx) => <li key={tx.id} className="flex justify-between py-1.5"><span>{formatDay(tx.date)} · {catLabel(tx.category)}{tx.note ? ` · ${tx.note}` : ''}</span><span className="tabular">{formatINR(tx.amount.paise)}</span></li>)}
      </ul>
    </div>
  );
}

function Merchants() {
  const [months, setMonths] = useState('6');
  const [selected, setSelected] = useState(null);
  const q = useInsight('merchants', { from: monthBounds(shiftMonth(currentMonth(), -(Number(months) - 1))).from, to: today() });
  const d = q.data;
  return (
    <div className="space-y-4">
      <Segmented label={t('Period')} value={months} onChange={setMonths} options={[{ value: '1', label: t('This month') }, { value: '3', label: '3 months' }, { value: '6', label: '6 months' }, { value: '12', label: '12 months' }]} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t('Where you spend')} subtitle={d?.withoutMerchant.count ? t('{n} expenses ({amount}) have no merchant; imports fill it in, or type one under “More”.', { n: d.withoutMerchant.count, amount: formatINR(d.withoutMerchant.total.paise) }) : undefined} />
          {!d ? <Loading q={q} /> : d.merchants.length ? (
            <ul className="space-y-2">
              {d.merchants.slice(0, 30).map((m) => (
                <li key={m.merchant}>
                  <button type="button" onClick={() => setSelected(m.merchant)} className={cx('w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50', selected === m.merchant && 'bg-indigo-50 dark:bg-indigo-500/10')}>
                    <span className="flex justify-between gap-3"><span className="truncate font-medium">{m.merchant}</span><span className="tabular">{formatINR(m.total.paise)}</span></span>
                    <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><span className="block h-full rounded-full bg-indigo-500" style={{ width: `${m.share}%` }} /></span>
                    <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">{tn(m.count, '{n} time', '{n} times')} · {catLabel(m.category)} · {t('last {date}', { date: formatDayShort(m.lastDate) })}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <EmptyState icon={Store} title={t('No merchants yet')}>{t('Import a statement, or type the merchant when adding an expense.')}</EmptyState>}
        </Card>
        <Card>
          <CardHeader title={selected ?? t('Pick a merchant')} />
          {selected ? <MerchantDetail key={selected} name={selected} /> : <p className="text-sm text-slate-500 dark:text-slate-400">{t('See a merchant month by month and its latest entries.')}</p>}
        </Card>
      </div>
    </div>
  );
}

// ───────────── Compare ─────────────

function presetRanges(preset) {
  const cur = currentMonth();
  if (preset === 'month') return { a: monthBounds(shiftMonth(cur, -1)), b: { from: monthBounds(cur).from, to: today() } };
  if (preset === 'yoy') return { a: monthBounds(shiftMonth(cur, -13)), b: monthBounds(shiftMonth(cur, -1)) };
  return { a: monthBounds(shiftMonth(cur, -2)), b: monthBounds(shiftMonth(cur, -1)) };
}

function Compare() {
  const [preset, setPreset] = useState('month');
  const [custom, setCustom] = useState(presetRanges('month'));
  const r = preset === 'custom' ? custom : presetRanges(preset);
  const valid = r.a.from && r.a.to && r.b.from && r.b.to && r.a.from <= r.a.to && r.b.from <= r.b.to;
  const q = useInsight('compare', { aFrom: r.a.from, aTo: r.a.to, bFrom: r.b.from, bTo: r.b.to }, { enabled: Boolean(valid) });
  const c = q.data;
  const setC = (side, key, v) => setCustom({ ...custom, [side]: { ...custom[side], [key]: v } });
  return (
    <div className="space-y-4">
      <Segmented label={t('Compare')} value={preset} onChange={setPreset} options={[{ value: 'month', label: t('This month vs last') }, { value: 'last2', label: t('Last 2 months') }, { value: 'yoy', label: t('Last month vs a year before') }, { value: 'custom', label: t('Custom') }]} />
      {preset === 'custom' && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <Field label={t('First period from')} htmlFor="ca-from"><Input id="ca-from" type="date" value={custom.a.from} onChange={(e) => setC('a', 'from', e.target.value)} /></Field>
          <Field label="to" htmlFor="ca-to"><Input id="ca-to" type="date" value={custom.a.to} onChange={(e) => setC('a', 'to', e.target.value)} /></Field>
          <Field label={t('Second period from')} htmlFor="cb-from"><Input id="cb-from" type="date" value={custom.b.from} onChange={(e) => setC('b', 'from', e.target.value)} /></Field>
          <Field label="to" htmlFor="cb-to"><Input id="cb-to" type="date" value={custom.b.to} onChange={(e) => setC('b', 'to', e.target.value)} /></Field>
        </div>
      )}
      {!valid ? <p className="text-sm text-rose-600">{t('Pick both periods, each ending on or after it starts.')}</p> : !c ? <Loading q={q} /> : (
        <Card>
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3 text-sm">
            {[['a', c.a], ['b', c.b]].map(([k, s]) => (
              <div key={k}><p className="text-xs text-slate-500 dark:text-slate-400">{t('{from} to {to}', { from: formatDay(s.from), to: formatDay(s.to) })}</p><p className="tabular text-xl font-semibold">{formatINR(s.expense.paise)}</p><p className="text-xs text-slate-500 dark:text-slate-400">{t('{amount} a day · income {income}', { amount: formatINR(s.perDay.paise), income: formatINR(s.income.paise) })}</p></div>
            ))}
            <div><p className="text-xs text-slate-500 dark:text-slate-400">{t('Change')}</p><p className={cx('tabular text-xl font-semibold', c.expenseChange.paise > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400')}>{signed(c.expenseChange.paise)}</p><p className="text-xs text-slate-500 dark:text-slate-400">{c.expenseChangePct !== null ? `${c.expenseChangePct > 0 ? '+' : ''}${c.expenseChangePct}%` : ''}</p></div>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-slate-500 dark:text-slate-400"><th className="py-1 font-medium">{t('Category')}</th><th className="py-1 text-right font-medium">{t('First')}</th><th className="py-1 text-right font-medium">{t('Second')}</th><th className="py-1 text-right font-medium">{t('Change')}</th></tr></thead>
            <tbody className="divide-y divide-slate-900/[0.05] dark:divide-white/[0.05]">
              {c.categories.map((x) => (
                <tr key={x.category}><td className="py-1.5">{x.category}</td><td className="tabular py-1.5 text-right">{formatINR(x.a.paise)}</td><td className="tabular py-1.5 text-right">{formatINR(x.b.paise)}</td>
                  <td className={cx('tabular py-1.5 text-right', x.change.paise > 0 ? 'text-rose-600 dark:text-rose-400' : x.change.paise < 0 ? 'text-emerald-600 dark:text-emerald-400' : '')}>{signed(x.change.paise)}</td></tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

// ───────────── Year in review ─────────────

function YearReview() {
  const thisYear = Number(today().slice(0, 4));
  const [year, setYear] = useState(String(thisYear));
  const q = useInsight('year', { year });
  const y = q.data;
  return (
    <div className="space-y-4">
      <Field label={t('Year')} htmlFor="review-year" className="w-32"><Select id="review-year" value={year} onChange={(e) => setYear(e.target.value)}>{[0, 1, 2, 3].map((n) => <option key={n} value={thisYear - n}>{thisYear - n}</option>)}</Select></Field>
      {!y ? <Loading q={q} h="h-64" /> : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            {[[t('Spent'), formatINR(y.expense.paise), y.previous.expenseChangePct !== null ? t('{pct}% on {year}', { pct: `${y.previous.expenseChangePct > 0 ? '+' : ''}${y.previous.expenseChangePct}`, year: year - 1 }) : null],
              [t('Earned'), formatINR(y.income.paise), null],
              [t('Kept'), formatINR(y.saved.paise), y.savingsRate !== null ? `${y.savingsRate}% of income` : null],
              [t('No-spend days'), String(y.noSpendDays), t('{amount} a day on average', { amount: formatINR(y.perDay.paise) })]].map(([k, v, sub]) => (
              <Card key={k}><p className="text-sm text-slate-500 dark:text-slate-400">{k}</p><p className="tabular text-xl font-semibold">{v}</p>{sub && <p className="text-xs text-slate-500 dark:text-slate-400">{sub}</p>}</Card>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title={t('{year} month by month', { year })} subtitle={y.complete ? undefined : t('So far, to {date}', { date: formatDay(y.to) })} />
              <ValueBars rows={y.months.map((m) => ({ label: m.month, value: m.total.rupees }))} formatLabel={formatMonthShort} height={200} />
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                {y.busiestMonth && `${t('Busiest: {month} ({amount}).', { month: formatMonth(y.busiestMonth.month), amount: formatINR(y.busiestMonth.total.paise) })} `}
                {y.lightestMonth && t('Lightest: {month} ({amount}).', { month: formatMonth(y.lightestMonth.month), amount: formatINR(y.lightestMonth.total.paise) })}
              </p>
            </Card>
            <Card>
              <CardHeader title={t('Where it went')} />
              <ul className="space-y-1.5 text-sm">{y.topCategories.map((c) => <li key={c.category} className="flex justify-between"><span>{c.category}</span><span className="tabular">{formatINR(c.total.paise)} · {c.share}%</span></li>)}</ul>
              {y.topMerchants.length > 0 && <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">{t('Top merchants: {list}.', { list: y.topMerchants.map((m) => `${m.merchant} ${formatINR(m.total.paise)}`).join(', ') })}</p>}
              {y.biggest && <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{t('Biggest expense: {amount} on {category}{note}, {date}.', { amount: formatINR(y.biggest.amount.paise), category: catLabel(y.biggest.category), note: y.biggest.note ? ` (${y.biggest.note})` : '', date: formatDay(y.biggest.date) })}</p>}
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{tn(y.entries, '{n} entry recorded.', '{n} entries recorded.')}</p>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

// ───────────── Saved reports ─────────────

const GROUPS = { category: t('Category'), month: t('Month'), merchant: t('Merchant'), tag: t('Tag'), account: t('Account'), paymentMethod: t('Payment method'), weekday: t('Day of the week') };
const PERIODS = { 'this-month': t('This month'), 'last-month': t('Last month'), 'last-3-months': t('Last 3 months'), 'last-6-months': t('Last 6 months'), 'this-year': t('This year'), 'last-12-months': t('Last 12 months'), 'this-fy': t('This financial year'), 'last-fy': t('Last financial year'), custom: t('Custom dates') };

function ReportResult({ data }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600 dark:text-slate-400">{t('{from} to {to}', { from: formatDay(data.from), to: formatDay(data.to) })} · {formatINR(data.total.paise)}</p>
      {data.rows.length ? (
        <>
          <ValueBars rows={data.rows.slice(0, 15).map((r) => ({ label: r.label, value: r.total.rupees }))} height={200} />
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-900/[0.05] dark:divide-white/[0.05]">
              {data.rows.map((r) => <tr key={r.key}><td className="py-1.5">{r.label}</td><td className="py-1.5 text-right text-xs text-slate-500 dark:text-slate-400">{r.count} · {r.share}%</td><td className="tabular py-1.5 text-right">{formatINR(r.total.paise)}</td></tr>)}
            </tbody>
          </table>
        </>
      ) : <p className="text-sm text-slate-500 dark:text-slate-400">{t('Nothing matches in this period.')}</p>}
    </div>
  );
}

function Reports() {
  const saved = useSavedReports();
  const categories = useCategories();
  const preview = usePreviewReport();
  const mutate = usePlanMutation('transactions');
  const [open, setOpen] = useState(null);
  const run = useRunReport(open);
  const [f, setF] = useState({ name: '', groupBy: 'category', period: 'last-3-months', from: '', to: '', type: 'expense', category: '', tag: '' });
  const body = useMemo(() => ({
    name: f.name.trim() || undefined, groupBy: f.groupBy, period: f.period,
    ...(f.period === 'custom' ? { from: f.from || null, to: f.to || null } : {}),
    filters: { type: f.type || null, ...(f.category ? { category: [f.category] } : {}), ...(f.tag.trim() ? { tag: f.tag.trim().replace(/^#/, '') } : {}) },
  }), [f]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const cats = categories.data ? [...new Set([...categories.data.defaults.expense, ...categories.data.custom.expense, ...categories.data.defaults.income])] : [];
  async function save() {
    if (!f.name.trim()) { toast.error(t('Name the report to save it')); return; }
    try {
      const { report } = await mutate.mutateAsync({ path: '/saved-reports', body });
      toast.success(t('Report saved'));
      setOpen(report.id);
    } catch (err) { toast.error(err.details?.[0]?.message ?? err.message); }
  }
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
      <Card className="lg:col-span-3">
        <CardHeader title={t('Build a report')} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label={t('Group by')} htmlFor="r-group"><Select id="r-group" value={f.groupBy} onChange={set('groupBy')}>{Object.entries(GROUPS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
          <Field label={t('Period')} htmlFor="r-period"><Select id="r-period" value={f.period} onChange={set('period')}>{Object.entries(PERIODS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
          <Field label={t('Entries')} htmlFor="r-type"><Select id="r-type" value={f.type} onChange={set('type')}><option value="expense">{t('Expenses')}</option><option value="income">{t('Income')}</option></Select></Field>
          {f.period === 'custom' && <>
            <Field label={t('From')} htmlFor="r-from"><Input id="r-from" type="date" value={f.from} onChange={set('from')} /></Field>
            <Field label={t('To')} htmlFor="r-to"><Input id="r-to" type="date" value={f.to} onChange={set('to')} /></Field>
          </>}
          <Field label={t('Only category (optional)')} htmlFor="r-cat"><Select id="r-cat" value={f.category} onChange={set('category')}><option value="">{t('Any')}</option>{cats.map((c) => <option key={c} value={c}>{c}</option>)}</Select></Field>
          <Field label={t('Only tag (optional)')} htmlFor="r-tag"><Input id="r-tag" value={f.tag} onChange={set('tag')} placeholder="office" /></Field>
          <Field label={t('Name (to save it)')} htmlFor="r-name"><Input id="r-name" value={f.name} onChange={set('name')} maxLength={60} placeholder={t('Office spending')} /></Field>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={async () => { try { await preview.mutateAsync(body); setOpen(null); } catch (err) { toast.error(err.details?.[0]?.message ?? err.message); } }} loading={preview.isPending}>{t('Show report')}</Button>
          <Button variant="secondary" onClick={save} loading={mutate.isPending}>{t('Save report')}</Button>
        </div>
        <div className="mt-5">{open ? (run.data ? <ReportResult data={run.data} /> : <Loading q={run} />) : preview.data ? <ReportResult data={preview.data} /> : null}</div>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader title={t('Saved reports')} />
        {!saved.data ? <Loading q={saved} /> : saved.data.reports.length ? (
          <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
            {saved.data.reports.map((r) => (
              <li key={r.id} className="flex items-center gap-2 py-2">
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpen(r.id)}>
                  <span className={cx('block truncate font-medium', open === r.id && 'text-indigo-600 dark:text-indigo-400')}>{r.name}</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">{t('By {group}', { group: GROUPS[r.groupBy].toLowerCase() })} · {PERIODS[r.period].toLowerCase()}</span>
                </button>
                <Button size="sm" variant="ghost" onClick={async () => { try { await mutate.mutateAsync({ method: 'DELETE', path: `/saved-reports/${r.id}` }); if (open === r.id) setOpen(null); toast.success(t('Report deleted')); } catch (err) { toast.error(err.message); } }}>{t('Delete')}</Button>
              </li>
            ))}
          </ul>
        ) : <EmptyState icon={CalendarRange} title={t('No saved reports')}>{t('Build one on the left and save it to open it again any time.')}</EmptyState>}
      </Card>
    </div>
  );
}

export default function Insights() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((x) => x.value === params.get('tab')) ? params.get('tab') : 'overview';
  const PANELS = { overview: Overview, patterns: Patterns, merchants: Merchants, compare: Compare, year: YearReview, reports: Reports };
  const Panel = PANELS[tab];
  return (
    <>
      <PageHeader title={t('Insights')} subtitle={t('What your entries say: where the month is heading, what’s unusual, and your habits.')} />
      <Tabs className="mb-6" label={t('Insights section')} value={tab} onChange={(v) => setParams(v === 'overview' ? {} : { tab: v }, { replace: true })} options={TABS} />
      <Panel />
      <p className="mt-6 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
        <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" /> {tab === 'overview' ? t('Everything here is worked out from your own entries; the price index comes from MoSPI.') : t('Everything here is worked out from your own entries.')} <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" /> <Link to="/transactions" className="hover:underline">{t('See transactions')}</Link>
      </p>
    </>
  );
}

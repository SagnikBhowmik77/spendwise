import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ArrowRight, CalendarClock, ChartPie, Landmark, PiggyBank, Plus, Receipt, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import {
  useAccounts, useBudgets, useByCategory, useByPaymentMethod, useDaily, useMonthly, useSummary, useTransactions, useUpcoming,
} from '../hooks/api.js';
import { METHOD_LABEL, catLabel } from '../lib/labels.js';
import { currentMonth, monthBounds, shiftMonth, today } from '../lib/dates.js';
import { formatDayShort, formatINR, formatMonth, greeting } from '../lib/format.js';
import { t, tn } from '../lib/i18n.js';
import StatCard from '../components/StatCard.jsx';
import QuickAdd from '../components/QuickAdd.jsx';
import { GetStarted } from '../components/Onboarding.jsx';
import MonthPicker from '../components/MonthPicker.jsx';
import TransactionForm from '../components/TransactionForm.jsx';
import TransactionList, { TransactionListSkeleton } from '../components/TransactionList.jsx';
import CategoryIcon from '../components/CategoryIcon.jsx';
import { CategoryPie, DailyArea, MonthlyBars } from '../components/charts.jsx';
import { Amount, Badge, Button, Card, CardHeader, EmptyState, ErrorNote, PageHeader, ProgressBar, Skeleton, STATUS_LABEL, STATUS_TONE } from '../components/ui.jsx';

const viewAll = (to, label = t('View all')) => (
  <Link to={to} className="shrink-0 text-sm font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300">{label}</Link>
);

function spendingChange(now, before, prevMonth) {
  if (!before) return null;
  const pct = Math.round(((now - before) * 1000) / before) / 10;
  if (pct === 0) return t('Same as {month}', { month: formatMonth(prevMonth) });
  return pct > 0
    ? t('{pct}% more than {month}', { pct: Math.abs(pct), month: formatMonth(prevMonth) })
    : t('{pct}% less than {month}', { pct: Math.abs(pct), month: formatMonth(prevMonth) });
}

export default function Dashboard() {
  const { user } = useAuth();
  const [month, setMonth] = useState(currentMonth);
  const [adding, setAdding] = useState(false);
  // The daily reminder notification and the app's home-screen shortcuts open /?add=expense or /?add=income
  // straight into the add form.
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const kind = params.get('add');
    if (kind !== 'expense' && kind !== 'income') return;
    setAdding(kind);
    setParams({}, { replace: true });
  }, [params, setParams]);

  const range = monthBounds(month);
  const prevMonth = shiftMonth(month, -1);
  // The current month's daily chart stops at today instead of drawing empty future days.
  const dailyRange = { from: range.from, to: range.to > today() ? today() : range.to };

  const summary = useSummary(range);
  const previous = useSummary(monthBounds(prevMonth));
  const pie = useByCategory({ ...range, type: 'expense' });
  const monthly = useMonthly({ from: monthBounds(shiftMonth(month, -5)).from, to: range.to });
  const daily = useDaily(dailyRange);
  const recent = useTransactions({ limit: 6, sort: '-date' });
  const budgets = useBudgets(month);
  const upcoming = useUpcoming(14);
  const accounts = useAccounts();
  const methods = useByPaymentMethod({ ...range, type: 'expense' });

  const s = summary.data;
  const budgetRows = budgets.data
    ? [budgets.data.overall, ...[...budgets.data.categories].sort((a, b) => b.percentUsed - a.percentUsed)].filter(Boolean).slice(0, 4)
    : [];
  const monthName = formatMonth(month);

  return (
    <>
      <PageHeader
        title={t('{greeting}, {name}', { greeting: greeting(), name: user.name.split(' ')[0] })}
        subtitle={month === currentMonth() ? t('Here’s this month at a glance.') : t('Here’s {month} at a glance.', { month: monthName })}
        actions={(
          <>
            <MonthPicker value={month} onChange={setMonth} max={currentMonth()} />
            <Button onClick={() => setAdding(true)} className="max-sm:hidden"><Plus className="h-4 w-4" aria-hidden="true" /> {t('Add transaction')}</Button>
          </>
        )}
      />

      <GetStarted />

      <div className="mb-4"><QuickAdd /></div>
      {summary.error && <div className="mb-4"><ErrorNote error={summary.error} onRetry={summary.refetch} /></div>}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label={t('Income')} tone="income" icon={TrendingUp} loading={!s} paise={s?.income.paise ?? 0} />
        <StatCard label={t('Expenses')} tone="expense" icon={TrendingDown} loading={!s} paise={s?.expense.paise ?? 0}
          sub={s && previous.data ? spendingChange(s.expense.paise, previous.data.expense.paise, prevMonth) : undefined} />
        <StatCard label={t('Balance')} tone="balance" icon={Wallet} loading={!s} paise={s?.balance.paise ?? 0}
          sub={s ? tn(s.count, '{n} transaction', '{n} transactions') : undefined} />
        <Link to="/accounts" className="block rounded-xl transition-transform duration-150 hover:-translate-y-px focus-visible:outline-2">
          <StatCard label={t('Net worth')} tone="balance" icon={Landmark} loading={!accounts.data} paise={accounts.data?.netWorth.net.paise ?? 0}
            sub={accounts.data ? tn(accounts.data.accounts.length, 'Across {n} account, today', 'Across {n} accounts, today') : undefined} />
        </Link>
      </div>

      {/* Charts: the bar chart stretches to the donut card's height, so the pair ends level. */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-5">
          <CardHeader title={t('Where the money went')} subtitle={monthName} />
          {!pie.data ? (
            <Skeleton className="mx-auto h-[180px] w-[180px] rounded-full" />
          ) : pie.data.categories.length ? (
            <CategoryPie categories={pie.data.categories} total={pie.data.total.paise} />
          ) : (
            <EmptyState icon={ChartPie} title={t('No expenses in {month}', { month: monthName })} compact>{t('Expenses you add show up here by category.')}</EmptyState>
          )}
        </Card>
        <Card className="flex flex-col lg:col-span-7">
          <CardHeader title={t('Income vs expenses')} subtitle={t('Last 6 months')} />
          {!monthly.data ? <Skeleton className="h-[240px] w-full" /> : monthly.data.months.some((m) => m.income.paise || m.expense.paise) ? (
            <MonthlyBars months={monthly.data.months} fill />
          ) : (
            <EmptyState icon={ChartPie} title={t('Nothing to compare yet')} compact>{t('Income and expenses from the last 6 months appear here as bars.')}</EmptyState>
          )}
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title={t('Daily spending')} subtitle={monthName}
          action={s && <span className="text-sm text-slate-500 dark:text-slate-400">{t('{amount} total', { amount: formatINR(s.expense.paise) })}</span>} />
        {!daily.data ? <Skeleton className="h-[180px] w-full" /> : daily.data.days.some((d) => d.expense.paise) ? (
          <DailyArea days={daily.data.days} />
        ) : (
          <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">{t('No spending recorded in {month}.', { month: monthName })}</p>
        )}
      </Card>

      {/* Recent entries beside budgets and payment methods; the list card ends with its own link, so it reads complete. */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Card className="flex flex-col lg:col-span-7">
          <CardHeader title={t('Recent transactions')} action={viewAll('/transactions')} />
          {!recent.data ? <TransactionListSkeleton /> : recent.data.items.length ? (
            <>
              <TransactionList items={recent.data.items} groupByDay />
              <Link to="/transactions" className="mt-auto flex items-center justify-center gap-1.5 border-t border-slate-900/[0.06] pt-3 text-sm font-medium text-slate-600 hover:text-slate-900 dark:border-white/[0.06] dark:text-slate-400 dark:hover:text-white">
                {t('See all transactions')} <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </>
          ) : (
            <EmptyState icon={Receipt} title={t('No transactions yet')}
              action={<Button variant="secondary" onClick={() => setAdding(true)}>{t('Add transaction')}</Button>}>
              {t('Everything you add appears here, newest first.')}
            </EmptyState>
          )}
        </Card>

        <div className="flex flex-col gap-4 lg:col-span-5">
          <Card>
            <CardHeader title={t('Budgets')} subtitle={monthName} action={viewAll('/budgets', t('Manage'))} />
            {!budgets.data ? <Skeleton className="h-24 w-full" /> : budgetRows.length ? (
              <ul className="space-y-4">
                {budgetRows.map((b) => {
                  const name = b.category ? catLabel(b.category) : t('Overall');
                  return (
                    <li key={b.id}>
                      <div className="mb-1.5 flex items-center justify-between gap-2 text-sm">
                        <span className="truncate font-medium">{name}</span>
                        {b.status === 'ok'
                          ? <span className="tabular text-caption text-slate-500 dark:text-slate-400">{b.percentUsed}%</span>
                          : <Badge tone={STATUS_TONE[b.status]} dot>{STATUS_LABEL[b.status]}</Badge>}
                      </div>
                      <ProgressBar percent={b.percentUsed} status={b.status} label={t('{name} budget used', { name })} />
                      <p className="tabular mt-1.5 text-caption text-slate-500 dark:text-slate-400">
                        {t('{spent} of {limit} · {pct}%', { spent: formatINR(b.spent.paise), limit: formatINR(b.limit.paise), pct: b.percentUsed })}
                      </p>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState icon={PiggyBank} title={t('No budgets this month')} action={viewAll('/budgets', t('Set a budget'))} compact />
            )}
          </Card>

          <Card className="flex-1">
            <CardHeader title={t('How you paid')} subtitle={monthName} />
            {!methods.data ? <Skeleton className="h-16 w-full" /> : methods.data.methods.length ? (
              <ul className="space-y-3">
                {methods.data.methods.map((m) => (
                  <li key={m.method}>
                    <div className="mb-1.5 flex justify-between gap-3 text-sm">
                      <span className="text-slate-700 dark:text-slate-300">{METHOD_LABEL[m.method]}</span>
                      <span className="tabular text-slate-500 dark:text-slate-400"><span className="font-medium text-slate-900 dark:text-white">{formatINR(m.total.paise)}</span> · {m.share}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-900/[0.07] dark:bg-white/[0.08]">
                      <div className="h-full rounded-full bg-indigo-500 transition-[width] duration-500" style={{ width: `${m.share}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400">{t('No spending in {month}.', { month: monthName })}</p>
            )}
          </Card>
        </div>
      </div>

      <Card className="mt-4">
        <CardHeader title={t('Coming up')} subtitle={t('Next 14 days')} action={viewAll('/recurring', t('Recurring'))} />
        {!upcoming.data ? <Skeleton className="h-16 w-full" /> : upcoming.data.items.length ? (
          <ul className="grid gap-x-8 sm:grid-cols-2">
            {upcoming.data.items.slice(0, 6).map((u) => (
              <li key={`${u.ruleId}-${u.date}`} className="flex items-center gap-3 border-b border-slate-900/[0.05] py-2.5 text-sm dark:border-white/[0.05]">
                <CategoryIcon category={u.category} size="sm" tone={u.type === 'income' ? 'income' : undefined} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{catLabel(u.category)}</p>
                  <p className="text-caption text-slate-500 dark:text-slate-400">{formatDayShort(u.date)}</p>
                </div>
                <Amount paise={u.amountPaise} type={u.type} />
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex items-center gap-3 rounded-lg bg-slate-900/[0.03] px-4 py-3 text-sm text-slate-500 dark:bg-white/[0.03] dark:text-slate-400">
            <CalendarClock className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span><span className="font-medium text-slate-700 dark:text-slate-200">{t('Nothing scheduled')}.</span> {t('Recurring rent, salary or bills show up here before they’re due.')}</span>
          </div>
        )}
      </Card>

      <TransactionForm open={Boolean(adding)} defaults={adding === 'income' ? { type: 'income' } : undefined} onClose={() => setAdding(false)} />
    </>
  );
}

import { useId, useState } from 'react';
import { useSearchParams } from 'react-router';
import toast from 'react-hot-toast';
import { CalendarRange, Copy, Pencil, PiggyBank, Plus, Repeat2, Trash2 } from 'lucide-react';
import {
  useBudgetHistory, useBudgets, useCopyBudgets, useDeleteBudget, useDeleteWeeklyBudget, useSaveBudget, useSaveWeeklyBudget, useWeeklyBudgets,
} from '../hooks/api.js';
import { currentMonth, shiftMonth } from '../lib/dates.js';
import { formatDayShort, formatINR, formatMonth } from '../lib/format.js';
import { catLabel } from '../lib/labels.js';
import { t, tn } from '../lib/i18n.js';
import MonthPicker from '../components/MonthPicker.jsx';
import { BudgetHistoryBars } from '../components/charts.jsx';
import { ConfirmDialog, Modal } from '../components/Modal.jsx';
import { CategoryInput, amountProblem } from '../components/TransactionForm.jsx';
import {
  Badge, Button, Card, CardHeader, EmptyState, ErrorNote, Field, Input, PageHeader, ProgressBar, Skeleton, STATUS_LABEL, STATUS_TONE, Tabs, cx,
} from '../components/ui.jsx';
import CategoryIcon from '../components/CategoryIcon.jsx';

// Row actions wait for hover on a mouse; on touch screens they stay visible.
const reveal = '[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150';
// Status in words only when it needs attention; on track shows the plain percentage.
const Status = ({ b }) => (b.status === 'ok'
  ? <span className="tabular text-caption text-slate-500 dark:text-slate-400">{b.percentUsed}%</span>
  : <Badge tone={STATUS_TONE[b.status]} dot>{STATUS_LABEL[b.status]}</Badge>);
import { Envelopes, SinkingFunds } from '../components/Budgeting.jsx';

const TABS = [{ value: 'limits', label: t('Limits') }, { value: 'envelopes', label: t('Envelopes') }, { value: 'funds', label: t('Sinking funds') }];

// "Amount is required" reads "Limit is required" here (the Hindi already says रकम, which fits both).
const limitProblem = (v) => amountProblem(v)?.replace('Amount', 'Limit');
const nameOf = (b) => (b.category ? catLabel(b.category) : t('Overall (all expenses)'));

function BudgetForm({ month, budget, preset, onDone }) {
  const uid = useId();
  const save = useSaveBudget();
  const editing = Boolean(budget);
  const [overall, setOverall] = useState(budget ? budget.category === null : preset?.overall ?? false);
  const [category, setCategory] = useState(budget?.category ?? preset?.category ?? '');
  const [limit, setLimit] = useState(budget ? String(budget.baseLimit.rupees) : '');
  const [rollover, setRollover] = useState(budget?.rollover ?? false);
  const [errors, setErrors] = useState({});

  async function submit(e) {
    e.preventDefault();
    const local = {};
    const amount = limitProblem(limit);
    if (amount) local.limit = amount;
    if (!overall && !category.trim()) local.category = t('Pick or type a category');
    setErrors(local);
    if (Object.keys(local).length) return;
    try {
      await save.mutateAsync(editing
        ? { id: budget.id, limit: limit.replace(/,/g, ''), rollover }
        : { month, category: overall ? null : category.trim(), limit: limit.replace(/,/g, ''), rollover });
      toast.success(editing ? t('Budget updated') : t('Budget saved'));
      onDone();
    } catch (err) {
      setErrors({ ...err.fieldErrors(), form: err.details.length ? undefined : err.message });
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {errors.form && <ErrorNote error={{ message: errors.form }} />}
      {!editing && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={overall} onChange={(e) => setOverall(e.target.checked)} className="h-4 w-4 rounded border-slate-300 accent-indigo-600" />
          {t('Overall limit for all expenses this month')}
        </label>
      )}
      {!overall && (
        editing ? <p className="text-sm"><span className="text-slate-500 dark:text-slate-400">{t('Category:')}</span> <span className="font-medium">{catLabel(budget.category)}</span></p> : (
          <Field label={t('Category')} htmlFor={`${uid}-cat`} error={errors.category}>
            <CategoryInput id={`${uid}-cat`} type="expense" value={category} onChange={setCategory} error={errors.category} />
          </Field>
        )
      )}
      <Field label={t('Monthly limit for {month} (₹)', { month: formatMonth(month) })} htmlFor={`${uid}-limit`} error={errors.limit}>
        <Input id={`${uid}-limit`} inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} error={errors.limit} placeholder="5000" autoFocus />
      </Field>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={rollover} onChange={(e) => setRollover(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-indigo-600" />
        <span>{t('Roll over unspent money')}<span className="block text-slate-500 dark:text-slate-400">{t('What’s left of last month’s budget for this is added to this month’s limit.')}</span></span>
      </label>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onDone}>{t('Cancel')}</Button>
        <Button type="submit" loading={save.isPending}>{editing ? t('Save') : t('Set budget')}</Button>
      </div>
    </form>
  );
}

function BudgetRow({ b, onEdit, onDelete }) {
  const over = b.remaining.paise < 0;
  const name = nameOf(b);
  return (
    <li className="group flex gap-3 py-4 first:pt-1 last:pb-1">
      <CategoryIcon category={b.category ?? 'Savings'} />
      <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate font-medium">{name}</p>
        {b.rollover && <span className="hidden items-center gap-1 text-caption text-slate-500 sm:inline-flex dark:text-slate-400" title={t('Unspent money rolls over')}><Repeat2 className="h-3.5 w-3.5" aria-hidden="true" /> {t('Rolls over')}</span>}
        <Status b={b} />
        <div className={cx('flex', reveal)}>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(b)} aria-label={t('Edit {name} budget', { name })}><Pencil className="h-4 w-4" aria-hidden="true" /></Button>
          <Button variant="ghost" size="icon" onClick={() => onDelete(b)} aria-label={t('Delete {name} budget', { name })} className="h-8 w-8 hover:text-rose-600"><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
        </div>
      </div>
      <div className="mt-2"><ProgressBar percent={b.percentUsed} status={b.status} label={t('{name} budget used', { name })} /></div>
      <div className="tabular mt-1.5 flex flex-wrap justify-between gap-x-4 text-caption text-slate-500 dark:text-slate-400">
        <span>{t('{spent} of {limit} ({pct}%)', { spent: formatINR(b.spent.paise), limit: formatINR(b.limit.paise), pct: b.percentUsed })}</span>
        <span className={over ? 'font-medium text-rose-600 dark:text-rose-400' : ''}>
          {over ? t('{amount} over', { amount: formatINR(-b.remaining.paise) }) : t('{amount} left', { amount: formatINR(b.remaining.paise) })}
        </span>
      </div>
      {b.carriedOver?.paise > 0 && (
        <p className="mt-1 text-caption text-emerald-700 dark:text-emerald-300">{t('Includes {amount} rolled over from last month ({base} budget).', { amount: formatINR(b.carriedOver.paise), base: formatINR(b.baseLimit.paise) })}</p>
      )}
      </div>
    </li>
  );
}

// Standing limits that reset every Monday, e.g. ₹2,000 a week for eating out.
function WeeklyBudgets() {
  const uid = useId();
  const { data, error, refetch } = useWeeklyBudgets();
  const save = useSaveWeeklyBudget();
  const remove = useDeleteWeeklyBudget();
  const [adding, setAdding] = useState(false);
  const [overall, setOverall] = useState(false);
  const [category, setCategory] = useState('');
  const [limit, setLimit] = useState('');
  const [errors, setErrors] = useState({});

  async function submit(e) {
    e.preventDefault();
    const local = {};
    const amount = limitProblem(limit);
    if (amount) local.limit = amount;
    if (!overall && !category.trim()) local.category = t('Pick or type a category');
    setErrors(local);
    if (Object.keys(local).length) return;
    try {
      await save.mutateAsync({ category: overall ? null : category.trim(), limit: limit.replace(/,/g, '') });
      toast.success(t('Weekly budget saved'));
      setAdding(false); setCategory(''); setLimit(''); setOverall(false);
    } catch (err) {
      setErrors({ ...err.fieldErrors(), form: err.details.length ? undefined : err.message });
    }
  }
  async function del(b) {
    try { await remove.mutateAsync(b.id); toast.success(t('Weekly budget removed')); } catch (err) { toast.error(err.message); }
  }

  return (
    <Card className="mt-4">
      <CardHeader title={t('Weekly budgets')}
        subtitle={data ? t('This week: {from} to {to}. Resets every Monday.', { from: formatDayShort(data.week.from), to: formatDayShort(data.week.to) }) : t('Resets every Monday.')}
        action={!adding && <Button variant="secondary" size="sm" onClick={() => setAdding(true)}><Plus className="h-4 w-4" aria-hidden="true" /> {t('Add weekly budget')}</Button>} />
      {error && <ErrorNote error={error} onRetry={refetch} />}
      {adding && (
        <form onSubmit={submit} noValidate className="mb-4 space-y-3 rounded-xl bg-slate-900/[0.03] p-4 ring-1 ring-inset ring-slate-900/[0.05] dark:bg-white/[0.03] dark:ring-white/[0.06]">
          {errors.form && <ErrorNote error={{ message: errors.form }} />}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={overall} onChange={(e) => setOverall(e.target.checked)} className="h-4 w-4 rounded border-slate-300 accent-indigo-600" />
            {t('Overall limit for all expenses each week')}
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {!overall && (
              <Field label={t('Category')} htmlFor={`${uid}-wcat`} error={errors.category}>
                <CategoryInput id={`${uid}-wcat`} type="expense" value={category} onChange={setCategory} error={errors.category} />
              </Field>
            )}
            <Field label={t('Weekly limit (₹)')} htmlFor={`${uid}-wlimit`} error={errors.limit}>
              <Input id={`${uid}-wlimit`} inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} error={errors.limit} placeholder="2000" />
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAdding(false)}>{t('Cancel')}</Button>
            <Button type="submit" loading={save.isPending}>{t('Save weekly budget')}</Button>
          </div>
        </form>
      )}
      {!data ? <Skeleton className="h-16 w-full" /> : data.budgets.length ? (
        <ul className="divide-y divide-slate-900/[0.05] dark:divide-white/[0.05]">
          {data.budgets.map((b) => {
            const name = nameOf(b);
            return (
              <li key={b.id} className="group py-4 first:pt-1 last:pb-1">
                <div className="flex items-center gap-2">
                  <p className="min-w-0 flex-1 truncate font-medium">{name}</p>
                  <Status b={b} />
                  <Button variant="ghost" size="icon" onClick={() => del(b)} aria-label={t('Delete {name} weekly budget', { name })} className={cx('h-8 w-8 hover:text-rose-600', reveal)}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
                </div>
                <div className="mt-2"><ProgressBar percent={b.percentUsed} status={b.status} label={t('{name} weekly budget used', { name })} /></div>
                <div className="tabular mt-1.5 flex flex-wrap justify-between gap-x-4 text-caption text-slate-500 dark:text-slate-400">
                  <span>{t('{spent} of {limit} this week ({pct}%)', { spent: formatINR(b.spent.paise), limit: formatINR(b.limit.paise), pct: b.percentUsed })}</span>
                  <span>{t('Last week: {amount}', { amount: formatINR(b.lastWeek.paise) })}</span>
                </div>
              </li>
            );
          })}
        </ul>
      ) : !adding && (
        <div className="flex items-center gap-3 rounded-lg bg-slate-900/[0.03] px-4 py-3 text-sm text-slate-500 dark:bg-white/[0.03] dark:text-slate-400">
          <CalendarRange className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span><span className="font-medium text-slate-700 dark:text-slate-200">{t('No weekly budgets')}.</span> {t('Handy for groceries or eating out: a limit that starts fresh every Monday.')}</span>
        </div>
      )}
    </Card>
  );
}

function Limits({ tabs }) {
  const [month, setMonth] = useState(currentMonth);
  const [form, setForm] = useState(null); // null | { budget?, preset? }
  const [deleting, setDeleting] = useState(null);
  const budgets = useBudgets(month);
  const historyTo = month > currentMonth() ? currentMonth() : month;
  const history = useBudgetHistory({ to: historyTo, months: 6 });
  const copy = useCopyBudgets();
  const remove = useDeleteBudget();
  const prev = shiftMonth(month, -1);
  const data = budgets.data;
  const rows = data ? [data.overall, ...data.categories].filter(Boolean) : [];

  async function copyFromPrevious() {
    try {
      const res = await copy.mutateAsync({ from: prev, to: month });
      toast.success(res.copied ? tn(res.copied, 'Copied {n} budget from {month}', 'Copied {n} budgets from {month}', { month: formatMonth(prev) }) : t('Every budget from last month is already set here'));
    } catch (err) {
      toast.error(err.code === 'no_budgets' ? t('No budgets in {month} to copy', { month: formatMonth(prev) }) : err.message);
    }
  }

  async function confirmDelete() {
    const b = deleting;
    setDeleting(null);
    try {
      await remove.mutateAsync(b.id);
      toast.success(t('Budget removed'));
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <>
      <PageHeader
        title={t('Budgets')}
        subtitle={t('Monthly limits for your spending. Only expenses count.')}
        actions={(
          <>
            <Button variant="secondary" onClick={copyFromPrevious} loading={copy.isPending}><Copy className="h-4 w-4" aria-hidden="true" /> {t('Copy {month}', { month: formatMonth(prev).split(' ')[0] })}</Button>
            <Button onClick={() => setForm({})}><Plus className="h-4 w-4" aria-hidden="true" /> {t('Add budget')}</Button>
          </>
        )}
      />
      {tabs}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <MonthPicker value={month} onChange={setMonth} max={shiftMonth(currentMonth(), 12)} />
        {data && <p className="tabular text-sm text-slate-500 dark:text-slate-400">{t('{amount} spent in total this month', { amount: formatINR(data.totals.spentTotal.paise) })}</p>}
      </div>

      {budgets.error && <div className="mb-4"><ErrorNote error={budgets.error} onRetry={budgets.refetch} /></div>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-7">
          <CardHeader title={t('Limits')} subtitle={formatMonth(month)} />
          {!data ? <Skeleton className="h-40 w-full" /> : rows.length ? (
            <ul className="divide-y divide-slate-900/[0.05] dark:divide-white/[0.05]">
              {rows.map((b) => <BudgetRow key={b.id} b={b} onEdit={(budget) => setForm({ budget })} onDelete={setDeleting} />)}
            </ul>
          ) : (
            <EmptyState icon={PiggyBank} title={t('No budgets for {month}', { month: formatMonth(month) })}
              action={<Button onClick={() => setForm({})}>{t('Add a budget')}</Button>}>
              {t('Set a limit for a category, like Food & Dining, or one overall limit for the month.')}
            </EmptyState>
          )}
        </Card>

        <div className="flex flex-col gap-4 lg:col-span-5">
          <Card>
            <CardHeader title={t('Spent without a budget')} subtitle={t('Categories with spending but no limit')} />
            {!data ? <Skeleton className="h-20 w-full" /> : data.unbudgeted.length ? (
              <ul className="space-y-2">
                {data.unbudgeted.map((u) => (
                  <li key={u.category} className="flex items-center gap-3 text-sm">
                    <CategoryIcon category={u.category} size="sm" />
                    <span className="min-w-0 flex-1 truncate">{catLabel(u.category)}</span>
                    <span className="tabular font-medium">{formatINR(u.spent.paise)}</span>
                    <Button variant="ghost" size="sm" onClick={() => setForm({ preset: { category: u.category } })}>{t('Set budget')}</Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {data.totals.spentTotal.paise ? t('Every category you spent on has a budget.') : t('No spending recorded this month.')}
              </p>
            )}
          </Card>
          <Card className="flex flex-1 flex-col">
            <CardHeader title={t('Last 6 months')} subtitle={t('Budgets vs spending in the budgeted categories')} />
            {history.data ? <BudgetHistoryBars months={history.data.months} height={180} fill /> : <Skeleton className="h-[200px] w-full" />}
          </Card>
        </div>
      </div>

      <WeeklyBudgets />

      <Modal open={form !== null} onClose={() => setForm(null)} title={form?.budget ? t('Edit budget') : t('Add budget')}>
        {form && <BudgetForm key={form.budget?.id ?? form.preset?.category ?? 'new'} month={month} budget={form.budget} preset={form.preset} onDone={() => setForm(null)} />}
      </Modal>
      <ConfirmDialog open={deleting !== null} title={t('Remove this budget?')} confirmLabel={t('Remove')} danger onClose={() => setDeleting(null)} onConfirm={confirmDelete}>
        {deleting && t('The {name} budget for {month} will be removed. Your transactions aren’t affected.', { name: deleting.category ? catLabel(deleting.category) : t('overall'), month: formatMonth(month) })}
      </ConfirmDialog>
    </>
  );
}

// Batch 12O: monthly limits, envelopes and sinking funds, one tab each (?tab=envelopes, ?tab=funds).
export default function Budgets() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((x) => x.value === params.get('tab')) ? params.get('tab') : 'limits';
  const tabs = <Tabs className="mb-6" label={t('Budget style')} value={tab} onChange={(v) => setParams(v === 'limits' ? {} : { tab: v }, { replace: true })} options={TABS} />;
  if (tab === 'limits') return <Limits tabs={tabs} />;
  return (
    <>
      <PageHeader title={t('Budgets')} subtitle={tab === 'envelopes' ? t('Share this month’s money out into envelopes and spend from each only what it holds.') : t('Save a little each month for the big yearly costs.')} />
      {tabs}
      {tab === 'envelopes' ? <Envelopes /> : <SinkingFunds />}
    </>
  );
}

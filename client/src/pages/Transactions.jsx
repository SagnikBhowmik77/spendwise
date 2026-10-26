import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import toast from 'react-hot-toast';
import { ChevronLeft, ChevronRight, FileSpreadsheet, FileText, Plus, Receipt, Search, SlidersHorizontal, X } from 'lucide-react';
import { useAccounts, useCategories, useDeleteTransaction, useRestoreTransaction, useSummary, useTags, useTransactions } from '../hooks/api.js';
import QuickAdd from '../components/QuickAdd.jsx';
import { PAYMENT_METHODS, catLabel } from '../lib/labels.js';
import { t } from '../lib/i18n.js';
import { download } from '../lib/api.js';
import { DATE_PRESETS, today } from '../lib/dates.js';
import { formatDay, formatINR } from '../lib/format.js';
import TransactionForm from '../components/TransactionForm.jsx';
import TransactionList, { TransactionListSkeleton } from '../components/TransactionList.jsx';
import { Button, Card, EmptyState, ErrorNote, Field, Input, Money, PageHeader, Segmented, Select, Skeleton, cx } from '../components/ui.jsx';

const SORTS = [
  { value: '-date', label: t('Newest first') },
  { value: 'date', label: t('Oldest first') },
  { value: '-amount', label: t('Highest amount') },
  { value: 'amount', label: t('Lowest amount') },
];
const PAGE_SIZE = 20;

// Filters live in the URL, so a filtered view survives a reload and can be bookmarked.
function useFilters() {
  const [params, setParams] = useSearchParams();
  const preset = params.get('preset') || 'this-month';
  const range = preset === 'custom'
    ? { from: params.get('from') || '', to: params.get('to') || '' }
    : (DATE_PRESETS.find((p) => p.id === preset) ?? DATE_PRESETS[0]).range();
  const filters = {
    type: params.get('type') || '',
    category: params.get('category') || '',
    q: params.get('q') || '',
    account: params.get('account') || '',
    paymentMethod: params.get('paymentMethod') || '',
    tag: params.get('tag') || '',
    sort: params.get('sort') || '-date',
    ...range,
  };
  const page = Math.max(1, Number(params.get('page')) || 1);
  const update = (changes) => setParams((prev) => {
    const next = new URLSearchParams(prev);
    for (const [k, v] of Object.entries(changes)) (v ? next.set(k, v) : next.delete(k));
    if (!('page' in changes)) next.delete('page');
    return next;
  }, { replace: true });
  return { preset, filters, page, update, clear: () => setParams({}, { replace: true }) };
}

// Income, spending and net for whatever is filtered, in one strip.
function Totals({ summary, range }) {
  const s = summary.data;
  const cells = [
    [t('Income'), s?.income.paise, 'text-emerald-600 dark:text-emerald-400'],
    [t('Expenses'), s?.expense.paise, 'text-slate-900 dark:text-white'],
    [t('Balance'), s?.balance.paise, s && s.balance.paise < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white'],
  ];
  return (
    <Card padding="none" className="mb-4 grid grid-cols-3 divide-x divide-slate-900/[0.06] dark:divide-white/[0.06]">
      {cells.map(([label, paise, tone], i) => (
        <div key={label} className="min-w-0 px-3 py-3 sm:px-5 sm:py-4">
          <p className="truncate text-caption font-medium text-slate-500 dark:text-slate-400">{label}{i === 2 && <span className="hidden sm:inline"> · {range}</span>}</p>
          {s ? <p className={cx('mt-1 truncate text-[0.9375rem] font-semibold tracking-[-0.015em] sm:text-heading', tone)}><Money paise={paise} sign={paise < 0 ? '−' : ''} /></p>
            : <Skeleton className="mt-2 h-6 w-20" />}
        </div>
      ))}
    </Card>
  );
}

export default function Transactions() {
  const { preset, filters, page, update, clear } = useFilters();
  const [search, setSearch] = useState(filters.q);
  const [editing, setEditing] = useState(null); // null | 'new' | transaction
  const [exporting, setExporting] = useState(null);
  const accounts = useAccounts({ includeArchived: true });
  const restore = useRestoreTransaction();

  // Search waits until typing pauses.
  useEffect(() => {
    const id = setTimeout(() => { if (search !== filters.q) update({ q: search.trim() }); }, 300);
    return () => clearTimeout(id);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = useTransactions({ ...filters, page, limit: PAGE_SIZE });
  const { sort, ...statFilters } = filters;
  const summary = useSummary(statFilters);
  const categories = useCategories();
  const remove = useDeleteTransaction();

  const categoryOptions = useMemo(() => {
    if (!categories.data) return [];
    const { defaults, custom } = categories.data;
    const types = filters.type ? [filters.type] : ['expense', 'income'];
    return [...new Set(types.flatMap((ty) => [...defaults[ty], ...custom[ty]]))].sort((a, b) => catLabel(a).localeCompare(catLabel(b)));
  }, [categories.data, filters.type]);

  // Anything that narrows the list (for the empty-state message) vs anything changed from the default view.
  const narrowing = filters.type || filters.category || filters.q || filters.account || filters.paymentMethod || filters.tag;
  const tagList = useTags();
  const filtered = Boolean(narrowing || preset !== 'all');
  const changed = Boolean(narrowing || preset !== 'this-month' || filters.sort !== '-date');
  // The fold-away panel: open by itself whenever one of its filters is set.
  const extra = [filters.category, filters.account, filters.paymentMethod, filters.tag, filters.sort !== '-date' && filters.sort].filter(Boolean).length;
  const [panel, setPanel] = useState(extra > 0);
  const showPanel = panel || extra > 0;
  const data = list.data;
  const firstShown = data ? (data.page - 1) * data.limit + 1 : 0;
  const rangeLabel = filters.from || filters.to ? `${filters.from ? formatDay(filters.from) : t('Start')} – ${filters.to ? formatDay(filters.to) : t('today')}` : t('All time');

  async function exportAs(kind) {
    setExporting(kind);
    try {
      const { from, to, ...rest } = filters;
      await download(`/export/transactions.${kind}`, { ...rest, from, to });
      toast.success(t('{kind} downloaded', { kind: kind.toUpperCase() }));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setExporting(null);
    }
  }

  // Deletes at once and offers Undo (a deleted entry can also be restored later from Activity).
  async function deleteNow(tx) {
    try {
      await remove.mutateAsync(tx.id);
    } catch (err) {
      toast.error(t('Couldn’t delete: {error}', { error: err.message }));
      return;
    }
    toast((tt) => (
      <span className="flex items-center gap-3">
        <span>{t('Deleted {what} · {amount}', { what: tx.type === 'transfer' ? t('transfer') : catLabel(tx.category), amount: formatINR(tx.amountPaise) })}</span>
        <button type="button" className="font-semibold text-indigo-600 hover:underline dark:text-indigo-400" onClick={async () => {
          toast.dismiss(tt.id);
          try {
            await restore.mutateAsync(tx.id);
            toast.success(t('Restored'));
          } catch (err) {
            toast.error(err.message);
          }
        }}>{t('Undo')}</button>
      </span>
    ), { duration: 8000 });
  }

  return (
    <>
      <PageHeader
        title={t('Transactions')}
        subtitle={t('Every income and expense, filtered your way.')}
        actions={(
          <>
            <Button variant="secondary" onClick={() => exportAs('csv')} loading={exporting === 'csv'} disabled={!data?.total}>
              <FileSpreadsheet className="h-4 w-4" aria-hidden="true" /> CSV
            </Button>
            <Button variant="secondary" onClick={() => exportAs('pdf')} loading={exporting === 'pdf'} disabled={!data?.total}>
              <FileText className="h-4 w-4" aria-hidden="true" /> PDF
            </Button>
            <Button onClick={() => setEditing('new')} className="max-sm:hidden"><Plus className="h-4 w-4" aria-hidden="true" /> {t('Add')}</Button>
          </>
        )}
      />

      <div className="mb-4"><QuickAdd /></div>

      {/* Search, dates and type always in view; the rest folds away. */}
      <div className="mb-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-0 flex-[1_1_16rem]">
            <label htmlFor="tx-search" className="sr-only">{t('Search')}</label>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <Input id="tx-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('Notes or category')} className="pl-9" />
          </div>
          <div className="min-w-0 flex-[1_1_10rem] sm:max-w-[13rem]">
            <label htmlFor="tx-preset" className="sr-only">{t('Dates')}</label>
            <Select id="tx-preset" value={preset} onChange={(e) => {
              const id = e.target.value;
              update(id === 'custom' ? { preset: id, from: filters.from || today().slice(0, 8) + '01', to: filters.to || today() } : { preset: id, from: '', to: '' });
            }}>
              {DATE_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </Select>
          </div>
          <Button variant="secondary" onClick={() => setPanel((o) => !o)} aria-expanded={showPanel} aria-controls="tx-more-filters">
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" /> {t('Filters')}
            {extra > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-indigo-600 px-1.5 text-[0.6875rem] font-semibold text-white dark:bg-indigo-600">{extra}</span>}
          </Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="max-w-full overflow-x-auto">
            <Segmented label={t('Type')} size="sm" value={filters.type} onChange={(v) => update({ type: v, category: '', paymentMethod: v === 'transfer' ? '' : filters.paymentMethod })}
              options={[{ value: '', label: t('All') }, { value: 'expense', label: t('Expenses') }, { value: 'income', label: t('Income') }, { value: 'transfer', label: t('Transfers') }]} />
          </div>
          {changed && (
            <button type="button" onClick={() => { setSearch(''); setPanel(false); clear(); }} className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">
              <X className="h-3.5 w-3.5" aria-hidden="true" /> {t('Reset filters')}
            </button>
          )}
        </div>
        {preset === 'custom' && (
          <div className="grid gap-3 sm:max-w-md sm:grid-cols-2">
            <Field label={t('From')} htmlFor="tx-from">
              <Input id="tx-from" type="date" value={filters.from} max={filters.to || today()} onChange={(e) => update({ from: e.target.value })} />
            </Field>
            <Field label={t('To')} htmlFor="tx-to">
              <Input id="tx-to" type="date" value={filters.to} min={filters.from} onChange={(e) => update({ to: e.target.value })} />
            </Field>
          </div>
        )}
        <div id="tx-more-filters" hidden={!showPanel} className={cx(showPanel && 'animate-rise')}>
          <Card className="grid grid-cols-2 gap-3 lg:grid-cols-5 [&>*:last-child]:col-span-2 lg:[&>*:last-child]:col-span-1">
            <Field label={t('Category')} htmlFor="tx-category">
              <Select id="tx-category" value={filters.category} onChange={(e) => update({ category: e.target.value })}>
                <option value="">{t('All categories')}</option>
                {categoryOptions.map((c) => <option key={c} value={c}>{catLabel(c)}</option>)}
              </Select>
            </Field>
            <Field label={t('Account')} htmlFor="tx-account">
              <Select id="tx-account" value={filters.account} onChange={(e) => update({ account: e.target.value })}>
                <option value="">{t('All accounts')}</option>
                {(accounts.data?.accounts ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}{a.archived ? ` (${t('archived')})` : ''}</option>)}
              </Select>
            </Field>
            <Field label={t('Paid with')} htmlFor="tx-method">
              <Select id="tx-method" value={filters.paymentMethod} onChange={(e) => update({ paymentMethod: e.target.value })}>
                <option value="">{t('Any method')}</option>
                {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </Select>
            </Field>
            <Field label={t('Tag')} htmlFor="tx-tag">
              <Select id="tx-tag" value={filters.tag} onChange={(e) => update({ tag: e.target.value })}>
                <option value="">{t('Any tag')}</option>
                {(tagList.data?.tags ?? []).map((x) => <option key={x.tag} value={x.tag}>#{x.tag} ({x.count})</option>)}
                {filters.tag && !(tagList.data?.tags ?? []).some((x) => x.tag === filters.tag) && <option value={filters.tag}>#{filters.tag}</option>}
              </Select>
            </Field>
            <Field label={t('Sort')} htmlFor="tx-sort">
              <Select id="tx-sort" value={filters.sort} onChange={(e) => update({ sort: e.target.value === '-date' ? '' : e.target.value })}>
                {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </Select>
            </Field>
          </Card>
        </div>
      </div>

      <Totals summary={summary} range={rangeLabel} />

      <Card>
        {list.error && <ErrorNote error={list.error} onRetry={list.refetch} />}
        {!data ? <TransactionListSkeleton rows={8} /> : data.items.length ? (
          <>
            <TransactionList items={data.items} onEdit={setEditing} onDelete={deleteNow} groupByDay={filters.sort === '-date' || filters.sort === 'date'} />
            <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-900/[0.06] pt-3 text-sm dark:border-white/[0.06]">
              <p className="tabular text-slate-500 dark:text-slate-400">
                {t('{from}–{to} of {total}', { from: firstShown, to: firstShown + data.items.length - 1, total: data.total })}
              </p>
              <div className="flex gap-1">
                <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })} aria-label={t('Previous page')}>
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button variant="secondary" size="sm" disabled={page >= data.totalPages} onClick={() => update({ page: String(page + 1) })} aria-label={t('Next page')}>
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          </>
        ) : filtered ? (
          <EmptyState icon={Search} title={t('No transactions match these filters')}
            action={<Button variant="secondary" onClick={() => { setSearch(''); clear(); }}>{t('Clear filters')}</Button>}>
            {t('Try another date range or category.')}
          </EmptyState>
        ) : (
          <EmptyState icon={Receipt} title={t('No transactions yet')} action={<Button onClick={() => setEditing('new')}>{t('Add transaction')}</Button>}>
            {t('Add your income and expenses to start tracking.')}
          </EmptyState>
        )}
      </Card>

      <TransactionForm open={editing !== null} onClose={() => setEditing(null)} transaction={editing === 'new' ? null : editing} />
    </>
  );
}

import { Money, Skeleton, cx } from './ui.jsx';

// One summary number (income, expenses, balance or net worth). Reused on the dashboard and the transactions page.
// The number does the work: large, tabular, paise muted. The icon is a quiet marker, not decoration.
export default function StatCard({ label, paise, tone, icon: Icon, sub, loading }) {
  const negative = tone === 'balance' && paise < 0;
  return (
    <div className="min-w-0 rounded-xl bg-white p-4 shadow-xs ring-1 ring-slate-900/[0.06] sm:p-5 dark:bg-slate-900 dark:shadow-none dark:ring-white/[0.06]">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-sm font-medium text-slate-500 dark:text-slate-400">{label}</p>
        {Icon && <Icon className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" strokeWidth={1.75} />}
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-8 w-36" />
      ) : (
        <p className={cx('mt-2 truncate text-[1.25rem] font-semibold leading-7 tracking-[-0.025em] sm:text-[1.5rem] sm:leading-8 2xl:text-title', negative ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white')}>
          <Money paise={paise} sign={negative ? '−' : ''} />
        </p>
      )}
      {sub && <p className="mt-1 truncate text-caption text-slate-500 dark:text-slate-400" title={typeof sub === 'string' ? sub : undefined}>{sub}</p>}
    </div>
  );
}

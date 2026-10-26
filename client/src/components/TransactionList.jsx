import { useState } from 'react';
import { Paperclip, Pencil, Repeat, Trash2 } from 'lucide-react';
import { formatMoney } from '../lib/format.js';
import { ReceiptViewer } from './Receipt.jsx';
import { useAccounts } from '../hooks/api.js';
import { useSpace } from '../context/SpaceContext.jsx';
import { formatDay } from '../lib/format.js';
import { addDays, today } from '../lib/dates.js';
import { METHOD_LABEL, catLabel } from '../lib/labels.js';
import { t as tr } from '../lib/i18n.js';
import CategoryIcon from './CategoryIcon.jsx';
import { Amount, Button, Money, Skeleton, cx } from './ui.jsx';

const TYPE_LABEL = { income: tr('Income'), expense: tr('Expense'), transfer: tr('Transfer') };
// Edit and delete wait for hover on a mouse; on touch screens (no hover) they stay visible.
const reveal = '[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150';

export function TransactionRow({ t, onEdit, onDelete, accountName, addedBy, onReceipt, showDate = true }) {
  const title = t.type === 'transfer'
    ? `${accountName(t.account)} → ${accountName(t.toAccount)}`
    : t.splits ? t.splits.map((s) => catLabel(s.category)).join(' + ') : catLabel(t.category);
  const account = t.type !== 'transfer' && accountName(t.account);
  const method = t.paymentMethod && METHOD_LABEL[t.paymentMethod];
  const details = [
    showDate && formatDay(t.date),
    t.time,
    t.merchant,
    t.note && t.note !== t.merchant && t.note,
    account,
    method !== account && method,
    t.original && formatMoney(t.original.amount, t.original.currency),
    t.worth === 'no' && tr('Not worth it'),
    t.worth === 'yes' && tr('Worth it'),
    addedBy && tr('by {name}', { name: addedBy }),
  ].filter(Boolean);
  const icon = t.type === 'transfer' ? 'Transfer' : t.splits ? 'Split' : t.category;
  return (
    <li className="group flex items-center gap-3 py-2.5">
      <CategoryIcon category={icon} tone={t.type === 'income' ? 'income' : undefined} />
      <span className="sr-only">{TYPE_LABEL[t.type]}</span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-sm font-medium text-slate-900 dark:text-slate-100">
          <span className="truncate">{title}</span>
          {t.recurringRuleId && <Repeat className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-label={tr('From a recurring rule')} />}
        </p>
        <p className="truncate text-caption text-slate-500 dark:text-slate-400">
          {details.join(' · ')}
          {t.tags.map((g) => <span key={g} className="ml-1.5 text-indigo-600 dark:text-indigo-400">#{g}</span>)}
        </p>
      </div>
      {t.hasReceipt && onReceipt && (
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onReceipt(t)} aria-label={tr('View receipt for {title}', { title })}>
          <Paperclip className="h-4 w-4" aria-hidden="true" />
        </Button>
      )}
      <Amount paise={t.amountPaise} type={t.type} className="shrink-0 text-sm" />
      {(onEdit || onDelete) && (
        <div className={cx('flex shrink-0 gap-0.5', reveal)}>
          {onEdit && (
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(t)} aria-label={tr('Edit {title} on {date}', { title, date: formatDay(t.date) })}>
              <Pencil className="h-4 w-4" aria-hidden="true" />
            </Button>
          )}
          {onDelete && (
            <Button variant="ghost" size="icon" onClick={() => onDelete(t)} aria-label={tr('Delete {title} on {date}', { title, date: formatDay(t.date) })}
              className="h-8 w-8 hover:text-rose-600 dark:hover:text-rose-400">
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

export function TransactionListSkeleton({ rows = 5 }) {
  return (
    <ul className="space-y-1">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex items-center gap-3 py-2.5">
          <Skeleton className="h-10 w-10 rounded-xl" />
          <div className="flex-1 space-y-1.5"><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-48" /></div>
          <Skeleton className="h-4 w-20" />
        </li>
      ))}
    </ul>
  );
}

const dayLabel = (day) => (day === today() ? tr('Today') : day === addDays(today(), -1) ? tr('Yesterday') : formatDay(day));

// groupByDay: entries under a heading per day; days with several entries also show their net (money in minus money
// out; transfers left out).
// Only for lists in date order.
export default function TransactionList({ items, onEdit, onDelete, groupByDay = false }) {
  const { data } = useAccounts({ includeArchived: true });
  const { shared, memberName } = useSpace();
  const names = new Map((data?.accounts ?? []).map((a) => [a.id, a.name]));
  const accountName = (id) => names.get(id) ?? tr('Account');
  const [receipt, setReceipt] = useState(null);
  const row = (t) => (
    <TransactionRow key={t.id} t={t} onEdit={onEdit} onDelete={onDelete} accountName={accountName} showDate={!groupByDay}
      addedBy={shared ? memberName(t.createdBy) : null} onReceipt={(x) => setReceipt(x.id)} />
  );
  const days = [];
  if (groupByDay) for (const t of items) { if (days.at(-1)?.day !== t.date) days.push({ day: t.date, items: [] }); days.at(-1).items.push(t); }
  return (
    <>
      {groupByDay ? (
        <div className="space-y-3">
          {days.map((d) => {
            const net = d.items.reduce((s, t) => s + (t.type === 'income' ? t.amountPaise : t.type === 'expense' ? -t.amountPaise : 0), 0);
            return (
              <section key={d.day} aria-label={dayLabel(d.day)}>
                <div className="flex items-baseline justify-between border-b border-slate-900/[0.06] pb-1.5 dark:border-white/[0.06]">
                  <h3 className="text-caption font-semibold text-slate-500 dark:text-slate-400">{dayLabel(d.day)}</h3>
                  {d.items.length > 1 && net !== 0 && <Money paise={net} sign={net > 0 ? '+' : '−'} className="text-caption font-medium text-slate-500 dark:text-slate-400" />}
                </div>
                <ul>{d.items.map(row)}</ul>
              </section>
            );
          })}
        </div>
      ) : (
        <ul className="divide-y divide-slate-900/[0.05] dark:divide-white/[0.05]">{items.map(row)}</ul>
      )}
      <ReceiptViewer txId={receipt} onClose={() => setReceipt(null)} />
    </>
  );
}

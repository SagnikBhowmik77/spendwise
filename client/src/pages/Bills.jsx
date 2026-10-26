import { useId, useState } from 'react';
import toast from 'react-hot-toast';
import { CalendarClock, Plus, Trash2 } from 'lucide-react';
import { useAccounts, useBillCalendar, useBills, usePlanMutation } from '../hooks/api.js';
import { formatDay, formatDayShort, formatINR, formatMonth } from '../lib/format.js';
import { currentMonth, shiftMonth, today } from '../lib/dates.js';
import { CategoryInput, amountProblem } from '../components/TransactionForm.jsx';
import MonthPicker from '../components/MonthPicker.jsx';
import { ConfirmDialog, Modal } from '../components/Modal.jsx';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorNote, Field, Input, PageHeader, Select, Skeleton, cx } from '../components/ui.jsx';
import { t, tn } from '../lib/i18n.js';
import { catLabel } from '../lib/labels.js';

const rupees = (s) => String(s).trim().replace(/,/g, '');
const FREQ = { monthly: t('Monthly'), quarterly: t('Every 3 months'), 'half-yearly': t('Every 6 months'), yearly: t('Yearly') };
const STATUS = {
  overdue: [t('Overdue'), 'rose'], 'due-soon': [t('Due soon'), 'amber'], upcoming: [t('Upcoming'), 'slate'],
  paid: [t('Paid'), 'green'], skipped: [t('Skipped'), 'slate'], inactive: [t('Stopped'), 'slate'],
};
const PILL = {
  overdue: 'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200',
  'due-soon': 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200',
  upcoming: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  paid: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200',
  skipped: 'bg-slate-100 text-slate-500 line-through dark:bg-slate-800 dark:text-slate-400',
};

function dueText(b) {
  if (!b.nextDue) return t('Stopped');
  const d = b.daysUntilDue;
  if (d < 0) return tn(-d, 'Was due {date} ({n} day ago)', 'Was due {date} ({n} days ago)', { date: formatDay(b.nextDue) });
  if (d === 0) return t('Due today');
  if (d === 1) return t('Due tomorrow');
  return t('Due {date} (in {n} days)', { date: formatDay(b.nextDue), n: d });
}

function AccountSelect({ id, value, onChange, label }) {
  const { data } = useAccounts();
  return (
    <Field label={label} htmlFor={id}>
      <Select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{t('Default account')}</option>
        {(data?.accounts ?? []).filter((a) => !a.archived).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </Select>
    </Field>
  );
}

function BillForm({ bill, onDone }) {
  const uid = useId();
  const save = usePlanMutation('bills');
  const [f, setF] = useState({
    name: bill?.name ?? '', amount: bill?.amount ? String(bill.amount.rupees) : '', category: bill?.category ?? '',
    frequency: bill?.frequency ?? 'monthly', firstDue: bill?.nextDue ?? bill?.firstDue ?? today(), account: bill?.account ?? null,
  });
  const [errors, setErrors] = useState({});
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function submit(e) {
    e.preventDefault();
    const local = {};
    if (!f.name.trim()) local.name = t('Name the bill, e.g. Electricity');
    if (f.amount && amountProblem(rupees(f.amount))) local.amount = amountProblem(rupees(f.amount));
    if (!f.category.trim()) local.category = t('Pick a category');
    setErrors(local);
    if (Object.keys(local).length) return;
    const body = { name: f.name.trim(), amount: f.amount ? rupees(f.amount) : null, category: f.category.trim(), frequency: f.frequency, account: f.account };
    try {
      // Editing keeps the bill's history; a new first due date only applies to new bills.
      if (bill) await save.mutateAsync({ method: 'PATCH', path: `/bills/${bill.id}`, body });
      else await save.mutateAsync({ path: '/bills', body: { ...body, firstDue: f.firstDue } });
      toast.success(bill ? t('Bill updated') : t('Bill added'));
      onDone();
    } catch (err) {
      setErrors({ ...err.fieldErrors(), form: err.details.length ? undefined : err.message });
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {errors.form && <ErrorNote error={{ message: errors.form }} />}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('Bill')} htmlFor={`${uid}-n`} error={errors.name}><Input id={`${uid}-n`} value={f.name} onChange={set('name')} maxLength={60} placeholder={t('Electricity')} autoFocus /></Field>
        <Field label={t('Amount (₹)')} htmlFor={`${uid}-a`} error={errors.amount} hint={t('Leave empty if it changes every time.')}><Input id={`${uid}-a`} inputMode="decimal" value={f.amount} onChange={set('amount')} /></Field>
        <Field label={t('Category')} htmlFor={`${uid}-c`} error={errors.category}><CategoryInput id={`${uid}-c`} type="expense" value={f.category} onChange={(category) => setF({ ...f, category })} error={errors.category} /></Field>
        <Field label={t('How often')} htmlFor={`${uid}-f`}>
          <Select id={`${uid}-f`} value={f.frequency} onChange={set('frequency')}>{Object.entries(FREQ).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
        </Field>
        {!bill && <Field label={t('Next due date')} htmlFor={`${uid}-d`}><Input id={`${uid}-d`} type="date" value={f.firstDue} onChange={set('firstDue')} /></Field>}
        <AccountSelect id={`${uid}-acc`} label={t('Usually paid from')} value={f.account} onChange={(account) => setF({ ...f, account })} />
      </div>
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onDone}>{t('Cancel')}</Button><Button type="submit" loading={save.isPending}>{bill ? t('Save') : t('Add bill')}</Button></div>
    </form>
  );
}

function PayForm({ bill, onDone }) {
  const uid = useId();
  const save = usePlanMutation('bills', { money: true });
  const [amount, setAmount] = useState(bill.amount ? String(bill.amount.rupees) : '');
  const [date, setDate] = useState(today());
  const [account, setAccount] = useState(bill.account);
  const [addEntry, setAddEntry] = useState(true);
  const [error, setError] = useState(null);
  async function submit(e) {
    e.preventDefault();
    const a = amountProblem(rupees(amount));
    if (a) { setError(a); return; }
    try {
      await save.mutateAsync({ path: `/bills/${bill.id}/pay`, body: { amount: rupees(amount), date, addEntry, ...(account && { account }) } });
      toast.success(t('{name} marked as paid', { name: bill.name }));
      onDone();
    } catch (err) {
      setError(err.details?.[0]?.message ?? err.message);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <p className="text-sm text-slate-600 dark:text-slate-400">{t('For the bill due {date}. The next one is due after that.', { date: formatDay(bill.nextDue) })}</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('Amount paid (₹)')} htmlFor={`${uid}-a`} error={error}><Input id={`${uid}-a`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></Field>
        <Field label={t('Paid on')} htmlFor={`${uid}-d`}><Input id={`${uid}-d`} type="date" max={today()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={addEntry} onChange={(e) => setAddEntry(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
        {t('Add it to my transactions as a {category} expense', { category: catLabel(bill.category) })}
      </label>
      {addEntry && <AccountSelect id={`${uid}-acc`} label={t('Paid from')} value={account} onChange={setAccount} />}
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onDone}>{t('Cancel')}</Button><Button type="submit" loading={save.isPending}>{t('Mark as paid')}</Button></div>
    </form>
  );
}

// Monday-first month grid with each day's bills; on phones, a plain list of the month's due dates.
function Calendar({ month, items }) {
  const first = new Date(`${month}-01T00:00:00Z`);
  const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7;
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];
  const now = today();
  return (
    <>
      <div className="hidden grid-cols-7 gap-1 text-xs sm:grid">
        {[t('Mon'), t('Tue'), t('Wed'), t('Thu'), t('Fri'), t('Sat'), t('Sun')].map((d) => <div key={d} className="pb-1 text-center font-medium text-slate-500 dark:text-slate-400">{d}</div>)}
        {cells.map((day, i) => (
          <div key={day ?? `pad-${i}`} className={cx('min-h-[4.5rem] rounded-lg p-1.5', day ? 'bg-slate-900/[0.03] dark:bg-white/[0.04]/40' : '', day === now && 'ring-2 ring-brand-500')}>
            {day && <div className="mb-1 text-slate-500 dark:text-slate-400">{Number(day.slice(8))}</div>}
            {items.filter((it) => it.dueDate === day).map((it) => (
              <div key={it.billId} className={cx('mb-0.5 truncate rounded px-1 py-0.5', PILL[it.status])} title={`${it.name}: ${STATUS[it.status][0]}${it.amount ? `, ${formatINR(it.amount.paise)}` : ''}`}>
                {it.name}
              </div>
            ))}
          </div>
        ))}
      </div>
      <ul className="space-y-1.5 text-sm sm:hidden">
        {items.length ? items.map((it) => (
          <li key={`${it.billId}-${it.dueDate}`} className="flex items-center gap-2">
            <span className="w-14 text-xs text-slate-500 dark:text-slate-400">{formatDayShort(it.dueDate)}</span>
            <span className={cx('min-w-0 flex-1 truncate rounded px-2 py-0.5', PILL[it.status])}>{it.name}</span>
            {it.amount && <span className="tabular">{formatINR(it.amount.paise)}</span>}
          </li>
        )) : <li className="text-slate-500 dark:text-slate-400">{t('No bills due in {month}.', { month: formatMonth(month) })}</li>}
      </ul>
    </>
  );
}

export default function Bills() {
  const { data, error, refetch } = useBills();
  const [month, setMonth] = useState(currentMonth);
  const cal = useBillCalendar(month);
  const mutate = usePlanMutation('bills', { money: true });
  const [form, setForm] = useState(null); // { bill? }
  const [paying, setPaying] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const bills = data?.bills ?? [];
  const run = async (body, message) => { try { await mutate.mutateAsync(body); toast.success(message); } catch (err) { toast.error(err.message); } };
  const monthly = bills.filter((b) => b.active && b.amount).reduce((s, b) => s + Math.round(b.amount.paise / { monthly: 1, quarterly: 3, 'half-yearly': 6, yearly: 12 }[b.frequency]), 0);

  return (
    <>
      <PageHeader title={t('Bills')} subtitle={t('Bills you pay yourself, with a reminder 3 days before each one is due.')}
        actions={<Button onClick={() => setForm({})}><Plus className="h-4 w-4" aria-hidden="true" /> {t('Add bill')}</Button>} />
      {error && <div className="mb-4"><ErrorNote error={error} onRetry={refetch} /></div>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader title={t('Your bills')} subtitle={monthly ? t('About {amount} a month for bills with a fixed amount', { amount: formatINR(monthly) }) : undefined} />
          {!data ? <Skeleton className="h-40 w-full" /> : bills.length ? (
            <ul className="-my-3 divide-y divide-slate-900/[0.05] dark:divide-white/[0.05]">
              {bills.map((b) => (
                <li key={b.id} className="py-3">
                  <div className="flex items-center gap-2">
                    <p className="min-w-0 flex-1 truncate font-medium">{b.name}</p>
                    <Badge tone={STATUS[b.status][1]}>{STATUS[b.status][0]}</Badge>
                    <span className="tabular text-sm font-semibold">{b.amount ? formatINR(b.amount.paise) : t('Varies')}</span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{dueText(b)} · {FREQ[b.frequency]} · {catLabel(b.category)}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {b.active && <Button size="sm" onClick={() => setPaying(b)}>{t('Mark as paid')}</Button>}
                    {b.active && <Button size="sm" variant="ghost" onClick={() => run({ path: `/bills/${b.id}/skip` }, t('Skipped the {date} bill', { date: formatDayShort(b.nextDue) }))}>{t('Skip')}</Button>}
                    {b.payments.length > 0 && <Button size="sm" variant="ghost" onClick={() => run({ path: `/bills/${b.id}/undo` }, t('Last payment undone'))}>{t('Undo last')}</Button>}
                    <Button size="sm" variant="ghost" onClick={() => setForm({ bill: b })}>{t('Edit')}</Button>
                    <Button size="sm" variant="ghost" onClick={() => run({ method: 'PATCH', path: `/bills/${b.id}`, body: { active: !b.active } }, b.active ? t('Bill stopped') : t('Bill started again'))}>{b.active ? t('Stop') : t('Start again')}</Button>
                    <Button size="sm" variant="ghost" aria-label={t('Delete {name}', { name: b.name })} className="hover:text-rose-600" onClick={() => setDeleting(b)}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : <EmptyState icon={CalendarClock} title={t('No bills yet')} action={<Button onClick={() => setForm({})}>{t('Add a bill')}</Button>}>{t('Electricity, rent, phone, insurance: add them once and Spendwise reminds you before each is due.')}</EmptyState>}
        </Card>
        <Card className="lg:col-span-3">
          <CardHeader title={t('Calendar')} action={<MonthPicker value={month} onChange={setMonth} max={shiftMonth(currentMonth(), 12)} />} />
          {cal.error ? <ErrorNote error={cal.error} onRetry={cal.refetch} /> : !cal.data ? <Skeleton className="h-64 w-full" /> : <Calendar month={month} items={cal.data.items} />}
        </Card>
      </div>
      <Modal open={form !== null} onClose={() => setForm(null)} title={form?.bill ? t('Edit bill') : t('Add bill')} size="lg">
        {form && <BillForm key={form.bill?.id ?? 'new'} bill={form.bill} onDone={() => setForm(null)} />}
      </Modal>
      <Modal open={paying !== null} onClose={() => setPaying(null)} title={paying ? t('Pay {name}', { name: paying.name }) : t('Pay bill')}>
        {paying && <PayForm key={paying.id + paying.nextDue} bill={paying} onDone={() => setPaying(null)} />}
      </Modal>
      <ConfirmDialog open={deleting !== null} title={t('Delete this bill?')} confirmLabel={t('Delete')} danger onClose={() => setDeleting(null)}
        onConfirm={async () => { const b = deleting; setDeleting(null); await run({ method: 'DELETE', path: `/bills/${b.id}` }, t('Bill deleted')); }}>
        {deleting && t('“{name}” and its payment history are removed. Expenses already recorded for it stay in your transactions.', { name: deleting.name })}
      </ConfirmDialog>
    </>
  );
}

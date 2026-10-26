// Batch 12O: envelope budgeting, sinking funds and the wishlist with its cooling-off period.
import { useId, useState } from 'react';
import { Link } from 'react-router';
import toast from 'react-hot-toast';
import { Copy, Gift, Mail, Pencil, PiggyBank, Plus, ShoppingBag, Trash2, X } from 'lucide-react';
import { useCategories, useEnvelopes, usePlanMutation, useSinkingFunds, useWishlist } from '../hooks/api.js';
import { currentMonth, shiftMonth, today } from '../lib/dates.js';
import { formatDay, formatINR, formatMonth } from '../lib/format.js';
import { catLabel } from '../lib/labels.js';
import { t, tn } from '../lib/i18n.js';
import MonthPicker from './MonthPicker.jsx';
import { ConfirmDialog, Modal } from './Modal.jsx';
import { AccountSelect, amountProblem } from './TransactionForm.jsx';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorNote, Field, Input, ProgressBar, Skeleton, cx } from './ui.jsx';

const rupees = (s) => String(s ?? '').trim().replace(/,/g, '');
const errorText = (err) => err.details?.[0]?.message ?? err.message;
const chip = (on) => cx('rounded-full border px-2.5 py-1 text-xs font-medium',
  on ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-white/[0.08] dark:text-slate-300 dark:hover:bg-slate-800');

// ───────────── Envelopes ─────────────

const ENVELOPE_STATUS = { ok: ['green', t('On track')], warning: ['amber', t('Nearly empty')], over: ['rose', t('Overspent')] };

function EnvelopeEditor({ month, data, onDone }) {
  const uid = useId();
  const save = usePlanMutation('transactions');
  const cats = useCategories();
  const all = cats.data ? [...cats.data.defaults.expense, ...cats.data.custom.expense] : [];
  const [income, setIncome] = useState(data.incomePlanned ? String(data.incomePlanned.rupees) : '');
  const [rows, setRows] = useState(() => (data.envelopes.length
    ? data.envelopes.map((e) => ({ name: e.name, categories: e.categories, amount: String(e.amount.rupees) }))
    : [{ name: t('Needs'), categories: [], amount: '' }]));
  const [error, setError] = useState(null);
  const set = (i, patch) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const used = (c, i) => rows.some((r, j) => j !== i && r.categories.includes(c));
  const total = rows.reduce((s, r) => s + (Number(rupees(r.amount)) || 0), 0);
  async function submit(e) {
    e.preventDefault();
    const bad = rows.findIndex((r) => !r.name.trim() || amountProblem(rupees(r.amount)));
    if (bad >= 0) { setError(t('Envelope {n} needs a name and an amount', { n: bad + 1 })); return; }
    if (income.trim() && amountProblem(rupees(income))) { setError(amountProblem(rupees(income))); return; }
    try {
      await save.mutateAsync({ method: 'PUT', path: `/envelopes?month=${month}`, body: { income: income.trim() ? rupees(income) : null, envelopes: rows.map((r) => ({ name: r.name.trim(), categories: r.categories, amount: rupees(r.amount) })) } });
      toast.success(t('Envelopes saved'));
      onDone();
    } catch (err) { setError(errorText(err)); }
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && <ErrorNote error={{ message: error }} />}
      <Field label={t('Money to share out (₹, optional)')} htmlFor={`${uid}-inc`} hint={t('Leave empty to use the income recorded this month ({amount}).', { amount: formatINR(data.incomeRecorded.paise) })}>
        <Input id={`${uid}-inc`} inputMode="decimal" value={income} onChange={(e) => setIncome(e.target.value)} placeholder={String(data.incomeRecorded.rupees || '')} />
      </Field>
      <ul className="space-y-3">
        {rows.map((r, i) => (
          <li key={i} className="rounded-lg border border-slate-900/[0.08] p-3 dark:border-white/[0.08]">
            <div className="flex gap-2">
              <Input aria-label={t('Envelope name')} value={r.name} onChange={(e) => set(i, { name: e.target.value })} maxLength={60} placeholder={t('e.g. Food')} />
              <Input aria-label={t('Amount (₹)')} className="w-32" inputMode="decimal" value={r.amount} onChange={(e) => set(i, { amount: e.target.value })} placeholder="₹" />
              <Button variant="ghost" size="sm" aria-label={t('Remove envelope')} onClick={() => setRows((x) => x.filter((_, j) => j !== i))}><X className="h-4 w-4" aria-hidden="true" /></Button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {all.filter((c) => !used(c, i)).map((c) => (
                <button key={c} type="button" className={chip(r.categories.includes(c))} aria-pressed={r.categories.includes(c)}
                  onClick={() => set(i, { categories: r.categories.includes(c) ? r.categories.filter((x) => x !== c) : [...r.categories, c] })}>{catLabel(c)}</button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="secondary" size="sm" onClick={() => setRows((r) => [...r, { name: '', categories: [], amount: '' }])} disabled={rows.length >= 30}><Plus className="h-4 w-4" aria-hidden="true" /> {t('Add envelope')}</Button>
        <span className="tabular text-sm text-slate-600 dark:text-slate-400">{t('{amount} shared out', { amount: formatINR(Math.round(total * 100)) })}</span>
      </div>
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onDone}>{t('Cancel')}</Button><Button type="submit" loading={save.isPending}>{t('Save')}</Button></div>
    </form>
  );
}

export function Envelopes() {
  const [month, setMonth] = useState(currentMonth);
  const [editing, setEditing] = useState(false);
  const [clearing, setClearing] = useState(false);
  const q = useEnvelopes(month);
  const act = usePlanMutation('transactions');
  const d = q.data;
  async function copy() {
    try { await act.mutateAsync({ path: `/envelopes/copy?month=${month}` }); toast.success(t('Copied last month’s envelopes')); } catch (err) { toast.error(errorText(err)); }
  }
  async function clear() {
    setClearing(false);
    try { await act.mutateAsync({ method: 'DELETE', path: `/envelopes?month=${month}` }); toast.success(t('Envelopes removed for {month}', { month: formatMonth(month) })); } catch (err) { toast.error(errorText(err)); }
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <MonthPicker value={month} onChange={setMonth} max={shiftMonth(currentMonth(), 12)} />
        {d?.hasPlan && <Button variant="secondary" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" aria-hidden="true" /> {t('Edit envelopes')}</Button>}
        {d?.hasPlan && <Button variant="ghost" onClick={() => setClearing(true)} className="hover:text-rose-600"><Trash2 className="h-4 w-4" aria-hidden="true" /> {t('Remove')}</Button>}
      </div>
      {!d ? (q.error ? <ErrorNote error={q.error} onRetry={q.refetch} /> : <Skeleton className="h-40 w-full" />) : !d.hasPlan ? (
        <Card>
          <EmptyState icon={Mail} title={t('No envelopes for {month}', { month: formatMonth(month) })}
            action={<div className="flex flex-wrap justify-center gap-2"><Button onClick={() => setEditing(true)}>{t('Share out your money')}</Button><Button variant="secondary" onClick={copy} loading={act.isPending}><Copy className="h-4 w-4" aria-hidden="true" /> {t('Copy last month')}</Button></div>}>
            {t('Give every rupee a job: put your income into envelopes like Needs, Wants and Savings, and spend from each only what it holds.')}
          </EmptyState>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Card><p className="text-sm text-slate-500 dark:text-slate-400">{d.incomePlanned ? t('Planned income') : t('Income this month')}</p><p className="tabular mt-1 text-xl font-semibold">{formatINR(d.available.paise)}</p></Card>
            <Card><p className="text-sm text-slate-500 dark:text-slate-400">{t('In envelopes')}</p><p className="tabular mt-1 text-xl font-semibold">{formatINR(d.assigned.paise)}</p></Card>
            <Card><p className="text-sm text-slate-500 dark:text-slate-400">{d.toAssign.paise >= 0 ? t('Still to share out') : t('Shared out more than you have')}</p>
              <p className={cx('tabular mt-1 text-xl font-semibold', d.toAssign.paise < 0 && 'text-rose-600 dark:text-rose-400')}>{formatINR(Math.abs(d.toAssign.paise))}</p></Card>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {d.envelopes.map((e) => {
              const [tone, label] = ENVELOPE_STATUS[e.status];
              return (
                <Card key={e.id}>
                  <div className="flex items-center justify-between gap-2"><h3 className="truncate font-semibold">{e.name}</h3><Badge tone={tone}>{label}</Badge></div>
                  <p className="tabular mt-1 text-sm">{t('{spent} spent of {amount}', { spent: formatINR(e.spent.paise), amount: formatINR(e.amount.paise) })}</p>
                  <div className="mt-2"><ProgressBar percent={e.percent ?? 0} status={e.status} label={e.name} /></div>
                  <p className={cx('tabular mt-2 text-sm font-medium', e.left.paise < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400')}>
                    {e.left.paise < 0 ? t('{amount} over', { amount: formatINR(-e.left.paise) }) : t('{amount} left', { amount: formatINR(e.left.paise) })}
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{e.categories.length ? e.categories.map(catLabel).join(', ') : t('No categories yet: edit to add some')}</p>
                </Card>
              );
            })}
          </div>
          {d.outsideCategories.length > 0 && (
            <Card>
              <CardHeader title={t('Spent outside any envelope')} subtitle={formatINR(d.spentOutside.paise)} />
              <ul className="flex flex-wrap gap-2 text-sm">{d.outsideCategories.map((c) => <li key={c.category}><Badge>{catLabel(c.category)} · {formatINR(c.spent.paise)}</Badge></li>)}</ul>
            </Card>
          )}
        </>
      )}
      <Modal open={editing} onClose={() => setEditing(false)} title={t('Envelopes for {month}', { month: formatMonth(month) })} size="lg">
        {editing && d && <EnvelopeEditor month={month} data={d} onDone={() => setEditing(false)} />}
      </Modal>
      <ConfirmDialog open={clearing} title={t('Remove this month’s envelopes?')} confirmLabel={t('Remove')} danger onClose={() => setClearing(false)} onConfirm={clear}>
        {t('Your entries aren’t affected.')}
      </ConfirmDialog>
    </div>
  );
}

// ───────────── Sinking funds ─────────────

const FUND_STATUS = { ready: ['green', t('Ready')], overdue: ['rose', t('Overdue')], soon: ['amber', t('Due soon')], saving: ['indigo', t('Saving')] };

function FundForm({ fund, onDone }) {
  const uid = useId();
  const save = usePlanMutation('sinking-funds');
  const [f, setF] = useState({ name: fund?.name ?? '', amount: fund ? String(fund.amount.rupees) : '', nextDue: fund?.nextDue ?? '', everyMonths: String(fund?.everyMonths ?? 12), category: fund?.category ?? '' });
  const [errors, setErrors] = useState({});
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function submit(e) {
    e.preventDefault();
    const local = {};
    if (!f.name.trim()) local.name = t('Give it a name');
    const a = amountProblem(rupees(f.amount));
    if (a) local.amount = a;
    if (!f.nextDue) local.nextDue = t('Pick the date it’s due');
    setErrors(local);
    if (Object.keys(local).length) return;
    const body = { name: f.name.trim(), amount: rupees(f.amount), nextDue: f.nextDue, everyMonths: Number(f.everyMonths), category: f.category.trim() };
    try {
      if (fund) await save.mutateAsync({ method: 'PATCH', path: `/sinking-funds/${fund.id}`, body });
      else await save.mutateAsync({ path: '/sinking-funds', body });
      toast.success(fund ? t('Saved') : t('Sinking fund added'));
      onDone();
    } catch (err) { setErrors({ ...err.fieldErrors?.(), form: err.details?.length ? undefined : err.message }); }
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {errors.form && <ErrorNote error={{ message: errors.form }} />}
      <Field label={t('What it’s for')} htmlFor={`${uid}-n`} error={errors.name}><Input id={`${uid}-n`} value={f.name} onChange={set('name')} maxLength={60} placeholder={t('e.g. Car insurance, Diwali, School fees')} autoFocus /></Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('Cost (₹)')} htmlFor={`${uid}-a`} error={errors.amount}><Input id={`${uid}-a`} inputMode="decimal" value={f.amount} onChange={set('amount')} placeholder="12000" /></Field>
        <Field label={t('Next due')} htmlFor={`${uid}-d`} error={errors.nextDue}><Input id={`${uid}-d`} type="date" value={f.nextDue} onChange={set('nextDue')} /></Field>
        <Field label={t('Comes round every (months)')} htmlFor={`${uid}-e`} error={errors.everyMonths}><Input id={`${uid}-e`} type="number" min="1" max="120" value={f.everyMonths} onChange={set('everyMonths')} /></Field>
        <Field label={t('Category when paid (optional)')} htmlFor={`${uid}-c`}><Input id={`${uid}-c`} value={f.category} onChange={set('category')} maxLength={40} placeholder={t('e.g. Insurance')} /></Field>
      </div>
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onDone}>{t('Cancel')}</Button><Button type="submit" loading={save.isPending}>{fund ? t('Save') : t('Add')}</Button></div>
    </form>
  );
}

function FundMoneyForm({ fund, mode, onDone }) {
  const uid = useId();
  const save = usePlanMutation('sinking-funds', { money: mode === 'pay' });
  const [amount, setAmount] = useState(mode === 'pay' ? String(fund.amount.rupees) : mode === 'add' ? String(fund.monthly.rupees || '') : '');
  const [date, setDate] = useState(today());
  const [account, setAccount] = useState('');
  const [error, setError] = useState(null);
  async function submit(e) {
    e.preventDefault();
    const a = amountProblem(rupees(amount));
    if (a) { setError(a); return; }
    try {
      if (mode === 'pay') await save.mutateAsync({ path: `/sinking-funds/${fund.id}/paid`, body: { amount: rupees(amount), date, ...(account && { account }) } });
      else await save.mutateAsync({ path: `/sinking-funds/${fund.id}/contributions`, body: { direction: mode, amount: rupees(amount), date } });
      toast.success(mode === 'pay' ? t('Marked as paid: next due date moved on') : mode === 'add' ? t('Put aside') : t('Taken out'));
      onDone();
    } catch (err) { setError(errorText(err)); }
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <p className="text-sm text-slate-600 dark:text-slate-400">{t('{name}: {saved} put aside of {amount}.', { name: fund.name, saved: formatINR(fund.saved.paise), amount: formatINR(fund.amount.paise) })}</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={mode === 'pay' ? t('Amount paid (₹)') : t('Amount (₹)')} htmlFor={`${uid}-a`} error={error}><Input id={`${uid}-a`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></Field>
        <Field label={t('Date')} htmlFor={`${uid}-d`}><Input id={`${uid}-d`} type="date" max={today()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      {mode === 'pay' && (
        <Field label={t('Paid from (optional)')} htmlFor={`${uid}-acc`} hint={t('Pick an account to record the payment as an expense too.')}>
          <AccountSelect id={`${uid}-acc`} value={account} onChange={setAccount} />
        </Field>
      )}
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onDone}>{t('Cancel')}</Button>
        <Button type="submit" loading={save.isPending}>{mode === 'pay' ? t('Mark as paid') : mode === 'add' ? t('Put aside') : t('Take out')}</Button></div>
    </form>
  );
}

export function SinkingFunds() {
  const q = useSinkingFunds();
  const remove = usePlanMutation('sinking-funds');
  const [form, setForm] = useState(null); // { fund? }
  const [money, setMoney] = useState(null); // { fund, mode }
  const [deleting, setDeleting] = useState(null);
  const d = q.data;
  async function confirmDelete() {
    const f = deleting;
    setDeleting(null);
    try { await remove.mutateAsync({ method: 'DELETE', path: `/sinking-funds/${f.id}` }); toast.success(t('Sinking fund removed')); } catch (err) { toast.error(err.message); }
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-sm text-slate-600 dark:text-slate-400">{t('Big costs that come round every year or so. Put a little aside each month and they stop being a shock.')}</p>
        <Button onClick={() => setForm({})}><Plus className="h-4 w-4" aria-hidden="true" /> {t('Add sinking fund')}</Button>
      </div>
      {!d ? (q.error ? <ErrorNote error={q.error} onRetry={q.refetch} /> : <Skeleton className="h-40 w-full" />) : d.funds.length ? (
        <>
          <Card><p className="text-sm">{t('Put aside {amount} a month in all to be ready for every one of them. {saved} is set aside so far.', { amount: formatINR(d.monthly.paise), saved: formatINR(d.saved.paise) })}</p></Card>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {d.funds.map((f) => {
              const [tone, label] = FUND_STATUS[f.status];
              return (
                <Card key={f.id}>
                  <div className="flex items-center justify-between gap-2"><h3 className="truncate font-semibold">{f.name}</h3><Badge tone={tone}>{label}</Badge></div>
                  <p className="tabular mt-1 text-sm">{t('{saved} of {amount}', { saved: formatINR(f.saved.paise), amount: formatINR(f.amount.paise) })}</p>
                  <div className="mt-2"><ProgressBar percent={f.percent} status={f.status === 'overdue' ? 'over' : 'ok'} label={f.name} /></div>
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    {t('Due {date}', { date: formatDay(f.nextDue) })} · {f.everyMonths === 12 ? t('every year') : tn(f.everyMonths, 'every month', 'every {n} months')}
                    {f.left.paise > 0 && <> · {f.monthsLeft ? t('{amount} a month', { amount: formatINR(f.monthly.paise) }) : t('{amount} still to find', { amount: formatINR(f.left.paise) })}</>}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Button size="sm" onClick={() => setMoney({ fund: f, mode: 'add' })}><Plus className="h-4 w-4" aria-hidden="true" /> {t('Put aside')}</Button>
                    <Button size="sm" variant="secondary" onClick={() => setMoney({ fund: f, mode: 'pay' })}>{t('Paid')}</Button>
                    <Button size="sm" variant="ghost" onClick={() => setMoney({ fund: f, mode: 'withdraw' })} disabled={!f.saved.paise}>{t('Take out')}</Button>
                    <Button size="sm" variant="ghost" onClick={() => setForm({ fund: f })} aria-label={t('Edit {name}', { name: f.name })}><Pencil className="h-4 w-4" aria-hidden="true" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => setDeleting(f)} aria-label={t('Delete {name}', { name: f.name })} className="hover:text-rose-600"><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      ) : (
        <Card><EmptyState icon={PiggyBank} title={t('No sinking funds yet')} action={<Button onClick={() => setForm({})}>{t('Add sinking fund')}</Button>}>{t('Car insurance, festival shopping, school fees, a new phone every two years: add them and see what to save each month.')}</EmptyState></Card>
      )}
      <Modal open={form !== null} onClose={() => setForm(null)} title={form?.fund ? t('Edit sinking fund') : t('New sinking fund')}>
        {form && <FundForm key={form.fund?.id ?? 'new'} fund={form.fund} onDone={() => setForm(null)} />}
      </Modal>
      <Modal open={money !== null} onClose={() => setMoney(null)} title={money?.mode === 'pay' ? t('Mark as paid') : money?.mode === 'add' ? t('Put money aside') : t('Take money out')}>
        {money && <FundMoneyForm key={`${money.fund.id}-${money.mode}`} fund={money.fund} mode={money.mode} onDone={() => setMoney(null)} />}
      </Modal>
      <ConfirmDialog open={deleting !== null} title={t('Delete this sinking fund?')} confirmLabel={t('Delete')} danger onClose={() => setDeleting(null)} onConfirm={confirmDelete}>
        {deleting && t('“{name}” and what you put aside in it will be removed. Your transactions aren’t affected.', { name: deleting.name })}
      </ConfirmDialog>
    </div>
  );
}

// ───────────── Wishlist ─────────────

function WishForm({ item, onDone }) {
  const uid = useId();
  const save = usePlanMutation('wishlist');
  const [f, setF] = useState({ name: item?.name ?? '', price: item ? String(item.price.rupees) : '', url: item?.url ?? '', note: item?.note ?? '', coolDays: String(item?.coolDays ?? 30) });
  const [errors, setErrors] = useState({});
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function submit(e) {
    e.preventDefault();
    const local = {};
    if (!f.name.trim()) local.name = t('What do you want to buy?');
    const a = amountProblem(rupees(f.price));
    if (a) local.price = a;
    setErrors(local);
    if (Object.keys(local).length) return;
    const body = { name: f.name.trim(), price: rupees(f.price), url: f.url.trim(), note: f.note.trim(), coolDays: Number(f.coolDays) };
    try {
      if (item) await save.mutateAsync({ method: 'PATCH', path: `/wishlist/${item.id}`, body });
      else await save.mutateAsync({ path: '/wishlist', body });
      toast.success(item ? t('Saved') : t('Added to your wishlist'));
      onDone();
    } catch (err) { setErrors({ ...err.fieldErrors?.(), form: err.details?.length ? undefined : err.message }); }
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {errors.form && <ErrorNote error={{ message: errors.form }} />}
      <Field label={t('Item')} htmlFor={`${uid}-n`} error={errors.name}><Input id={`${uid}-n`} value={f.name} onChange={set('name')} maxLength={60} placeholder={t('e.g. Noise-cancelling headphones')} autoFocus /></Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('Price (₹)')} htmlFor={`${uid}-p`} error={errors.price}><Input id={`${uid}-p`} inputMode="decimal" value={f.price} onChange={set('price')} placeholder="15000" /></Field>
        <Field label={t('Wait before buying (days)')} htmlFor={`${uid}-c`} error={errors.coolDays} hint={t('Most impulse wants fade within 30 days.')}><Input id={`${uid}-c`} type="number" min="1" max="365" value={f.coolDays} onChange={set('coolDays')} /></Field>
      </div>
      <Field label={t('Link (optional)')} htmlFor={`${uid}-u`} error={errors.url}><Input id={`${uid}-u`} type="url" value={f.url} onChange={set('url')} placeholder="https://" /></Field>
      <Field label={t('Why you want it (optional)')} htmlFor={`${uid}-no`}><Input id={`${uid}-no`} value={f.note} onChange={set('note')} maxLength={200} /></Field>
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onDone}>{t('Cancel')}</Button><Button type="submit" loading={save.isPending}>{item ? t('Save') : t('Add')}</Button></div>
    </form>
  );
}

function BuyForm({ item, onDone }) {
  const uid = useId();
  const save = usePlanMutation('wishlist', { money: true });
  const [amount, setAmount] = useState(String(item.price.rupees));
  const [account, setAccount] = useState('');
  const [error, setError] = useState(null);
  async function submit(e) {
    e.preventDefault();
    const a = amountProblem(rupees(amount));
    if (a) { setError(a); return; }
    try {
      await save.mutateAsync({ path: `/wishlist/${item.id}/decide`, body: { decision: 'bought', early: !item.ready, amount: rupees(amount), ...(account && { account }) } });
      toast.success(t('Enjoy it!'));
      onDone();
    } catch (err) { setError(errorText(err)); }
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {!item.ready && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">{tn(item.daysLeft, 'There is still {n} day of the waiting time left. Do you still want it as much?', 'There are still {n} days of the waiting time left. Do you still want it as much?')}</p>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('What you paid (₹)')} htmlFor={`${uid}-a`} error={error}><Input id={`${uid}-a`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label={t('Paid from (optional)')} htmlFor={`${uid}-acc`} hint={t('Records it as a Shopping expense.')}><AccountSelect id={`${uid}-acc`} value={account} onChange={setAccount} /></Field>
      </div>
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onDone}>{t('Cancel')}</Button><Button type="submit" loading={save.isPending}>{item.ready ? t('I bought it') : t('Buy it anyway')}</Button></div>
    </form>
  );
}

export function Wishlist() {
  const q = useWishlist();
  const act = usePlanMutation('wishlist');
  const [form, setForm] = useState(null);
  const [buying, setBuying] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const d = q.data;
  const waiting = d?.items.filter((w) => w.status === 'waiting') ?? [];
  const decided = d?.items.filter((w) => w.status !== 'waiting') ?? [];
  async function drop(w) {
    try { await act.mutateAsync({ path: `/wishlist/${w.id}/decide`, body: { decision: 'dropped' } }); toast.success(t('Dropped: {amount} kept in your pocket', { amount: formatINR(w.price.paise) })); } catch (err) { toast.error(errorText(err)); }
  }
  async function confirmDelete() {
    const w = deleting;
    setDeleting(null);
    try { await act.mutateAsync({ method: 'DELETE', path: `/wishlist/${w.id}` }); toast.success(t('Removed')); } catch (err) { toast.error(err.message); }
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-sm text-slate-600 dark:text-slate-400">{t('Want something? Put it here first and wait. If you still want it when the wait is over, buy it without guilt.')}</p>
        <Button onClick={() => setForm({})}><Plus className="h-4 w-4" aria-hidden="true" /> {t('Add to wishlist')}</Button>
      </div>
      {!d ? (q.error ? <ErrorNote error={q.error} onRetry={q.refetch} /> : <Skeleton className="h-40 w-full" />) : d.items.length === 0 ? (
        <Card><EmptyState icon={Gift} title={t('Your wishlist is empty')} action={<Button onClick={() => setForm({})}>{t('Add to wishlist')}</Button>}>{t('The next time you’re about to buy something you don’t need right now, add it here instead.')}</EmptyState></Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Card><p className="text-sm text-slate-500 dark:text-slate-400">{t('Waiting')}</p><p className="tabular mt-1 text-xl font-semibold">{formatINR(d.waitingTotal.paise)}</p></Card>
            <Card><p className="text-sm text-slate-500 dark:text-slate-400">{t('Not bought after all')}</p><p className="tabular mt-1 text-xl font-semibold text-emerald-600 dark:text-emerald-400">{formatINR(d.droppedTotal.paise)}</p></Card>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {waiting.map((w) => (
              <Card key={w.id}>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="min-w-0 break-words font-semibold">{w.url ? <a href={w.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{w.name}</a> : w.name}</h3>
                  <Badge tone={w.ready ? 'green' : 'amber'}>{w.ready ? t('Ready to decide') : tn(w.daysLeft, '{n} day left', '{n} days left')}</Badge>
                </div>
                <p className="tabular mt-1 text-sm">{formatINR(w.price.paise)}</p>
                {w.note && <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{w.note}</p>}
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('Added {date} · decide from {ready}', { date: formatDay(w.addedOn), ready: formatDay(w.readyOn) })}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Button size="sm" variant={w.ready ? 'primary' : 'secondary'} onClick={() => setBuying(w)}><ShoppingBag className="h-4 w-4" aria-hidden="true" /> {t('Buy')}</Button>
                  <Button size="sm" variant="secondary" onClick={() => drop(w)}>{t('Don’t need it')}</Button>
                  <Link to={`/plan?tab=afford&amount=${w.price.rupees}`} className="inline-flex items-center px-2 text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">{t('Can I afford it?')}</Link>
                  <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setForm({ item: w })} aria-label={t('Edit {name}', { name: w.name })}><Pencil className="h-4 w-4" aria-hidden="true" /></Button>
                </div>
              </Card>
            ))}
          </div>
          {decided.length > 0 && (
            <Card>
              <CardHeader title={t('Decided')} />
              <ul className="divide-y divide-slate-900/[0.06] text-sm dark:divide-white/[0.06]">
                {decided.map((w) => (
                  <li key={w.id} className="flex items-center gap-3 py-2">
                    <Badge tone={w.status === 'bought' ? 'indigo' : 'green'}>{w.status === 'bought' ? t('Bought') : t('Dropped')}</Badge>
                    <span className="min-w-0 flex-1 truncate">{w.name}</span>
                    <span className="tabular">{formatINR(w.price.paise)}</span>
                    <span className="hidden w-24 text-xs text-slate-500 sm:inline dark:text-slate-400">{formatDay(w.decidedAt)}</span>
                    <Button size="sm" variant="ghost" onClick={() => setDeleting(w)} aria-label={t('Delete {name}', { name: w.name })} className="hover:text-rose-600"><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
      <Modal open={form !== null} onClose={() => setForm(null)} title={form?.item ? t('Edit wish') : t('Add to wishlist')}>
        {form && <WishForm key={form.item?.id ?? 'new'} item={form.item} onDone={() => setForm(null)} />}
      </Modal>
      <Modal open={buying !== null} onClose={() => setBuying(null)} title={buying ? t('Buy {name}', { name: buying.name }) : ''}>
        {buying && <BuyForm key={buying.id} item={buying} onDone={() => setBuying(null)} />}
      </Modal>
      <ConfirmDialog open={deleting !== null} title={t('Remove from the list?')} confirmLabel={t('Remove')} danger onClose={() => setDeleting(null)} onConfirm={confirmDelete}>
        {deleting && t('“{name}” will be removed from your wishlist history.', { name: deleting.name })}
      </ConfirmDialog>
    </div>
  );
}

import { useId, useState } from 'react';
import { useSearchParams } from 'react-router';
import toast from 'react-hot-toast';
import { LifeBuoy, Minus, Pencil, Plus, Target, Trash2 } from 'lucide-react';
import { useGoals, usePlanMutation } from '../hooks/api.js';
import { formatDay, formatINR, formatMonth } from '../lib/format.js';
import { today } from '../lib/dates.js';
import { amountProblem } from '../components/TransactionForm.jsx';
import { ConfirmDialog, Modal } from '../components/Modal.jsx';
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Input, PageHeader, Segmented, Skeleton, Tabs } from '../components/ui.jsx';
import { Wishlist } from '../components/Budgeting.jsx';
import { t } from '../lib/i18n.js';

const rupees = (s) => s.trim().replace(/,/g, '');

export function Ring({ percent, size = 72, label }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="8" className="stroke-slate-100 dark:stroke-slate-800" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="8" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(100, percent) / 100)}
        className={percent >= 100 ? 'stroke-emerald-500' : 'stroke-indigo-500'} />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" transform={`rotate(90 ${size / 2} ${size / 2})`}
        className="fill-slate-900 text-[13px] font-semibold dark:fill-white">{Math.floor(percent)}%</text>
    </svg>
  );
}

function GoalForm({ goal, preset, onDone }) {
  const uid = useId();
  const save = usePlanMutation('goals');
  const [name, setName] = useState(goal?.name ?? preset?.name ?? '');
  const [target, setTarget] = useState(goal ? String(goal.target.rupees) : preset?.target ?? '');
  const [targetDate, setTargetDate] = useState(goal?.targetDate ?? '');
  const [errors, setErrors] = useState({});
  async function submit(e) {
    e.preventDefault();
    const local = {};
    if (!name.trim()) local.name = t('Give the goal a name');
    const a = amountProblem(rupees(target));
    if (a) local.target = a;
    setErrors(local);
    if (Object.keys(local).length) return;
    const body = { name: name.trim(), target: rupees(target), targetDate: targetDate || null };
    try {
      if (goal) await save.mutateAsync({ method: 'PATCH', path: `/goals/${goal.id}`, body });
      else await save.mutateAsync({ path: '/goals', body: { ...body, kind: preset?.kind ?? 'custom' } });
      toast.success(goal ? t('Goal updated') : t('Goal created'));
      onDone();
    } catch (err) {
      setErrors({ ...err.fieldErrors(), form: err.details.length ? undefined : err.message });
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {errors.form && <ErrorNote error={{ message: errors.form }} />}
      <Field label={t('Name')} htmlFor={`${uid}-n`} error={errors.name}><Input id={`${uid}-n`} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder={t('e.g. New laptop, Goa trip')} autoFocus /></Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('Target (₹)')} htmlFor={`${uid}-t`} error={errors.target}><Input id={`${uid}-t`} inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="60000" /></Field>
        <Field label={t('Target date (optional)')} htmlFor={`${uid}-d`} error={errors.targetDate} hint={t('To see how much to save each month.')}><Input id={`${uid}-d`} type="date" min={today()} value={targetDate} onChange={(e) => setTargetDate(e.target.value)} /></Field>
      </div>
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onDone}>{t('Cancel')}</Button><Button type="submit" loading={save.isPending}>{goal ? t('Save') : t('Create goal')}</Button></div>
    </form>
  );
}

function EntryForm({ goal, direction, onDone }) {
  const uid = useId();
  const save = usePlanMutation('goals');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  async function submit(e) {
    e.preventDefault();
    const a = amountProblem(rupees(amount));
    if (a) { setError(a); return; }
    try {
      await save.mutateAsync({ path: `/goals/${goal.id}/entries`, body: { direction, amount: rupees(amount), date, note: note.trim() } });
      toast.success(direction === 'add' ? t('Added to {name}', { name: goal.name }) : t('Taken out of {name}', { name: goal.name }));
      onDone();
    } catch (err) {
      setError(err.details?.[0]?.message ?? err.message);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <p className="text-sm text-slate-600 dark:text-slate-400">{t('{name}: {saved} saved of {target}.', { name: goal.name, saved: formatINR(goal.saved.paise), target: formatINR(goal.target.paise) })}</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('Amount (₹)')} htmlFor={`${uid}-a`} error={error}><Input id={`${uid}-a`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></Field>
        <Field label={t('Date')} htmlFor={`${uid}-d`}><Input id={`${uid}-d`} type="date" max={today()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      <Field label={t('Note (optional)')} htmlFor={`${uid}-no`}><Input id={`${uid}-no`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} /></Field>
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onDone}>{t('Cancel')}</Button><Button type="submit" loading={save.isPending}>{direction === 'add' ? t('Add money') : t('Take out')}</Button></div>
    </form>
  );
}

function GoalCard({ goal, onEdit, onEntry, onDelete }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <div className="flex items-start gap-4">
        <Ring percent={goal.percent} label={`${goal.name}: ${goal.percent}% saved`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="min-w-0 break-words font-semibold">{goal.name}</h2>
            {goal.kind === 'emergency' && <Badge tone="indigo">{t('Emergency fund')}</Badge>}
            {goal.completed && <Badge tone="green">{t('Reached')}</Badge>}
          </div>
          <p className="tabular mt-1 text-sm">{formatINR(goal.saved.paise)} <span className="text-slate-500 dark:text-slate-400">{t('of {amount}', { amount: formatINR(goal.target.paise) })}</span></p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {goal.completed ? t('Target reached.') : goal.targetDate
              ? t('{amount} a month to reach it by {date}.', { amount: formatINR(goal.neededPerMonth.paise), date: formatDay(goal.targetDate) })
              : t('{amount} to go. Add a target date to see a monthly amount.', { amount: formatINR(goal.remaining.paise) })}
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-1.5">
        <Button size="sm" onClick={() => onEntry(goal, 'add')}><Plus className="h-4 w-4" aria-hidden="true" /> {t('Add money')}</Button>
        <Button size="sm" variant="secondary" onClick={() => onEntry(goal, 'withdraw')} disabled={!goal.saved.paise}><Minus className="h-4 w-4" aria-hidden="true" /> {t('Take out')}</Button>
        <Button size="sm" variant="ghost" onClick={() => onEdit(goal)} aria-label={t('Edit {name}', { name: goal.name })}><Pencil className="h-4 w-4" aria-hidden="true" /></Button>
        <Button size="sm" variant="ghost" onClick={() => onDelete(goal)} aria-label={t('Delete {name}', { name: goal.name })} className="hover:text-rose-600"><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
        {goal.entries.length > 0 && (
          <button type="button" className="ml-auto text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => setOpen((o) => !o)}>
            {open ? t('Hide history') : t('History ({n})', { n: goal.entries.length })}
          </button>
        )}
      </div>
      {open && (
        <ul className="mt-3 divide-y divide-slate-100 text-sm dark:divide-slate-800">
          {goal.entries.map((e) => (
            <li key={e.id} className="flex items-center gap-3 py-2">
              <span className="w-24 shrink-0 text-xs text-slate-500 dark:text-slate-400">{formatDay(e.date)}</span>
              <span className="min-w-0 flex-1 truncate">{e.note || (e.amount.paise > 0 ? t('Added') : t('Taken out'))}</span>
              <span className={`tabular font-medium ${e.amount.paise > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                {e.amount.paise > 0 ? '+' : '−'}{formatINR(Math.abs(e.amount.paise))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function GoalList({ tabs }) {
  const { data, error, refetch } = useGoals();
  const remove = usePlanMutation('goals');
  const [form, setForm] = useState(null); // { goal?, preset? }
  const [entry, setEntry] = useState(null); // { goal, direction }
  const [deleting, setDeleting] = useState(null);
  const ef = data?.emergency;
  const hasEmergency = data?.goals.some((g) => g.kind === 'emergency');

  async function confirmDelete() {
    const g = deleting;
    setDeleting(null);
    try { await remove.mutateAsync({ method: 'DELETE', path: `/goals/${g.id}` }); toast.success(t('Goal deleted')); } catch (err) { toast.error(err.message); }
  }

  return (
    <>
      <PageHeader title={t('Goals')} subtitle={t('Save towards something: put money aside and see how much each month gets you there.')}
        actions={<Button onClick={() => setForm({})}><Plus className="h-4 w-4" aria-hidden="true" /> {t('New goal')}</Button>} />
      {tabs}
      {error && <div className="mb-4"><ErrorNote error={error} onRetry={refetch} /></div>}
      {data && !hasEmergency && (
        <Card className="mb-4 bg-gradient-to-br from-indigo-50 to-white dark:from-indigo-500/10 dark:to-slate-900">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <LifeBuoy className="h-8 w-8 shrink-0 text-indigo-500" aria-hidden="true" />
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-semibold">{t('Build an emergency fund')}</p>
              {ef.averageMonthly ? (
                <p className="text-slate-600 dark:text-slate-400">
                  {t('You spent {amount} a month on average ({months}).', { amount: formatINR(ef.averageMonthly.paise), months: ef.months.filter((m) => m.spent.paise).map((m) => formatMonth(m.month)).join(', ') })}
                  {' '}{t('{n} months of that is {amount}.', { n: ef.multiplier, amount: formatINR(ef.target.paise) })}
                </p>
              ) : <p className="text-slate-600 dark:text-slate-400">{t('Once you have a month of spending recorded, Spendwise suggests a target of {n} months of it.', { n: ef.multiplier })}</p>}
            </div>
            <Button variant="secondary" onClick={() => setForm({ preset: { kind: 'emergency', name: t('Emergency fund'), target: ef.target ? String(ef.target.rupees) : '' } })}>{t('Set it up')}</Button>
          </div>
        </Card>
      )}
      {!data ? <Skeleton className="h-40 w-full" /> : data.goals.length ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.goals.map((g) => (
            <GoalCard key={g.id} goal={g} onEdit={(goal) => setForm({ goal })} onEntry={(goal, direction) => setEntry({ goal, direction })} onDelete={setDeleting} />
          ))}
        </div>
      ) : (
        <Card><EmptyState icon={Target} title={t('No goals yet')} action={<Button onClick={() => setForm({})}>{t('Create a goal')}</Button>}>{t('A laptop, a trip, a down payment: set a target and track what you put aside.')}</EmptyState></Card>
      )}
      <Modal open={form !== null} onClose={() => setForm(null)} title={form?.goal ? t('Edit goal') : form?.preset?.kind === 'emergency' ? t('Emergency fund') : t('New goal')}>
        {form && <GoalForm key={form.goal?.id ?? form.preset?.kind ?? 'new'} goal={form.goal} preset={form.preset} onDone={() => setForm(null)} />}
      </Modal>
      <Modal open={entry !== null} onClose={() => setEntry(null)} title={entry?.direction === 'withdraw' ? t('Take money out') : t('Add money')}>
        {entry && <EntryForm key={`${entry.goal.id}-${entry.direction}`} goal={entry.goal} direction={entry.direction} onDone={() => setEntry(null)} />}
      </Modal>
      <ConfirmDialog open={deleting !== null} title={t('Delete this goal?')} confirmLabel={t('Delete')} danger onClose={() => setDeleting(null)} onConfirm={confirmDelete}>
        {deleting && t('“{name}” and its history will be removed. Your transactions aren’t affected.', { name: deleting.name })}
      </ConfirmDialog>
    </>
  );
}

// Batch 12O: goals, and the wishlist (?tab=wishlist).
export default function Goals() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'wishlist' ? 'wishlist' : 'goals';
  const tabs = (
    <Tabs className="mb-6" label={t('Goals section')} value={tab} onChange={(v) => setParams(v === 'goals' ? {} : { tab: v }, { replace: true })}
      options={[{ value: 'goals', label: t('Goals') }, { value: 'wishlist', label: t('Wishlist') }]} />
  );
  if (tab === 'goals') return <GoalList tabs={tabs} />;
  return (
    <>
      <PageHeader title={t('Wishlist')} subtitle={t('Things you want, with a waiting period before you buy.')} />
      {tabs}
      <Wishlist />
    </>
  );
}

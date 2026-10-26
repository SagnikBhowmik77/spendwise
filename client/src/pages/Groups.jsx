import { useId, useState } from 'react';
import toast from 'react-hot-toast';
import { Copy, Plus, Trash2, Users, X } from 'lucide-react';
import { useGroup, useGroups, usePlanMutation } from '../hooks/api.js';
import { formatDay, formatINR } from '../lib/format.js';
import { today } from '../lib/dates.js';
import { canOpenUpi, upiLink } from '../lib/upi.js';
import { amountProblem } from '../components/TransactionForm.jsx';
import { ConfirmDialog, Modal } from '../components/Modal.jsx';
import { Button, Card, CardHeader, EmptyState, ErrorNote, Field, Input, PageHeader, Segmented, Select, Skeleton, cx } from '../components/ui.jsx';
import { t, tn, tr } from '../lib/i18n.js';

const rupees = (s) => String(s).trim().replace(/,/g, '');
const UPI_RE = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/;

function GroupForm({ group, onDone }) {
  const uid = useId();
  const save = usePlanMutation('groups');
  const [name, setName] = useState(group?.name ?? '');
  const [members, setMembers] = useState(group?.members.map((m) => ({ id: m.id, name: m.name, upiId: m.upiId })) ?? [{ name: '', upiId: '' }, { name: '', upiId: '' }]);
  const [errors, setErrors] = useState({});
  const setMember = (i, changes) => setMembers(members.map((m, j) => (i === j ? { ...m, ...changes } : m)));
  async function submit(e) {
    e.preventDefault();
    const filled = members.filter((m) => m.name.trim()).map((m) => ({ ...m, name: m.name.trim(), upiId: m.upiId.trim() }));
    const local = {};
    if (!name.trim()) local.name = t('Name the group, e.g. Goa trip or Flat 4B');
    if (filled.length < 2) local.members = t('Add at least 2 people');
    const bad = filled.find((m) => m.upiId && !UPI_RE.test(m.upiId));
    if (bad) local.members = t('{name}’s UPI ID should look like name@okaxis', { name: bad.name });
    setErrors(local);
    if (Object.keys(local).length) return;
    try {
      if (group) await save.mutateAsync({ method: 'PATCH', path: `/groups/${group.id}`, body: { name: name.trim(), members: filled } });
      else await save.mutateAsync({ path: '/groups', body: { name: name.trim(), members: filled.map(({ name: n, upiId }) => ({ name: n, upiId })) } });
      toast.success(group ? t('Group updated') : t('Group created'));
      onDone();
    } catch (err) {
      setErrors({ members: err.details?.[0]?.message ?? err.message });
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Field label={t('Group name')} htmlFor={`${uid}-n`} error={errors.name}><Input id={`${uid}-n`} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus /></Field>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">{t('People')}</legend>
        {members.map((m, i) => (
          <div key={m.id ?? `new-${i}`} className="flex gap-2">
            <Input value={m.name} onChange={(e) => setMember(i, { name: e.target.value })} placeholder={i === 0 ? t('You') : t('Name')} aria-label={t('Person {n} name', { n: i + 1 })} maxLength={40} />
            <Input value={m.upiId} onChange={(e) => setMember(i, { upiId: e.target.value })} placeholder={t('UPI ID (optional)')} aria-label={t('Person {n} UPI ID', { n: i + 1 })} maxLength={100} />
            <Button variant="ghost" size="icon" aria-label={t('Remove person {n}', { n: i + 1 })} onClick={() => setMembers(members.filter((_, j) => j !== i))} disabled={members.length <= 2}><X className="h-4 w-4" aria-hidden="true" /></Button>
          </div>
        ))}
        {errors.members && <p className="text-sm text-rose-600 dark:text-rose-400">{errors.members}</p>}
        <Button variant="secondary" size="sm" onClick={() => setMembers([...members, { name: '', upiId: '' }])}><Plus className="h-4 w-4" aria-hidden="true" /> {t('Add person')}</Button>
        <p className="text-xs text-slate-500 dark:text-slate-400">{t('UPI IDs let others pay that person straight from the settle-up list.')}</p>
      </fieldset>
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onDone}>{t('Cancel')}</Button><Button type="submit" loading={save.isPending}>{group ? t('Save') : t('Create group')}</Button></div>
    </form>
  );
}

function ExpenseForm({ group, onDone }) {
  const uid = useId();
  const save = usePlanMutation('groups');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [paidBy, setPaidBy] = useState(group.members[0].id);
  const [date, setDate] = useState(today());
  const [split, setSplit] = useState('equal');
  const [among, setAmong] = useState(group.members.map((m) => m.id));
  const [exact, setExact] = useState(Object.fromEntries(group.members.map((m) => [m.id, ''])));
  const [error, setError] = useState(null);
  const exactSum = Object.values(exact).reduce((s, v) => s + (Number(rupees(v)) || 0), 0);
  async function submit(e) {
    e.preventDefault();
    if (!description.trim()) { setError(t('What was it for?')); return; }
    const a = amountProblem(rupees(amount));
    if (a) { setError(a); return; }
    if (split === 'equal' && !among.length) { setError(t('Pick who shares it')); return; }
    const shares = Object.entries(exact).filter(([, v]) => rupees(v)).map(([member, v]) => ({ member, amount: rupees(v) }));
    try {
      await save.mutateAsync({ path: `/groups/${group.id}/expenses`, body: {
        description: description.trim(), amount: rupees(amount), paidBy, date, split, ...(split === 'equal' ? { among } : { exact: shares }),
      } });
      toast.success(t('Expense added'));
      onDone();
    } catch (err) {
      setError(err.details?.[0]?.message ?? err.message);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('What for')} htmlFor={`${uid}-d`}><Input id={`${uid}-d`} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={100} placeholder={t('Dinner at Thalassa')} autoFocus /></Field>
        <Field label={t('Amount (₹)')} htmlFor={`${uid}-a`}><Input id={`${uid}-a`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label={t('Paid by')} htmlFor={`${uid}-p`}>
          <Select id={`${uid}-p`} value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>{group.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>
        </Field>
        <Field label={t('Date')} htmlFor={`${uid}-dt`}><Input id={`${uid}-dt`} type="date" max={today()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      <Segmented label={t('Split')} value={split} onChange={setSplit} options={[{ value: 'equal', label: t('Split equally') }, { value: 'exact', label: t('Exact amounts') }]} />
      {split === 'equal' ? (
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {group.members.map((m) => (
            <label key={m.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={among.includes(m.id)}
                onChange={(e) => setAmong(e.target.checked ? [...among, m.id] : among.filter((x) => x !== m.id))} />
              {m.name}
            </label>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {group.members.map((m) => (
            <div key={m.id} className="flex items-center gap-3">
              <span className="w-32 truncate text-sm">{m.name}</span>
              <Input inputMode="decimal" value={exact[m.id]} onChange={(e) => setExact({ ...exact, [m.id]: e.target.value })} aria-label={t('{name}’s share', { name: m.name })} className="max-w-[10rem]" />
            </div>
          ))}
          <p className={cx('tabular text-sm', Math.round(exactSum * 100) === Math.round(Number(rupees(amount)) * 100) ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400')}>
            {amount ? t('Shares add up to {sum} of {total}', { sum: formatINR(Math.round(exactSum * 100)), total: formatINR(Math.round(Number(rupees(amount)) * 100) || 0) }) : t('Shares add up to {sum}', { sum: formatINR(Math.round(exactSum * 100)) })}
          </p>
        </div>
      )}
      {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onDone}>{t('Cancel')}</Button><Button type="submit" loading={save.isPending}>{t('Add expense')}</Button></div>
    </form>
  );
}

function SettleRow({ group, s }) {
  const save = usePlanMutation('groups');
  const phone = canOpenUpi();
  const copy = async () => {
    try { await navigator.clipboard.writeText(s.toUpiId); toast.success(t('UPI ID copied')); } catch { toast.error(t('Copy failed. Select the ID instead.')); }
  };
  return (
    <li className="flex flex-wrap items-center gap-2 py-3 text-sm">
      <span className="min-w-0 flex-1">{tr('<b>{from}</b> pays <b2>{to}</b2> <amt>{amount}</amt>', { from: s.fromName, to: s.toName, amount: formatINR(s.amount.paise) }, { b: (x) => <span className="font-medium">{x}</span>, b2: (x) => <span className="font-medium">{x}</span>, amt: (x) => <span className="tabular font-semibold">{x}</span> })}</span>
      {s.toUpiId && (phone ? (
        <a href={upiLink({ upiId: s.toUpiId, name: s.toName, amountPaise: s.amount.paise, note: t('{name} settle-up', { name: group.name }) })}
          className="inline-flex h-8 items-center rounded-lg bg-emerald-600 px-3 text-xs font-medium text-white hover:bg-emerald-700">{t('Pay with UPI')}</a>
      ) : (
        <span className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-xs dark:bg-slate-800">
          UPI: <span className="font-mono select-all">{s.toUpiId}</span>
          <button type="button" onClick={copy} aria-label={t('Copy {name}’s UPI ID', { name: s.toName })} className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"><Copy className="h-3.5 w-3.5" aria-hidden="true" /></button>
        </span>
      ))}
      <Button size="sm" variant="secondary" loading={save.isPending}
        onClick={async () => { try { await save.mutateAsync({ path: `/groups/${group.id}/settlements`, body: { from: s.from, to: s.to, amount: String(s.amount.rupees) } }); toast.success(t('Marked as paid')); } catch (err) { toast.error(err.message); } }}>
        {t('Mark as paid')}
      </Button>
    </li>
  );
}

function GroupDetail({ id, onEdit, onDeleted }) {
  const { data, error, refetch } = useGroup(id);
  const mutate = usePlanMutation('groups');
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const g = data?.group;
  const del = async (path, message) => { try { await mutate.mutateAsync({ method: 'DELETE', path }); toast.success(message); } catch (err) { toast.error(err.message); } };
  if (error) return <ErrorNote error={error} onRetry={refetch} />;
  if (!g) return <Skeleton className="h-64 w-full" />;
  return (
    <div className="min-w-0 space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="text-heading font-semibold">{g.name}</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">{tn(g.members.length, '{n} person', '{n} people')} · {t('{amount} spent together', { amount: formatINR(g.total.paise) })}</p>
          </div>
          <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" aria-hidden="true" /> {t('Add expense')}</Button>
          <Button variant="secondary" onClick={() => onEdit(g)}>{t('Edit')}</Button>
          <Button variant="ghost" size="icon" aria-label={t('Delete group')} className="hover:text-rose-600" onClick={() => setDeleting(true)}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
        </div>
        <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {g.members.map((m) => (
            <li key={m.id} className="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/50">
              <span className="min-w-0 flex-1"><span className="block truncate">{m.name}</span><span className="block truncate text-xs text-slate-500 dark:text-slate-400">{t('paid {paid} · share {share}', { paid: formatINR(m.paid.paise), share: formatINR(m.share.paise) })}</span></span>
              <span className={cx('tabular shrink-0 whitespace-nowrap text-right font-semibold', m.balance.paise > 0 && 'text-emerald-600 dark:text-emerald-400', m.balance.paise < 0 && 'text-rose-600 dark:text-rose-400')}>
                {m.balance.paise > 0 ? t('gets {amount}', { amount: formatINR(m.balance.paise) }) : m.balance.paise < 0 ? t('owes {amount}', { amount: formatINR(-m.balance.paise) }) : t('settled')}
              </span>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <CardHeader title={t('Settle up')} subtitle={g.settledUp ? t('Everyone is square.') : g.suggestions.length === 1 ? t('One payment settles everything.') : tn(g.suggestions.length, '{n} payment settles everything.', '{n} payments settle everything.')} />
        {!g.settledUp && <ul className="-my-3 divide-y divide-slate-900/[0.05] dark:divide-white/[0.05]">{g.suggestions.map((s) => <SettleRow key={`${s.from}-${s.to}`} group={g} s={s} />)}</ul>}
      </Card>
      <Card>
        <CardHeader title={t('Expenses')} />
        {g.expenses.length ? (
          <ul className="-my-3 divide-y divide-slate-900/[0.05] dark:divide-white/[0.05]">
            {g.expenses.map((e) => (
              <li key={e.id} className="flex items-center gap-3 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{e.description}</p>
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">{formatDay(e.date)} · {t('{name} paid · split {people}', { name: e.paidByName, people: e.shares.filter((s) => s.amount.paise).map((s) => s.name).join(', ') })}</p>
                </div>
                <span className="tabular font-semibold">{formatINR(e.amount.paise)}</span>
                <Button variant="ghost" size="icon" aria-label={t('Delete {name}', { name: e.description })} onClick={() => del(`/groups/${g.id}/expenses/${e.id}`, t('Expense removed'))}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
              </li>
            ))}
          </ul>
        ) : <EmptyState icon={Users} title={t('No expenses yet')} action={<Button onClick={() => setAdding(true)}>{t('Add the first one')}</Button>}>{t('Add who paid for what; Spendwise works out who owes whom.')}</EmptyState>}
        {g.settlements.length > 0 && (
          <>
            <h3 className="mt-6 mb-1 text-sm font-semibold">{t('Payments between people')}</h3>
            <ul className="divide-y divide-slate-900/[0.06] text-sm dark:divide-white/[0.06]">
              {g.settlements.map((s) => (
                <li key={s.id} className="flex items-center gap-3 py-2">
                  <span className="min-w-0 flex-1">{formatDay(s.date)} · {t('{from} paid {to}', { from: s.fromName, to: s.toName })}</span>
                  <span className="tabular">{formatINR(s.amount.paise)}</span>
                  <Button variant="ghost" size="icon" aria-label={t('Delete payment from {name}', { name: s.fromName })} onClick={() => del(`/groups/${g.id}/settlements/${s.id}`, t('Payment removed'))}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
      <Modal open={adding} onClose={() => setAdding(false)} title={t('Add expense to {name}', { name: g.name })} size="lg">{adding && <ExpenseForm group={g} onDone={() => setAdding(false)} />}</Modal>
      <ConfirmDialog open={deleting} title={t('Delete this group?')} confirmLabel={t('Delete')} danger onClose={() => setDeleting(false)}
        onConfirm={async () => { setDeleting(false); await del(`/groups/${g.id}`, t('Group deleted')); onDeleted(); }}>
        {t('“{name}” and all its expenses and payments are removed.', { name: g.name })}
      </ConfirmDialog>
    </div>
  );
}

export default function Groups() {
  const { data, error, refetch } = useGroups();
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(null); // { group? }
  const groups = data?.groups ?? [];
  const current = groups.find((g) => g.id === selected) ?? groups[0];
  return (
    <>
      <PageHeader title={t('Groups')} subtitle={t('Split expenses with friends, flatmates or a trip, then settle up in as few payments as possible.')}
        actions={<Button onClick={() => setForm({})}><Plus className="h-4 w-4" aria-hidden="true" /> {t('New group')}</Button>} />
      {error && <div className="mb-4"><ErrorNote error={error} onRetry={refetch} /></div>}
      {!data ? <Skeleton className="h-48 w-full" /> : groups.length ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <nav aria-label={t('Groups')} className="space-y-1">
            {groups.map((g) => (
              <button key={g.id} type="button" onClick={() => setSelected(g.id)} aria-current={g.id === current?.id ? 'true' : undefined}
                className={cx('w-full rounded-lg px-3 py-2 text-left text-sm', g.id === current?.id ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-200' : 'hover:bg-slate-100 dark:hover:bg-slate-800')}>
                <span className="block font-medium">{g.name}</span>
                <span className="text-xs text-slate-500 dark:text-slate-400">{formatINR(g.total.paise)} · {g.settledUp ? 'settled' : `${g.suggestions.length} to settle`}</span>
              </button>
            ))}
          </nav>
          {current && <GroupDetail key={current.id} id={current.id} onEdit={(group) => setForm({ group })} onDeleted={() => setSelected(null)} />}
        </div>
      ) : <Card><EmptyState icon={Users} title={t('No groups yet')} action={<Button onClick={() => setForm({})}>{t('Create a group')}</Button>}>{t('A trip, a flat or a dinner club: add who paid for what and see who owes whom.')}</EmptyState></Card>}
      <Modal open={form !== null} onClose={() => setForm(null)} title={form?.group ? t('Edit group') : t('New group')} size="lg">
        {form && <GroupForm key={form.group?.id ?? 'new'} group={form.group} onDone={() => setForm(null)} />}
      </Modal>
    </>
  );
}

import { useId, useState } from 'react';
import { Link } from 'react-router';
import toast from 'react-hot-toast';
import { ArrowLeftRight, Lock, Plus } from 'lucide-react';
import { useSpace } from '../context/SpaceContext.jsx';
import { CardRewards } from '../components/Life.jsx';
import { useAccounts, useCardCycle, useDeleteAccount, useSaveAccount } from '../hooks/api.js';
import { formatDayShort, formatINR, ordinal } from '../lib/format.js';
import { ACCOUNT_TYPE, ACCOUNT_TYPES } from '../lib/labels.js';
import { t, tn } from '../lib/i18n.js';
import TransactionForm from '../components/TransactionForm.jsx';
import { ConfirmDialog, Modal } from '../components/Modal.jsx';
import { Badge, Button, Card, CardHeader, ErrorNote, Field, Input, Money, PageHeader, RowMenu, Select, Skeleton, cx } from '../components/ui.jsx';


// Net worth leads; what you have and what you owe sit beside it.
function NetWorth({ data }) {
  const parts = [
    [t('Assets'), data?.netWorth.assets.paise, t('Accounts with money in them')],
    [t('Owed'), data?.netWorth.liabilities.paise, t('Credit cards and accounts below zero')],
  ];
  return (
    <Card padding="lg" className="mb-4 grid grid-cols-2 gap-5 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] md:items-end md:gap-0 md:divide-x md:divide-slate-900/[0.06] dark:md:divide-white/[0.06]">
      <div className="col-span-2 min-w-0 md:col-span-1 md:pr-6">
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{t('Net worth')}</p>
        {data ? <p className={cx('mt-1 truncate text-[2rem] font-semibold leading-tight tracking-[-0.03em] sm:text-display', data.netWorth.net.paise < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white')}>
          <Money paise={data.netWorth.net.paise} sign={data.netWorth.net.paise < 0 ? '−' : ''} /></p> : <Skeleton className="mt-2 h-10 w-48" />}
        <p className="mt-1 text-caption text-slate-500 dark:text-slate-400">{t('Everything you have minus what you owe')}</p>
      </div>
      {parts.map(([label, paise, hint]) => (
        <div key={label} className="min-w-0 md:px-6">
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{label}</p>
          {data ? <p className="mt-1 truncate text-heading font-semibold text-slate-900 dark:text-white"><Money paise={paise} /></p> : <Skeleton className="mt-2 h-6 w-28" />}
          <p className="mt-0.5 truncate text-caption text-slate-500 dark:text-slate-400">{hint}</p>
        </div>
      ))}
    </Card>
  );
}

const SIGNED_RE = /^-?\d+(\.\d{1,2})?$/;

function AccountForm({ account, onDone }) {
  const uid = useId();
  const save = useSaveAccount();
  const [form, setForm] = useState({
    name: account?.name ?? '',
    type: account?.type ?? 'bank',
    openingBalance: account ? String(account.openingBalance.rupees) : '',
  });
  const [errors, setErrors] = useState({});
  const set = (key, v) => setForm((f) => ({ ...f, [key]: v }));

  async function submit(e) {
    e.preventDefault();
    const local = {};
    if (!form.name.trim()) local.name = t('Name is required');
    const opening = form.openingBalance.trim().replace(/,/g, '') || '0';
    if (!SIGNED_RE.test(opening)) local.openingBalance = t('Enter an amount like 5000, 1250.50 or -2000');
    setErrors(local);
    if (Object.keys(local).length) return;
    try {
      await save.mutateAsync({ id: account?.id, name: form.name.trim(), type: form.type, openingBalance: opening });
      toast.success(account ? t('Account updated') : t('Account added'));
      onDone();
    } catch (err) {
      setErrors({ ...err.fieldErrors(), form: err.details.length ? undefined : err.message });
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {errors.form && <ErrorNote error={{ message: errors.form }} />}
      <Field label={t('Name')} htmlFor={`${uid}-name`} error={errors.name}>
        <Input id={`${uid}-name`} value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={40} placeholder={t('e.g. HDFC Savings')} autoFocus error={errors.name} />
      </Field>
      <Field label={t('Type')} htmlFor={`${uid}-type`}>
        <Select id={`${uid}-type`} value={form.type} onChange={(e) => set('type', e.target.value)}>
          {ACCOUNT_TYPES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
        </Select>
      </Field>
      <Field label={t('Opening balance (₹)')} htmlFor={`${uid}-open`} error={errors.openingBalance}
        hint={t('What’s in it before the entries you add here. For a credit card, enter what you owe as a negative number, e.g. -2500.')}>
        <Input id={`${uid}-open`} inputMode="decimal" value={form.openingBalance} onChange={(e) => set('openingBalance', e.target.value)} placeholder="0" error={errors.openingBalance} />
      </Field>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onDone}>{t('Cancel')}</Button>
        <Button type="submit" loading={save.isPending}>{account ? t('Save') : t('Add account')}</Button>
      </div>
    </form>
  );
}

const CYCLE_TONE = { paid: 'green', due: 'amber', overdue: 'rose' };
const CYCLE_LABEL = { paid: t('Paid'), due: t('Due'), overdue: t('Overdue') };
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

// One credit card's billing cycle, or a form to set its statement and due days.
function CardCycle({ card, onPay }) {
  const save = useSaveAccount();
  const set = Boolean(card.statementDay && card.dueDay);
  const { data, error } = useCardCycle(card.id, set);
  const [statementDay, setStatementDay] = useState(card.statementDay ?? 15);
  const [dueDay, setDueDay] = useState(card.dueDay ?? 5);
  const [editing, setEditing] = useState(!set);
  async function saveDays(e) {
    e.preventDefault();
    try {
      await save.mutateAsync({ id: card.id, statementDay: Number(statementDay), dueDay: Number(dueDay) });
      toast.success(t('Billing cycle saved'));
      setEditing(false);
    } catch (err) {
      toast.error(err.message);
    }
  }
  const s = data?.lastStatement;
  return (
    <Card>
      <CardHeader title={card.name}
        subtitle={set && !editing ? t('Statement on the {statement}, due on the {due}', { statement: ordinal(card.statementDay), due: ordinal(card.dueDay) }) : t('Set the days printed on your card statement.')}
        action={set && !editing && <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>{t('Change days')}</Button>} />
      {editing ? (
        <form onSubmit={saveDays} className="flex flex-wrap items-end gap-3">
          <Field label={t('Statement day')} htmlFor={`sd-${card.id}`}><Select id={`sd-${card.id}`} value={statementDay} onChange={(e) => setStatementDay(e.target.value)} className="w-24">{DAYS.map((d) => <option key={d} value={d}>{d}</option>)}</Select></Field>
          <Field label={t('Payment due day')} htmlFor={`dd-${card.id}`}><Select id={`dd-${card.id}`} value={dueDay} onChange={(e) => setDueDay(e.target.value)} className="w-24">{DAYS.map((d) => <option key={d} value={d}>{d}</option>)}</Select></Field>
          <Button type="submit" loading={save.isPending}>{t('Save')}</Button>
          {set && <Button variant="ghost" onClick={() => setEditing(false)}>{t('Cancel')}</Button>}
        </form>
      ) : error ? <ErrorNote error={error} /> : !data ? <Skeleton className="h-20 w-full" /> : (
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <div>
              <p className="text-caption text-slate-500 dark:text-slate-400">{t('Statement of {date}', { date: formatDayShort(s.to) })}</p>
              <p className="tabular text-heading font-semibold">{formatINR(s.balance.paise)}</p>
            </div>
            <div>
              <p className="text-caption text-slate-500 dark:text-slate-400">{t('Due {date}', { date: formatDayShort(s.dueDate) })}</p>
              <p className="tabular text-heading font-semibold">{formatINR(s.remaining.paise)} <span className="text-sm font-normal text-slate-500 dark:text-slate-400">{t('left to pay')}</span></p>
            </div>
            <Badge tone={CYCLE_TONE[s.status]}>{CYCLE_LABEL[s.status]}</Badge>
            {s.remaining.paise > 0 && <Button size="sm" className="ml-auto" onClick={() => onPay(card, s.remaining.rupees)}>{t('Pay card bill')}</Button>}
          </div>
          <p className="text-slate-500 dark:text-slate-400">
            {t('Statement {from} to {to}: {spent} spent', { from: formatDayShort(s.from), to: formatDayShort(s.to), spent: formatINR(s.purchases.paise) })}
            {s.refunds.paise > 0 && t(', {amount} refunded', { amount: formatINR(s.refunds.paise) })}
            {t('. Paid since: {amount}.', { amount: formatINR(s.paidSince.paise) })}
            {' '}{t('This cycle (to {date}, {days} days left): {spent} spent so far.', { date: formatDayShort(data.currentCycle.to), days: data.currentCycle.daysLeft, spent: formatINR(data.currentCycle.purchases.paise) })}
          </p>
        </div>
      )}
    </Card>
  );
}

export default function Accounts() {
  const [showArchived, setShowArchived] = useState(false);
  const { shared } = useSpace();
  const { data, error, refetch } = useAccounts({ includeArchived: true });
  const save = useSaveAccount();
  const remove = useDeleteAccount();
  const [form, setForm] = useState(null); // null | { account? }
  const [transfer, setTransfer] = useState(false); // false | true | { toAccount, amount }
  const [deleting, setDeleting] = useState(null);
  const list = (data?.accounts ?? []).filter((a) => showArchived || !a.archived);
  const cards = (data?.accounts ?? []).filter((a) => a.type === 'credit_card' && !a.archived);

  const patch = async (a, body, message) => {
    try {
      await save.mutateAsync({ id: a.id, ...body });
      toast.success(message);
    } catch (err) {
      toast.error(err.message);
    }
  };
  async function confirmDelete() {
    const a = deleting;
    setDeleting(null);
    try {
      await remove.mutateAsync(a.id);
      toast.success(t('Account deleted'));
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <>
      <PageHeader title={t('Accounts')} subtitle={t('Cash, bank accounts, cards and wallets, and what you’re worth across them.')}
        actions={(
          <>
            <Button variant="secondary" onClick={() => setTransfer(true)} disabled={(data?.accounts.filter((a) => !a.archived).length ?? 0) < 2}>
              <ArrowLeftRight className="h-4 w-4" aria-hidden="true" /> {t('Transfer')}
            </Button>
            <Button onClick={() => setForm({})}><Plus className="h-4 w-4" aria-hidden="true" /> {t('Add account')}</Button>
          </>
        )} />
      {error && <div className="mb-4"><ErrorNote error={error} onRetry={refetch} /></div>}

      <NetWorth data={data} />

      <Card>
        {!data ? <Skeleton className="h-40 w-full" /> : (
          <ul className="divide-y divide-slate-900/[0.05] dark:divide-white/[0.05]">
            {list.map((a) => {
              const { icon: Icon, label } = ACCOUNT_TYPE[a.type];
              return (
                <li key={a.id} className={cx('flex items-center gap-3 py-3 first:pt-0 last:pb-0', a.archived && 'opacity-70')}>
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-900/[0.05] text-slate-600 dark:bg-white/[0.06] dark:text-slate-300">
                    <Icon className="h-[1.125rem] w-[1.125rem]" aria-hidden="true" strokeWidth={1.75} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      <span className="truncate">{a.name}</span>
                      {a.isDefault && <Badge tone="indigo">{t('Default')}</Badge>}
                      {a.archived && <Badge>{t('Archived')}</Badge>}
                      {a.private && <Badge tone="amber"><Lock className="mr-1 inline h-3 w-3" aria-hidden="true" />{t('Only you')}</Badge>}
                    </p>
                    <p className="text-caption text-slate-500 dark:text-slate-400">
                      {label} · <Link to={`/transactions?account=${a.id}&preset=all`} className="hover:underline">{tn(a.entries, '{n} entry', '{n} entries')}</Link>
                    </p>
                  </div>
                  <Money paise={a.balance.paise} sign={a.balance.paise < 0 ? '−' : ''} className={cx('font-semibold', a.balance.paise < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white')} />
                  <div className="flex items-center gap-0.5">
                    <Button variant="ghost" size="sm" onClick={() => setForm({ account: a })}>{t('Edit')}</Button>
                    <RowMenu label={t('More for {name}', { name: a.name })} items={[
                      !a.isDefault && !a.archived && { label: t('Make default'), onClick: () => patch(a, { isDefault: true }, t('{name} is now the default', { name: a.name })) },
                      { label: a.archived ? t('Unarchive') : t('Archive'), onClick: () => patch(a, { archived: !a.archived }, a.archived ? t('Unarchived') : t('Archived. Its history stays.')) },
                      shared && !a.isDefault && { label: a.private ? t('Share with space') : t('Make private'), onClick: () => patch(a, { private: !a.private }, a.private ? t('{name} is shared with the space again', { name: a.name }) : t('Only you can see {name} and its entries now', { name: a.name })) },
                      a.entries === 0 && { label: t('Delete'), danger: true, onClick: () => setDeleting(a) },
                    ]} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {data?.archivedCount > 0 && (
          <button type="button" onClick={() => setShowArchived((s) => !s)} className="mt-4 text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            {showArchived ? t('Hide archived accounts') : tn(data.archivedCount, 'Show {n} archived account', 'Show {n} archived accounts')}
          </button>
        )}
      </Card>

      {cards.length > 0 && (
        <section className="mt-6" aria-labelledby="cards-heading">
          <h2 id="cards-heading" className="mb-3 text-[0.9375rem] font-semibold">{t('Credit card cycles')}</h2>
          <div className={cx('grid grid-cols-1 gap-4', cards.length > 1 && 'lg:grid-cols-2')}>{cards.map((c) => <CardCycle key={c.id} card={c} onPay={(card, amount) => setTransfer({ toAccount: card.id, amount })} />)}</div>
        </section>
      )}

      <CardRewards />
      <Modal open={form !== null} onClose={() => setForm(null)} title={form?.account ? t('Edit account') : t('Add account')}>
        {form && <AccountForm key={form.account?.id ?? 'new'} account={form.account} onDone={() => setForm(null)} />}
      </Modal>
      <TransactionForm key={transfer?.toAccount ?? 'transfer'} open={Boolean(transfer)} onClose={() => setTransfer(false)}
        defaults={{ type: 'transfer', ...(transfer?.toAccount && { toAccount: transfer.toAccount, amount: String(transfer.amount), note: t('Card bill') }) }} />
      <ConfirmDialog open={deleting !== null} title={t('Delete this account?')} confirmLabel={t('Delete')} danger onClose={() => setDeleting(null)} onConfirm={confirmDelete}>
        {deleting && t('“{name}” has no entries, so nothing else changes.', { name: deleting.name })}
      </ConfirmDialog>
    </>
  );
}

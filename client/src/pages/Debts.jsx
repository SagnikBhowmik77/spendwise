import { useEffect, useId, useState } from 'react';
import toast from 'react-hot-toast';
import { Calculator, HandCoins, Landmark, Plus, Trash2 } from 'lucide-react';
import { useAccounts, useDebts, useLoanPrepayment, useLoans, usePlanMutation } from '../hooks/api.js';
import { formatDay, formatINR } from '../lib/format.js';
import { today } from '../lib/dates.js';
import { amountProblem } from '../components/TransactionForm.jsx';
import { ConfirmDialog, Modal } from '../components/Modal.jsx';
import {
  Badge, Button, Card, CardHeader, EmptyState, ErrorNote, Field, Input, PageHeader, ProgressBar, Segmented, Select, Skeleton, Tabs
} from '../components/ui.jsx';
import { t, tn, tr } from '../lib/i18n.js';
import { catLabel } from '../lib/labels.js';

const rupees = (s) => String(s).trim().replace(/,/g, '');
const months = (n) => (n === null ? t('never at this EMI') : `${Math.floor(n / 12) ? `${t('{n} yr', { n: Math.floor(n / 12) })} ` : ''}${n % 12 ? t('{n} mo', { n: n % 12 }) : ''}`.trim() || t('{n} mo', { n: 0 }));

// The same EMI formula the server uses, for a live preview while typing.
function emiPreview(principal, rate, tenure) {
  const p = Number(rupees(principal)) * 100;
  const n = Number(tenure);
  const r = Number(rate) / 1200;
  if (!(p > 0) || !(n > 0) || !(r >= 0)) return null;
  if (r === 0) return Math.ceil(p / n);
  const f = (1 + r) ** n;
  return Math.round((p * r * f) / (f - 1));
}

function AccountSelect({ id, value, onChange, label = t('Account'), optional = false }) {
  const { data } = useAccounts();
  return (
    <Field label={label} htmlFor={id}>
      <Select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        {optional && <option value="">{t('Default account')}</option>}
        {(data?.accounts ?? []).filter((a) => !a.archived).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </Select>
    </Field>
  );
}

function LoanForm({ onDone }) {
  const uid = useId();
  const save = usePlanMutation('loans');
  const [f, setF] = useState({ name: '', lender: '', principal: '', annualRatePct: '', tenureMonths: '', firstEmiDate: today(), emi: '', account: null });
  const [errors, setErrors] = useState({});
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const preview = emiPreview(f.principal, f.annualRatePct, f.tenureMonths);
  async function submit(e) {
    e.preventDefault();
    const local = {};
    if (!f.name.trim()) local.name = t('Name the loan, e.g. Car loan');
    if (amountProblem(rupees(f.principal))) local.principal = amountProblem(rupees(f.principal));
    if (f.annualRatePct === '') local.annualRatePct = t('Enter the yearly interest rate (0 for no-cost EMI)');
    if (!f.tenureMonths) local.tenureMonths = t('How many months?');
    setErrors(local);
    if (Object.keys(local).length) return;
    try {
      await save.mutateAsync({ path: '/loans', body: {
        name: f.name.trim(), lender: f.lender.trim(), principal: rupees(f.principal), annualRatePct: Number(f.annualRatePct),
        tenureMonths: Number(f.tenureMonths), firstEmiDate: f.firstEmiDate, ...(f.emi && { emi: rupees(f.emi) }), account: f.account,
      } });
      toast.success(t('Loan added'));
      onDone();
    } catch (err) {
      setErrors({ ...err.fieldErrors(), form: err.details.length ? undefined : err.message });
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {errors.form && <ErrorNote error={{ message: errors.form }} />}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('Name')} htmlFor={`${uid}-n`} error={errors.name}><Input id={`${uid}-n`} value={f.name} onChange={set('name')} placeholder={t('Car loan')} autoFocus /></Field>
        <Field label={t('Lender (optional)')} htmlFor={`${uid}-l`}><Input id={`${uid}-l`} value={f.lender} onChange={set('lender')} placeholder={t('HDFC Bank')} /></Field>
        <Field label={t('Loan amount (₹)')} htmlFor={`${uid}-p`} error={errors.principal}><Input id={`${uid}-p`} inputMode="decimal" value={f.principal} onChange={set('principal')} placeholder="500000" /></Field>
        <Field label={t('Interest rate (% a year)')} htmlFor={`${uid}-r`} error={errors.annualRatePct}><Input id={`${uid}-r`} inputMode="decimal" value={f.annualRatePct} onChange={set('annualRatePct')} placeholder="10.5" /></Field>
        <Field label={t('Tenure (months)')} htmlFor={`${uid}-t`} error={errors.tenureMonths}><Input id={`${uid}-t`} inputMode="numeric" value={f.tenureMonths} onChange={set('tenureMonths')} placeholder="60" /></Field>
        <Field label={t('First EMI date')} htmlFor={`${uid}-d`}><Input id={`${uid}-d`} type="date" value={f.firstEmiDate} onChange={set('firstEmiDate')} /></Field>
        <Field label={t('EMI (₹, optional)')} htmlFor={`${uid}-e`} error={errors.emi} hint={preview ? t('Worked out: {amount}. Enter your lender’s figure if it differs.', { amount: formatINR(preview) }) : t('Worked out from the amount, rate and tenure.')}>
          <Input id={`${uid}-e`} inputMode="decimal" value={f.emi} onChange={set('emi')} />
        </Field>
        <AccountSelect id={`${uid}-a`} label={t('EMIs are paid from')} optional value={f.account} onChange={(account) => setF({ ...f, account })} />
      </div>
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onDone}>{t('Cancel')}</Button><Button type="submit" loading={save.isPending}>{t('Add loan')}</Button></div>
    </form>
  );
}

function PaymentForm({ loan, kind, onDone }) {
  const uid = useId();
  const save = usePlanMutation('loans', { money: true });
  const [amount, setAmount] = useState(kind === 'emi' ? String(loan.emi.rupees) : '');
  const [date, setDate] = useState(today());
  const [account, setAccount] = useState(loan.account);
  const [addEntry, setAddEntry] = useState(true);
  const [error, setError] = useState(null);
  async function submit(e) {
    e.preventDefault();
    const a = amountProblem(rupees(amount));
    if (a) { setError(a); return; }
    try {
      await save.mutateAsync({ path: `/loans/${loan.id}/payments`, body: { kind, amount: rupees(amount), date, addEntry, ...(account && { account }) } });
      toast.success(kind === 'emi' ? t('EMI recorded') : t('Prepayment recorded'));
      onDone();
    } catch (err) {
      setError(err.details?.[0]?.message ?? err.message);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('Amount (₹)')} htmlFor={`${uid}-a`} error={error}><Input id={`${uid}-a`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></Field>
        <Field label={t('Paid on')} htmlFor={`${uid}-d`}><Input id={`${uid}-d`} type="date" max={today()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={addEntry} onChange={(e) => setAddEntry(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
        {t('Also add it to my transactions as a {category} expense', { category: catLabel('EMI & Loans') })}
      </label>
      {addEntry && <AccountSelect id={`${uid}-acc`} label={t('Paid from')} optional value={account} onChange={setAccount} />}
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onDone}>{t('Cancel')}</Button><Button type="submit" loading={save.isPending}>{kind === 'emi' ? t('Record EMI') : t('Record prepayment')}</Button></div>
    </form>
  );
}

function PrepaymentCalculator({ loan }) {
  const uid = useId();
  const [input, setInput] = useState('');
  const [amount, setAmount] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setAmount(amountProblem(rupees(input)) ? '' : rupees(input)), 300);
    return () => clearTimeout(id);
  }, [input]);
  const { data, error } = useLoanPrepayment(loan.id, amount);
  return (
    <div className="space-y-4 text-sm">
      <p className="text-slate-600 dark:text-slate-400">{t('{amount} left at {rate}% with an EMI of {emi}.', { amount: formatINR(loan.balance.paise), rate: loan.annualRatePct, emi: formatINR(loan.emi.paise) })}</p>
      <Field label={t('If I prepay (₹)')} htmlFor={`${uid}-a`} className="max-w-xs"><Input id={`${uid}-a`} inputMode="decimal" value={input} onChange={(e) => setInput(e.target.value)} placeholder="100000" autoFocus /></Field>
      {error && <p className="text-rose-600 dark:text-rose-400">{error.details?.[0]?.message ?? error.message}</p>}
      {data && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-lg bg-emerald-50 p-3 dark:bg-emerald-500/10">
            <p className="font-semibold">{t('Keep the EMI, finish sooner')}</p>
            <p className="mt-1">{t('Done in {time} ({n} months sooner)', { time: months(data.reduceTenure.monthsLeft), n: data.reduceTenure.monthsSaved })}</p>
            <p className="tabular">{tr('Interest saved: <b>{amount}</b>', { amount: formatINR(data.reduceTenure.interestSaved.paise) }, { b: (x) => <span className="font-semibold">{x}</span> })}</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
            <p className="font-semibold">{t('Keep the end date, lower EMI')}</p>
            <p className="mt-1 tabular">{t('New EMI: {amount}', { amount: formatINR(data.reduceEmi.emi.paise) })}</p>
            <p className="tabular">{tr('Interest saved: <b>{amount}</b>', { amount: formatINR(data.reduceEmi.interestSaved.paise) }, { b: (x) => <span className="font-semibold">{x}</span> })}</p>
          </div>
          <p className="text-xs text-slate-500 sm:col-span-2 dark:text-slate-400">{t('Finishing sooner usually saves more. Ask your lender which they apply; some charge a prepayment fee on fixed-rate loans.')}</p>
        </div>
      )}
    </div>
  );
}

function LoanCard({ loan, onPay, onCalc, onDelete }) {
  const [open, setOpen] = useState(false);
  const repaid = Math.round((loan.principalRepaid.paise * 1000) / loan.principal.paise) / 10;
  const stats = [
    ['EMI', formatINR(loan.emi.paise)],
    [t('Next EMI'), loan.nextEmiDate ? formatDay(loan.nextEmiDate) : '—'],
    [t('Paid off'), loan.payoffDate ? `${formatDay(loan.payoffDate)} (${months(loan.monthsLeft)})` : loan.closed ? t('Done') : '—'],
    [t('Interest paid'), formatINR(loan.interestPaid.paise)],
    [t('Interest still to pay'), loan.interestLeft ? formatINR(loan.interestLeft.paise) : '—'],
    [t('EMIs paid'), t('{n} of {total}', { n: loan.emisPaid, total: loan.tenureMonths })],
  ];
  return (
    <Card>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 font-semibold">{loan.name}{loan.closed && <Badge tone="green">{t('Repaid')}</Badge>}</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">{[loan.lender, `${formatINR(loan.principal.paise)} at ${loan.annualRatePct}%`, `${loan.tenureMonths} months`].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="text-right">
          <p className="tabular text-xl font-semibold">{formatINR(loan.balance.paise)}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('left to repay')}</p>
        </div>
      </div>
      <div className="mt-3"><ProgressBar percent={repaid} label={`${loan.name}: ${repaid}% repaid`} /></div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
        {stats.map(([k, v]) => <div key={k}><dt className="text-xs text-slate-500 dark:text-slate-400">{k}</dt><dd className="tabular font-medium">{v}</dd></div>)}
      </dl>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {!loan.closed && <Button size="sm" onClick={() => onPay(loan, 'emi')}>{t('Pay EMI')}</Button>}
        {!loan.closed && <Button size="sm" variant="secondary" onClick={() => onPay(loan, 'prepayment')}>{t('Prepay')}</Button>}
        {!loan.closed && <Button size="sm" variant="secondary" onClick={() => onCalc(loan)}><Calculator className="h-4 w-4" aria-hidden="true" /> What if I prepay?</Button>}
        <Button size="sm" variant="ghost" onClick={() => onDelete(loan)} aria-label={t('Delete {name}', { name: loan.name })} className="hover:text-rose-600"><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
        {loan.payments.length > 0 && (
          <button type="button" className="ml-auto text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => setOpen((o) => !o)}>
            {open ? t('Hide payments') : t('Payments ({n})', { n: loan.payments.length })}
          </button>
        )}
      </div>
      {open && <PaymentList loan={loan} />}
    </Card>
  );
}

function PaymentList({ loan }) {
  const remove = usePlanMutation('loans', { money: true });
  return (
    <ul className="mt-3 divide-y divide-slate-100 text-sm dark:divide-slate-800">
      {loan.payments.map((p) => (
        <li key={p.id} className="flex items-center gap-3 py-2">
          <span className="w-24 shrink-0 text-xs text-slate-500 dark:text-slate-400">{formatDay(p.date)}</span>
          <span className="min-w-0 flex-1">{p.kind === 'emi' ? 'EMI' : t('Prepayment')}{p.transactionId ? '' : ' (not in transactions)'}</span>
          <span className="tabular font-medium">{formatINR(p.amount.paise)}</span>
          <Button variant="ghost" size="icon" aria-label={t('Remove payment of {date}', { date: formatDay(p.date) })}
            onClick={async () => { try { await remove.mutateAsync({ method: 'DELETE', path: `/loans/${loan.id}/payments/${p.id}` }); toast.success(t('Payment removed')); } catch (err) { toast.error(err.message); } }}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        </li>
      ))}
    </ul>
  );
}

function Loans() {
  const { data, error, refetch } = useLoans();
  const remove = usePlanMutation('loans');
  const [adding, setAdding] = useState(false);
  const [pay, setPay] = useState(null);
  const [calc, setCalc] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const owed = data?.loans.reduce((s, l) => s + l.balance.paise, 0) ?? 0;
  const emis = data?.loans.filter((l) => !l.closed).reduce((s, l) => s + l.emi.paise, 0) ?? 0;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {data?.loans.length > 0 && <p className="text-sm text-slate-600 dark:text-slate-400">{tr('<b>{owed}</b> left across loans · <b>{emis}</b> in EMIs a month', { owed: formatINR(owed), emis: formatINR(emis) }, { b: (x) => <span className="tabular font-semibold text-slate-900 dark:text-white">{x}</span> })}</p>}
        <Button className="ml-auto" onClick={() => setAdding(true)}><Plus className="h-4 w-4" aria-hidden="true" /> {t('Add loan')}</Button>
      </div>
      {error && <ErrorNote error={error} onRetry={refetch} />}
      {!data ? <Skeleton className="h-40 w-full" /> : data.loans.length ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">{data.loans.map((l) => <LoanCard key={l.id} loan={l} onPay={(loan, kind) => setPay({ loan, kind })} onCalc={setCalc} onDelete={setDeleting} />)}</div>
      ) : <Card><EmptyState icon={Landmark} title={t('No loans')}>{t('Add a home, car, personal or education loan to see what’s left, when it ends and what prepaying would save.')}</EmptyState></Card>}
      <Modal open={adding} onClose={() => setAdding(false)} title={t('Add loan')} size="lg">{adding && <LoanForm onDone={() => setAdding(false)} />}</Modal>
      <Modal open={pay !== null} onClose={() => setPay(null)} title={pay?.kind === 'emi' ? t('Pay EMI: {name}', { name: pay?.loan.name }) : t('Prepay: {name}', { name: pay?.loan.name ?? '' })}>
        {pay && <PaymentForm key={`${pay.loan.id}-${pay.kind}`} loan={pay.loan} kind={pay.kind} onDone={() => setPay(null)} />}
      </Modal>
      <Modal open={calc !== null} onClose={() => setCalc(null)} title={t('Prepayment calculator')} size="lg">{calc && <PrepaymentCalculator key={calc.id} loan={calc} />}</Modal>
      <ConfirmDialog open={deleting !== null} title={t('Delete this loan?')} confirmLabel={t('Delete')} danger onClose={() => setDeleting(null)}
        onConfirm={async () => { const l = deleting; setDeleting(null); try { await remove.mutateAsync({ method: 'DELETE', path: `/loans/${l.id}` }); toast.success(t('Loan deleted')); } catch (err) { toast.error(err.message); } }}>
        {deleting && t('“{name}” and its payment history are removed. Expenses already recorded for EMIs stay in your transactions.', { name: deleting.name })}
      </ConfirmDialog>
    </>
  );
}

function DebtForm({ onDone }) {
  const uid = useId();
  const save = usePlanMutation('debts');
  const [f, setF] = useState({ direction: 'lent', person: '', amount: '', date: today(), dueDate: '', note: '' });
  const [errors, setErrors] = useState({});
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function submit(e) {
    e.preventDefault();
    const local = {};
    if (!f.person.trim()) local.person = t('Who?');
    if (amountProblem(rupees(f.amount))) local.amount = amountProblem(rupees(f.amount));
    setErrors(local);
    if (Object.keys(local).length) return;
    try {
      await save.mutateAsync({ path: '/debts', body: { ...f, person: f.person.trim(), amount: rupees(f.amount), dueDate: f.dueDate || null, note: f.note.trim() } });
      toast.success(t('Saved'));
      onDone();
    } catch (err) {
      setErrors(err.fieldErrors());
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Segmented label={t('Lent or borrowed')} value={f.direction} onChange={(direction) => setF({ ...f, direction })}
        options={[{ value: 'lent', label: t('I lent money') }, { value: 'borrowed', label: t('I borrowed money') }]} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={f.direction === 'lent' ? t('To whom') : t('From whom')} htmlFor={`${uid}-p`} error={errors.person}><Input id={`${uid}-p`} value={f.person} onChange={set('person')} maxLength={60} autoFocus /></Field>
        <Field label={t('Amount (₹)')} htmlFor={`${uid}-a`} error={errors.amount}><Input id={`${uid}-a`} inputMode="decimal" value={f.amount} onChange={set('amount')} /></Field>
        <Field label={t('Date')} htmlFor={`${uid}-d`}><Input id={`${uid}-d`} type="date" max={today()} value={f.date} onChange={set('date')} /></Field>
        <Field label={t('To be repaid by (optional)')} htmlFor={`${uid}-due`}><Input id={`${uid}-due`} type="date" value={f.dueDate} onChange={set('dueDate')} /></Field>
      </div>
      <Field label={t('Note (optional)')} htmlFor={`${uid}-n`}><Input id={`${uid}-n`} value={f.note} onChange={set('note')} maxLength={200} placeholder={t('Concert tickets')} /></Field>
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onDone}>{t('Cancel')}</Button><Button type="submit" loading={save.isPending}>{t('Save')}</Button></div>
    </form>
  );
}

function SettleForm({ debt, onDone }) {
  const uid = useId();
  const save = usePlanMutation('debts');
  const [amount, setAmount] = useState(String(debt.outstanding.rupees));
  const [date, setDate] = useState(today());
  const [error, setError] = useState(null);
  async function submit(e) {
    e.preventDefault();
    const a = amountProblem(rupees(amount));
    if (a) { setError(a); return; }
    try {
      await save.mutateAsync({ path: `/debts/${debt.id}/settlements`, body: { amount: rupees(amount), date } });
      toast.success(t('Repayment recorded'));
      onDone();
    } catch (err) {
      setError(err.details?.[0]?.message ?? err.message);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <p className="text-sm text-slate-600 dark:text-slate-400">{debt.direction === 'lent' ? t('{amount} outstanding from {name}.', { amount: formatINR(debt.outstanding.paise), name: debt.person }) : t('{amount} outstanding to {name}.', { amount: formatINR(debt.outstanding.paise), name: debt.person })}</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('Amount repaid (₹)')} htmlFor={`${uid}-a`} error={error}><Input id={`${uid}-a`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></Field>
        <Field label={t('Date')} htmlFor={`${uid}-d`}><Input id={`${uid}-d`} type="date" max={today()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onDone}>{t('Cancel')}</Button><Button type="submit" loading={save.isPending}>{t('Record repayment')}</Button></div>
    </form>
  );
}

const DEBT_TONE = { open: 'amber', overdue: 'rose', settled: 'green' };

function LentBorrowed() {
  const { data, error, refetch } = useDebts();
  const remove = usePlanMutation('debts');
  const [adding, setAdding] = useState(false);
  const [settling, setSettling] = useState(null);
  return (
    <>
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-center">
        <Card><p className="text-sm text-slate-500 dark:text-slate-400">{t('Owed to you')}</p><p className="tabular text-xl font-semibold text-emerald-600 dark:text-emerald-400">{formatINR(data?.totals.owedToYou.paise ?? 0)}</p></Card>
        <Card><p className="text-sm text-slate-500 dark:text-slate-400">{t('You owe')}</p><p className="tabular text-xl font-semibold text-rose-600 dark:text-rose-400">{formatINR(data?.totals.youOwe.paise ?? 0)}</p></Card>
        <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" aria-hidden="true" /> {t('Add')}</Button>
      </div>
      {error && <ErrorNote error={error} onRetry={refetch} />}
      {data?.people.length > 0 && (
        <p className="mb-3 flex flex-wrap gap-2 text-sm">
          {data.people.map((p) => (
            <span key={p.person} className="rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-800">
              {p.person}: {p.net.paise > 0 ? <span className="text-emerald-700 dark:text-emerald-300">{t('owes you {amount}', { amount: formatINR(p.net.paise) })}</span> : <span className="text-rose-700 dark:text-rose-300">{t('you owe {amount}', { amount: formatINR(-p.net.paise) })}</span>}
            </span>
          ))}
        </p>
      )}
      <Card>
        {!data ? <Skeleton className="h-24 w-full" /> : data.debts.length ? (
          <ul className="-my-3 divide-y divide-slate-900/[0.05] dark:divide-white/[0.05]">
            {data.debts.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{d.direction === 'lent' ? t('Lent to {name}', { name: d.person }) : t('Borrowed from {name}', { name: d.person })} <Badge tone={DEBT_TONE[d.status]}>{d.status === 'open' ? t('Open') : d.status === 'overdue' ? t('Overdue') : t('Settled')}</Badge></p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{[formatDay(d.date), d.note, d.dueDate && t('due {date}', { date: formatDay(d.dueDate) }), d.settled.paise > 0 && t('{amount} repaid', { amount: formatINR(d.settled.paise) })].filter(Boolean).join(' · ')}</p>
                </div>
                <span className="tabular text-right">
                  <span className="block font-semibold">{formatINR(d.outstanding.paise)}</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">{t('of {amount}', { amount: formatINR(d.amount.paise) })}</span>
                </span>
                {d.status !== 'settled' && <Button size="sm" variant="secondary" onClick={() => setSettling(d)}>{t('Settle')}</Button>}
                <Button size="icon" variant="ghost" aria-label={t('Delete {name} entry', { name: d.person })} className="hover:text-rose-600"
                  onClick={async () => { try { await remove.mutateAsync({ method: 'DELETE', path: `/debts/${d.id}` }); toast.success(t('Removed')); } catch (err) { toast.error(err.message); } }}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        ) : <EmptyState icon={HandCoins} title={t('Nothing lent or borrowed')}>{t('Keep track of money you lent a friend or borrowed from family, and settle it in parts.')}</EmptyState>}
      </Card>
      <Modal open={adding} onClose={() => setAdding(false)} title={t('Lent or borrowed')}>{adding && <DebtForm onDone={() => setAdding(false)} />}</Modal>
      <Modal open={settling !== null} onClose={() => setSettling(null)} title={t('Record a repayment')}>{settling && <SettleForm key={settling.id} debt={settling} onDone={() => setSettling(null)} />}</Modal>
    </>
  );
}

export default function Debts() {
  const [tab, setTab] = useState('loans');
  return (
    <>
      <PageHeader title={t('Loans & debts')} subtitle={t('EMIs and what’s left to repay, and money lent to or borrowed from people.')}
      />
      <Tabs className="mb-6" label={t('Show')} value={tab} onChange={setTab} options={[{ value: 'loans', label: t('Loans & EMIs') }, { value: 'people', label: t('Lent & borrowed') }]} />
      {tab === 'loans' ? <Loans /> : <LentBorrowed />}
    </>
  );
}

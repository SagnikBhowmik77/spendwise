import { useEffect, useId, useState } from 'react';
import { useSearchParams } from 'react-router';
import toast from 'react-hot-toast';
import { CalendarClock, Coins, Pencil, Plus, Repeat, Search, Tag, Trash2, TrendingUp } from 'lucide-react';
import { useAccounts, useInvestments, useNetWorth, usePlanMutation, useSchemeSearch } from '../hooks/api.js';
import { formatDay, formatINR, formatMonth } from '../lib/format.js';
import { today } from '../lib/dates.js';
import { ConfirmDialog, Modal } from '../components/Modal.jsx';
import { NetWorthChart } from '../components/charts.jsx';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorNote, Field, Input, PageHeader, ProgressBar, Segmented, Select, Skeleton, cx, Tabs } from '../components/ui.jsx';
import { t, tn } from '../lib/i18n.js';
import { TAX_CLASS_LABEL } from '../components/TaxFiling.jsx';

const rupees = (s) => String(s).trim().replace(/,/g, '');
const KINDS = [
  { value: 'mf', label: t('Mutual fund') }, { value: 'stock', label: t('Stock') }, { value: 'gold', label: t('Gold') },
  { value: 'fd', label: t('Fixed deposit') }, { value: 'rd', label: t('Recurring deposit') }, { value: 'ppf', label: 'PPF' }, { value: 'epf', label: 'EPF' }, { value: 'nps', label: 'NPS' }, { value: 'other', label: t('Other') },
];
const GROUP_LABEL = { mf: t('Mutual funds'), stock: t('Stocks'), gold: t('Gold'), fd: t('Fixed deposits'), rd: t('Recurring deposits'), ppf: 'PPF', epf: 'EPF', nps: 'NPS', other: t('Other') };
const MARKET = ['mf', 'stock', 'gold', 'nps', 'other'];
const PRICED = ['stock', 'gold', 'nps', 'other'];
// Batch 12M: how a sale is taxed, chosen per holding (NPS isn't a capital asset sold on the market).
const TAXED = ['mf', 'stock', 'gold', 'other'];
const COMPOUNDING = [['quarterly', t('Quarterly (most banks)')], ['monthly', t('Monthly')], ['half-yearly', t('Half-yearly')], ['yearly', t('Yearly')], ['simple', t('Simple interest (paid out)')]];
const unitsFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 4 });
const priceFmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 4 });
const pct = (n) => (n === null || n === undefined ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(2)}%`);
const gainTone = (p) => (p > 0 ? 'text-emerald-600 dark:text-emerald-400' : p < 0 ? 'text-rose-600 dark:text-rose-400' : '');
const signed = (p) => `${p > 0 ? '+' : p < 0 ? '−' : ''}${formatINR(Math.abs(p))}`;
const PRICE_SOURCE = { amfi: t('AMFI NAV'), manual: t('price you entered'), trade: t('last purchase or sale') };

function useFormErrors() {
  const [errors, setErrors] = useState({});
  const fail = (err) => setErrors({ ...err.fieldErrors?.(), form: err.details?.length ? undefined : err.message });
  return [errors, fail];
}

const FormButtons = ({ onDone, loading, label }) => (
  <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onDone}>{t('Cancel')}</Button><Button type="submit" loading={loading}>{label}</Button></div>
);

function SchemePicker({ value, onPick, error }) {
  const uid = useId();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQ(text), 300);
    return () => { clearTimeout(timer); };
  }, [text]);
  const { data, error: searchError, isFetching } = useSchemeSearch(q);
  return (
    <Field label={t('Fund')} htmlFor={`${uid}-q`} error={error} hint={t('From AMFI’s list of every mutual fund scheme, with its latest NAV.')}>
      {value ? (
        <div className="flex items-start gap-3 rounded-lg border border-slate-900/[0.08] p-3 text-sm dark:border-white/[0.08]">
          <div className="min-w-0 flex-1">
            <p className="font-medium">{value.name}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{[value.plan, value.option].filter(Boolean).join(' · ')} · {t('NAV {nav} on {date}', { nav: priceFmt.format(value.nav), date: formatDay(value.navDate) })} · {t('code {code}', { code: value.code })}</p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => onPick(null)}>{t('Change')}</Button>
        </div>
      ) : (
        <>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <Input id={`${uid}-q`} className="pl-9" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('e.g. parag parikh flexi, or a scheme code')} autoFocus />
          </div>
          {searchError && <p className="mt-2 text-sm text-rose-600">{searchError.message}</p>}
          {q.trim().length >= 2 && data && (
            <ul className={cx('mt-2 max-h-64 divide-y divide-slate-900/[0.06] overflow-y-auto rounded-lg border border-slate-900/[0.08] dark:divide-white/[0.06] dark:border-white/[0.08]', isFetching && 'opacity-60')} aria-label={t('Matching funds')}>
              {data.schemes.length ? data.schemes.map((s) => (
                <li key={s.code}>
                  <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800" onClick={() => onPick(s)}>
                    <span className="block font-medium">{s.name}</span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">{[s.plan, s.option].filter(Boolean).join(' · ')} · NAV {priceFmt.format(s.nav)} ({formatDay(s.navDate)})</span>
                  </button>
                </li>
              )) : <li className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">{t('No fund matches every word.')}</li>}
            </ul>
          )}
        </>
      )}
    </Field>
  );
}

function HoldingForm({ holding, onDone }) {
  const uid = useId();
  const save = usePlanMutation('investments', { money: true });
  const [kind, setKind] = useState(holding?.kind ?? 'mf');
  const [scheme, setScheme] = useState(null);
  const [name, setName] = useState(holding?.name ?? '');
  const [price, setPrice] = useState(holding?.manualPrice ? String(holding.manualPrice) : '');
  const [amount, setAmount] = useState(holding?.principal ? String(holding.principal.rupees) : holding?.monthly ? String(holding.monthly.rupees) : '');
  const [ratePct, setRatePct] = useState(holding?.ratePct ?? '');
  const [startDate, setStartDate] = useState(holding?.startDate ?? today());
  const [tenure, setTenure] = useState(String(holding?.tenureMonths ?? 12));
  const [compounding, setCompounding] = useState(holding?.compounding ?? 'quarterly');
  const [note, setNote] = useState(holding?.note ?? '');
  const [taxClass, setTaxClass] = useState(holding?.taxClass ?? '');
  const [fmv, setFmv] = useState(holding?.fmv2018 ? String(holding.fmv2018) : '');
  const [errors, fail] = useFormErrors();
  const taxed = Boolean(holding) && TAXED.includes(kind);
  const before2018 = Boolean(holding?.trades?.some((x) => x.type === 'buy' && x.date < '2018-02-01'));
  const deposit = kind === 'fd' || kind === 'rd';

  async function submit(e) {
    e.preventDefault();
    const body = { note: note.trim() };
    if (name.trim()) body.name = name.trim();
    if (kind === 'mf' && !holding) body.schemeCode = scheme?.code;
    if (PRICED.includes(kind) && !holding && rupees(price)) body.manualPrice = Number(rupees(price));
    if ((deposit || kind === 'ppf') && String(ratePct).trim() !== '') body.ratePct = Number(ratePct);
    if (deposit) Object.assign(body, { startDate, tenureMonths: Number(tenure), ...(rupees(amount) && { [kind === 'fd' ? 'principal' : 'monthly']: rupees(amount) }) });
    if (kind === 'fd') body.compounding = compounding;
    if (taxed) Object.assign(body, { taxClass: taxClass || null, fmv2018: rupees(fmv) ? Number(rupees(fmv)) : null });
    try {
      if (holding) await save.mutateAsync({ method: 'PATCH', path: `/investments/${holding.id}`, body });
      else await save.mutateAsync({ path: '/investments', body: { kind, ...body } });
      toast.success(holding ? t('Saved') : t('Investment added'));
      onDone();
    } catch (err) { fail(err); }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {errors.form && <ErrorNote error={{ message: errors.form }} />}
      {!holding && (
        <Field label={t('What is it?')} htmlFor={`${uid}-k`}>
          <Select id={`${uid}-k`} value={kind} onChange={(e) => setKind(e.target.value)}>{KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</Select>
        </Field>
      )}
      {kind === 'mf' && !holding ? <SchemePicker value={scheme} onPick={setScheme} error={errors.schemeCode} /> : (
        <Field label={t('Name')} htmlFor={`${uid}-n`} error={errors.name}>
          <Input id={`${uid}-n`} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder={t('e.g. {example}', { example: { stock: 'Infosys', gold: 'Sovereign Gold Bond 2024 Series I', fd: 'SBI FD', rd: 'HDFC RD', ppf: 'PPF at SBI', epf: t('EPF at Acme Ltd'), nps: 'NPS Tier I', other: t('P2P lending') }[kind] })} />
        </Field>
      )}
      {PRICED.includes(kind) && !holding && (
        <Field label={t('Current price per unit (₹, optional)')} htmlFor={`${uid}-p`} error={errors.manualPrice} hint={kind === 'gold' ? t('Per gram or per unit, as you count it. Update it whenever you like.') : t('Update it whenever you like; until then the last purchase price counts.')}>
          <Input id={`${uid}-p`} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="1500" />
        </Field>
      )}
      {(deposit || kind === 'ppf') && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {deposit && (
            <Field label={kind === 'fd' ? t('Amount deposited (₹)') : t('Monthly instalment (₹)')} htmlFor={`${uid}-a`} error={errors.principal ?? errors.monthly}>
              <Input id={`${uid}-a`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={kind === 'fd' ? '100000' : '2000'} />
            </Field>
          )}
          <Field label={t('Interest rate (% a year)')} htmlFor={`${uid}-r`} error={errors.ratePct} hint={kind === 'ppf' ? t('The rate the government set; change it here when it’s revised.') : undefined}>
            <Input id={`${uid}-r`} inputMode="decimal" value={ratePct} onChange={(e) => setRatePct(e.target.value)} placeholder="7.1" />
          </Field>
          {deposit && (
            <>
              <Field label={t('Start date')} htmlFor={`${uid}-s`} error={errors.startDate}><Input id={`${uid}-s`} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
              <Field label={t('Term (months)')} htmlFor={`${uid}-t`} error={errors.tenureMonths}><Input id={`${uid}-t`} inputMode="numeric" value={tenure} onChange={(e) => setTenure(e.target.value)} /></Field>
            </>
          )}
          {kind === 'fd' && (
            <Field label={t('Interest')} htmlFor={`${uid}-c`} className="sm:col-span-2">
              <Select id={`${uid}-c`} value={compounding} onChange={(e) => setCompounding(e.target.value)}>{COMPOUNDING.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
            </Field>
          )}
        </div>
      )}
      {kind === 'epf' && !holding && <p className="text-sm text-slate-600 dark:text-slate-400">{t('After adding it, enter the balance from your EPFO passbook, then your monthly contributions (yours and your employer’s). Interest is estimated at EPFO’s declared rate until the passbook shows it.')}</p>}
      {kind === 'nps' && !holding && <p className="text-sm text-slate-600 dark:text-slate-400">{t('Record each contribution as a purchase at that day’s NAV from your NPS statement, and update the NAV now and then. Spendwise doesn’t fetch NPS NAVs.')}</p>}
      {taxed && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('How sales are taxed')} htmlFor={`${uid}-tc`} error={errors.taxClass} hint={t('Used for capital gains under Tax & planning.')}>
            <Select id={`${uid}-tc`} value={taxClass} onChange={(e) => setTaxClass(e.target.value)}>
              <option value="">{holding.defaultTaxClass ? t('Usual for this kind: {label}', { label: t(TAX_CLASS_LABEL[holding.defaultTaxClass]) }) : t('Not set')}</option>
              {Object.entries(TAX_CLASS_LABEL).map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
            </Select>
          </Field>
          {before2018 && (
            <Field label={t('Value per unit on 31 Jan 2018 (₹)')} htmlFor={`${uid}-fmv`} error={errors.fmv2018} hint={kind === 'mf' ? t('Leave empty to use AMFI’s NAV for that day.') : t('The highest price quoted on the exchange that day.')}>
              <Input id={`${uid}-fmv`} inputMode="decimal" value={fmv} onChange={(e) => setFmv(e.target.value)} />
            </Field>
          )}
        </div>
      )}
      <Field label={t('Note (optional)')} htmlFor={`${uid}-no`} error={errors.note}><Input id={`${uid}-no`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} /></Field>
      <FormButtons onDone={onDone} loading={save.isPending} label={holding ? t('Save') : t('Add')} />
    </form>
  );
}

function AccountPicker({ id, value, onChange, hint }) {
  const { data } = useAccounts();
  return (
    <Field label={t('Paid from (optional)')} htmlFor={id} hint={hint}>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t('Don’t record an expense')}</option>
        {data?.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </Select>
    </Field>
  );
}

function TradeForm({ holding, type, onDone }) {
  const uid = useId();
  const save = usePlanMutation('investments', { money: true });
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState('');
  const [units, setUnits] = useState('');
  const [price, setPrice] = useState('');
  const [account, setAccount] = useState('');
  const [errors, fail] = useFormErrors();
  const fund = holding.kind === 'mf';
  async function submit(e) {
    e.preventDefault();
    const body = { type, date };
    if (rupees(amount)) body.amount = rupees(amount);
    if (rupees(units)) body.units = Number(rupees(units));
    if (rupees(price)) body.price = Number(rupees(price));
    if (account && type === 'buy') body.account = account;
    try {
      const before = new Set(holding.trades.map((x) => x.id));
      const r = await save.mutateAsync({ path: `/investments/${holding.id}/trades`, body });
      const trade = r.holding.trades.find((x) => !before.has(x.id));
      const vars = { units: unitsFmt.format(trade.units), price: priceFmt.format(trade.price), date: formatDay(trade.date) };
      toast.success(type === 'buy' ? t('Bought {units} units at {price} ({date})', vars) : t('Sold {units} units at {price} ({date})', vars));
      onDone();
    } catch (err) { fail(err); }
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {errors.form && <ErrorNote error={{ message: errors.form }} />}
      <p className="text-sm text-slate-600 dark:text-slate-400">
        {fund ? t('Enter the amount; the units follow from AMFI’s NAV for that day (the next business day on a holiday). Or enter the NAV from your statement.') : t('Enter two of amount, units and price; the third follows.')}
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('Date')} htmlFor={`${uid}-d`} error={errors.date}><Input id={`${uid}-d`} type="date" max={today()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label={t('Amount (₹)')} htmlFor={`${uid}-a`} error={errors.amount}><Input id={`${uid}-a`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></Field>
        <Field label={t('Units')} htmlFor={`${uid}-u`} error={errors.units}><Input id={`${uid}-u`} inputMode="decimal" value={units} onChange={(e) => setUnits(e.target.value)} placeholder={fund ? t('Worked out') : ''} /></Field>
        <Field label={fund ? t('NAV (₹, optional)') : t('Price per unit (₹)')} htmlFor={`${uid}-p`} error={errors.price}><Input id={`${uid}-p`} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder={fund ? t('From AMFI') : ''} /></Field>
      </div>
      {type === 'buy' && <AccountPicker id={`${uid}-ac`} value={account} onChange={setAccount} hint={t('Records it as an “Investments” expense from that account.')} />}
      <FormButtons onDone={onDone} loading={save.isPending} label={type === 'buy' ? t('Record purchase') : t('Record sale')} />
    </form>
  );
}

function SipForm({ holding, onDone }) {
  const uid = useId();
  const save = usePlanMutation('investments', { money: true });
  const active = holding.sip?.active;
  const [amount, setAmount] = useState(active ? String(holding.sip.amount.rupees) : '');
  const [startDate, setStartDate] = useState(active ? holding.sip.startDate : today());
  const [account, setAccount] = useState(holding.sip?.account ?? '');
  const [errors, fail] = useFormErrors();
  async function submit(e) {
    e.preventDefault();
    try {
      const r = await save.mutateAsync({ method: 'PUT', path: `/investments/${holding.id}/sip`, body: { amount: rupees(amount), startDate, account: account || null } });
      toast.success(r.holding.sip.catchingUp ? t('SIP saved. Buying past instalments at their NAVs…') : t('SIP saved'));
      onDone();
    } catch (err) { fail(err); }
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {errors.form && <ErrorNote error={{ message: errors.form }} />}
      <p className="text-sm text-slate-600 dark:text-slate-400">{t('Each month on the first instalment’s day, Spendwise buys units at that day’s NAV from AMFI once it’s published (the same evening). If the first instalment is in the past, every instalment since is bought at its own day’s NAV.')}</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('Amount a month (₹)')} htmlFor={`${uid}-a`} error={errors.amount}><Input id={`${uid}-a`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="5000" autoFocus /></Field>
        <Field label={t('First instalment')} htmlFor={`${uid}-s`} error={errors.startDate}><Input id={`${uid}-s`} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
      </div>
      <AccountPicker id={`${uid}-ac`} value={account} onChange={setAccount} hint={t('Records each instalment from today on as an “Investments” expense.')} />
      <FormButtons onDone={onDone} loading={save.isPending} label={t('Save SIP')} />
    </form>
  );
}

function DepositForm({ holding, onDone }) {
  const uid = useId();
  const save = usePlanMutation('investments');
  const [direction, setDirection] = useState('deposit');
  const epf = holding.kind === 'epf';
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const [errors, fail] = useFormErrors();
  async function submit(e) {
    e.preventDefault();
    try {
      await save.mutateAsync({ path: `/investments/${holding.id}/deposits`, body: { direction, amount: rupees(amount), date } });
      toast.success(direction === 'deposit' ? (epf ? t('Contribution added') : t('Deposit added')) : t('Withdrawal added'));
      onDone();
    } catch (err) { fail(err); }
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {errors.form && <ErrorNote error={{ message: errors.form }} />}
      <Segmented label={t('Deposit or withdraw')} value={direction} onChange={setDirection} options={[{ value: 'deposit', label: epf ? t('Contribution') : t('Deposit') }, { value: 'withdraw', label: t('Withdraw') }]} />
      {epf ? <p className="text-sm text-slate-600 dark:text-slate-400">{t('Your share and your employer’s, as one amount or two entries. It earns interest from the next month.')}</p>
        : <p className="text-sm text-slate-600 dark:text-slate-400">{t('{amount} of {limit} deposited this financial year. A deposit made by the 5th earns interest for that month.', { amount: formatINR(holding.thisYear.deposited.paise), limit: formatINR(holding.thisYear.limit.paise) })}</p>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('Amount (₹)')} htmlFor={`${uid}-a`} error={errors.amount}><Input id={`${uid}-a`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></Field>
        <Field label={t('Date')} htmlFor={`${uid}-d`} error={errors.date}><Input id={`${uid}-d`} type="date" max={today()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      <FormButtons onDone={onDone} loading={save.isPending} label={t('Save')} />
    </form>
  );
}

// EPF: the balance shown in the EPFO passbook (it includes the interest EPFO has credited).
function PassbookForm({ holding, onDone }) {
  const uid = useId();
  const save = usePlanMutation('investments');
  const [balance, setBalance] = useState('');
  const [date, setDate] = useState(today());
  const [errors, fail] = useFormErrors();
  async function submit(e) {
    e.preventDefault();
    try {
      await save.mutateAsync({ path: `/investments/${holding.id}/passbook`, body: { balance: rupees(balance), date } });
      toast.success(t('Passbook balance saved'));
      onDone();
    } catch (err) { fail(err); }
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {errors.form && <ErrorNote error={{ message: errors.form }} />}
      <p className="text-sm text-slate-600 dark:text-slate-400">{t('From the EPFO passbook (UAN member portal or the UMANG app): the total balance on a day. Contributions before that day are already in it.')}</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('Balance (₹)')} htmlFor={`${uid}-b`} error={errors.balance}><Input id={`${uid}-b`} inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} autoFocus /></Field>
        <Field label={t('As on')} htmlFor={`${uid}-d`} error={errors.date}><Input id={`${uid}-d`} type="date" max={today()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      <FormButtons onDone={onDone} loading={save.isPending} label={t('Save')} />
    </form>
  );
}

function PriceForm({ holding, onDone }) {
  const uid = useId();
  const save = usePlanMutation('investments');
  const [price, setPrice] = useState(holding.price ? String(holding.price.value) : '');
  const [errors, fail] = useFormErrors();
  async function submit(e) {
    e.preventDefault();
    try {
      await save.mutateAsync({ method: 'PATCH', path: `/investments/${holding.id}`, body: { manualPrice: Number(rupees(price)) } });
      toast.success(t('Price updated'));
      onDone();
    } catch (err) { fail(err); }
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {errors.form && <ErrorNote error={{ message: errors.form }} />}
      <Field label={t('Price per unit today (₹)')} htmlFor={`${uid}-p`} error={errors.manualPrice} hint={t('From your broker or the exchange; Spendwise doesn’t fetch stock or gold prices.')}>
        <Input id={`${uid}-p`} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} autoFocus />
      </Field>
      <FormButtons onDone={onDone} loading={save.isPending} label={t('Update')} />
    </form>
  );
}

function Stat({ label, value, hint, className }) {
  return (
    <div className={cx('min-w-0 rounded-xl bg-white p-4 ring-1 ring-slate-900/[0.06] dark:bg-slate-900 dark:ring-white/[0.06]', className)}>
      <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{label}</p>
      <p className="tabular mt-2 break-words text-heading font-semibold text-slate-900 dark:text-white">{value}</p>
      {hint && <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  );
}

function Metric({ label, children }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p className="tabular truncate text-sm font-medium">{children}</p>
    </div>
  );
}

function HoldingCard({ h, act }) {
  const [open, setOpen] = useState(false);
  const market = MARKET.includes(h.kind);
  const history = market ? h.trades : h.kind === 'ppf' ? h.deposits
    : h.kind === 'epf' ? [...h.deposits, ...h.passbook.map((p) => ({ ...p, passbook: true }))].sort((a, b) => (a.date < b.date ? 1 : -1)) : [];
  return (
    <Card className="min-w-0">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 break-words font-semibold">{h.name}</h3>
            {h.sip?.active && <Badge tone="green">{t('SIP {amount}/month', { amount: formatINR(h.sip.amount.paise) })}</Badge>}
            {h.matured && <Badge tone="amber">{t('Matured')}</Badge>}
          </div>
          {market && h.price && (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {t('{units} units × {price} ({source}, {date})', { units: unitsFmt.format(h.units), price: priceFmt.format(h.price.value), source: PRICE_SOURCE[h.price.source], date: formatDay(h.price.date) })}
            </p>
          )}
          {market && !h.price && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('No purchases yet.')}</p>}
          {!market && h.maturityDate && (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {t('{rate}% a year', { rate: h.ratePct })} · {h.matured ? t('matured {date}', { date: formatDay(h.maturityDate) }) : t('matures {date}', { date: formatDay(h.maturityDate) })}{h.maturityValue ? ` · ${t('{amount} at maturity', { amount: formatINR(h.maturityValue.paise) })}` : ''}
            </p>
          )}
          {h.kind === 'ppf' && !h.maturityDate && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('{rate}% a year', { rate: h.ratePct })} · {t('add your first deposit')}</p>}
          {h.kind === 'epf' && (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {h.epfRate.declared ? t('{rate}% a year (EPFO, {fy})', { rate: h.epfRate.pct, fy: h.epfRate.fy }) : t('{rate}% a year (latest EPFO rate; {fy}’s isn’t declared yet)', { rate: h.epfRate.pct, fy: h.epfRate.fy })}
              {h.lastPassbook ? ` · ${t('passbook {amount} on {date}', { amount: formatINR(h.lastPassbook.balance.paise), date: formatDay(h.lastPassbook.date) })}` : ` · ${t('add your passbook balance')}`}
            </p>
          )}
        </div>
        <p className="tabular shrink-0 text-right text-heading font-semibold">{formatINR(h.value.paise)}</p>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label={t('Invested')}>{formatINR(h.invested.paise)}</Metric>
        <Metric label={t('Gain')}><span className={gainTone(h.gain.paise)}>{signed(h.gain.paise)}</span></Metric>
        <Metric label={t('Gain %')}><span className={gainTone(h.gain.paise)}>{pct(h.gainPct)}</span></Metric>
        <Metric label={t('XIRR (a year)')}>{h.xirr === null ? <span className="text-slate-400" title={t('Shown once the first money went in at least 30 days ago')}>—</span> : pct(h.xirr)}</Metric>
      </div>
      {h.kind === 'ppf' && h.deposits.length > 0 && (
        <div className="mt-3 space-y-2 text-xs text-slate-500 dark:text-slate-400">
          <p>{t('{credited} interest credited so far; {accrued} earned this year, credited on 31 March.', { credited: formatINR(h.interestCredited.paise), accrued: formatINR(h.accrued.paise) })}</p>
          <ProgressBar percent={(h.thisYear.deposited.paise / h.thisYear.limit.paise) * 100} label={t('Deposited this financial year')} />
          <p>{t('{amount} of {limit} deposited this financial year.', { amount: formatINR(h.thisYear.deposited.paise), limit: formatINR(h.thisYear.limit.paise) })}</p>
        </div>
      )}
      {h.kind === 'epf' && h.interestEstimated.paise > 0 && (
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{t('{amount} of the value is interest Spendwise estimated since your last passbook balance; update the balance when EPFO credits it.', { amount: formatINR(h.interestEstimated.paise) })}</p>
      )}
      {h.sip?.active && (
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          {h.sip.catchingUp ? t('Buying past instalments at their NAVs… {n} done so far.', { n: h.sip.count })
            : `${tn(h.sip.count, '{n} instalment bought. Next on {date}', '{n} instalments bought. Next on {date}', { date: formatDay(h.sip.nextDate) })}${h.sip.pending ? ` ${t('(waiting for AMFI’s NAV)')}` : ''}.`}
        </p>
      )}
      {market && h.realised.paise !== 0 && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{t('Realised on sales: {amount}.', { amount: signed(h.realised.paise) })}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        {market && <Button size="sm" onClick={() => act('buy', h)}><Plus className="h-4 w-4" aria-hidden="true" /> {t('Buy')}</Button>}
        {market && h.units > 0 && <Button size="sm" variant="secondary" onClick={() => act('sell', h)}>{t('Sell')}</Button>}
        {h.kind === 'mf' && <Button size="sm" variant="secondary" onClick={() => act('sip', h)}><Repeat className="h-4 w-4" aria-hidden="true" /> {h.sip?.active ? t('Change SIP') : t('Start SIP')}</Button>}
        {h.kind === 'mf' && h.sip?.active && <Button size="sm" variant="ghost" onClick={() => act('stop-sip', h)}>{t('Stop SIP')}</Button>}
        {PRICED.includes(h.kind) && <Button size="sm" variant="secondary" onClick={() => act('price', h)}><Tag className="h-4 w-4" aria-hidden="true" /> {t('Update price')}</Button>}
        {h.kind === 'ppf' && <Button size="sm" onClick={() => act('deposit', h)}><Plus className="h-4 w-4" aria-hidden="true" /> {t('Deposit')}</Button>}
        {h.kind === 'epf' && <Button size="sm" onClick={() => act('deposit', h)}><Plus className="h-4 w-4" aria-hidden="true" /> {t('Contribution')}</Button>}
        {h.kind === 'epf' && <Button size="sm" variant="secondary" onClick={() => act('passbook', h)}>{t('Passbook balance')}</Button>}
        <Button size="sm" variant="ghost" onClick={() => act('edit', h)} aria-label={t('Edit {name}', { name: h.name })}><Pencil className="h-4 w-4" aria-hidden="true" /></Button>
        <Button size="sm" variant="ghost" onClick={() => act('delete', h)} aria-label={t('Delete {name}', { name: h.name })} className="hover:text-rose-600"><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
        {history.length > 0 && (
          <button type="button" className="ml-auto text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => setOpen((o) => !o)}>
            {open ? t('Hide history') : t('History ({n})', { n: history.length })}
          </button>
        )}
      </div>
      {open && (
        <ul className="mt-3 divide-y divide-slate-900/[0.06] text-sm dark:divide-white/[0.06]" aria-label={t('{name} history', { name: h.name })}>
          {market ? h.trades.map((trade) => (
            <li key={trade.id} className="flex items-center gap-3 py-2">
              <span className="w-24 shrink-0 text-xs text-slate-500 dark:text-slate-400">{formatDay(trade.date)}</span>
              <span className="min-w-0 flex-1 truncate">{trade.type === 'buy' ? (trade.sip ? 'SIP' : t('Bought')) : t('Sold')} {unitsFmt.format(trade.units)} @ {priceFmt.format(trade.price)}</span>
              <span className={cx('tabular font-medium', trade.type === 'sell' && 'text-emerald-600 dark:text-emerald-400')}>{formatINR(trade.amount.paise)}</span>
              <Button size="sm" variant="ghost" onClick={() => act('delete-trade', h, trade)} aria-label={trade.type === 'buy' ? t('Remove purchase on {date}', { date: formatDay(trade.date) }) : t('Remove sale on {date}', { date: formatDay(trade.date) })}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /></Button>
            </li>
          )) : h.deposits.map((d) => (
            <li key={d.id} className="flex items-center gap-3 py-2">
              <span className="w-24 shrink-0 text-xs text-slate-500 dark:text-slate-400">{formatDay(d.date)}</span>
              <span className="min-w-0 flex-1 truncate">{d.passbook ? t('Passbook balance') : d.amount.paise > 0 ? (h.kind === 'epf' ? t('Contribution') : t('Deposit')) : t('Withdrawal')}</span>
              <span className="tabular font-medium">{formatINR(Math.abs((d.passbook ? d.balance : d.amount).paise))}</span>
              <Button size="sm" variant="ghost" onClick={() => act(d.passbook ? 'delete-passbook' : 'delete-deposit', h, d)} aria-label={t('Remove entry on {date}', { date: formatDay(d.date) })}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /></Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Holdings({ onAdd }) {
  const [poll, setPoll] = useState(false);
  const { data, error, refetch } = useInvestments({ poll });
  const mutate = usePlanMutation('investments', { money: true });
  const [dialog, setDialog] = useState(null); // { kind, h, item }
  // While a SIP's past instalments are being bought, check back every 2 seconds.
  const catchingUp = Boolean(data?.holdings.some((h) => h.sip?.catchingUp));
  useEffect(() => { setPoll(catchingUp); }, [catchingUp]);
  const act = (kind, h, item) => setDialog({ kind, h, item });
  const close = () => setDialog(null);
  async function run(method, path, done) {
    close();
    try { await mutate.mutateAsync({ method, path }); toast.success(done); } catch (err) { toast.error(err.message); }
  }
  if (error) return <ErrorNote error={error} onRetry={refetch} />;
  if (!data) return <Skeleton className="h-60 w-full" />;
  const s = data.summary;
  const groups = Object.keys(GROUP_LABEL).map((k) => ({ kind: k, label: GROUP_LABEL[k], items: data.holdings.filter((h) => h.kind === k && !h.closed) })).filter((g) => g.items.length);
  const closed = data.holdings.filter((h) => h.closed);
  const d = dialog;
  return (
    <>
      {data.navError && <div className="mb-4"><ErrorNote error={{ message: t('Fund values use your last purchase prices for now: {error}', { error: data.navError }) }} /></div>}
      {data.holdings.length === 0 ? (
        <Card><EmptyState icon={TrendingUp} title={t('No investments yet')} action={<Button onClick={onAdd}>{t('Add an investment')}</Button>}>{t('Mutual funds with AMFI’s daily NAVs, SIPs, stocks, gold, FDs, RDs, PPF, EPF and NPS: see what you put in, what it’s worth and your yearly return.')}</EmptyState></Card>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-6">
            <Stat className="col-span-2 sm:col-span-3" label={t('Current value')} value={formatINR(s.value.paise)} />
            <Stat className="sm:col-span-3" label={t('Invested')} value={formatINR(s.invested.paise)} />
            <Stat className="sm:col-span-2" label={t('Gain')} value={<span className={gainTone(s.gain.paise)}>{signed(s.gain.paise)}</span>} hint={pct(s.gainPct)} />
            <Stat className="sm:col-span-2" label={t('XIRR (a year)')} value={s.xirr === null ? '—' : pct(s.xirr)} hint={t('Counts when each rupee went in')} />
            <Stat className="sm:col-span-2" label={t('SIPs a month')} value={formatINR(s.sipMonthly.paise)} />
          </div>
          <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card className="min-w-0">
              <CardHeader title={t('Where it is')} subtitle={t('Share of current value')} />
              {s.allocation.length ? (
                <ul className="space-y-3">
                  {s.allocation.map((a) => (
                    <li key={a.kind}>
                      <div className="mb-1 flex justify-between gap-2 text-sm"><span>{a.label}</span><span className="tabular text-slate-600 dark:text-slate-400">{formatINR(a.value.paise)} · {a.pct.toFixed(1)}%</span></div>
                      <ProgressBar percent={a.pct} label={`${a.label}: ${a.pct.toFixed(1)}%`} />
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-slate-500 dark:text-slate-400">{t('Nothing is worth anything yet: add a purchase or deposit.')}</p>}
            </Card>
            <Card className="min-w-0">
              <CardHeader title={t('Maturing soon')} subtitle={t('FDs, RDs and PPF in the next 90 days')} />
              {s.maturing.length ? (
                <ul className="divide-y divide-slate-900/[0.06] text-sm dark:divide-white/[0.06]">
                  {s.maturing.map((m) => (
                    <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                      <CalendarClock className="h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate">{m.name}</span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">{m.daysToMaturity === 0 ? t('today') : tn(m.daysToMaturity, 'in {n} day', 'in {n} days')} · {formatDay(m.maturityDate)}</span>
                      <span className="tabular font-medium">{formatINR(m.value.paise)}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-slate-500 dark:text-slate-400">{t('Nothing matures in the next 90 days. You’ll get a reminder a week before anything does.')}</p>}
            </Card>
          </div>
          {groups.map((g) => (
            <section key={g.kind} className="mb-6" aria-label={g.label}>
              <h2 className="mb-2 text-sm font-semibold text-slate-500 dark:text-slate-400">{g.label}</h2>
              <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">{g.items.map((h) => <HoldingCard key={h.id} h={h} act={act} />)}</div>
            </section>
          ))}
          {closed.length > 0 && <p className="text-sm text-slate-500 dark:text-slate-400">{t('Closed (not in the totals): {list}.', { list: closed.map((h) => h.name).join(', ') })}</p>}
          <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">{t('Fund NAVs: {source}. FD, RD and PPF values are worked out from their rate and dates; stock and gold prices are the ones you enter. Not investment advice.', { source: data.navSource })}</p>
        </>
      )}
      <Modal open={Boolean(d && ['buy', 'sell'].includes(d.kind))} onClose={close} title={d?.kind === 'sell' ? t('Sell {name}', { name: d?.h.name }) : t('Buy {name}', { name: d?.h.name })}>
        {d && ['buy', 'sell'].includes(d.kind) && <TradeForm key={`${d.h.id}-${d.kind}`} holding={d.h} type={d.kind} onDone={close} />}
      </Modal>
      <Modal open={d?.kind === 'sip'} onClose={close} title={t('Monthly SIP')}>{d?.kind === 'sip' && <SipForm holding={d.h} onDone={close} />}</Modal>
      <Modal open={d?.kind === 'deposit'} onClose={close} title={d?.h.name ?? ''}>{d?.kind === 'deposit' && <DepositForm holding={d.h} onDone={close} />}</Modal>
      <Modal open={d?.kind === 'passbook'} onClose={close} title={t('Passbook balance: {name}', { name: d?.h.name })}>{d?.kind === 'passbook' && <PassbookForm holding={d.h} onDone={close} />}</Modal>
      <Modal open={d?.kind === 'price'} onClose={close} title={t('Price of {name}', { name: d?.h.name })}>{d?.kind === 'price' && <PriceForm holding={d.h} onDone={close} />}</Modal>
      <Modal open={d?.kind === 'edit'} onClose={close} title={t('Edit investment')}>{d?.kind === 'edit' && <HoldingForm holding={d.h} onDone={close} />}</Modal>
      <ConfirmDialog open={d?.kind === 'delete'} title={t('Delete this investment?')} confirmLabel={t('Delete')} danger onClose={close} onConfirm={() => run('DELETE', `/investments/${d.h.id}`, t('Investment deleted'))}>
        {d?.kind === 'delete' && t('“{name}” and its history will be removed. Expense entries recorded with purchases stay in your transactions.', { name: d.h.name })}
      </ConfirmDialog>
      <ConfirmDialog open={d?.kind === 'stop-sip'} title={t('Stop this SIP?')} confirmLabel={t('Stop SIP')} onClose={close} onConfirm={() => run('DELETE', `/investments/${d.h.id}/sip`, t('SIP stopped'))}>
        {t('No more instalments will be bought. Units already bought stay.')}
      </ConfirmDialog>
      <ConfirmDialog open={d?.kind === 'delete-trade'} title={t('Remove this entry?')} confirmLabel={t('Remove')} danger onClose={close} onConfirm={() => run('DELETE', `/investments/${d.h.id}/trades/${d.item.id}`, t('Removed'))}>
        {d?.kind === 'delete-trade' && (d.item.type === 'buy'
          ? (d.item.transactionId ? t('The purchase on {date} and the expense recorded with it will be removed.', { date: formatDay(d.item.date) }) : t('The purchase on {date} will be removed.', { date: formatDay(d.item.date) }))
          : t('The sale on {date} will be removed.', { date: formatDay(d.item.date) }))}
      </ConfirmDialog>
      <ConfirmDialog open={d?.kind === 'delete-deposit'} title={t('Remove this entry?')} confirmLabel={t('Remove')} danger onClose={close} onConfirm={() => run('DELETE', `/investments/${d.h.id}/deposits/${d.item.id}`, t('Removed'))}>
        {t('Interest is worked out again without it.')}
      </ConfirmDialog>
      <ConfirmDialog open={d?.kind === 'delete-passbook'} title={t('Remove this entry?')} confirmLabel={t('Remove')} danger onClose={close} onConfirm={() => run('DELETE', `/investments/${d.h.id}/passbook/${d.item.id}`, t('Removed'))}>
        {t('The value is worked out again from the passbook balance before it.')}
      </ConfirmDialog>
    </>
  );
}

const SOURCE_NOTE = { snapshot: t('stored at month end'), 'worked-out': t('worked out'), live: t('today') };

function NetWorth() {
  const [months, setMonths] = useState(12);
  const { data, error, refetch } = useNetWorth(months);
  if (error) return <ErrorNote error={error} onRetry={refetch} />;
  if (!data) return <Skeleton className="h-72 w-full" />;
  const rows = data.months;
  const latest = rows.at(-1);
  const first = rows[0];
  return (
    <div className="space-y-4">
      <Card className="min-w-0">
        <CardHeader title={t('Net worth, month by month')} subtitle={t('Accounts + investments − loans, at each month end')}
          action={<Segmented size="sm" label={t('Months shown')} value={String(months)} onChange={(v) => setMonths(Number(v))} options={[{ value: '6', label: '6m' }, { value: '12', label: '1y' }, { value: '36', label: '3y' }]} />} />
        {rows.length ? (
          <>
            <p className="tabular mb-3 text-title font-semibold">{formatINR(latest.netWorth.paise)}
              {rows.length > 1 && <span className={cx('ml-2 text-sm font-medium', gainTone(latest.netWorth.paise - first.netWorth.paise))}>{t('{amount} since {month}', { amount: signed(latest.netWorth.paise - first.netWorth.paise), month: formatMonth(first.month) })}</span>}
            </p>
            <NetWorthChart rows={rows.map((r) => ({ month: r.month, accounts: r.accounts.rupees, investments: r.investments.rupees, netWorth: r.netWorth.rupees }))} />
          </>
        ) : <p className="text-sm text-slate-500 dark:text-slate-400">{t('Add accounts, entries or investments to see your net worth over time.')}</p>}
      </Card>
      {rows.length > 0 && (
        <Card className="min-w-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr className="text-left text-xs text-slate-500 dark:text-slate-400"><th className="py-2 font-medium">{t('Month')}</th><th className="py-2 text-right font-medium">{t('Accounts')}</th><th className="py-2 text-right font-medium">{t('Investments')}</th><th className="py-2 text-right font-medium">{t('Loans')}</th><th className="py-2 text-right font-medium">{t('Net worth')}</th></tr></thead>
              <tbody className="divide-y divide-slate-900/[0.05] dark:divide-white/[0.05]">
                {[...rows].reverse().map((r) => (
                  <tr key={r.month}>
                    <td className="py-2">{formatMonth(r.month)}</td>
                    <td className="tabular py-2 text-right">{formatINR(r.accounts.paise)}</td>
                    <td className="tabular py-2 text-right">{formatINR(r.investments.paise)} <span className="text-xs text-slate-400">({SOURCE_NOTE[r.source]})</span></td>
                    <td className="tabular py-2 text-right">{r.loans.paise ? `−${formatINR(r.loans.paise)}` : '—'}</td>
                    <td className="tabular py-2 text-right font-medium">{formatINR(r.netWorth.paise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{t('Account balances come from your entries. Investments are the value stored at each month end from the time Spendwise tracks them; earlier months are worked out from deposits’ terms and the last NAV or price known then.')}</p>
        </Card>
      )}
    </div>
  );
}

const TABS = [{ value: 'holdings', label: t('Holdings'), icon: Coins }, { value: 'net-worth', label: t('Net worth'), icon: TrendingUp }];

export default function Investments() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'net-worth' ? 'net-worth' : 'holdings';
  const [adding, setAdding] = useState(false);
  return (
    <>
      <PageHeader title={t('Investments')} subtitle={t('Funds, SIPs, stocks, gold, deposits and PPF: what you put in, what it’s worth, and your net worth over time.')}
        actions={<Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" aria-hidden="true" /> {t('Add investment')}</Button>} />
      <Tabs className="mb-6" label={t('Investments section')} value={tab} onChange={(v) => setParams(v === 'holdings' ? {} : { tab: v }, { replace: true })} options={TABS} />
      {tab === 'holdings' ? <Holdings onAdd={() => setAdding(true)} /> : <NetWorth />}
      <Modal open={adding} onClose={() => setAdding(false)} title={t('Add investment')}>{adding && <HoldingForm onDone={() => setAdding(false)} />}</Modal>
    </>
  );
}

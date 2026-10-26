import { useId, useState } from 'react';
import toast from 'react-hot-toast';
import { useAccounts, useCategories, useCurrencies, useFxRate, useSaveTransaction, useTags, useTrips } from '../hooks/api.js';
import { api, spaceStore } from '../lib/api.js';
import { newClientRef, offlineSupported, queueEntry } from '../lib/offline.js';
import { ReceiptScanButton } from './ReceiptScan.jsx';
import { formatINR, formatMoney } from '../lib/format.js';
import { compressImage, uploadReceipt } from './Receipt.jsx';
import { useSpace } from '../context/SpaceContext.jsx';
import { today } from '../lib/dates.js';
import { PAYMENT_METHODS, catLabel } from '../lib/labels.js';
import { t } from '../lib/i18n.js';
import { Modal } from './Modal.jsx';
import { Button, ErrorNote, Field, Input, Segmented, Select, Textarea, cx } from './ui.jsx';

const AMOUNT_RE = /^\d+(\.\d{1,2})?$/;

// Client-side checks that mirror the API's, so most mistakes show instantly.
export function amountProblem(value) {
  const s = String(value).trim().replace(/,/g, '');
  if (!s) return t('Amount is required');
  if (!AMOUNT_RE.test(s)) return t('Enter an amount like 250 or 1,250.50');
  if (Number(s) <= 0) return t('Amount must be more than ₹0');
  if (Number(s) > 10_000_000) return t('Amount must be at most ₹1,00,00,000');
  return null;
}

const chip = (active) => cx('inline-flex h-7 items-center rounded-full px-3 text-caption font-medium ring-1 ring-inset transition-colors duration-150',
  active
    ? 'bg-slate-900 text-white ring-slate-900 dark:bg-white dark:text-slate-900 dark:ring-white'
    : 'bg-white text-slate-600 ring-slate-900/10 hover:bg-slate-50 hover:text-slate-900 dark:bg-white/[0.03] dark:text-slate-300 dark:ring-white/10 dark:hover:bg-white/[0.06]');

// Category text box with suggestions (the defaults plus the space's own), and one-tap chips.
export function CategoryInput({ id, type, value, onChange, error }) {
  const { data } = useCategories();
  const suggestions = data ? [...data.defaults[type], ...data.custom[type]] : [];
  const listId = `${id}-list`;
  return (
    <>
      <Input id={id} list={listId} value={value} onChange={(e) => onChange(e.target.value)} error={error} maxLength={40}
        placeholder={type === 'income' ? t('e.g. Salary') : t('e.g. Groceries')} autoComplete="off" />
      <datalist id={listId}>{suggestions.map((c) => <option key={c} value={c} />)}</datalist>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {suggestions.slice(0, 8).map((c) => (
          <button key={c} type="button" onClick={() => onChange(c)} className={chip(value === c)}>{catLabel(c)}</button>
        ))}
      </div>
    </>
  );
}

// UPI / Card / Cash / Net banking / Other; tapping the selected one clears it (it's optional).
export function PaymentMethodPicker({ value, onChange }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('Payment method')}>
      {PAYMENT_METHODS.map((m) => (
        <button key={m.value} type="button" role="radio" aria-checked={value === m.value}
          onClick={() => onChange(value === m.value ? null : m.value)} className={chip(value === m.value)}>
          {m.label}
        </button>
      ))}
    </div>
  );
}

// Active accounts of the current space (plus one already chosen, even if it's archived now).
export function AccountSelect({ id, value, onChange, error, exclude }) {
  const { data } = useAccounts({ includeArchived: true });
  const options = (data?.accounts ?? []).filter((a) => (!a.archived || a.id === value) && a.id !== exclude);
  return (
    <Select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)} error={error}>
      {!value && <option value="">{t('Choose an account')}</option>}
      {options.map((a) => <option key={a.id} value={a.id}>{a.name}{a.archived ? ` (${t('archived')})` : ''}</option>)}
    </Select>
  );
}

// Tags as chips: type and press Enter (or comma); suggestions come from tags already used in this space.
export function TagInput({ id, value, onChange }) {
  const { data } = useTags();
  const [text, setText] = useState('');
  const add = (raw) => {
    const tag = raw.trim().toLowerCase().replace(/^#/, '').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
    if (tag && !value.includes(tag) && value.length < 10) onChange([...value, tag]);
    setText('');
  };
  return (
    <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg bg-white px-2 py-1.5 shadow-xs ring-1 ring-inset ring-slate-900/12 focus-within:ring-2 focus-within:ring-indigo-500 dark:bg-slate-900 dark:ring-white/10">
      {value.map((tag) => (
        <span key={tag} className="inline-flex items-center gap-1 rounded-md bg-indigo-500/10 px-2 py-0.5 text-caption font-medium text-indigo-700 dark:bg-indigo-400/12 dark:text-indigo-300">
          #{tag}
          <button type="button" onClick={() => onChange(value.filter((x) => x !== tag))} aria-label={t('Remove tag {tag}', { tag })} className="hover:text-rose-600">×</button>
        </span>
      ))}
      <input id={id} list={`${id}-list`} value={text} onChange={(e) => setText(e.target.value)} placeholder={value.length ? '' : t('Add a tag')}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(text); } else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1)); }}
        onBlur={() => text && add(text)} className="min-w-[6rem] flex-1 bg-transparent text-sm outline-none" />
      <datalist id={`${id}-list`}>{(data?.tags ?? []).map((x) => <option key={x.tag} value={x.tag} />)}</datalist>
    </div>
  );
}

function SplitEditor({ id, type, parts, onChange, error, total, currency }) {
  const { data } = useCategories();
  const suggestions = data ? [...data.defaults[type], ...data.custom[type]] : [];
  const toMinor = (v) => Math.round(Number(String(v).replace(/,/g, '')) * 100) || 0;
  const left = toMinor(total) - parts.reduce((s, p) => s + toMinor(p.amount), 0);
  const setPart = (i, key, v) => onChange(parts.map((p, j) => (j === i ? { ...p, [key]: v } : p)));
  const fmt = (minor) => (currency === 'INR' ? formatINR(minor) : formatMoney(minor / 100, currency));
  return (
    <Field label={t('Split across categories')} error={error}
      hint={left === 0 ? t('The parts add up to the total.') : left > 0 ? t('{amount} still to assign', { amount: fmt(left) }) : t('{amount} more than the total', { amount: fmt(-left) })}>
      <div className="space-y-2">
        {parts.map((p, i) => (
          <div key={i} className="flex gap-2">
            <Input list={`${id}-split-cats`} value={p.category} onChange={(e) => setPart(i, 'category', e.target.value)} placeholder={t('Category')} aria-label={t('Part {n} category', { n: i + 1 })} className="flex-1" />
            <Input inputMode="decimal" value={p.amount} onChange={(e) => setPart(i, 'amount', e.target.value)} placeholder="0.00" aria-label={t('Part {n} amount', { n: i + 1 })} className="w-28" />
            {parts.length > 2 && <Button variant="ghost" size="icon" onClick={() => onChange(parts.filter((_, j) => j !== i))} aria-label={t('Remove part {n}', { n: i + 1 })}>×</Button>}
          </div>
        ))}
        <datalist id={`${id}-split-cats`}>{suggestions.map((c) => <option key={c} value={c} />)}</datalist>
        {parts.length < 10 && (
          <button type="button" onClick={() => onChange([...parts, { category: '', amount: left > 0 ? String(left / 100) : '' }])}
            className="text-caption font-medium text-indigo-600 hover:underline dark:text-indigo-400">{t('+ Add a part')}</button>
        )}
      </div>
    </Field>
  );
}

function CurrencySelect({ id, value, onChange }) {
  const { data, error } = useCurrencies(true);
  if (error) return <p className="text-sm text-rose-600 dark:text-rose-400">{error.message}</p>;
  return (
    <Select id={id} aria-label={t('Currency')} value={value} onChange={(e) => onChange(e.target.value)} className="max-w-xs">
      {Object.entries(data?.currencies ?? { [value]: value }).map(([code, name]) => <option key={code} value={code}>{code} · {name}</option>)}
    </Select>
  );
}

// "≈ ₹1,186.63 at ₹94.93 per USD (ECB rate of 20 Oct 2026)".
function FxPreview({ currency, date, amount }) {
  const { data, error, isFetching } = useFxRate(currency, date);
  if (error) return <span className="text-rose-600 dark:text-rose-400">{error.message}</span>;
  if (!data) return <span>{isFetching ? t('Getting the exchange rate…') : ' '}</span>;
  const minor = Math.round(Number(String(amount).replace(/,/g, '')) * 100);
  const rate = t('₹{rate} per {currency} (ECB rate of {date})', { rate: data.rate, currency, date: data.rateDate });
  return <span>{minor > 0 ? t('≈ {amount} at {rate}', { amount: formatINR(Math.round(minor * data.rate)), rate }) : rate}</span>;
}

function FormBody({ transaction, defaults, onDone }) {
  const uid = useId();
  const save = useSaveTransaction();
  const { space } = useSpace();
  const editing = Boolean(transaction);
  // One per new entry, so a retry (or the offline queue) can't add it twice.
  const [clientRef] = useState(newClientRef);
  const [form, setForm] = useState(() => ({
    type: transaction?.type ?? defaults?.type ?? 'expense',
    amount: transaction ? String(transaction.amount) : defaults?.amount ?? '',
    category: (transaction?.splits ? '' : transaction?.category) ?? defaults?.category ?? '',
    date: transaction?.date ?? defaults?.date ?? today(),
    note: transaction?.note ?? defaults?.note ?? '',
    account: transaction?.account ?? defaults?.account ?? space?.defaultAccount ?? '',
    toAccount: transaction?.toAccount ?? defaults?.toAccount ?? '',
    paymentMethod: transaction?.paymentMethod ?? defaults?.paymentMethod ?? null,
    tags: transaction?.tags ?? defaults?.tags ?? [],
    time: transaction?.time ?? defaults?.time ?? '',
    merchant: transaction?.merchant ?? defaults?.merchant ?? '',
    worth: transaction?.worth ?? null,
    tds: transaction?.tdsPaise ? String(transaction.tdsPaise / 100) : '',
    splitOn: Boolean(transaction?.splits),
    splits: transaction?.splits?.map((s) => ({ category: s.category, amount: String(s.amount) })) ?? [{ category: '', amount: '' }, { category: '', amount: '' }],
    foreign: Boolean(transaction?.original),
    currency: transaction?.original?.currency ?? 'USD',
    originalAmount: transaction?.original ? String(transaction.original.amount) : '',
    receiptFile: defaults?.receiptFile ?? null,
    removeReceipt: false,
  }));
  const [errors, setErrors] = useState({});
  const [failure, setFailure] = useState(null);
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const transfer = form.type === 'transfer';
  // A new entry gets the running trip's tag (visible, and removable).
  const trips = useTrips();
  const tripTag = trips.data?.trips.find((t) => t.active)?.tag;
  const [tripApplied, setTripApplied] = useState(false);
  if (!editing && tripTag && !tripApplied) {
    setTripApplied(true);
    if (!form.tags.includes(tripTag)) setForm((f) => ({ ...f, tags: [...f.tags, tripTag] }));
  }

  // An existing transfer stays a transfer, and income/expense can't become one.
  const typeOptions = editing
    ? (transfer ? [{ value: 'transfer', label: t('Transfer') }] : [{ value: 'expense', label: t('Expense') }, { value: 'income', label: t('Income') }])
    : [{ value: 'expense', label: t('Expense') }, { value: 'income', label: t('Income') }, { value: 'transfer', label: t('Transfer') }];

  async function submit(e) {
    e.preventDefault();
    setFailure(null);
    const local = {};
    const foreign = !transfer && form.foreign;
    const amount = amountProblem(foreign ? form.originalAmount : form.amount);
    if (amount) local[foreign ? 'originalAmount' : 'amount'] = amount;
    const splitOn = !transfer && form.splitOn;
    if (splitOn) {
      const total = Math.round(Number((foreign ? form.originalAmount : form.amount).replace(/,/g, '')) * 100);
      const parts = form.splits.map((s) => Math.round(Number(s.amount.replace(/,/g, '')) * 100));
      if (form.splits.some((s) => !s.category.trim() || amountProblem(s.amount))) local.splits = t('Each part needs a category and an amount');
      else if (parts.reduce((a, b) => a + b, 0) !== total) local.splits = t('The parts must add up to the total');
    } else if (!transfer && !form.category.trim()) local.category = t('Pick or type a category');
    if (!form.account) local.account = t('Choose an account');
    if (transfer && !form.toAccount) local.toAccount = t('Choose where the money went');
    if (transfer && form.toAccount && form.toAccount === form.account) local.toAccount = t('Pick two different accounts');
    if (form.type === 'income' && form.tds.trim()) {
      const p = amountProblem(form.tds.trim().replace(/,/g, ''));
      if (p) local.tds = p;
      else if (!foreign && Number(form.tds.replace(/,/g, '')) > Number(form.amount.replace(/,/g, ''))) local.tds = t('TDS can’t be more than the amount');
    }
    if (!form.date) local.date = t('Date is required');
    else if (form.date > today()) local.date = t('Date cannot be in the future');
    setErrors(local);
    if (Object.keys(local).length) return;

    const clean = (v) => v.trim().replace(/,/g, '');
    const body = {
      type: form.type,
      date: form.date,
      note: form.note.trim(),
      account: form.account,
      tags: form.tags,
      time: form.time || null,
      ...(foreign ? { currency: form.currency, originalAmount: clean(form.originalAmount) } : { amount: clean(form.amount) }),
      ...(transfer ? { toAccount: form.toAccount } : { paymentMethod: form.paymentMethod, merchant: form.merchant.trim() || null }),
      ...(form.type === 'expense' ? { worth: form.worth } : {}),
      ...(form.type === 'income' ? { tds: form.tds.trim() ? clean(form.tds) : null } : {}),
      ...(!transfer && (splitOn
        ? { splits: form.splits.map((s) => ({ category: s.category.trim(), amount: clean(s.amount) })) }
        : { category: form.category.trim(), ...(editing && transaction.splits ? { splits: null } : {}) })),
    };
    try {
      const { transaction: saved } = await save.mutateAsync({ id: transaction?.id, ...body, ...(!editing && { clientRef }) });
      if (form.receiptFile) {
        try {
          await uploadReceipt(saved.id, await compressImage(form.receiptFile));
        } catch (err) {
          toast.error(t('Saved, but the receipt didn’t upload: {error}', { error: err.message }));
        }
      } else if (form.removeReceipt) {
        await api(`/transactions/${saved.id}/receipt`, { method: 'DELETE' }).catch(() => {});
      }
      if (saved.pending) toast.success(t('Sent to the owner for approval. It counts once they approve it.'), { duration: 6000 });
      else toast.success(editing ? t('Changes saved') : { income: t('Income added'), expense: t('Expense added'), transfer: t('Transfer added') }[form.type]);
      onDone();
    } catch (err) {
      // No connection: a new entry waits on this device and is sent when the app is back online.
      if (err.code === 'network' && !editing && offlineSupported()) {
        try {
          await queueEntry({ ...body, clientRef }, spaceStore.get());
          toast.success(form.receiptFile ? t('No connection: saved on this phone without the photo. It’ll be added when you’re back online.') : t('No connection: saved on this phone. It’ll be added when you’re back online.'), { duration: 6000 });
          onDone();
          return;
        } catch { /* fall through to the error */ }
      }
      setErrors(err.fieldErrors?.() ?? {});
      if (!err.details?.length) setFailure(err);
    }
  }

  return (
    <form id={`${uid}-form`} onSubmit={submit} className="space-y-4" noValidate>
      {failure && <ErrorNote error={failure} />}
      <div className="[&>div[role=radiogroup]]:flex [&>div[role=radiogroup]]:w-full [&>div[role=radiogroup]>button]:flex-1">
        <Segmented label={t('Type')} value={form.type} onChange={(v) => set('type', v)} options={typeOptions} />
      </div>
      {!editing && form.type === 'expense' && (
        <ReceiptScanButton onUse={(r) => setForm((f) => ({
          ...f, receiptFile: r.file, ...(r.amount && { amount: r.amount }), ...(r.date && { date: r.date }), ...(r.merchant && { merchant: r.merchant, note: f.note || r.merchant }),
        }))} />
      )}
      {transfer && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {t('Moving money between your own accounts, like an ATM withdrawal or paying a card bill. It isn’t counted as income or spending.')}
        </p>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 [&>*:first-child]:sm:col-span-2">
        {!transfer && form.foreign ? (
          <Field label={t('Amount ({currency})', { currency: form.currency })} htmlFor={`${uid}-amount`} error={errors.originalAmount}
            hint={<FxPreview currency={form.currency} date={form.date} amount={form.originalAmount} />}>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-caption font-semibold text-slate-400">{form.currency}</span>
              <Input id={`${uid}-amount`} inputMode="decimal" value={form.originalAmount} onChange={(e) => set('originalAmount', e.target.value)}
                error={errors.originalAmount} placeholder="0.00" autoFocus className="tabular h-14 pl-12 text-[1.625rem] font-semibold tracking-[-0.02em] placeholder:font-normal placeholder:text-slate-300 dark:placeholder:text-slate-600" />
            </div>
          </Field>
        ) : (
          <Field label={t('Amount (₹)')} htmlFor={`${uid}-amount`} error={errors.amount}>
            <div className="relative">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-heading font-medium text-slate-400" aria-hidden="true">₹</span>
              <Input id={`${uid}-amount`} inputMode="decimal" value={form.amount} onChange={(e) => set('amount', e.target.value)}
                error={errors.amount} placeholder="0.00" autoFocus className="tabular h-14 pl-9 text-[1.625rem] font-semibold tracking-[-0.02em] placeholder:font-normal placeholder:text-slate-300 dark:placeholder:text-slate-600" />
            </div>
          </Field>
        )}
        <Field label={t('Date')} htmlFor={`${uid}-date`} error={errors.date}>
          <Input id={`${uid}-date`} type="date" value={form.date} max={today()} onChange={(e) => set('date', e.target.value)} error={errors.date} />
        </Field>
        <Field label={transfer ? t('From') : form.type === 'income' ? t('Received in') : t('Paid from')} htmlFor={`${uid}-account`} error={errors.account}>
          <AccountSelect id={`${uid}-account`} value={form.account} onChange={(v) => set('account', v)} error={errors.account} />
        </Field>
        {transfer && (
          <Field label={t('To')} htmlFor={`${uid}-to`} error={errors.toAccount}>
            <AccountSelect id={`${uid}-to`} value={form.toAccount} onChange={(v) => set('toAccount', v)} error={errors.toAccount} exclude={form.account} />
          </Field>
        )}
      </div>
      {!transfer && (
        <>
          {form.splitOn ? (
            <SplitEditor id={uid} type={form.type} parts={form.splits} onChange={(v) => set('splits', v)} error={errors.splits}
              total={form.foreign ? form.originalAmount : form.amount} currency={form.foreign ? form.currency : 'INR'} />
          ) : (
            <Field label={t('Category')} htmlFor={`${uid}-category`} error={errors.category}>
              <CategoryInput id={`${uid}-category`} type={form.type} value={form.category} onChange={(v) => set('category', v)} error={errors.category} />
            </Field>
          )}
          <button type="button" onClick={() => set('splitOn', !form.splitOn)} className="-mt-2 text-caption font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            {form.splitOn ? t('Use one category') : t('Split across categories (e.g. one Big Bazaar bill)')}
          </button>
          <Field label={t('Paid with (optional)')} error={errors.paymentMethod}>
            <PaymentMethodPicker value={form.paymentMethod} onChange={(v) => set('paymentMethod', v)} />
          </Field>
        </>
      )}
      <Field label={t('Note (optional)')} htmlFor={`${uid}-note`} error={errors.note}>
        <Textarea id={`${uid}-note`} rows={2} maxLength={500} value={form.note} onChange={(e) => set('note', e.target.value)}
          placeholder={transfer ? t('e.g. ATM withdrawal') : t('What was it for?')} />
      </Field>
      <details className="group rounded-xl bg-slate-900/[0.03] ring-1 ring-inset ring-slate-900/[0.05] dark:bg-white/[0.03] dark:ring-white/[0.06]" open={Boolean(form.tags.length || form.time || form.foreign || transaction?.hasReceipt || form.merchant || form.worth || form.tds)}>
        <summary className="flex cursor-pointer select-none list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-slate-700 [&::-webkit-details-marker]:hidden dark:text-slate-300">
          {t('More: tags, time, merchant, currency, receipt, worth it?')}
          <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
        </summary>
        <div className="space-y-4 px-4 pb-4 pt-1">
          <Field label={t('Tags')} htmlFor={`${uid}-tags`} error={errors.tags} hint={t('Press Enter after each, e.g. office or trip-goa.')}>
            <TagInput id={`${uid}-tags`} value={form.tags} onChange={(v) => set('tags', v)} />
          </Field>
          <Field label={t('Time (optional)')} htmlFor={`${uid}-time`} error={errors.time} className="max-w-[12rem]">
            <Input id={`${uid}-time`} type="time" value={form.time} onChange={(e) => set('time', e.target.value)} />
          </Field>
          {!transfer && (
            <Field label={t('Merchant (optional)')} htmlFor={`${uid}-merchant`} error={errors.merchant} hint={t('Where you paid, for the merchant view in Insights.')}>
              <Input id={`${uid}-merchant`} value={form.merchant} onChange={(e) => set('merchant', e.target.value)} maxLength={60} placeholder={t('e.g. Swiggy')} />
            </Field>
          )}
          {form.type === 'income' && (
            <Field label={t('TDS deducted (₹, optional)')} htmlFor={`${uid}-tds`} error={errors.tds} hint={t('Tax deducted at source, e.g. by your bank on interest or by a client. It adds up under Tax & planning.')} className="max-w-xs">
              <Input id={`${uid}-tds`} inputMode="decimal" value={form.tds} onChange={(e) => set('tds', e.target.value)} error={errors.tds} />
            </Field>
          )}
          {form.type === 'expense' && (
            <div className="space-y-1.5">
              <p id={`${uid}-worth`} className="text-sm font-medium">{t('Was it worth it? (optional)')}</p>
              <div role="radiogroup" aria-labelledby={`${uid}-worth`} className="flex flex-wrap gap-1.5">
                {[['yes', t('Worth it')], ['meh', t('Meh')], ['no', t('Not worth it')]].map(([v, label]) => (
                  <button key={v} type="button" role="radio" aria-checked={form.worth === v} onClick={() => set('worth', form.worth === v ? null : v)}
                    className={chip(form.worth === v)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {!transfer && (
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.foreign} onChange={(e) => set('foreign', e.target.checked)} className="h-4 w-4 rounded border-slate-300 accent-indigo-600" />
                {t('Paid in another currency')}
              </label>
              {form.foreign && <CurrencySelect id={`${uid}-cur`} value={form.currency} onChange={(v) => set('currency', v)} />}
            </div>
          )}
          <Field label={t('Receipt photo (optional)')} htmlFor={`${uid}-receipt`} error={errors.receipt}
            hint={transaction?.hasReceipt && !form.removeReceipt ? t('This entry has a receipt. Choosing a new photo replaces it.') : t('Compressed on your device before uploading.')}>
            <input id={`${uid}-receipt`} type="file" accept="image/*" capture="environment" onChange={(e) => set('receiptFile', e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-slate-500 file:mr-3 file:h-8 file:cursor-pointer file:rounded-lg file:border-0 file:bg-white file:px-3 file:text-sm file:font-medium file:text-slate-800 file:shadow-xs file:ring-1 file:ring-slate-900/10 dark:text-slate-400 dark:file:bg-slate-800 dark:file:text-slate-100" />
          </Field>
          {transaction?.hasReceipt && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.removeReceipt} onChange={(e) => set('removeReceipt', e.target.checked)} className="h-4 w-4 rounded border-slate-300 accent-indigo-600" />
              {t('Remove the attached receipt')}
            </label>
          )}
        </div>
      </details>
      <div className="sticky -bottom-5 z-10 -mx-5 -mb-5 flex justify-end gap-2 border-t border-slate-900/[0.06] bg-white/95 px-5 py-3 backdrop-blur sm:-bottom-6 sm:-mx-6 sm:-mb-6 sm:px-6 dark:border-white/[0.06] dark:bg-slate-900/95">
        <Button variant="secondary" onClick={onDone}>{t('Cancel')}</Button>
        <Button type="submit" loading={save.isPending} className="min-w-24">{editing ? t('Save changes') : t('Add')}</Button>
      </div>
    </form>
  );
}

// Add (no `transaction`) or edit a transaction. `defaults` can preset { type, account } for a new one.
// The form remounts each time it opens, so it starts fresh.
export default function TransactionForm({ open, onClose, transaction, defaults }) {
  return (
    <Modal open={open} onClose={onClose} title={transaction ? t('Edit transaction') : t('Add transaction')}>
      {open && <FormBody key={transaction?.id ?? `new-${JSON.stringify(defaults ?? {})}`} transaction={transaction} defaults={defaults} onDone={onClose} />}
    </Modal>
  );
}

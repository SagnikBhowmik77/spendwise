// Batch 12M: capital gains, interest and TDS, and rent receipts, shown under Tax & planning.
import { useState } from 'react';
import { Link } from 'react-router';
import toast from 'react-hot-toast';
import { AlertTriangle, Download, Info, Pencil, Plus, Trash2 } from 'lucide-react';
import { useCapitalGains, useInterestTds, usePlanMutation, useRentProfile, useRentReceipts, useTaxRules } from '../hooks/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { download } from '../lib/api.js';
import { formatDay, formatINR, formatMonth } from '../lib/format.js';
import { today } from '../lib/dates.js';
import { k, t, tn } from '../lib/i18n.js';
import { amountProblem } from './TransactionForm.jsx';
import { ConfirmDialog, Modal } from './Modal.jsx';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorNote, Field, Input, Select, Skeleton, cx } from './ui.jsx';

const rupees = (s) => String(s).trim().replace(/,/g, '');
const Loading = ({ q, h = 'h-32' }) => (q.error ? <ErrorNote error={q.error} onRetry={q.refetch} /> : <Skeleton className={`${h} w-full`} />);
const Estimate = ({ children }) => (
  <p className="flex items-start gap-1.5 text-xs text-slate-500 dark:text-slate-400"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span>{children}</span></p>
);
const Warning = ({ children }) => (
  <div role="alert" className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-100">
    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><div className="min-w-0 flex-1 space-y-2">{children}</div>
  </div>
);

// ───────────── Capital gains ─────────────

export const TAX_CLASS_LABEL = {
  equity: k('Equity (shares, equity funds)'), debt: k('Debt fund'), listed: k('Other listed (ETFs, bonds)'), other: k('Other (gold, fund of funds…)'),
};
const BUCKETS = [
  ['stcgEquity', k('Short-term: shares and equity funds')],
  ['ltcgEquity', k('Long-term: shares and equity funds')],
  ['ltcgOther', k('Long-term: other assets')],
  ['stcgSlab', k('Short-term at your slab rate')],
];
const SLABS = [0, 5, 10, 15, 20, 25, 30];

export function CapitalGains() {
  const [fy, setFy] = useState(null);
  const [slab, setSlab] = useState('');
  const q = useCapitalGains({ ...(fy && { fy }), ...(slab !== '' && { slabPct: slab }) });
  const save = usePlanMutation('investments');
  const [open, setOpen] = useState(null);
  const r = q.data;
  if (!r) return <Loading q={q} />;
  const tt = r.totals;
  const rate = { stcgEquity: `${r.rates.stcgEquity}%`, ltcgEquity: `${r.rates.ltcgEquity}%`, ltcgOther: `${r.rates.ltcgOther}%`, stcgSlab: slab === '' ? t('your slab rate') : `${slab}%` };
  const section = { stcgEquity: r.sections.stcgEquity, ltcgEquity: r.sections.ltcgEquity, ltcgOther: r.sections.ltcgOther, stcgSlab: r.sections.specifiedFund };
  const setClass = async (id, taxClass) => {
    try { await save.mutateAsync({ method: 'PATCH', path: `/investments/${id}`, body: { taxClass } }); toast.success(t('Saved')); } catch (err) { toast.error(err.message); }
  };
  const w = r.warnings;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <Field label={t('Year')} htmlFor="cg-fy" className="w-44">
          <Select id="cg-fy" value={r.fy} onChange={(e) => setFy(e.target.value)}>{r.years.map((y) => <option key={y} value={y}>{y}</option>)}</Select>
        </Field>
        <Field label={t('Your income-tax slab rate')} htmlFor="cg-slab" className="w-52" hint={t('For gains taxed at your slab rate.')}>
          <Select id="cg-slab" value={slab} onChange={(e) => setSlab(e.target.value)}>
            <option value="">{t('Not set')}</option>
            {SLABS.map((s) => <option key={s} value={s}>{s}%</option>)}
          </Select>
        </Field>
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-400">{t('Sales from {from} to {to}, from the purchases and sales recorded under Investments · {law}.', { from: formatDay(r.from), to: formatDay(r.to), law: r.law })}</p>

      {w.needsClass.length > 0 && (
        <Warning>
          <p className="font-medium">{t('Choose how these are taxed. Their AMFI category doesn’t settle it, so they aren’t counted yet.')}</p>
          {w.needsClass.map((h) => (
            <div key={h.id} className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1">{h.name}{h.category ? <span className="text-xs opacity-75"> · {h.category}</span> : null}</span>
              <Select aria-label={t('How {name} is taxed', { name: h.name })} value="" onChange={(e) => e.target.value && setClass(h.id, e.target.value)} className="w-56!">
                <option value="">{t('Choose…')}</option>
                {Object.entries(TAX_CLASS_LABEL).map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
              </Select>
            </div>
          ))}
        </Warning>
      )}
      {w.needsFmv.length > 0 && (
        <Warning>
          <p>{t('These have units bought before February 2018. Enter their value per unit on 31 January 2018 under Investments (Edit), or the gain is worked out from what you paid: {list}.', { list: w.needsFmv.map((h) => h.name).join(', ') })}</p>
          <Link to="/investments" className="font-medium underline">{t('Go to Investments')}</Link>
        </Warning>
      )}
      {w.unmatched.length > 0 && (
        <Warning><p>{t('Some sales are more units than the purchases recorded before them, so part of each has no cost: {list}. Add the missing purchases.', { list: w.unmatched.map((u) => `${u.name} (${formatDay(u.date)})`).join(', ') })}</p></Warning>
      )}
      {w.fmvUnavailable.length > 0 && <Warning><p>{t('AMFI couldn’t be reached for the 31 January 2018 NAV of: {list}. Try again later.', { list: w.fmvUnavailable.map((h) => h.name).join(', ') })}</p></Warning>}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {BUCKETS.map(([key, label]) => (
          <Card key={key}>
            <CardHeader title={t(label)} subtitle={`${section[key]} · ${rate[key]}`} />
            <p className={cx('tabular text-xl font-semibold', tt.net[key].paise < 0 && 'text-rose-600 dark:text-rose-400')}>{formatINR(tt.net[key].paise)}</p>
            {tt.gross[key].paise !== tt.net[key].paise && <p className="text-xs text-slate-500 dark:text-slate-400">{t('{amount} before losses were set off', { amount: formatINR(tt.gross[key].paise) })}</p>}
            {key === 'ltcgEquity' && <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{t('{used} of the {limit} exemption used; {taxable} taxable.', { used: formatINR(tt.exemptionUsed.paise), limit: formatINR(tt.exemption.paise), taxable: formatINR(tt.taxable.ltcgEquity.paise) })}</p>}
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader title={t('Estimated tax on these gains')} subtitle={t('Before surcharge (at most {pct}% on this income)', { pct: r.surchargeCapPct })} />
        <dl className="max-w-md space-y-1 text-sm">
          {BUCKETS.map(([key, label]) => (
            <div key={key} className="flex justify-between gap-4"><dt className="text-slate-600 dark:text-slate-400">{t(label)}</dt><dd className="tabular">{tt.tax[key] ? formatINR(tt.tax[key].paise) : t('pick your slab rate')}</dd></div>
          ))}
          <div className="flex justify-between gap-4"><dt className="text-slate-600 dark:text-slate-400">{t('{pct}% health and education cess', { pct: r.cessPct })}</dt><dd className="tabular">{formatINR(tt.cess.paise)}</dd></div>
          <div className="flex justify-between gap-4 border-t border-slate-900/[0.06] pt-1 font-semibold dark:border-white/[0.06]"><dt>{t('Total')}</dt><dd className="tabular">{formatINR(tt.total.paise)}</dd></div>
        </dl>
        {(tt.carryForward.shortTerm.paise > 0 || tt.carryForward.longTerm.paise > 0) && (
          <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">{t('Losses left to carry forward (declare them in your return to use them later): short-term {st}, long-term {lt}.', { st: formatINR(tt.carryForward.shortTerm.paise), lt: formatINR(tt.carryForward.longTerm.paise) })}</p>
        )}
      </Card>

      <Card>
        <CardHeader title={t('Sales this year')} subtitle={t('Each sale is matched with the oldest units first')} />
        {r.sales.length ? (
          <ul className="-my-3 divide-y divide-slate-900/[0.05] dark:divide-white/[0.05]">
            {r.sales.map((s, i) => (
              <li key={`${s.holdingId}-${s.date}-${i}`} className="py-3 text-sm">
                <button type="button" className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-left" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
                  <span className="min-w-0 flex-1"><span className="font-medium">{s.name}</span> <span className="text-xs text-slate-500 dark:text-slate-400">{formatDay(s.date)} · {tn(s.units, '{n} unit', '{n} units')} · {s.taxClass ? t(TAX_CLASS_LABEL[s.taxClass]) : t('not counted yet')}</span></span>
                  <span className="tabular text-slate-500 dark:text-slate-400">{formatINR(s.proceeds.paise)}</span>
                  <span className={cx('tabular w-28 text-right font-semibold', s.gain.paise >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>{s.gain.paise >= 0 ? '+' : '−'}{formatINR(Math.abs(s.gain.paise))}</span>
                </button>
                {open === i && (
                  <ul className="mt-2 space-y-1 rounded-lg bg-slate-50 p-2 text-xs dark:bg-slate-800/50">
                    {s.lots.map((l, j) => (
                      <li key={j} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        {l.term && <Badge tone={l.term === 'long' ? 'indigo' : 'slate'}>{l.term === 'long' ? t('Long-term') : t('Short-term')}</Badge>}
                        <span className="min-w-0 flex-1">{t('{units} units bought {date}: cost {cost}, sold for {proceeds}', { units: l.units, date: formatDay(l.bought), cost: formatINR(l.cost.paise), proceeds: formatINR(l.proceeds.paise) })}
                          {l.grandfathered && ` ${t('(cost from the 31 Jan 2018 value; paid {paid})', { paid: formatINR(l.paid.paise) })}`}</span>
                        <span className="tabular font-medium">{formatINR(l.gain.paise)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        ) : <EmptyState title={t('No sales in this year')}>{t('Record sales under Investments (a fund, stock or gold holding → Sell) and the gains show up here.')}</EmptyState>}
      </Card>
      <Estimate>{t('An estimate from the sales you recorded, matched first in, first out. Surcharge and losses carried in from earlier years aren’t included. Check with Form 26AS / AIS and your broker’s or fund house’s capital gains statement before filing.')} {t('Sources: {list}.', { list: r.sources.join('; ') })}</Estimate>
    </div>
  );
}

// ───────────── Interest and TDS ─────────────

const TDS_KIND = { interest: k('Interest'), salary: k('Salary'), rent: k('Rent'), professional: k('Professional fees'), other: k('Other') };

function TdsForm({ record, onDone }) {
  const save = usePlanMutation('tax-records');
  const [f, setF] = useState({
    date: record?.date ?? today(), deductor: record?.deductor ?? '', kind: record?.kind ?? 'interest',
    income: record?.income ? String(record.income.rupees) : '', tds: record ? String(record.tds.rupees) : '', note: record?.note ?? '',
  });
  const [errors, setErrors] = useState({});
  const set = (key) => (e) => setF({ ...f, [key]: e.target.value });
  async function submit(e) {
    e.preventDefault();
    const local = {};
    if (!f.deductor.trim()) local.deductor = t('Who deducted it?');
    if (amountProblem(rupees(f.tds))) local.tds = amountProblem(rupees(f.tds));
    if (f.income.trim() && amountProblem(rupees(f.income))) local.income = amountProblem(rupees(f.income));
    setErrors(local);
    if (Object.keys(local).length) return;
    const body = { date: f.date, deductor: f.deductor.trim(), kind: f.kind, tds: rupees(f.tds), income: f.income.trim() ? rupees(f.income) : null, note: f.note.trim() };
    try {
      if (record) await save.mutateAsync({ method: 'PATCH', path: `/tax/tds/${record.id}`, body });
      else await save.mutateAsync({ path: '/tax/tds', body });
      toast.success(record ? t('TDS updated') : t('TDS added'));
      onDone();
    } catch (err) {
      setErrors({ ...err.fieldErrors(), form: err.details.length ? undefined : err.message });
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {errors.form && <ErrorNote error={{ message: errors.form }} />}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('Deducted by')} htmlFor="tds-who" error={errors.deductor}><Input id="tds-who" value={f.deductor} onChange={set('deductor')} maxLength={80} placeholder={t('e.g. SBI, your employer, a client')} autoFocus /></Field>
        <Field label={t('On')} htmlFor="tds-kind"><Select id="tds-kind" value={f.kind} onChange={set('kind')}>{Object.entries(TDS_KIND).map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}</Select></Field>
        <Field label={t('Income it was deducted from (₹, optional)')} htmlFor="tds-income" error={errors.income}><Input id="tds-income" inputMode="decimal" value={f.income} onChange={set('income')} /></Field>
        <Field label={t('TDS (₹)')} htmlFor="tds-amount" error={errors.tds}><Input id="tds-amount" inputMode="decimal" value={f.tds} onChange={set('tds')} /></Field>
        <Field label={t('Date')} htmlFor="tds-date" error={errors.date}><Input id="tds-date" type="date" max={today()} value={f.date} onChange={set('date')} /></Field>
        <Field label={t('Note (optional)')} htmlFor="tds-note"><Input id="tds-note" value={f.note} onChange={set('note')} maxLength={200} placeholder={t('e.g. Form 16A for Q3')} /></Field>
      </div>
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onDone}>{t('Cancel')}</Button><Button type="submit" loading={save.isPending}>{record ? t('Save') : t('Add TDS')}</Button></div>
    </form>
  );
}

export function InterestTds() {
  const base = useTaxRules();
  const [fy, setFy] = useState(null);
  const year = fy ?? base.data?.fy;
  const q = useInterestTds(year);
  const remove = usePlanMutation('tax-records');
  const [form, setForm] = useState(null); // { record? }
  const [deleting, setDeleting] = useState(null);
  if (!base.data) return <Loading q={base} />;
  const r = q.data;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <Field label={t('Year')} htmlFor="int-fy" className="w-44">
          <Select id="int-fy" value={year} onChange={(e) => setFy(e.target.value)}>{base.data.years.map((y) => <option key={y} value={y}>{y}</option>)}</Select>
        </Field>
        <Button onClick={() => setForm({})}><Plus className="h-4 w-4" aria-hidden="true" /> {t('Add TDS')}</Button>
      </div>
      {!r ? <Loading q={q} /> : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title={t('Interest income')} subtitle={t('Taxed at your slab rate')} />
            <p className="tabular text-title font-semibold">{formatINR(r.interest.total.paise)}</p>
            <h3 className="mt-4 mb-1 text-sm font-semibold">{t('Interest entries')} <span className="font-normal text-slate-500 dark:text-slate-400">{formatINR(r.interest.entriesTotal.paise)}</span></h3>
            {r.interest.entries.length ? (
              <ul className="space-y-1 text-sm">
                {r.interest.entries.map((e) => <li key={e.id} className="flex justify-between gap-3"><span className="min-w-0 truncate">{formatDay(e.date)} · {e.merchant || e.note || t('Interest')}</span><span className="tabular">{formatINR(e.amount.paise)}</span></li>)}
              </ul>
            ) : <p className="text-sm text-slate-500 dark:text-slate-400">{t('Add savings or FD interest as income in the Interest category.')}</p>}
            <h3 className="mt-4 mb-1 text-sm font-semibold">{t('Earned on FDs and RDs')} <span className="font-normal text-slate-500 dark:text-slate-400">{formatINR(r.interest.depositsTotal.paise)}</span></h3>
            {r.interest.deposits.length ? (
              <ul className="space-y-1 text-sm">
                {r.interest.deposits.map((d) => <li key={d.id} className="flex justify-between gap-3"><span className="min-w-0 truncate">{d.name}</span><span className="tabular">{formatINR(d.interest.paise)}</span></li>)}
              </ul>
            ) : <p className="text-sm text-slate-500 dark:text-slate-400">{t('No cumulative FDs or RDs earning in this year.')}</p>}
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{t('Worked out from each deposit’s rate, up to {date}.', { date: formatDay(r.interest.depositsUntil) })}</p>
          </Card>
          <Card>
            <CardHeader title={t('Tax deducted at source (TDS)')} subtitle={t('Claimed back in your return')} />
            <p className="tabular text-title font-semibold">{formatINR(r.tds.total.paise)}</p>
            {Object.keys(r.tds.byKind).length > 0 && (
              <p className="mt-1 flex flex-wrap gap-1.5">{Object.entries(r.tds.byKind).map(([kind, m]) => <Badge key={kind} tone="slate">{t(TDS_KIND[kind])}: {formatINR(m.paise)}</Badge>)}</p>
            )}
            {r.tds.fromEntries.length + r.tds.records.length ? (
              <ul className="mt-3 divide-y divide-slate-900/[0.06] text-sm dark:divide-white/[0.06]">
                {r.tds.fromEntries.map((x) => (
                  <li key={`e-${x.id}`} className="flex items-center gap-3 py-2">
                    <span className="min-w-0 flex-1"><span className="block truncate">{x.deductor}</span><span className="block text-xs text-slate-500 dark:text-slate-400">{formatDay(x.date)} · {t(TDS_KIND[x.kind])} · {t('from an income entry')}</span></span>
                    <span className="tabular">{formatINR(x.tds.paise)}</span>
                  </li>
                ))}
                {r.tds.records.map((x) => (
                  <li key={x.id} className="flex items-center gap-2 py-2">
                    <span className="min-w-0 flex-1"><span className="block truncate">{x.deductor}</span><span className="block text-xs text-slate-500 dark:text-slate-400">{formatDay(x.date)} · {t(TDS_KIND[x.kind])}{x.income ? ` · ${t('on {amount}', { amount: formatINR(x.income.paise) })}` : ''}{x.note ? ` · ${x.note}` : ''}</span></span>
                    <span className="tabular">{formatINR(x.tds.paise)}</span>
                    <Button variant="ghost" size="icon" aria-label={t('Edit {name}', { name: x.deductor })} onClick={() => setForm({ record: x })}><Pencil className="h-4 w-4" aria-hidden="true" /></Button>
                    <Button variant="ghost" size="icon" aria-label={t('Delete {name}', { name: x.deductor })} className="hover:text-rose-600" onClick={() => setDeleting(x)}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">{t('Add TDS on an income entry (under More), or here from Form 16 / 16A / 26AS.')}</p>}
          </Card>
        </div>
      )}
      {r && <Estimate>{t('Interest from FDs and RDs is worked out from their rate, as it accrues in the year (payout FDs are left out: record their payments as Interest entries). Match TDS with Form 26AS / AIS before filing.')}</Estimate>}
      <Modal open={form !== null} onClose={() => setForm(null)} title={form?.record ? t('Edit TDS') : t('Add TDS')}>
        {form && <TdsForm key={form.record?.id ?? 'new'} record={form.record} onDone={() => setForm(null)} />}
      </Modal>
      <ConfirmDialog open={deleting !== null} title={t('Delete this TDS record?')} confirmLabel={t('Delete')} danger onClose={() => setDeleting(null)}
        onConfirm={async () => { const x = deleting; setDeleting(null); try { await remove.mutateAsync({ method: 'DELETE', path: `/tax/tds/${x.id}` }); toast.success(t('Deleted')); } catch (err) { toast.error(err.message); } }}>
        {deleting && t('{name}, {amount}.', { name: deleting.deductor, amount: formatINR(deleting.tds.paise) })}
      </ConfirmDialog>
    </div>
  );
}

// ───────────── Rent receipts ─────────────

function LandlordForm({ initial, onSaved }) {
  const { user } = useAuth();
  const save = usePlanMutation('tax-records');
  const [f, setF] = useState({
    tenantName: initial?.tenantName ?? user.name, landlordName: initial?.landlordName ?? '',
    landlordPan: initial?.landlordPan ?? '', propertyAddress: initial?.propertyAddress ?? '',
  });
  const [errors, setErrors] = useState({});
  const set = (key) => (e) => setF({ ...f, [key]: e.target.value });
  async function submit(e) {
    e.preventDefault();
    try {
      await save.mutateAsync({ method: 'PUT', path: '/tax/rent-profile', body: { ...f, landlordPan: f.landlordPan.trim() || null } });
      setErrors({});
      toast.success(t('Details saved'));
      onSaved?.();
    } catch (err) {
      setErrors({ ...err.fieldErrors(), form: err.details.length ? undefined : err.message });
    }
  }
  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      {errors.form && <ErrorNote error={{ message: errors.form }} />}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t('Your name (tenant)')} htmlFor="rr-tenant" error={errors.tenantName}><Input id="rr-tenant" value={f.tenantName} onChange={set('tenantName')} maxLength={80} /></Field>
        <Field label={t('Landlord’s name')} htmlFor="rr-landlord" error={errors.landlordName}><Input id="rr-landlord" value={f.landlordName} onChange={set('landlordName')} maxLength={80} /></Field>
        <Field label={t('Landlord’s PAN')} htmlFor="rr-pan" error={errors.landlordPan} hint={t('Needed when the year’s rent is over ₹1,00,000.')}><Input id="rr-pan" value={f.landlordPan} onChange={set('landlordPan')} maxLength={10} placeholder="ABCDE1234F" className="uppercase" /></Field>
        <Field label={t('Address of the rented home')} htmlFor="rr-address" error={errors.propertyAddress}><Input id="rr-address" value={f.propertyAddress} onChange={set('propertyAddress')} maxLength={300} /></Field>
      </div>
      <Button type="submit" variant="secondary" loading={save.isPending}>{t('Save details')}</Button>
    </form>
  );
}

export function RentReceipts({ fy, open, onClose }) {
  const profile = useRentProfile();
  const rec = useRentReceipts(open ? fy : null);
  const [busy, setBusy] = useState(false);
  const r = rec.data;
  async function get() {
    setBusy(true);
    try { await download('/tax/rent-receipts.pdf', { fy }); } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title={t('Rent receipts for {fy}', { fy })} size="lg">
      <div className="space-y-5">
        <p className="text-sm text-slate-600 dark:text-slate-400">{t('One receipt for each month you paid rent, made from your expenses in the Rent category (or tagged #rent), for your landlord to sign. Receipts are in English.')}</p>
        {/* Filled from the saved details once; saving doesn't reset what's being typed. */}
        {profile.data ? <LandlordForm initial={profile.data.profile} onSaved={() => rec.refetch()} /> : <Loading q={profile} h="h-24" />}
        <div className="border-t border-slate-900/[0.06] pt-4 dark:border-white/[0.06]">
          {!r ? <Loading q={rec} h="h-16" /> : r.months.length ? (
            <>
              <ul className="grid gap-1 text-sm sm:grid-cols-2">
                {r.months.map((m) => <li key={m.month} className="flex justify-between gap-3 rounded bg-slate-50 px-2 py-1 dark:bg-slate-800/50"><span>{formatMonth(m.month)}</span><span className="tabular">{formatINR(m.amount.paise)}</span></li>)}
              </ul>
              <p className="mt-2 text-sm font-medium">{t('{n} months, {amount} in all', { n: r.months.length, amount: formatINR(r.total.paise) })}</p>
              {r.panRequired && !r.profile?.landlordPan && <div className="mt-2"><Warning><p>{t('Rent this year is over ₹1,00,000, so the landlord’s PAN is needed for an HRA claim. Add it above.')}</p></Warning></div>}
            </>
          ) : <p className="text-sm text-slate-500 dark:text-slate-400">{t('No rent paid in {fy} yet. Add rent as an expense in the Rent category.', { fy })}</p>}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>{t('Close')}</Button>
          <Button onClick={get} loading={busy} disabled={!r?.ready}><Download className="h-4 w-4" aria-hidden="true" /> {t('Download receipts (PDF)')}</Button>
        </div>
      </div>
    </Modal>
  );
}

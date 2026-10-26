import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import toast from 'react-hot-toast';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { useAfford, useCashflow, useSalaryBreakdown, useTaxRules, useTaxSummary } from '../hooks/api.js';
import { formatDay, formatDayShort, formatINR } from '../lib/format.js';
import { today } from '../lib/dates.js';
import { amountProblem } from '../components/TransactionForm.jsx';
import { BalanceLine } from '../components/charts.jsx';
import { Badge, Button, Card, CardHeader, ErrorNote, Field, Input, PageHeader, ProgressBar, Segmented, Select, Skeleton, cx, Tabs } from '../components/ui.jsx';
import { t, tn, tr } from '../lib/i18n.js';
import { CapitalGains, InterestTds, RentReceipts } from '../components/TaxFiling.jsx';
import { Fire } from '../components/Life.jsx';

const TABS = [
  { value: 'tax', label: t('Tax helper') }, { value: 'gains', label: t('Capital gains') }, { value: 'interest', label: t('Interest & TDS') },
  { value: 'salary', label: t('Salary') }, { value: 'cashflow', label: t('Cash flow') }, { value: 'afford', label: t('Can I afford it?') },
  { value: 'fire', label: t('FIRE') },
];
const rupees = (s) => String(s).trim().replace(/,/g, '');
const Loading = ({ q, h = 'h-32' }) => (q.error ? <ErrorNote error={q.error} onRetry={q.refetch} /> : <Skeleton className={`${h} w-full`} />);
const Estimate = ({ children }) => (
  <p className="flex items-start gap-1.5 text-xs text-slate-500 dark:text-slate-400"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span>{children}</span></p>
);

// ───────────── Tax helper ─────────────

const BUCKETS = [
  ['investments', t('Investments'), t('PPF, ELSS, EPF, life insurance, home loan principal, tuition fees and the like')],
  ['healthSelf', t('Health insurance: you and family'), t('Premiums, health check-ups (up to ₹5,000) and, for senior citizens without insurance, medical bills')],
  ['healthParents', t('Health insurance: parents'), t('Premiums and check-ups for your parents')],
];

function TaxHelper() {
  const base = useTaxRules();
  const [fy, setFy] = useState(null);
  const [selfSenior, setSelfSenior] = useState(false);
  const [parentsSenior, setParentsSenior] = useState(false);
  const [receipts, setReceipts] = useState(false);
  const year = fy ?? base.data?.fy;
  const rules = useTaxRules(year);
  const q = useTaxSummary(year ? { fy: year, selfSenior, parentsSenior } : undefined);
  const s = q.data;
  if (!base.data) return <Loading q={base} />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <Field label={t('Year')} htmlFor="tax-fy" className="w-44">
          <Select id="tax-fy" value={year} onChange={(e) => setFy(e.target.value)}>{base.data.years.map((y) => <option key={y} value={y}>{y}</option>)}</Select>
        </Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={selfSenior} onChange={(e) => setSelfSenior(e.target.checked)} />{t('I’m 60 or older')}</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={parentsSenior} onChange={(e) => setParentsSenior(e.target.checked)} />{t('A parent I pay for is 60 or older')}</label>
      </div>
      {!s ? <Loading q={q} /> : (
        <>
          <p className="text-sm text-slate-600 dark:text-slate-400">{s.label} · {s.law}. {t('Tag an expense with the tag shown on each card and it counts here.')}</p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {BUCKETS.map(([key, title, hint]) => {
              const b = s.buckets[key];
              const section = key === 'investments' ? s.sections.investments : s.sections.health;
              return (
                <Card key={key}>
                  <CardHeader title={title} subtitle={section} />
                  <p className="tabular text-xl font-semibold">{formatINR(b.used.paise)} <span className="text-sm font-normal text-slate-500 dark:text-slate-400">{t('of {amount}', { amount: formatINR(b.limit.paise) })}</span></p>
                  <div className="my-2"><ProgressBar percent={b.percent} status={b.percent >= 100 ? 'ok' : 'warning'} label={t('{name}: {pct}% of the limit used', { name: title, pct: b.percent })} /></div>
                  <p className="text-sm text-slate-600 dark:text-slate-400">{b.remaining.paise > 0 ? t('{amount} more would still count.', { amount: formatINR(b.remaining.paise) }) : t('Limit reached for this year.')}</p>
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{hint}.</p>
                  <p className="mt-2 flex flex-wrap gap-1">{b.tags.slice(0, 1).map((g) => <Link key={g} to={`/transactions?tag=${g}&preset=custom&from=${s.from}&to=${s.to}`} className="rounded-full bg-indigo-50 px-2 text-xs text-indigo-700 hover:underline dark:bg-indigo-500/15 dark:text-indigo-300">#{g} ({b.count})</Link>)}</p>
                </Card>
              );
            })}
            <Card>
              <CardHeader title={t('Rent paid')} subtitle={t('For HRA: {section}', { section: s.sections.hra })} />
              <p className="tabular text-xl font-semibold">{formatINR(s.buckets.rent.used.paise)}</p>
              <p className="text-sm text-slate-600 dark:text-slate-400">{tn(s.buckets.rent.months, '{n} month recorded this year.', '{n} months recorded this year.')}</p>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{t('Use it in the Salary tab to estimate your HRA exemption. Without HRA, {section} may apply.', { section: s.sections.rentWithoutHra })}</p>
              <p className="mt-2"><Link to={`/transactions?category=Rent&preset=custom&from=${s.from}&to=${s.to}`} className="rounded-full bg-indigo-50 px-2 text-xs text-indigo-700 hover:underline dark:bg-indigo-500/15 dark:text-indigo-300">{t('Rent entries ({n})', { n: s.buckets.rent.count })}</Link></p>
              <Button variant="secondary" size="sm" className="mt-3" onClick={() => setReceipts(true)}>{t('Rent receipts')}</Button>
            </Card>
          </div>
          <Estimate>{s.note} {t('Sources: {list}.', { list: rules.data?.sources.join('; ') })}</Estimate>
        </>
      )}
      {year && <RentReceipts fy={year} open={receipts} onClose={() => setReceipts(false)} />}
    </div>
  );
}

// ───────────── Salary breakdown ─────────────

function RegimeColumn({ name, r, better }) {
  return (
    <Card className={cx(better && 'ring-2 ring-emerald-400 dark:ring-emerald-500/60')}>
      <CardHeader title={name} action={better && <Badge tone="green">{t('Lower tax')}</Badge>} />
      <p className="tabular text-title font-semibold">{formatINR(r.monthlyTakeHome.paise)}<span className="text-sm font-normal text-slate-500 dark:text-slate-400"> {t('a month in hand')}</span></p>
      <dl className="mt-3 space-y-1 text-sm">
        {Object.entries(r.deductions).filter(([, v]) => v.paise).map(([k, v]) => (
          <div key={k} className="flex justify-between text-slate-600 dark:text-slate-400"><dt>{{ standardDeduction: t('Standard deduction'), hra: t('HRA exempt ({pct}% rule)', { pct: r.hraPct }), professionalTax: t('Professional tax'), investments: t('Investments'), health: t('Health insurance') }[k]}</dt><dd className="tabular">−{formatINR(v.paise)}</dd></div>
        ))}
        <div className="flex justify-between border-t border-slate-900/[0.06] pt-1 font-medium dark:border-white/[0.06]"><dt>{t('Taxable income')}</dt><dd className="tabular">{formatINR(r.taxable.paise)}</dd></div>
        {r.tax.slabs.map((p) => <div key={p.rate} className="flex justify-between text-xs text-slate-500 dark:text-slate-400"><dt>{t('{rate}% on {amount}', { rate: p.rate, amount: formatINR(p.to.paise - p.from.paise) })}</dt><dd className="tabular">{formatINR(p.tax.paise)}</dd></div>)}
        {r.tax.rebate.paise > 0 && <div className="flex justify-between text-slate-600 dark:text-slate-400"><dt>{t('Rebate')}</dt><dd className="tabular">−{formatINR(r.tax.rebate.paise)}</dd></div>}
        {r.tax.surcharge.paise > 0 && <div className="flex justify-between text-slate-600 dark:text-slate-400"><dt>{t('Surcharge')}</dt><dd className="tabular">{formatINR(r.tax.surcharge.paise)}</dd></div>}
        <div className="flex justify-between text-slate-600 dark:text-slate-400"><dt>{t('4% health and education cess')}</dt><dd className="tabular">{formatINR(r.tax.cess.paise)}</dd></div>
        <div className="flex justify-between border-t border-slate-900/[0.06] pt-1 font-semibold dark:border-white/[0.06]"><dt>{t('Tax for the year')}</dt><dd className="tabular">{formatINR(r.tax.total.paise)} ({r.tax.effectiveRate}%)</dd></div>
      </dl>
    </Card>
  );
}

function Salary() {
  const rules = useTaxRules();
  const calc = useSalaryBreakdown();
  const [f, setF] = useState({ ctc: '', basicPct: '40', pf: 'capped', gratuityInCtc: false, professionalTax: '2500', rentPaid: '', city: '', age: 'below60', investments: '', healthSelf: '', healthParents: '', selfSenior: false, parentsSenior: false });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const r = calc.data;
  async function submit(e) {
    e.preventDefault();
    const bad = amountProblem(rupees(f.ctc));
    if (bad) { toast.error(`CTC: ${bad}`); return; }
    const n = (v) => rupees(v || '0');
    try {
      await calc.mutateAsync({ ...f, ctc: rupees(f.ctc), basicPct: Number(f.basicPct), professionalTax: n(f.professionalTax), rentPaid: n(f.rentPaid), investments: n(f.investments), healthSelf: n(f.healthSelf), healthParents: n(f.healthParents) });
    } catch (err) { toast.error(err.details?.[0] ? `${err.details[0].field}: ${err.details[0].message}` : err.message); }
  }
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
      <Card className="lg:col-span-2">
        <CardHeader title={t('Your salary')} subtitle={rules.data ? rules.data.label : undefined} />
        <form onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2" noValidate>
          <Field label={t('CTC a year (₹)')} htmlFor="s-ctc"><Input id="s-ctc" inputMode="decimal" value={f.ctc} onChange={set('ctc')} placeholder="1500000" /></Field>
          <Field label={t('Basic (% of CTC)')} htmlFor="s-basic"><Input id="s-basic" inputMode="numeric" value={f.basicPct} onChange={set('basicPct')} /></Field>
          <Field label={t('Provident fund')} htmlFor="s-pf"><Select id="s-pf" value={f.pf} onChange={set('pf')}><option value="capped">{t('12% up to ₹1,800 a month')}</option><option value="full">{t('12% of full basic')}</option><option value="none">{t('No PF')}</option></Select></Field>
          <Field label={t('Professional tax a year (₹)')} htmlFor="s-pt" hint={t('Depends on your state; ₹2,500 in many.')}><Input id="s-pt" inputMode="decimal" value={f.professionalTax} onChange={set('professionalTax')} /></Field>
          <Field label={t('Rent paid a year (₹)')} htmlFor="s-rent"><Input id="s-rent" inputMode="decimal" value={f.rentPaid} onChange={set('rentPaid')} placeholder="0" /></Field>
          <Field label={t('City')} htmlFor="s-city"><Select id="s-city" value={f.city} onChange={set('city')}><option value="">{t('Other city')}</option>{rules.data?.hraFiftyPctCities.map((c) => <option key={c} value={c}>{c}</option>)}</Select></Field>
          <Field label={t('Other investments (₹)')} htmlFor="s-inv" hint={t('PPF, ELSS, insurance… EPF is added for you.')}><Input id="s-inv" inputMode="decimal" value={f.investments} onChange={set('investments')} placeholder="0" /></Field>
          <Field label={t('Your age')} htmlFor="s-age"><Select id="s-age" value={f.age} onChange={set('age')}><option value="below60">{t('Under 60')}</option><option value="senior">{t('60 to 79')}</option><option value="superSenior">{t('80 or older')}</option></Select></Field>
          <Field label={t('Health insurance: you (₹)')} htmlFor="s-hs"><Input id="s-hs" inputMode="decimal" value={f.healthSelf} onChange={set('healthSelf')} placeholder="0" /></Field>
          <Field label={t('Health insurance: parents (₹)')} htmlFor="s-hp"><Input id="s-hp" inputMode="decimal" value={f.healthParents} onChange={set('healthParents')} placeholder="0" /></Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={f.parentsSenior} onChange={set('parentsSenior')} />{t('Parents are 60 or older')}</label>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={f.gratuityInCtc} onChange={set('gratuityInCtc')} />{t('Gratuity is part of my CTC')}</label>
          <Button type="submit" loading={calc.isPending} className="sm:col-span-2">{t('Work it out')}</Button>
        </form>
      </Card>
      <div className="space-y-4 lg:col-span-3">
        {!r ? <Card className="flex h-full items-center justify-center p-8 text-center"><p className="max-w-xs text-sm text-slate-500 dark:text-slate-400">{t('Enter your CTC to see take-home pay and tax under both regimes.')}</p></Card> : (
          <>
            <Card>
              <p className="text-sm">{t('Gross salary {gross} a year (CTC {ctc} less employer PF {pf}{gratuity}). Basic {basic}, HRA {hra}.', { gross: formatINR(r.salary.gross.paise), ctc: formatINR(r.salary.ctc.paise), pf: formatINR(r.salary.employerPf.paise), gratuity: r.salary.gratuity.paise ? t(' and gratuity {amount}', { amount: formatINR(r.salary.gratuity.paise) }) : '', basic: formatINR(r.salary.basic.paise), hra: formatINR(r.salary.hra.paise) })}</p>
              <p className="mt-2 font-semibold text-emerald-700 dark:text-emerald-300">{r.better === 'new' ? t('The new regime saves you {amount} a year.', { amount: formatINR(r.saving.paise) }) : t('The old regime saves you {amount} a year.', { amount: formatINR(r.saving.paise) })}</p>
            </Card>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <RegimeColumn name={t('New regime (default)')} r={r.new} better={r.better === 'new'} />
              <RegimeColumn name={t('Old regime')} r={r.old} better={r.better === 'old'} />
            </div>
            <Estimate>{t('An estimate for salary income only, not tax advice: other income, employer NPS, home loan interest and other deductions aren’t included.')} {t('Sources: {list}.', { list: r.sources.join('; ') })}</Estimate>
          </>
        )}
      </div>
    </div>
  );
}

// ───────────── Cash flow ─────────────

const KIND = { income: t('Income'), recurring: t('Recurring'), bill: t('Bill'), emi: 'EMI', card: t('Card bill') };

function Cashflow() {
  const q = useCashflow(60);
  const c = q.data;
  if (!c) return <Loading q={q} h="h-64" />;
  const withEvents = c.days.filter((d) => d.events.length);
  return (
    <div className="space-y-4">
      {c.firstNegative ? (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-500/10 dark:text-rose-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{tr('Your cash and bank balance is heading below zero on <b>{date}</b>, reaching {amount} on {low}. Move money in or put off a payment before then.', { date: formatDay(c.firstNegative), amount: formatINR(c.lowest.balance.paise), low: formatDay(c.lowest.date) }, { b: (x) => <strong>{x}</strong> })}</span>
        </p>
      ) : (
        <p className="flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{t('No day below zero in the next 60 days. Lowest point: {amount} on {date}.', { amount: formatINR(c.lowest.balance.paise), date: formatDay(c.lowest.date) })}</span>
        </p>
      )}
      <Card>
        <CardHeader title={t('Cash and bank, next 60 days')} subtitle={t('From {start} today ({accounts}) to {end} on {date}', { start: formatINR(c.start.paise), accounts: c.accounts.map((a) => a.name).join(', '), end: formatINR(c.end.paise), date: formatDay(c.to) })} />
        <BalanceLine rows={c.days.map((d) => ({ date: d.date, balance: d.balance.rupees }))} />
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{t('Includes recurring entries, bills, EMIs and card bills, plus your usual day-to-day spending of {amount} a day (rent, EMIs, insurance, investments, bills and one-offs of ₹10,000 or more aren’t in that daily figure: add regular ones as bills or recurring entries so they show here). Spending on credit cards shows up when the card bill is due.', { amount: formatINR(c.perDay.paise) })}</p>
      </Card>
      <Card>
        <CardHeader title={t('Coming up')} />
        {withEvents.length ? (
          <ul className="divide-y divide-slate-900/[0.06] text-sm dark:divide-white/[0.06]">
            {withEvents.flatMap((d) => d.events.map((e, i) => (
              <li key={`${d.date}-${i}`} className="flex items-center gap-3 py-2">
                <span className="w-16 shrink-0 text-xs text-slate-500 dark:text-slate-400">{formatDayShort(d.date)}</span>
                <span className="min-w-0 flex-1 truncate">{e.name} <span className="text-xs text-slate-500 dark:text-slate-400">· {KIND[e.kind]}</span></span>
                <span className="flex shrink-0 flex-col items-end sm:flex-row sm:items-center sm:gap-3">
                  <span className={cx('tabular font-medium', e.amount.paise > 0 ? 'text-emerald-600 dark:text-emerald-400' : '')}>{e.amount.paise > 0 ? '+' : '−'}{formatINR(Math.abs(e.amount.paise))}</span>
                  <span className={cx('tabular text-right text-xs sm:w-28', d.balance.paise < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400')}>{formatINR(d.balance.paise)}</span>
                </span>
              </li>
            )))}
          </ul>
        ) : <p className="text-sm text-slate-500 dark:text-slate-400">{t('Nothing scheduled. Add bills, loans or recurring entries to see them here.')}</p>}
        {c.unknownAmounts.length > 0 && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{t('Not counted (amount varies): {list}.', { list: c.unknownAmounts.map((u) => t('{name} on {date}', { name: u.name, date: formatDayShort(u.date) })).join(', ') })}</p>}
      </Card>
    </div>
  );
}

// ───────────── Can I afford it? ─────────────

const VERDICT = {
  yes: [CheckCircle2, t('Yes, comfortably'), 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200'],
  tight: [AlertTriangle, t('Yes, but it gets tight'), 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200'],
  no: [XCircle, t('Not right now'), 'bg-rose-50 text-rose-800 dark:bg-rose-500/10 dark:text-rose-200'],
};

function Afford() {
  // From the wishlist: /plan?tab=afford&amount=15000 checks that price straight away.
  const [search] = useSearchParams();
  const preset = /^d+(.d{1,2})?$/.test(search.get('amount') ?? '') ? search.get('amount') : '';
  const [amount, setAmount] = useState(preset);
  const [date, setDate] = useState(today());
  const [params, setParams] = useState(preset ? { amount: preset, date: today() } : null);
  const q = useAfford(params);
  const a = q.data;
  function submit(e) {
    e.preventDefault();
    const bad = amountProblem(rupees(amount));
    if (bad) { toast.error(bad); return; }
    setParams({ amount: rupees(amount), date });
  }
  const V = a && VERDICT[a.verdict];
  const VerdictIcon = V?.[0];
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
      <Card className="lg:col-span-2">
        <CardHeader title={t('What do you want to buy?')} />
        <form onSubmit={submit} className="space-y-3" noValidate>
          <Field label={t('Price (₹)')} htmlFor="af-amount"><Input id="af-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="45000" /></Field>
          <Field label={t('When')} htmlFor="af-date"><Input id="af-date" type="date" min={today()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Button type="submit" loading={q.isFetching}>{t('Check')}</Button>
        </form>
      </Card>
      <Card className={cx('lg:col-span-3', !params && 'flex h-full items-center justify-center p-8 text-center')}>
        {!params ? <p className="max-w-xs text-sm text-slate-500 dark:text-slate-400">{t('Spendwise checks your cash and bank balance over the next 60 days, with everything already due, and tells you if the purchase fits.')}</p>
          : !a ? <Loading q={q} /> : (
            <div className="space-y-3 text-sm">
              <p className={cx('flex items-center gap-2 rounded-lg p-3 text-base font-semibold', V[2])}><VerdictIcon className="h-5 w-5" aria-hidden="true" />{V[1]}</p>
              <p>{tr('Buying it for {amount} on {date}, your lowest balance in the next 60 days would be <b>{low}</b> on {lowDate} (instead of {without}).', { amount: formatINR(a.amount.paise), date: formatDay(a.date), low: formatINR(a.lowestWith.balance.paise), lowDate: formatDay(a.lowestWith.date), without: formatINR(a.lowestWithout.balance.paise) }, { b: (x) => <strong className="tabular">{x}</strong> })}</p>
              <p className="text-slate-600 dark:text-slate-400">{a.verdict === 'tight' ? t('That leaves less than a month of usual day-to-day spending ({amount}) as a cushion.', { amount: formatINR(a.buffer.paise) }) : a.verdict === 'yes' ? t('You’d still keep more than a month of usual spending ({amount}) as a cushion.', { amount: formatINR(a.buffer.paise) }) : t('Your cash and bank balance would go below zero.')}</p>
              <p className="text-slate-600 dark:text-slate-400">{a.monthsToSave ? tn(a.monthsToSave, 'Saving for it instead: about {n} month at your average of {amount} saved a month.', 'Saving for it instead: about {n} months at your average of {amount} saved a month.', { amount: formatINR(a.averageMonthlySaving.paise) }) : t('Record your income to see how long saving for it would take.')}</p>
              <Estimate>{t('Based on your current balances, scheduled payments and usual spending. Not financial advice.')}</Estimate>
            </div>
          )}
      </Card>
    </div>
  );
}

export default function Plan() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((x) => x.value === params.get('tab')) ? params.get('tab') : 'tax';
  const Panel = { tax: TaxHelper, gains: CapitalGains, interest: InterestTds, salary: Salary, cashflow: Cashflow, afford: Afford, fire: Fire }[tab];
  return (
    <>
      <PageHeader title={t('Tax & planning')} subtitle={t('Tax-saving limits for the financial year, your salary under both regimes, and the weeks ahead.')} />
      <Tabs className="mb-6" label={t('Planning section')} value={tab} onChange={(v) => setParams(v === 'tax' ? {} : { tab: v }, { replace: true })} options={TABS} />
      <Panel />
    </>
  );
}

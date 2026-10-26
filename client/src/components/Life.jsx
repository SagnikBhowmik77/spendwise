// Batch 12P: vehicles (fuel, mileage, servicing), the warranty and insurance vault, credit card rewards and FIRE.
import { useId, useState } from 'react';
import toast from 'react-hot-toast';
import { Car, Fuel, Gift, Pencil, Plus, ShieldCheck, Trash2, Wrench } from 'lucide-react';
import { useCardRewards, useCategories, useFire, usePlanMutation, useVault, useVehicles } from '../hooks/api.js';
import { today } from '../lib/dates.js';
import { formatDay, formatINR } from '../lib/format.js';
import { catLabel } from '../lib/labels.js';
import { t, tn } from '../lib/i18n.js';
import { ConfirmDialog, Modal } from './Modal.jsx';
import { AccountSelect, amountProblem } from './TransactionForm.jsx';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorNote, Field, Input, PageHeader, Segmented, Select, Skeleton, cx } from './ui.jsx';

const rupees = (s) => String(s ?? '').trim().replace(/,/g, '');
const errorText = (err) => err.details?.[0]?.message ?? err.message;
const num = (n, d = 1) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: d }).format(n);
const Loading = ({ q }) => (q.error ? <ErrorNote error={q.error} onRetry={q.refetch} /> : <Skeleton className="h-40 w-full" />);

// ───────────── Vehicles ─────────────

const KINDS = [{ value: 'car', label: t('Car') }, { value: 'bike', label: t('Motorbike') }, { value: 'scooter', label: t('Scooter') }, { value: 'other', label: t('Other') }];
const FUELS = [{ value: 'petrol', label: t('Petrol') }, { value: 'diesel', label: t('Diesel') }, { value: 'cng', label: t('CNG') }, { value: 'electric', label: t('Electric') }];
const UNIT = { petrol: t('litres'), diesel: t('litres'), cng: t('kg'), electric: t('kWh') };
const MILEAGE = { petrol: t('km/l'), diesel: t('km/l'), cng: t('km/kg'), electric: t('km/kWh') };
const DUE_TONE = { overdue: 'rose', soon: 'amber', ok: 'green' };

function VehicleForm({ vehicle, onDone }) {
  const uid = useId();
  const save = usePlanMutation('vehicles');
  const s = vehicle?.service;
  const [f, setF] = useState({
    name: vehicle?.name ?? '', kind: vehicle?.kind ?? 'car', fuel: vehicle?.fuel ?? 'petrol',
    everyKm: s?.everyKm ? String(s.everyKm) : '', everyMonths: s?.everyMonths ? String(s.everyMonths) : '',
    lastKm: s?.lastKm !== null && s?.lastKm !== undefined ? String(s.lastKm) : '', lastDate: s?.lastDate ?? '',
  });
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const n = (v) => (v.trim() ? Number(v) : null);
  async function submit(e) {
    e.preventDefault();
    if (!f.name.trim()) { setError(t('Give the vehicle a name')); return; }
    const body = { name: f.name.trim(), kind: f.kind, fuel: f.fuel, service: { everyKm: n(f.everyKm), everyMonths: n(f.everyMonths), lastKm: n(f.lastKm), lastDate: f.lastDate || null } };
    try {
      if (vehicle) await save.mutateAsync({ method: 'PATCH', path: `/vehicles/${vehicle.id}`, body });
      else await save.mutateAsync({ path: '/vehicles', body });
      toast.success(vehicle ? t('Saved') : t('Vehicle added'));
      onDone();
    } catch (err) { setError(errorText(err)); }
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && <ErrorNote error={{ message: error }} />}
      <Field label={t('Name')} htmlFor={`${uid}-n`}><Input id={`${uid}-n`} value={f.name} onChange={set('name')} maxLength={60} placeholder={t('e.g. Swift, Activa')} autoFocus /></Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('Type')} htmlFor={`${uid}-k`}><Select id={`${uid}-k`} value={f.kind} onChange={set('kind')}>{KINDS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></Field>
        <Field label={t('Runs on')} htmlFor={`${uid}-f`}><Select id={`${uid}-f`} value={f.fuel} onChange={set('fuel')}>{FUELS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></Field>
      </div>
      <fieldset className="space-y-3 rounded-lg border border-slate-900/[0.08] p-3 dark:border-white/[0.08]">
        <legend className="px-1 text-sm font-medium">{t('Servicing (optional)')}</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('Every (km)')} htmlFor={`${uid}-ek`}><Input id={`${uid}-ek`} type="number" min="100" value={f.everyKm} onChange={set('everyKm')} placeholder="10000" /></Field>
          <Field label={t('Or every (months)')} htmlFor={`${uid}-em`}><Input id={`${uid}-em`} type="number" min="1" max="60" value={f.everyMonths} onChange={set('everyMonths')} placeholder="12" /></Field>
          <Field label={t('Last service at (km)')} htmlFor={`${uid}-lk`}><Input id={`${uid}-lk`} type="number" min="0" value={f.lastKm} onChange={set('lastKm')} /></Field>
          <Field label={t('Last service on')} htmlFor={`${uid}-ld`}><Input id={`${uid}-ld`} type="date" max={today()} value={f.lastDate} onChange={set('lastDate')} /></Field>
        </div>
      </fieldset>
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onDone}>{t('Cancel')}</Button><Button type="submit" loading={save.isPending}>{vehicle ? t('Save') : t('Add')}</Button></div>
    </form>
  );
}

function FillForm({ vehicle, onDone }) {
  const uid = useId();
  const save = usePlanMutation('vehicles', { money: true });
  const [f, setF] = useState({ date: today(), odometerKm: vehicle.stats.odometerKm ? String(vehicle.stats.odometerKm) : '', quantity: '', amount: '', fullTank: true, account: '' });
  const [errors, setErrors] = useState({});
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function submit(e) {
    e.preventDefault();
    const local = {};
    if (!f.odometerKm.trim()) local.odometerKm = t('Enter the odometer reading');
    if (!(Number(f.quantity) > 0)) local.quantity = t('Enter how much you filled');
    const a = amountProblem(rupees(f.amount));
    if (a) local.amount = a;
    setErrors(local);
    if (Object.keys(local).length) return;
    try {
      await save.mutateAsync({ path: `/vehicles/${vehicle.id}/fills`, body: { date: f.date, odometerKm: Number(f.odometerKm), quantity: Number(f.quantity), amount: rupees(f.amount), fullTank: f.fullTank, ...(f.account && { account: f.account }) } });
      toast.success(t('Fill-up added'));
      onDone();
    } catch (err) { setErrors({ ...err.fieldErrors?.(), form: err.details?.length ? undefined : err.message }); }
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {errors.form && <ErrorNote error={{ message: errors.form }} />}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('Date')} htmlFor={`${uid}-d`}><Input id={`${uid}-d`} type="date" max={today()} value={f.date} onChange={set('date')} /></Field>
        <Field label={t('Odometer (km)')} htmlFor={`${uid}-o`} error={errors.odometerKm}><Input id={`${uid}-o`} type="number" min="0" value={f.odometerKm} onChange={set('odometerKm')} autoFocus /></Field>
        <Field label={t('Quantity ({unit})', { unit: UNIT[vehicle.fuel] })} htmlFor={`${uid}-q`} error={errors.quantity}><Input id={`${uid}-q`} inputMode="decimal" value={f.quantity} onChange={set('quantity')} /></Field>
        <Field label={t('Amount paid (₹)')} htmlFor={`${uid}-a`} error={errors.amount}><Input id={`${uid}-a`} inputMode="decimal" value={f.amount} onChange={set('amount')} /></Field>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={f.fullTank} onChange={(e) => setF((x) => ({ ...x, fullTank: e.target.checked }))} />{vehicle.fuel === 'electric' ? t('Charged to full') : t('Filled the tank to full')}</label>
      <Field label={t('Paid from (optional)')} htmlFor={`${uid}-acc`} hint={t('Pick an account to record it as a Fuel expense too.')}><AccountSelect id={`${uid}-acc`} value={f.account} onChange={(v) => setF((x) => ({ ...x, account: v }))} /></Field>
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onDone}>{t('Cancel')}</Button><Button type="submit" loading={save.isPending}>{t('Add fill-up')}</Button></div>
    </form>
  );
}

function VehicleCard({ v, onEdit, onFill, onDelete }) {
  const act = usePlanMutation('vehicles');
  const [open, setOpen] = useState(false);
  const due = v.service.due;
  const s = v.stats;
  async function serviced() {
    try { await act.mutateAsync({ path: `/vehicles/${v.id}/serviced`, body: {} }); toast.success(t('Service recorded')); } catch (err) { toast.error(errorText(err)); }
  }
  async function removeFill(id) {
    try { await act.mutateAsync({ method: 'DELETE', path: `/vehicles/${v.id}/fills/${id}` }); toast.success(t('Fill-up removed')); } catch (err) { toast.error(errorText(err)); }
  }
  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 truncate font-semibold"><Car className="h-4 w-4 text-slate-400" aria-hidden="true" />{v.name}</h3>
        {due && <Badge tone={DUE_TONE[due.status]}>{due.status === 'overdue' ? t('Service overdue') : due.status === 'soon' ? t('Service due soon') : t('Service OK')}</Badge>}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <div><dt className="text-xs text-slate-500 dark:text-slate-400">{t('Average')}</dt><dd className="tabular font-semibold">{s.averageMileage ? `${num(s.averageMileage)} ${MILEAGE[v.fuel]}` : '—'}</dd></div>
        <div><dt className="text-xs text-slate-500 dark:text-slate-400">{t('Cost per km')}</dt><dd className="tabular font-semibold">{s.costPerKm ? formatINR(s.costPerKm.paise) : '—'}</dd></div>
        <div><dt className="text-xs text-slate-500 dark:text-slate-400">{t('Odometer')}</dt><dd className="tabular">{s.odometerKm !== null ? `${num(s.odometerKm, 0)} km` : '—'}</dd></div>
        <div><dt className="text-xs text-slate-500 dark:text-slate-400">{t('Spent on fuel')}</dt><dd className="tabular">{formatINR(s.spent.paise)}</dd></div>
      </dl>
      {!s.averageMileage && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{t('Mileage shows after two full-tank fill-ups.')}</p>}
      {due && (
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          {[due.nextKm !== null && (due.kmLeft > 0 ? t('{km} km to go', { km: num(due.kmLeft, 0) }) : t('{km} km past due', { km: num(-due.kmLeft, 0) })),
            due.nextDate && t('by {date}', { date: formatDay(due.nextDate) })].filter(Boolean).join(' · ')}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Button size="sm" onClick={() => onFill(v)}><Fuel className="h-4 w-4" aria-hidden="true" /> {t('Fill-up')}</Button>
        {due && <Button size="sm" variant="secondary" onClick={serviced} loading={act.isPending}><Wrench className="h-4 w-4" aria-hidden="true" /> {t('Serviced today')}</Button>}
        <Button size="sm" variant="ghost" onClick={() => onEdit(v)} aria-label={t('Edit {name}', { name: v.name })}><Pencil className="h-4 w-4" aria-hidden="true" /></Button>
        <Button size="sm" variant="ghost" onClick={() => onDelete(v)} aria-label={t('Delete {name}', { name: v.name })} className="hover:text-rose-600"><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
        {v.fills.length > 0 && <button type="button" className="ml-auto text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => setOpen((o) => !o)}>{open ? t('Hide fill-ups') : t('Fill-ups ({n})', { n: v.fills.length })}</button>}
      </div>
      {open && (
        <ul className="mt-3 divide-y divide-slate-900/[0.06] text-sm dark:divide-white/[0.06]">
          {v.fills.map((f) => (
            <li key={f.id} className="flex items-center gap-3 py-2">
              <span className="w-24 shrink-0 text-xs text-slate-500 dark:text-slate-400">{formatDay(f.date)}</span>
              <span className="tabular min-w-0 flex-1 truncate">{num(f.odometerKm, 0)} km · {num(f.quantity, 2)} {UNIT[v.fuel]}{f.fullTank ? '' : ` · ${t('part fill')}`}</span>
              <span className="tabular font-medium">{formatINR(f.amount.paise)}</span>
              <Button size="sm" variant="ghost" onClick={() => removeFill(f.id)} aria-label={t('Remove fill-up')} className="hover:text-rose-600"><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function Vehicles() {
  const q = useVehicles();
  const remove = usePlanMutation('vehicles');
  const [form, setForm] = useState(null);
  const [fill, setFill] = useState(null);
  const [deleting, setDeleting] = useState(null);
  async function confirmDelete() {
    const v = deleting;
    setDeleting(null);
    try { await remove.mutateAsync({ method: 'DELETE', path: `/vehicles/${v.id}` }); toast.success(t('Vehicle removed')); } catch (err) { toast.error(err.message); }
  }
  return (
    <>
      <PageHeader title={t('Vehicles')} subtitle={t('Fuel, real mileage and cost per km from your fill-ups, and a reminder when a service is due.')}
        actions={<Button onClick={() => setForm({})}><Plus className="h-4 w-4" aria-hidden="true" /> {t('Add vehicle')}</Button>} />
      {!q.data ? <Loading q={q} /> : q.data.vehicles.length ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {q.data.vehicles.map((v) => <VehicleCard key={v.id} v={v} onEdit={(x) => setForm({ vehicle: x })} onFill={setFill} onDelete={setDeleting} />)}
        </div>
      ) : (
        <Card><EmptyState icon={Car} title={t('No vehicles yet')} action={<Button onClick={() => setForm({})}>{t('Add vehicle')}</Button>}>{t('Add your car or bike, then note each fill-up with the odometer reading.')}</EmptyState></Card>
      )}
      <Modal open={form !== null} onClose={() => setForm(null)} title={form?.vehicle ? t('Edit vehicle') : t('Add vehicle')}>
        {form && <VehicleForm key={form.vehicle?.id ?? 'new'} vehicle={form.vehicle} onDone={() => setForm(null)} />}
      </Modal>
      <Modal open={fill !== null} onClose={() => setFill(null)} title={fill ? t('Fill-up: {name}', { name: fill.name }) : ''}>
        {fill && <FillForm key={fill.id} vehicle={fill} onDone={() => setFill(null)} />}
      </Modal>
      <ConfirmDialog open={deleting !== null} title={t('Delete this vehicle?')} confirmLabel={t('Delete')} danger onClose={() => setDeleting(null)} onConfirm={confirmDelete}>
        {deleting && t('“{name}” and its fill-ups will be removed. Fuel expenses already recorded stay.', { name: deleting.name })}
      </ConfirmDialog>
    </>
  );
}

// ───────────── The vault ─────────────

const VAULT_TONE = { expired: 'rose', soon: 'amber', ok: 'green' };

function VaultForm({ item, kind, onDone }) {
  const uid = useId();
  const save = usePlanMutation('vault');
  const [f, setF] = useState({
    kind: item?.kind ?? kind, name: item?.name ?? '', provider: item?.provider ?? '', number: item?.number ?? '',
    purchaseDate: item?.purchaseDate ?? '', expiryDate: item?.expiryDate ?? '', amount: item?.amount ? String(item.amount.rupees) : '',
    sumInsured: item?.sumInsured ? String(item.sumInsured.rupees) : '', nominee: item?.nominee ?? '', note: item?.note ?? '',
  });
  const [errors, setErrors] = useState({});
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const insurance = f.kind === 'insurance';
  async function submit(e) {
    e.preventDefault();
    const local = {};
    if (!f.name.trim()) local.name = t('Give it a name');
    if (!f.expiryDate) local.expiryDate = insurance ? t('Enter the renewal date') : t('Enter when the warranty ends');
    for (const k of ['amount', 'sumInsured']) if (f[k].trim() && amountProblem(rupees(f[k]))) local[k] = amountProblem(rupees(f[k]));
    setErrors(local);
    if (Object.keys(local).length) return;
    const body = {
      kind: f.kind, name: f.name.trim(), provider: f.provider.trim(), number: f.number.trim(), purchaseDate: f.purchaseDate || null, expiryDate: f.expiryDate,
      amount: f.amount.trim() ? rupees(f.amount) : null, sumInsured: insurance && f.sumInsured.trim() ? rupees(f.sumInsured) : null,
      nominee: insurance ? f.nominee.trim() : '', note: f.note.trim(),
    };
    try {
      if (item) await save.mutateAsync({ method: 'PATCH', path: `/vault/${item.id}`, body });
      else await save.mutateAsync({ path: '/vault', body });
      toast.success(item ? t('Saved') : t('Added to the vault'));
      onDone();
    } catch (err) { setErrors({ ...err.fieldErrors?.(), form: err.details?.length ? undefined : err.message }); }
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {errors.form && <ErrorNote error={{ message: errors.form }} />}
      <Segmented label={t('Kind')} value={f.kind} onChange={(v) => setF((x) => ({ ...x, kind: v }))} options={[{ value: 'warranty', label: t('Warranty') }, { value: 'insurance', label: t('Insurance') }]} />
      <Field label={insurance ? t('Policy') : t('Product')} htmlFor={`${uid}-n`} error={errors.name}><Input id={`${uid}-n`} value={f.name} onChange={set('name')} maxLength={60} placeholder={insurance ? t('e.g. Family health cover') : t('e.g. Samsung fridge')} autoFocus /></Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={insurance ? t('Insurer') : t('Brand or shop')} htmlFor={`${uid}-p`}><Input id={`${uid}-p`} value={f.provider} onChange={set('provider')} maxLength={60} /></Field>
        <Field label={insurance ? t('Policy number') : t('Serial number')} htmlFor={`${uid}-no`}><Input id={`${uid}-no`} value={f.number} onChange={set('number')} maxLength={60} /></Field>
        <Field label={insurance ? t('Started on') : t('Bought on')} htmlFor={`${uid}-pd`}><Input id={`${uid}-pd`} type="date" value={f.purchaseDate} onChange={set('purchaseDate')} /></Field>
        <Field label={insurance ? t('Renewal date') : t('Warranty ends')} htmlFor={`${uid}-ed`} error={errors.expiryDate}><Input id={`${uid}-ed`} type="date" value={f.expiryDate} onChange={set('expiryDate')} /></Field>
        <Field label={insurance ? t('Premium (₹)') : t('Price (₹)')} htmlFor={`${uid}-a`} error={errors.amount}><Input id={`${uid}-a`} inputMode="decimal" value={f.amount} onChange={set('amount')} /></Field>
        {insurance && <Field label={t('Sum insured (₹)')} htmlFor={`${uid}-si`} error={errors.sumInsured}><Input id={`${uid}-si`} inputMode="decimal" value={f.sumInsured} onChange={set('sumInsured')} /></Field>}
        {insurance && <Field label={t('Nominee')} htmlFor={`${uid}-nom`}><Input id={`${uid}-nom`} value={f.nominee} onChange={set('nominee')} maxLength={60} /></Field>}
      </div>
      <Field label={t('Note (optional)')} htmlFor={`${uid}-note`}><Input id={`${uid}-note`} value={f.note} onChange={set('note')} maxLength={200} placeholder={t('e.g. Bill is in the blue file')} /></Field>
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onDone}>{t('Cancel')}</Button><Button type="submit" loading={save.isPending}>{item ? t('Save') : t('Add')}</Button></div>
    </form>
  );
}

export function Vault() {
  const q = useVault();
  const remove = usePlanMutation('vault');
  const [form, setForm] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const items = q.data?.items ?? [];
  async function confirmDelete() {
    const x = deleting;
    setDeleting(null);
    try { await remove.mutateAsync({ method: 'DELETE', path: `/vault/${x.id}` }); toast.success(t('Removed from the vault')); } catch (err) { toast.error(err.message); }
  }
  const section = (kind, title) => {
    const list = items.filter((x) => x.kind === kind);
    if (!list.length) return null;
    return (
      <Card>
        <CardHeader title={title} />
        <ul className="divide-y divide-slate-900/[0.06] text-sm dark:divide-white/[0.06]">
          {list.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{x.name}</p>
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">{[x.provider, x.number, x.sumInsured && t('cover {amount}', { amount: formatINR(x.sumInsured.paise) }), x.nominee && t('nominee {name}', { name: x.nominee }), x.note].filter(Boolean).join(' · ')}</p>
              </div>
              {x.amount && <span className="tabular">{formatINR(x.amount.paise)}</span>}
              <Badge tone={VAULT_TONE[x.status]}>
                {x.status === 'expired' ? (kind === 'insurance' ? t('Lapsed {date}', { date: formatDay(x.expiryDate) }) : t('Ended {date}', { date: formatDay(x.expiryDate) }))
                  : x.daysLeft === 0 ? t('Ends today') : tn(x.daysLeft, '{n} day left', '{n} days left')}
              </Badge>
              <span className="hidden text-xs text-slate-500 sm:inline dark:text-slate-400">{formatDay(x.expiryDate)}</span>
              <Button size="sm" variant="ghost" onClick={() => setForm({ item: x })} aria-label={t('Edit {name}', { name: x.name })}><Pencil className="h-4 w-4" aria-hidden="true" /></Button>
              <Button size="sm" variant="ghost" onClick={() => setDeleting(x)} aria-label={t('Delete {name}', { name: x.name })} className="hover:text-rose-600"><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
            </li>
          ))}
        </ul>
      </Card>
    );
  };
  return (
    <>
      <PageHeader title={t('Vault')} subtitle={t('Warranties and insurance policies in one place, with a reminder 30 and 7 days before each one ends.')}
        actions={(
          <>
            <Button variant="secondary" onClick={() => setForm({ kind: 'warranty' })}><Plus className="h-4 w-4" aria-hidden="true" /> {t('Warranty')}</Button>
            <Button onClick={() => setForm({ kind: 'insurance' })}><Plus className="h-4 w-4" aria-hidden="true" /> {t('Policy')}</Button>
          </>
        )} />
      {!q.data ? <Loading q={q} /> : items.length ? (
        <div className="space-y-4">{section('insurance', t('Insurance'))}{section('warranty', t('Warranties'))}</div>
      ) : (
        <Card><EmptyState icon={ShieldCheck} title={t('The vault is empty')} action={<Button onClick={() => setForm({ kind: 'insurance' })}>{t('Add a policy')}</Button>}>{t('Health, life, vehicle and home policies, and the warranties on things you buy: never miss a renewal or a free repair again.')}</EmptyState></Card>
      )}
      <Modal open={form !== null} onClose={() => setForm(null)} title={form?.item ? t('Edit') : form?.kind === 'insurance' ? t('Add a policy') : t('Add a warranty')}>
        {form && <VaultForm key={form.item?.id ?? form.kind} item={form.item} kind={form.kind} onDone={() => setForm(null)} />}
      </Modal>
      <ConfirmDialog open={deleting !== null} title={t('Remove from the vault?')} confirmLabel={t('Remove')} danger onClose={() => setDeleting(null)} onConfirm={confirmDelete}>
        {deleting && t('“{name}” will be removed.', { name: deleting.name })}
      </ConfirmDialog>
    </>
  );
}

// ───────────── Card rewards ─────────────

function RewardForm({ card, onDone }) {
  const uid = useId();
  const save = usePlanMutation('transactions');
  const cats = useCategories();
  const all = cats.data ? [...cats.data.defaults.expense, ...cats.data.custom.expense] : [];
  const r = card.rates;
  const [type, setType] = useState(r?.type ?? 'cashback');
  const [rate, setRate] = useState(r ? String(r.defaultRate) : '1');
  const [pointValue, setPointValue] = useState(r?.pointValue ? String(r.pointValue) : '0.25');
  const [rules, setRules] = useState(r?.rules.map((x) => ({ category: x.category, rate: String(x.rate) })) ?? []);
  const [error, setError] = useState(null);
  async function submit(e) {
    e.preventDefault();
    try {
      await save.mutateAsync({ method: 'PUT', path: `/card-rewards/${card.accountId}`, body: {
        type, defaultRate: Number(rate), ...(type === 'points' && { pointValue: Number(pointValue) }),
        rules: rules.filter((x) => x.category && x.rate !== '').map((x) => ({ category: x.category, rate: Number(x.rate) })),
      } });
      toast.success(t('Rewards saved'));
      onDone();
    } catch (err) { setError(errorText(err)); }
  }
  const unit = type === 'cashback' ? t('% back') : t('points per ₹100');
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && <ErrorNote error={{ message: error }} />}
      <Segmented label={t('Reward type')} value={type} onChange={setType} options={[{ value: 'cashback', label: t('Cashback') }, { value: 'points', label: t('Reward points') }]} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('On everything ({unit})', { unit })} htmlFor={`${uid}-r`}><Input id={`${uid}-r`} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></Field>
        {type === 'points' && <Field label={t('One point is worth (₹)')} htmlFor={`${uid}-pv`} hint={t('Check your card’s redemption rate, e.g. ₹0.25.')}><Input id={`${uid}-pv`} inputMode="decimal" value={pointValue} onChange={(e) => setPointValue(e.target.value)} /></Field>}
      </div>
      <div>
        <p className="mb-2 text-sm font-medium">{t('Higher rates on some categories')}</p>
        <ul className="space-y-2">
          {rules.map((x, i) => (
            <li key={i} className="flex gap-2">
              <Select aria-label={t('Category')} value={x.category} onChange={(e) => setRules((rs) => rs.map((y, j) => (j === i ? { ...y, category: e.target.value } : y)))}>
                <option value="">{t('Choose a category')}</option>
                {all.map((c) => <option key={c} value={c}>{catLabel(c)}</option>)}
              </Select>
              <Input aria-label={unit} className="w-28" inputMode="decimal" value={x.rate} onChange={(e) => setRules((rs) => rs.map((y, j) => (j === i ? { ...y, rate: e.target.value } : y)))} />
              <Button size="sm" variant="ghost" aria-label={t('Remove')} onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
            </li>
          ))}
        </ul>
        <Button size="sm" variant="secondary" className="mt-2" onClick={() => setRules((rs) => [...rs, { category: '', rate: '' }])}><Plus className="h-4 w-4" aria-hidden="true" /> {t('Add a category rate')}</Button>
      </div>
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onDone}>{t('Cancel')}</Button><Button type="submit" loading={save.isPending}>{t('Save')}</Button></div>
    </form>
  );
}

export function CardRewards() {
  const q = useCardRewards();
  const [editing, setEditing] = useState(null);
  const d = q.data;
  if (!d) return q.error ? <ErrorNote error={q.error} onRetry={q.refetch} /> : null;
  if (!d.cards.length) return null;
  const tips = d.categories.filter((c) => c.best).slice(0, 6);
  return (
    <Card className="mt-6">
      <CardHeader title={t('Credit card rewards')} subtitle={t('What each card earned on what you spent with it since {date}.', { date: formatDay(d.from) })} />
      <ul className="divide-y divide-slate-900/[0.06] text-sm dark:divide-white/[0.06]">
        {d.cards.map((c) => (
          <li key={c.accountId} className="flex flex-wrap items-center gap-3 py-2.5">
            <Gift className="h-4 w-4 text-slate-400" aria-hidden="true" />
            <div className="min-w-[9rem] flex-1">
              <p className="truncate font-medium">{c.name}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{c.rates ? (c.rates.type === 'cashback' ? t('{rate}% cashback', { rate: c.rates.defaultRate }) : t('{rate} points per ₹100', { rate: c.rates.defaultRate })) + (c.rates.rules.length ? ` · ${tn(c.rates.rules.length, '{n} special rate', '{n} special rates')}` : '') : t('Rewards not set')}</p>
            </div>
            <span className="tabular text-slate-500 dark:text-slate-400">{t('{amount} spent', { amount: formatINR(c.spent.paise) })}</span>
            {c.earned && <span className="tabular font-semibold text-emerald-600 dark:text-emerald-400">{t('{amount} earned', { amount: formatINR(c.earned.paise) })}</span>}
            <Button size="sm" variant="secondary" onClick={() => setEditing(c)}>{c.rates ? t('Edit') : t('Set rewards')}</Button>
          </li>
        ))}
      </ul>
      {tips.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-sm font-medium">{t('Best card for each category')}</p>
          <ul className="grid gap-2 text-sm sm:grid-cols-2">
            {tips.map((c) => <li key={c.category} className="flex justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/60"><span className="truncate">{catLabel(c.category)}</span><span className="truncate font-medium">{c.best.name} · {num(c.best.pct, 2)}%</span></li>)}
          </ul>
        </div>
      )}
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing ? t('Rewards on {name}', { name: editing.name }) : ''}>
        {editing && <RewardForm key={editing.accountId} card={editing} onDone={() => setEditing(null)} />}
      </Modal>
    </Card>
  );
}

// ───────────── FIRE ─────────────

export function Fire() {
  const uid = useId();
  const [form, setForm] = useState({ annualSpend: '', annualSaving: '', corpus: '', returnPct: '10', inflationPct: '6', withdrawalPct: '4' });
  const [params, setParams] = useState({});
  const q = useFire(params);
  const d = q.data;
  const set = (k) => (e) => setForm((x) => ({ ...x, [k]: e.target.value }));
  function submit(e) {
    e.preventDefault();
    setParams(Object.fromEntries(Object.entries(form).map(([k, v]) => [k, rupees(v)]).filter(([, v]) => v !== '')));
  }
  const fields = [
    ['annualSpend', t('Yearly spending (₹)'), d?.found.annualSpend], ['annualSaving', t('Saved each year (₹)'), d?.found.annualSaving], ['corpus', t('Invested now (₹)'), d?.found.corpus],
  ];
  const max = d?.series.length ? Math.max(d.target?.paise ?? 0, ...d.series.map((s) => s.corpus.paise)) : 1;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
      <Card className="lg:col-span-2">
        <CardHeader title={t('Your numbers')} subtitle={d ? t('Found from {from} to {to}; change any of them.', { from: formatDay(d.from), to: formatDay(d.to) }) : undefined} />
        <form onSubmit={submit} className="space-y-3" noValidate>
          {fields.map(([k, label, found]) => (
            <Field key={k} label={label} htmlFor={`${uid}-${k}`} hint={found?.paise ? t('From your data: {amount}', { amount: formatINR(found.paise) }) : undefined}>
              <Input id={`${uid}-${k}`} inputMode="decimal" value={form[k]} onChange={set(k)} placeholder={found?.paise ? String(found.rupees) : ''} />
            </Field>
          ))}
          <div className="grid grid-cols-3 gap-2">
            <Field label={t('Return %')} htmlFor={`${uid}-r`}><Input id={`${uid}-r`} inputMode="decimal" value={form.returnPct} onChange={set('returnPct')} /></Field>
            <Field label={t('Inflation %')} htmlFor={`${uid}-i`}><Input id={`${uid}-i`} inputMode="decimal" value={form.inflationPct} onChange={set('inflationPct')} /></Field>
            <Field label={t('Withdraw %')} htmlFor={`${uid}-w`}><Input id={`${uid}-w`} inputMode="decimal" value={form.withdrawalPct} onChange={set('withdrawalPct')} /></Field>
          </div>
          <Button type="submit" loading={q.isFetching}>{t('Work it out')}</Button>
        </form>
      </Card>
      <Card className="lg:col-span-3">
        {!d ? <Loading q={q} /> : !d.target ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">{t('Record a few months of spending, or type your yearly spending, to see your FIRE number.')}</p>
        ) : (
          <div className="space-y-4 text-sm">
            <div>
              <p className="text-slate-500 dark:text-slate-400">{t('Your FIRE number')}</p>
              <p className="tabular text-title font-semibold">{formatINR(d.target.paise)}</p>
              <p className="text-slate-600 dark:text-slate-400">{t('{pct}% of it a year covers your spending of {amount}.', { pct: d.inputs.withdrawalPct, amount: formatINR(d.inputs.annualSpend.paise) })}</p>
            </div>
            <p className={cx('rounded-lg p-3 text-base font-semibold', d.years === null ? 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200' : 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200')}>
              {d.years === 0 ? t('You’re already there.') : d.years === null ? t('Not within 60 years at this rate: save more or spend less.') : tn(d.years, 'About {n} year to go: around {year}.', 'About {n} years to go: around {year}.', { year: d.year })}
            </p>
            {d.series.length > 1 && (
              <div className="flex h-32 items-end gap-0.5" role="img" aria-label={t('Corpus growing towards the FIRE number')}>
                {d.series.map((s) => <div key={s.year} title={`${s.year}: ${formatINR(s.corpus.paise)}`} className={cx('flex-1 rounded-t', s.corpus.paise >= d.target.paise ? 'bg-emerald-500' : 'bg-indigo-400')} style={{ height: `${Math.max(2, (s.corpus.paise / max) * 100)}%` }} />)}
              </div>
            )}
            <p className="text-xs text-slate-500 dark:text-slate-400">{t('In today’s money, with a real return of {pct}% a year after inflation.', { pct: d.realReturnPct })} {t('A projection, not financial advice: markets don’t move in straight lines.')}</p>
          </div>
        )}
      </Card>
    </div>
  );
}

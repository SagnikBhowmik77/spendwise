import { useId, useState } from 'react';
import toast from 'react-hot-toast';
import { CalendarClock, Pause, Pencil, Play, Plus, Repeat, Trash2 } from 'lucide-react';
import { useDeleteRecurring, useRecurring, useSaveRecurring, useUpcoming } from '../hooks/api.js';
import { addDays, today } from '../lib/dates.js';
import { describeSchedule, formatDay, formatDayShort, formatINR } from '../lib/format.js';
import { ConfirmDialog, Modal } from '../components/Modal.jsx';
import { AccountSelect, CategoryInput, PaymentMethodPicker, amountProblem } from '../components/TransactionForm.jsx';
import { useSpace } from '../context/SpaceContext.jsx';
import {
  Amount, Badge, Button, Card, CardHeader, EmptyState, ErrorNote, Field, Input, PageHeader, Segmented, Select, Skeleton, STATUS_LABEL, STATUS_TONE, Textarea,
} from '../components/ui.jsx';
import { k, t, tn } from '../lib/i18n.js';
import { catLabel } from '../lib/labels.js';

const FREQUENCIES = [
  { value: 'daily', label: t('Daily'), unit: k('days') },
  { value: 'weekly', label: t('Weekly'), unit: k('weeks') },
  { value: 'monthly', label: t('Monthly'), unit: k('months') },
  { value: 'yearly', label: t('Yearly'), unit: k('years') },
];

function RuleForm({ rule, onDone }) {
  const uid = useId();
  const save = useSaveRecurring();
  const { space } = useSpace();
  const editing = Boolean(rule);
  const [form, setForm] = useState(() => ({
    account: rule?.account ?? space?.defaultAccount ?? '',
    paymentMethod: rule?.paymentMethod ?? null,
    type: rule?.type ?? 'expense',
    amount: rule ? String(rule.amount) : '',
    category: rule?.category ?? '',
    note: rule?.note ?? '',
    frequency: rule?.frequency ?? 'monthly',
    interval: String(rule?.interval ?? 1),
    startDate: rule?.startDate ?? today(),
    endDate: rule?.endDate ?? '',
  }));
  const [errors, setErrors] = useState({});
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const unit = FREQUENCIES.find((f) => f.value === form.frequency).unit;

  async function submit(e) {
    e.preventDefault();
    const local = {};
    const amount = amountProblem(form.amount);
    if (amount) local.amount = amount;
    if (!form.category.trim()) local.category = t('Pick or type a category');
    if (form.endDate && form.endDate < form.startDate) local.endDate = t('End date must be on or after the start date');
    setErrors(local);
    if (Object.keys(local).length) return;
    const common = {
      amount: form.amount.replace(/,/g, ''), category: form.category.trim(), note: form.note.trim(), endDate: form.endDate || null,
      account: form.account, paymentMethod: form.paymentMethod,
    };
    try {
      const res = await save.mutateAsync(editing ? { id: rule.id, ...common } : {
        ...common, type: form.type, frequency: form.frequency, interval: Number(form.interval), startDate: form.startDate,
      });
      if (editing) toast.success(t('Rule updated. Future entries use the new details.'));
      else toast.success(res.created ? tn(res.created, 'Rule created. {n} past entry was added.', 'Rule created. {n} past entries were added.') : t('Rule created'));
      onDone();
    } catch (err) {
      setErrors({ ...err.fieldErrors(), form: err.details.length ? undefined : err.message });
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {errors.form && <ErrorNote error={{ message: errors.form }} />}
      {editing ? (
        <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
          {t('{schedule}, from {date}. To change the schedule, delete this rule and create a new one.', { schedule: describeSchedule(rule), date: formatDay(rule.startDate) })}
        </p>
      ) : (
        <Segmented label={t('Type')} value={form.type} onChange={(v) => set('type', v)}
          options={[{ value: 'expense', label: t('Expense') }, { value: 'income', label: t('Income') }]} />
      )}
      <Field label={t('Amount (₹)')} htmlFor={`${uid}-amount`} error={errors.amount}>
        <Input id={`${uid}-amount`} inputMode="decimal" value={form.amount} onChange={(e) => set('amount', e.target.value)} error={errors.amount} placeholder="12000" autoFocus />
      </Field>
      <Field label={t('Category')} htmlFor={`${uid}-cat`} error={errors.category}>
        <CategoryInput id={`${uid}-cat`} type={rule?.type ?? form.type} value={form.category} onChange={(v) => set('category', v)} error={errors.category} />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={(rule?.type ?? form.type) === 'income' ? t('Received in') : t('Paid from')} htmlFor={`${uid}-acc`} error={errors.account}>
          <AccountSelect id={`${uid}-acc`} value={form.account} onChange={(v) => set('account', v)} error={errors.account} />
        </Field>
        <Field label={t('Paid with (optional)')}>
          <PaymentMethodPicker value={form.paymentMethod} onChange={(v) => set('paymentMethod', v)} />
        </Field>
      </div>
      {!editing && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label={t('Repeats')} htmlFor={`${uid}-freq`}>
            <Select id={`${uid}-freq`} value={form.frequency} onChange={(e) => set('frequency', e.target.value)}>
              {FREQUENCIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </Select>
          </Field>
          <Field label={t('Every ({unit})', { unit: t(unit) })} htmlFor={`${uid}-int`} error={errors.interval}>
            <Select id={`${uid}-int`} value={form.interval} onChange={(e) => set('interval', e.target.value)}>
              {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
            </Select>
          </Field>
          <Field label={t('First date')} htmlFor={`${uid}-start`} error={errors.startDate}>
            <Input id={`${uid}-start`} type="date" value={form.startDate} min={addDays(today(), -365)} max={addDays(today(), 365)}
              onChange={(e) => set('startDate', e.target.value)} error={errors.startDate} />
          </Field>
        </div>
      )}
      {!editing && form.startDate < today() && (
        <p className="text-xs text-slate-500 dark:text-slate-400">{t('The first date is in the past, so the entries already due are added straight away.')}</p>
      )}
      <Field label={t('End date (optional)')} htmlFor={`${uid}-end`} error={errors.endDate} hint={t('Leave empty to keep repeating.')}>
        <Input id={`${uid}-end`} type="date" value={form.endDate} min={rule?.startDate ?? form.startDate} onChange={(e) => set('endDate', e.target.value)} error={errors.endDate} />
      </Field>
      <Field label={t('Note (optional)')} htmlFor={`${uid}-note`}>
        <Textarea id={`${uid}-note`} rows={2} maxLength={500} value={form.note} onChange={(e) => set('note', e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onDone}>{t('Cancel')}</Button>
        <Button type="submit" loading={save.isPending}>{editing ? t('Save') : t('Create rule')}</Button>
      </div>
    </form>
  );
}

export default function Recurring() {
  const rules = useRecurring();
  const upcoming = useUpcoming(30);
  const save = useSaveRecurring();
  const remove = useDeleteRecurring();
  const [form, setForm] = useState(null); // null | { rule? }
  const [deleting, setDeleting] = useState(null);

  async function toggle(rule) {
    try {
      await save.mutateAsync({ id: rule.id, active: !rule.active });
      toast.success(rule.active ? t('Paused. Nothing is added until you resume.') : t('Resumed. Dates missed while paused are skipped.'));
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function confirmDelete() {
    const r = deleting;
    setDeleting(null);
    try {
      await remove.mutateAsync(r.id);
      toast.success(t('Rule deleted. Entries it already added are kept.'));
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <>
      <PageHeader title={t('Recurring')} subtitle={t('Rent, salary, subscriptions: added automatically on their due date.')}
        actions={<Button onClick={() => setForm({})}><Plus className="h-4 w-4" aria-hidden="true" /> {t('New rule')}</Button>} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title={t('Your rules')} />
          {rules.error && <ErrorNote error={rules.error} onRetry={rules.refetch} />}
          {!rules.data ? <Skeleton className="h-32 w-full" /> : rules.data.rules.length ? (
            <ul className="-my-3 divide-y divide-slate-900/[0.05] dark:divide-white/[0.05]">
              {rules.data.rules.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2">
                      <span className="truncate font-medium">{catLabel(r.category)}</span>
                      <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {describeSchedule(r)}
                      {r.status === 'ended' ? ` · ${t('ended {date}', { date: r.endDate ? formatDay(r.endDate) : '' })}` : r.nextDate ? ` · ${t('next {date}', { date: formatDay(r.nextDate) })}` : ''}
                      {r.note ? ` · ${r.note}` : ''}
                    </p>
                  </div>
                  <Amount paise={r.amountPaise} type={r.type} className="text-sm" />
                  <div className="flex gap-0.5">
                    {r.status !== 'ended' && (
                      <Button variant="ghost" size="icon" onClick={() => toggle(r)} aria-label={`${r.active ? t('Pause') : t('Resume')} ${catLabel(r.category)}`}>
                        {r.active ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" onClick={() => setForm({ rule: r })} aria-label={t('Edit {name}', { name: catLabel(r.category) })}><Pencil className="h-4 w-4" aria-hidden="true" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => setDeleting(r)} aria-label={t('Delete {name}', { name: catLabel(r.category) })} className="hover:text-rose-600"><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={Repeat} title={t('No recurring rules yet')} action={<Button onClick={() => setForm({})}>{t('Create a rule')}</Button>}>
              {t('For example, rent of ₹12,000 on the 1st of every month. Each entry is added on its date.')}
            </EmptyState>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title={t('Next 30 days')} subtitle={t('What your active rules will add')} />
          {!upcoming.data ? <Skeleton className="h-24 w-full" /> : upcoming.data.items.length ? (
            <>
              <ul className="space-y-2.5">
                {upcoming.data.items.map((u) => (
                  <li key={`${u.ruleId}-${u.date}`} className="flex items-center gap-3 text-sm">
                    <span className="w-14 shrink-0 text-xs text-slate-500 dark:text-slate-400">{formatDayShort(u.date)}</span>
                    <span className="min-w-0 flex-1 truncate">{catLabel(u.category)}</span>
                    <Amount paise={u.amountPaise} type={u.type} />
                  </li>
                ))}
              </ul>
              <div className="tabular mt-4 flex justify-between border-t border-slate-900/[0.06] pt-3 text-sm dark:border-white/[0.06]">
                <span className="text-slate-500 dark:text-slate-400">{t('In {amount}', { amount: formatINR(upcoming.data.totals.income.paise) })}</span>
                <span className="text-slate-500 dark:text-slate-400">{t('Out {amount}', { amount: formatINR(upcoming.data.totals.expense.paise) })}</span>
              </div>
            </>
          ) : (
            <EmptyState icon={CalendarClock} title={t('Nothing due in the next 30 days')} />
          )}
        </Card>
      </div>

      <Modal open={form !== null} onClose={() => setForm(null)} title={form?.rule ? t('Edit rule') : t('New recurring rule')}>
        {form && <RuleForm key={form.rule?.id ?? 'new'} rule={form.rule} onDone={() => setForm(null)} />}
      </Modal>
      <ConfirmDialog open={deleting !== null} title={t('Delete this rule?')} confirmLabel={t('Delete')} danger onClose={() => setDeleting(null)} onConfirm={confirmDelete}>
        {deleting && t('No more {name} entries will be added. The ones it already added stay in your history.', { name: catLabel(deleting.category) })}
      </ConfirmDialog>
    </>
  );
}

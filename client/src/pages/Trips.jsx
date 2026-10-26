import { useState } from 'react';
import { Link } from 'react-router';
import toast from 'react-hot-toast';
import { Plane } from 'lucide-react';
import { useDeleteTrip, useStartTrip, useTripSummary, useTrips, useUpdateTrip } from '../hooks/api.js';
import { formatDay, formatINR } from '../lib/format.js';
import { t, tn } from '../lib/i18n.js';
import { catLabel } from '../lib/labels.js';
import { amountProblem } from '../components/TransactionForm.jsx';
import { Modal } from '../components/Modal.jsx';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorNote, Field, Input, PageHeader, ProgressBar, Skeleton } from '../components/ui.jsx';

function StartTrip() {
  const start = useStartTrip();
  const [name, setName] = useState('');
  const [budget, setBudget] = useState('');
  const [error, setError] = useState(null);
  async function submit(e) {
    e.preventDefault();
    const b = budget.trim().replace(/,/g, '');
    if (b && amountProblem(b)) { setError(amountProblem(b)); return; }
    try {
      const { trip } = await start.mutateAsync({ name: name.trim(), budget: b || null });
      toast.success(t('Trip mode on. New entries get #{tag} until you end it.', { tag: trip.tag }));
      setName(''); setBudget(''); setError(null);
    } catch (err) {
      setError(err.message);
    }
  }
  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-end">
      <Field label={t('Trip name')} htmlFor="trip-name"><Input id="trip-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder={t('e.g. Goa, Diwali at home')} /></Field>
      <Field label={t('Budget (₹, optional)')} htmlFor="trip-budget" error={error}><Input id="trip-budget" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="40000" /></Field>
      <Button type="submit" loading={start.isPending} disabled={!name.trim()}>{t('Start trip')}</Button>
    </form>
  );
}

function Summary({ id, onClose }) {
  const { data, error } = useTripSummary(id);
  return (
    <Modal open={Boolean(id)} onClose={onClose} title={data ? t('{name}: summary', { name: data.trip.name }) : t('Trip summary')}>
      {error ? <ErrorNote error={error} /> : !data ? <Skeleton className="h-40 w-full" /> : (
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-3 gap-3">
            <div><p className="text-slate-500 dark:text-slate-400">{t('Spent')}</p><p className="tabular text-heading font-semibold">{formatINR(data.trip.spent.paise)}</p></div>
            <div><p className="text-slate-500 dark:text-slate-400">{t('Per day')}</p><p className="tabular text-heading font-semibold">{formatINR(data.perDay.paise)}</p></div>
            <div><p className="text-slate-500 dark:text-slate-400">{t('Days')}</p><p className="text-heading font-semibold">{data.daysWithSpending}</p></div>
          </div>
          {data.trip.budget && <p>{t('{pct}% of the {amount} budget.', { pct: data.trip.percentUsed, amount: formatINR(data.trip.budget.paise) })}</p>}
          {data.biggest && <p>{t('Biggest expense: {amount} on {category}{note}, {date}.', { amount: formatINR(data.biggest.amount.paise), category: catLabel(data.biggest.category), note: data.biggest.note ? ` (${data.biggest.note})` : '', date: formatDay(data.biggest.date) })}</p>}
          <ul className="space-y-1.5">
            {data.categories.map((c) => (
              <li key={c.category} className="flex justify-between"><span>{catLabel(c.category)}</span><span className="tabular">{formatINR(c.total.paise)} · {c.share}%</span></li>
            ))}
          </ul>
          <Link to={`/transactions?tag=${data.trip.tag}&preset=all`} className="inline-block font-medium text-indigo-600 hover:underline dark:text-indigo-400">{t('See every entry tagged #{tag}', { tag: data.trip.tag })}</Link>
        </div>
      )}
    </Modal>
  );
}

export default function Trips() {
  const { data, error, refetch } = useTrips();
  const update = useUpdateTrip();
  const remove = useDeleteTrip();
  const [summary, setSummary] = useState(null);
  const active = data?.trips.find((trip) => trip.active);
  const past = data?.trips.filter((trip) => !trip.active) ?? [];

  const end = async (trip) => {
    try { await update.mutateAsync({ id: trip.id, end: true }); setSummary(trip.id); } catch (err) { toast.error(err.message); }
  };

  return (
    <>
      <PageHeader title={t('Trips')} subtitle={t('Trip mode tags every new entry (like #trip-goa) and tracks it against a trip budget until you end it.')} />
      <div className="mx-auto max-w-3xl space-y-4">
        {error && <ErrorNote error={error} onRetry={refetch} />}
        <Card>
          {!data ? <Skeleton className="h-24 w-full" /> : active ? (
            <>
              <CardHeader title={active.name} subtitle={t('Running since {date} · new entries get #{tag}', { date: formatDay(active.startDate), tag: active.tag })}
                action={<Badge tone="green">{t('Trip mode on')}</Badge>} />
              <p className="tabular text-title font-semibold">{formatINR(active.spent.paise)}</p>
              <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">{tn(active.entries, '{n} entry', '{n} entries')}{active.budget ? ` · ${t('budget {amount}', { amount: formatINR(active.budget.paise) })}` : ''}</p>
              {active.budget && <ProgressBar percent={active.percentUsed} status={active.percentUsed > 100 ? 'over' : active.percentUsed >= 80 ? 'warning' : 'ok'} label={t('Trip budget used')} />}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => setSummary(active.id)}>{t('Summary so far')}</Button>
                <Button onClick={() => end(active)} loading={update.isPending}>{t('End trip')}</Button>
              </div>
            </>
          ) : (
            <>
              <CardHeader title={t('Start a trip')} />
              <StartTrip />
            </>
          )}
        </Card>
        <Card>
          <CardHeader title={t('Past trips')} />
          {!data ? <Skeleton className="h-16 w-full" /> : past.length ? (
            <ul className="divide-y divide-slate-900/[0.05] dark:divide-white/[0.05]">
              {past.map((trip) => (
                <li key={trip.id} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
                  <span className="min-w-0 flex-1"><span className="font-medium">{trip.name}</span> <span className="text-slate-500 dark:text-slate-400">#{trip.tag}</span></span>
                  <span className="tabular">{formatINR(trip.spent.paise)}</span>
                  <Button variant="ghost" size="sm" onClick={() => setSummary(trip.id)}>{t('Summary')}</Button>
                  <Button variant="ghost" size="sm" className="hover:text-rose-600" onClick={async () => {
                    try { await remove.mutateAsync(trip.id); toast.success(t('Trip removed. Its entries and tag stay.')); } catch (err) { toast.error(err.message); }
                  }}>{t('Remove')}</Button>
                </li>
              ))}
            </ul>
          ) : <EmptyState icon={Plane} title={t('No past trips yet')} />}
        </Card>
      </div>
      <Summary id={summary} onClose={() => setSummary(null)} />
    </>
  );
}

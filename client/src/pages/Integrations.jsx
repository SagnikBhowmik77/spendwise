// Batch 12J: Google Sheets sync, the Telegram bot, personal API tokens and webhooks.
import { useEffect, useId, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { CalendarDays, Copy, Download, ExternalLink, KeyRound, MessageCircle, RefreshCw, Send, Sheet, Trash2, Webhook } from 'lucide-react';
import { useCalendarFeed } from '../hooks/api.js';
import { api, fetchBlob } from '../lib/api.js';
import { useSpace } from '../context/SpaceContext.jsx';
import { ConfirmDialog } from '../components/Modal.jsx';
import { Badge, Button, Card, CardHeader, ErrorNote, Field, Input, PageHeader, Select, SettingRow, Skeleton, Switch, cx } from '../components/ui.jsx';
import { localeTag, t, tn, tr } from '../lib/i18n.js';

const when = (d) => (d ? new Intl.DateTimeFormat(localeTag(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(d)) : t('never'));
const API_BASE = (import.meta.env.VITE_API_URL || window.location.origin).replace(/\/+$/, '');
const EVENT_LABEL = {
  'transaction.created': t('Entry added'), 'transaction.updated': t('Entry edited'), 'transaction.deleted': t('Entry deleted'),
  'transaction.restored': t('Entry restored'), 'transactions.imported': t('Statement imported'), 'transactions.recurring': t('Recurring entries added'),
  'budget.alert': t('Budget at 80% or 100%'),
};
const GOOGLE_RESULT = {
  connected: ['success', t('Google Sheets connected. Your sheet is ready.')],
  cancelled: ['error', t('Google sign-in was cancelled')],
  noscope: ['error', t('Spendwise needs permission to create its sheet. Connect again and tick the Google Drive box.')],
  expired: ['error', t('That took too long. Try connecting again.')],
  error: ['error', t('Google couldn’t be connected. Try again.')],
};

async function copy(text, what = t('Copied')) {
  try { await navigator.clipboard.writeText(text); toast.success(what); } catch { toast.error(t('Copying isn’t allowed here; select it and copy by hand')); }
}

function Secret({ value, label }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
      <p className="text-sm font-medium">{label}</p>
      <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{t('Copy it now: it won’t be shown again.')}</p>
      <div className="mt-2 flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded bg-white px-2 py-1 text-xs dark:bg-slate-900" data-testid="secret">{value}</code>
        <Button size="sm" variant="secondary" onClick={() => copy(value)}><Copy className="h-4 w-4" aria-hidden="true" /> {t('Copy')}</Button>
      </div>
    </div>
  );
}

// Batch 12S: bills, EMIs, SIPs, card due dates, maturities and renewals in your own calendar app.
function CalendarCard() {
  const qc = useQueryClient();
  const q = useCalendarFeed();
  const [url, setUrl] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const feed = q.data?.feed;
  async function create() {
    setConfirmReset(false);
    setBusy(true);
    try { const r = await api('/integrations/calendar', { method: 'POST' }); setUrl(r.url); qc.invalidateQueries({ queryKey: ['calendar-feed'] }); } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  }
  async function remove() {
    try { await api('/integrations/calendar', { method: 'DELETE' }); setUrl(null); qc.invalidateQueries({ queryKey: ['calendar-feed'] }); toast.success(t('Calendar address turned off')); } catch (err) { toast.error(err.message); }
  }
  async function download() {
    try {
      const blob = await fetchBlob('/integrations/calendar/download');
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'spendwise.ics' });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (err) { toast.error(err.message); }
  }
  const webcal = url?.replace(/^https?:/, 'webcal:');
  const local = url && /\/\/(localhost|127\.0\.0\.1)[:/]/.test(url);
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><CalendarDays className="h-5 w-5 text-indigo-500" aria-hidden="true" />{t('Calendar')}</span>}
        subtitle={t('Bills, EMIs, SIPs, card due dates, FD/RD/PPF maturities and policy renewals in Google Calendar, Apple Calendar or Outlook, each with a reminder the day before.')} />
      {!q.data ? (q.error ? <ErrorNote error={q.error} onRetry={q.refetch} /> : <Skeleton className="h-10 w-full" />) : (
        <div className="space-y-3 text-sm">
          {url && <Secret value={url} label={t('Your private calendar address')} />}
          {url && (
            <div className="flex flex-wrap gap-2">
              <a className="inline-flex items-center gap-1 font-medium text-indigo-600 hover:underline dark:text-indigo-400" href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" aria-hidden="true" />{t('Add to Google Calendar')}</a>
              <a className="inline-flex items-center gap-1 font-medium text-indigo-600 hover:underline dark:text-indigo-400" href={webcal}><ExternalLink className="h-4 w-4" aria-hidden="true" />{t('Open in Apple Calendar or Outlook')}</a>
            </div>
          )}
          {local && <p className="text-xs text-amber-700 dark:text-amber-300">{t('This address is on your own computer, so online calendars can’t reach it yet. It works once Spendwise is online; until then, download the file.')}</p>}
          {feed && !url && <p className="text-slate-600 dark:text-slate-400">{feed.lastFetchedAt ? t('On. Your calendar last checked it {when}.', { when: new Date(feed.lastFetchedAt).toLocaleString(localeTag(), { dateStyle: 'medium', timeStyle: 'short' }) }) : t('On, but no calendar has checked it yet.')}</p>}
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('Anyone with the address can see these dates and amounts, so keep it private. Reset it to make a new one; the old one stops working.')}</p>
          <div className="flex flex-wrap gap-2">
            {!feed ? <Button onClick={create} loading={busy}><CalendarDays className="h-4 w-4" aria-hidden="true" /> {t('Make a calendar address')}</Button>
              : <Button variant="secondary" onClick={() => setConfirmReset(true)} loading={busy}><RefreshCw className="h-4 w-4" aria-hidden="true" /> {t('Reset address')}</Button>}
            <Button variant="secondary" onClick={download}><Download className="h-4 w-4" aria-hidden="true" /> {t('Download .ics')}</Button>
            {feed && <Button variant="ghost" className="hover:text-rose-600" onClick={remove}><Trash2 className="h-4 w-4" aria-hidden="true" /> {t('Turn off')}</Button>}
          </div>
        </div>
      )}
      <ConfirmDialog open={confirmReset} title={t('Reset the calendar address?')} confirmLabel={t('Reset')} onClose={() => setConfirmReset(false)} onConfirm={create}>
        {t('Calendars using the old address stop updating. Add the new one to them.')}
      </ConfirmDialog>
    </Card>
  );
}

function GoogleCard() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['integrations', 'google'], queryFn: () => api('/integrations/google') });
  const [busy, setBusy] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const s = status.data;
  const act = async (what, fn) => {
    setBusy(what);
    try { await fn(); } catch (err) { toast.error(err.message); } finally { setBusy(null); await qc.invalidateQueries({ queryKey: ['integrations', 'google'] }); }
  };
  const connect = () => act('connect', async () => { window.location.assign((await api('/integrations/google/start', { method: 'POST' })).url); });
  const sync = () => act('sync', async () => { const r = await api('/integrations/google/sync', { method: 'POST' }); toast.success(tn(r.rows, 'Synced {n} entry', 'Synced {n} entries')); });
  const disconnect = () => { setConfirm(false); act('off', async () => { await api('/integrations/google', { method: 'DELETE' }); toast.success(t('Google Sheets disconnected')); }); };
  return (
    <Card>
      <CardHeader title={t('Google Sheets')} subtitle={t('Keep a Google Sheet in your Drive filled with every entry and monthly totals, updated a few seconds after each change.')} />
      {status.error && <ErrorNote error={status.error} onRetry={status.refetch} />}
      {!s ? <Skeleton className="h-16 w-full" /> : !s.configured ? <p className="text-sm text-slate-500 dark:text-slate-400">{t('Google isn’t set up on this server.')}</p> : s.connected ? (
        <div className="space-y-3 text-sm">
          <p className="flex flex-wrap items-center gap-2"><Badge tone="green">{t('Connected')}</Badge> {s.googleEmail}{s.connectedBy ? ` · by ${s.connectedBy}` : ''}</p>
          <p className="text-slate-600 dark:text-slate-300">{tn(s.rowsSynced, '{n} entry', '{n} entries')} · {t('last synced {date}', { date: when(s.lastSyncAt) })}</p>
          {s.lastError && <ErrorNote error={{ message: t('Last sync failed: {error}', { error: s.lastError }) }} />}
          <div className="flex flex-wrap gap-2">
            {s.spreadsheetUrl && <a href={s.spreadsheetUrl} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand-600 px-3 text-sm font-medium text-white hover:bg-brand-700"><Sheet className="h-4 w-4" aria-hidden="true" /> {t('Open the sheet')} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /></a>}
            <Button size="sm" variant="secondary" onClick={sync} loading={busy === 'sync'}><RefreshCw className="h-4 w-4" aria-hidden="true" /> {t('Sync now')}</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(true)}>{t('Disconnect')}</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <Button onClick={connect} loading={busy === 'connect'}><Sheet className="h-4 w-4" aria-hidden="true" /> {t('Connect Google Sheets')}</Button>
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('Spendwise only asks for access to files it creates itself, not the rest of your Drive.')}</p>
        </div>
      )}
      <ConfirmDialog open={confirm} title={t('Disconnect Google Sheets?')} confirmLabel={t('Disconnect')} onClose={() => setConfirm(false)} onConfirm={disconnect}>
        {t('The sheet stops updating and Spendwise gives its Google access back. The sheet itself stays in your Drive.')}
      </ConfirmDialog>
    </Card>
  );
}

const SUMMARY_TIMES = ['08:00', '12:00', '18:00', '20:00', '21:00', '21:30', '22:00', '23:00'];

function TelegramCard() {
  const qc = useQueryClient();
  const [pending, setPending] = useState(null); // { url, botUsername, before }
  const status = useQuery({ queryKey: ['integrations', 'telegram'], queryFn: () => api('/integrations/telegram'), refetchInterval: pending ? 3000 : false });
  const s = status.data;
  useEffect(() => {
    if (pending && s && s.links.length > pending.before) { setPending(null); toast.success(t('Telegram linked. Send the bot “add 200 chai”.')); }
  }, [pending, s]);
  async function link() {
    try {
      const r = await api('/integrations/telegram/link', { method: 'POST' });
      setPending({ ...r, before: s.links.length });
      window.open(r.url, '_blank', 'noopener');
    } catch (err) { toast.error(err.message); }
  }
  async function change(id, body) {
    try { await api(`/integrations/telegram/${id}`, { method: 'PATCH', body }); await qc.invalidateQueries({ queryKey: ['integrations', 'telegram'] }); } catch (err) { toast.error(err.message); }
  }
  async function unlink(id) {
    try { await api(`/integrations/telegram/${id}`, { method: 'DELETE' }); toast.success(t('Unlinked')); await qc.invalidateQueries({ queryKey: ['integrations', 'telegram'] }); } catch (err) { toast.error(err.message); }
  }
  return (
    <Card>
      <CardHeader title={t('Telegram')} subtitle={t('Add entries by messaging a bot (“add 200 chai”), and get /today, /summary and an optional summary every evening.')} />
      {status.error && <ErrorNote error={status.error} onRetry={status.refetch} />}
      {!s ? <Skeleton className="h-16 w-full" /> : !s.configured ? <p className="text-sm text-slate-500 dark:text-slate-400">{t('Telegram isn’t set up on this server.')}</p> : (
        <div className="space-y-4">
          {s.links.map((l) => (
            <div key={l.id} className="space-y-3 rounded-lg border border-slate-900/[0.08] p-3 dark:border-white/[0.08]">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <MessageCircle className="h-4 w-4 text-sky-500" aria-hidden="true" />
                <span className="font-medium">{l.username ? `@${l.username}` : l.firstName || t('Telegram chat')}</span>
                <span className="text-slate-500 dark:text-slate-400">· {t('adds to {space} · linked {date}', { space: l.spaceName, date: when(l.linkedAt) })}</span>
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => unlink(l.id)}>{t('Unlink')}</Button>
              </div>
              <SettingRow title={t('Daily summary')} control={<Switch checked={l.dailySummary} onChange={(v) => change(l.id, { dailySummary: v })} label={t('Daily summary on Telegram')} />}>
                {t('The day’s spending and the month so far, every evening.')}
              </SettingRow>
              {l.dailySummary && (
                <Field label={t('Send it at')} htmlFor={`tg-${l.id}`} className="w-40">
                  <Select id={`tg-${l.id}`} value={l.summaryTime} onChange={(e) => change(l.id, { summaryTime: e.target.value })}>
                    {[...new Set([...SUMMARY_TIMES, l.summaryTime])].sort().map((x) => <option key={x} value={x}>{x}</option>)}
                  </Select>
                </Field>
              )}
            </div>
          ))}
          {pending ? (
            <div className="rounded-lg bg-sky-50 p-3 text-sm dark:bg-sky-500/10">
              <p>{tr('Telegram should have opened <b>@{bot}</b>. Tap <b>Start</b> there. This page updates once it’s linked.', { bot: pending.botUsername }, { b: (x) => <b>{x}</b> })}</p>
              <p className="mt-2">{tr('Didn’t open? <a>Open the link</a> (valid 15 minutes).', {}, { a: (x) => <a href={pending.url} target="_blank" rel="noreferrer" className="font-medium text-indigo-600 underline dark:text-indigo-400">{x}</a> })}</p>
            </div>
          ) : (
            <Button onClick={link}><Send className="h-4 w-4" aria-hidden="true" /> {s.links.length ? t('Link another chat') : t('Link Telegram')}</Button>
          )}
          {s.botUsername && <p className="text-xs text-slate-500 dark:text-slate-400">{t('The bot is @{bot}. It only answers chats linked from here, and only private chats.', { bot: s.botUsername })}</p>}
        </div>
      )}
    </Card>
  );
}

function TokensCard() {
  const uid = useId();
  const qc = useQueryClient();
  const { space } = useSpace();
  const list = useQuery({ queryKey: ['integrations', 'tokens'], queryFn: () => api('/integrations/tokens') });
  const [name, setName] = useState('');
  const [scope, setScope] = useState('read');
  const [days, setDays] = useState('');
  const [made, setMade] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function create(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api('/integrations/tokens', { method: 'POST', body: { name: name.trim(), scope, expiresInDays: days ? Number(days) : null } });
      setMade(r);
      setName('');
      await qc.invalidateQueries({ queryKey: ['integrations', 'tokens'] });
    } catch (err) { setError(err); } finally { setBusy(false); }
  }
  async function revoke(id) {
    try { await api(`/integrations/tokens/${id}`, { method: 'DELETE' }); toast.success(t('Token revoked')); await qc.invalidateQueries({ queryKey: ['integrations', 'tokens'] }); } catch (err) { toast.error(err.message); }
  }
  const example = `curl -H "Authorization: Bearer ${made?.token ?? 'sw_…'}" "${API_BASE}/api/transactions?preset=this-month"`;
  return (
    <Card>
      <CardHeader title={t('API tokens')} subtitle={t('For your own scripts and apps. A token works in one space (this one: {space}) and can only read, or read and change, your entries, budgets and the rest.', { space: space?.kind === 'shared' ? space.name : t('Personal') })} />
      {made && <div className="mb-4 space-y-2"><Secret value={made.token} label={t('Token “{name}”', { name: made.name })} /><p className="text-xs text-slate-500 dark:text-slate-400">{t('Try it:')} <code className="break-all">{example}</code></p></div>}
      <form onSubmit={create} className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end" noValidate>
        {error && <div className="sm:col-span-4"><ErrorNote error={error} /></div>}
        <Field label={t('Name')} htmlFor={`${uid}-n`}><Input id={`${uid}-n`} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('e.g. Home server')} maxLength={60} /></Field>
        <Field label={t('Can')} htmlFor={`${uid}-s`}><Select id={`${uid}-s`} value={scope} onChange={(e) => setScope(e.target.value)}><option value="read">{t('Read only')}</option><option value="write">{t('Read and write')}</option></Select></Field>
        <Field label={t('Expires')} htmlFor={`${uid}-d`}><Select id={`${uid}-d`} value={days} onChange={(e) => setDays(e.target.value)}><option value="">{t('Never')}</option><option value="30">{t('In 30 days')}</option><option value="90">{t('In 90 days')}</option><option value="365">{t('In a year')}</option></Select></Field>
        <Button type="submit" loading={busy} disabled={!name.trim()}><KeyRound className="h-4 w-4" aria-hidden="true" /> {t('Make token')}</Button>
      </form>
      {list.data?.tokens.length > 0 && (
        <ul className="mt-4 divide-y divide-slate-900/[0.06] text-sm dark:divide-white/[0.06]" aria-label={t('API tokens')}>
          {list.data.tokens.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <span className="font-medium">{x.name}</span>
              <code className="text-xs text-slate-500 dark:text-slate-400">{x.prefix}</code>
              <Badge tone={x.scope === 'write' ? 'amber' : 'slate'}>{x.scope === 'write' ? t('Read and write') : t('Read only')}</Badge>
              <span className="text-xs text-slate-500 dark:text-slate-400">{x.spaceName} · {t('used {date}', { date: when(x.lastUsedAt) })}{x.expiresAt ? ` · ${t('expires {date}', { date: when(x.expiresAt) })}` : ''}</span>
              <Button size="sm" variant="ghost" className="ml-auto hover:text-rose-600" onClick={() => revoke(x.id)} aria-label={t('Revoke {name}', { name: x.name })}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function WebhookRow({ h, onChanged }) {
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState(null);
  const deliveries = useQuery({ queryKey: ['integrations', 'webhooks', h.id, 'deliveries'], queryFn: () => api(`/integrations/webhooks/${h.id}/deliveries`), enabled: open });
  const run = async (fn) => { try { await fn(); } catch (err) { toast.error(err.message); } await onChanged(); if (open) deliveries.refetch(); };
  const test = () => run(async () => {
    const r = await api(`/integrations/webhooks/${h.id}/test`, { method: 'POST' });
    if (r.ok) toast.success(t('Delivered ({status})', { status: r.status })); else toast.error(t('Not delivered: {error}', { error: r.error }));
  });
  const d = h.lastDelivery;
  return (
    <li className="space-y-2 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Webhook className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
        <span className="min-w-0 break-all font-medium">{h.url}</span>
        {!h.active && <Badge tone="rose">{t('Off')}</Badge>}
        <div className="ml-auto"><Switch checked={h.active} onChange={(v) => run(() => api(`/integrations/webhooks/${h.id}`, { method: 'PATCH', body: { active: v } }))} label={t('Webhook {url} on or off', { url: h.url })} /></div>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">{h.events.map((e) => EVENT_LABEL[e] ?? e).join(', ')}</p>
      {h.disabledReason && <p className="text-xs text-rose-600">{h.disabledReason}</p>}
      <p className={cx('text-xs', d && !d.ok ? 'text-rose-600' : 'text-slate-500 dark:text-slate-400')}>{d ? t('Last delivery {date}: {result}', { date: when(d.at), result: d.ok ? t('delivered ({status})', { status: d.status }) : d.error }) : t('Nothing sent yet.')}</p>
      {secret && <Secret value={secret} label={t('New signing secret')} />}
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="secondary" onClick={test}><Send className="h-4 w-4" aria-hidden="true" /> {t('Send test')}</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}>{open ? t('Hide deliveries') : t('Deliveries')}</Button>
        <Button size="sm" variant="ghost" onClick={() => run(async () => setSecret((await api(`/integrations/webhooks/${h.id}/secret`, { method: 'POST' })).secret))}>{t('New secret')}</Button>
        <Button size="sm" variant="ghost" className="hover:text-rose-600" onClick={() => run(() => api(`/integrations/webhooks/${h.id}`, { method: 'DELETE' }))} aria-label={t('Delete webhook {url}', { url: h.url })}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
      </div>
      {open && (
        <ul className="divide-y divide-slate-900/[0.06] rounded-lg border border-slate-900/[0.08] text-xs dark:divide-white/[0.06] dark:border-white/[0.08]" aria-label={t('Deliveries')}>
          {(deliveries.data?.deliveries ?? []).map((x) => (
            <li key={x.id} className="flex flex-wrap gap-x-3 px-3 py-1.5">
              <span className={x.ok ? 'text-emerald-600' : 'text-rose-600'}>{x.ok ? `✓ ${x.status}` : `✗ ${x.status ?? '—'}`}</span>
              <span>{EVENT_LABEL[x.event] ?? x.event}</span>
              <span className="text-slate-500 dark:text-slate-400">{t('try {n}', { n: x.attempt })} · {when(x.at)} · {x.durationMs} ms</span>
              {x.error && <span className="text-rose-600">{x.error}</span>}
            </li>
          ))}
          {deliveries.data && !deliveries.data.deliveries.length && <li className="px-3 py-1.5 text-slate-500 dark:text-slate-400">{t('None yet.')}</li>}
        </ul>
      )}
    </li>
  );
}

function WebhooksCard() {
  const uid = useId();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['integrations', 'webhooks'], queryFn: () => api('/integrations/webhooks') });
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState(null);
  const [made, setMade] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const all = list.data?.events ?? [];
  const chosen = events ?? all;
  const refresh = () => qc.invalidateQueries({ queryKey: ['integrations', 'webhooks'] });
  async function create(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setMade(await api('/integrations/webhooks', { method: 'POST', body: { url: url.trim(), events: chosen } }));
      setUrl('');
      await refresh();
    } catch (err) { setError(err); } finally { setBusy(false); }
  }
  return (
    <Card>
      <CardHeader title={t('Webhooks')} subtitle={t('Spendwise POSTs a JSON message to your address when something happens in this space, signed so you can check it’s really from Spendwise.')} />
      {made && <div className="mb-4"><Secret value={made.secret} label={t('Signing secret')} /></div>}
      <form onSubmit={create} className="space-y-3" noValidate>
        {error && <ErrorNote error={error.details?.length ? { message: error.details[0].message } : error} />}
        <Field label={t('Address')} htmlFor={`${uid}-u`}><Input id={`${uid}-u`} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/hooks/spendwise" inputMode="url" /></Field>
        <fieldset>
          <legend className="text-sm font-medium">{t('Send when')}</legend>
          <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {all.map((ev) => (
              <label key={ev} className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={chosen.includes(ev)} onChange={(e) => setEvents(e.target.checked ? [...chosen, ev] : chosen.filter((x) => x !== ev))} />
                {EVENT_LABEL[ev] ?? ev}
              </label>
            ))}
          </div>
        </fieldset>
        <Button type="submit" loading={busy} disabled={!url.trim() || !chosen.length}><Webhook className="h-4 w-4" aria-hidden="true" /> {t('Add webhook')}</Button>
      </form>
      {list.data?.webhooks.length > 0 && (
        <ul className="mt-4 divide-y divide-slate-900/[0.05] dark:divide-white/[0.05]" aria-label={t('Webhooks')}>
          {list.data.webhooks.map((h) => <WebhookRow key={h.id} h={h} onChanged={refresh} />)}
        </ul>
      )}
      <details className="mt-4 text-xs text-slate-500 dark:text-slate-400">
        <summary className="cursor-pointer font-medium">{t('Checking the signature')}</summary>
        <p className="mt-2">{tr('Each request has <c>{ts}</c> and <c>{sig}</c>, the HMAC-SHA256 of <c>{signed}</c> with your secret. Compute it on your side and compare; ignore requests older than a few minutes. Failed deliveries are retried after 30 seconds and 5 minutes; 20 failures in a row turn the webhook off.', { ts: 'X-Spendwise-Timestamp', sig: 'X-Spendwise-Signature: sha256=…', signed: '{timestamp}.{body}' }, { c: (x) => <code>{x}</code> })}</p>
      </details>
    </Card>
  );
}

export default function Integrations() {
  const [params, setParams] = useSearchParams();
  // Coming back from Google's consent screen.
  useEffect(() => {
    const result = GOOGLE_RESULT[params.get('google')];
    if (!result) return;
    if (result[0] === 'success') toast.success(result[1], { id: 'google' }); else toast.error(result[1], { id: 'google' });
    setParams({}, { replace: true });
  }, [params, setParams]);
  return (
    <>
      <PageHeader title={t('Integrations')} subtitle={t('Connect Spendwise to Google Sheets and Telegram, or to your own tools with tokens and webhooks.')} />
      <div className="mx-auto max-w-3xl space-y-4">
        <CalendarCard />
        <GoogleCard />
        <TelegramCard />
        <TokensCard />
        <WebhooksCard />
      </div>
    </>
  );
}

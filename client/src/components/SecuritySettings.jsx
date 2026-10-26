// Settings → security (batch 12I): two-factor login, app lock, signed-in devices, backup and restore.
import { useEffect, useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import QRCode from 'qrcode';
import { platformAuthenticatorIsAvailable, startRegistration } from '@simplewebauthn/browser';
import { Copy, Download, Fingerprint, KeyRound, Laptop, Lock, ShieldCheck, Upload } from 'lucide-react';
import { api, download } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useSpace } from '../context/SpaceContext.jsx';
import { useNotificationSettings, useUpdateNotificationSettings } from '../hooks/api.js';
import { PasswordInput } from '../pages/Login.jsx';
import { Badge, Button, Card, CardHeader, ErrorNote, Field, Input, Select, SettingRow, Skeleton, Switch } from './ui.jsx';
import { localeTag, t, tn } from '../lib/i18n.js';

const when = (d) => new Intl.DateTimeFormat(localeTag(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(d));
const day = (d) => new Intl.DateTimeFormat(localeTag(), { dateStyle: 'medium' }).format(new Date(d));
const LOCK_TIMES = [1, 5, 15, 30, 60];

function BackupCodes({ codes, onDone }) {
  const text = `${t('Spendwise backup codes (each works once)')}\n\n${codes.join('\n')}\n`;
  async function copy() {
    try { await navigator.clipboard.writeText(text); toast.success(t('Copied')); } catch { toast.error(t('Copying isn’t allowed here; download them instead')); }
  }
  function save() {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = 'spendwise-backup-codes.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
      <p className="text-sm font-medium">{t('Save these backup codes now')}</p>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{t('If you lose your phone, each one signs you in once instead of a code. They won’t be shown again.')}</p>
      <ul className="mt-3 grid grid-cols-2 gap-2 font-mono text-sm sm:grid-cols-5" aria-label={t('Backup codes')}>
        {codes.map((c) => <li key={c} className="rounded bg-white px-2 py-1 text-center dark:bg-slate-900">{c}</li>)}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={copy}><Copy className="h-4 w-4" aria-hidden="true" /> {t('Copy')}</Button>
        <Button size="sm" variant="secondary" onClick={save}><Download className="h-4 w-4" aria-hidden="true" /> {t('Download')}</Button>
        <Button size="sm" onClick={onDone}>{t('I’ve saved them')}</Button>
      </div>
    </div>
  );
}

export function TwoFactorCard() {
  const uid = useId();
  const { refreshUser } = useAuth();
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['security', '2fa'], queryFn: () => api('/auth/2fa') });
  const [setup, setSetup] = useState(null); // { secret, otpauthUrl }
  const [qr, setQr] = useState(null);
  const [codes, setCodes] = useState(null);
  const [mode, setMode] = useState(null); // 'disable' | 'regenerate'
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!setup) { setQr(null); return; }
    QRCode.toDataURL(setup.otpauthUrl, { margin: 1, width: 192 }).then(setQr).catch(() => setQr(null));
  }, [setup]);

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['security'] }), refreshUser()]);
  const run = async (fn) => {
    setError(null);
    setBusy(true);
    try { await fn(); } catch (err) { setError(err); } finally { setBusy(false); }
  };
  const start = () => run(async () => { setSetup(await api('/auth/2fa/setup', { method: 'POST' })); setCode(''); });
  const confirm = (e) => {
    e.preventDefault();
    run(async () => {
      const r = await api('/auth/2fa/enable', { method: 'POST', body: { code: code.trim() } });
      setSetup(null);
      setCode('');
      setCodes(r.backupCodes);
      toast.success(t('Two-factor login is on'));
      await refresh();
    });
  };
  const submitMode = (e) => {
    e.preventDefault();
    run(async () => {
      if (mode === 'disable') {
        await api('/auth/2fa/disable', { method: 'POST', body: { password, code: code.trim() } });
        toast.success(t('Two-factor login is off'));
      } else {
        setCodes((await api('/auth/2fa/backup-codes', { method: 'POST', body: { code: code.trim() } })).backupCodes);
      }
      setMode(null);
      setCode('');
      setPassword('');
      await refresh();
    });
  };
  const s = status.data;

  return (
    <Card>
      <CardHeader title={t('Two-factor login')} subtitle={t('Ask for a code from an authenticator app (Google Authenticator, Microsoft Authenticator, Aegis…) as well as the password.')} />
      {status.error && <ErrorNote error={status.error} onRetry={status.refetch} />}
      {error && <div className="mb-3"><ErrorNote error={error} /></div>}
      {!s ? <Skeleton className="h-16 w-full" /> : codes ? <BackupCodes codes={codes} onDone={() => setCodes(null)} /> : setup ? (
        <form onSubmit={confirm} className="space-y-4" noValidate>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            {qr ? <img src={qr} alt={t('QR code to scan with your authenticator app')} width={192} height={192} className="rounded-lg bg-white p-2 ring-1 ring-slate-200" /> : <Skeleton className="h-48 w-48" />}
            <div className="min-w-0 text-sm text-slate-600 dark:text-slate-300">
              <p>{t('1. In your authenticator app, add an account and scan this code.')}</p>
              <p className="mt-2">Can’t scan? Type this key instead:</p>
              <p className="mt-1 break-all font-mono text-base text-slate-900 dark:text-white" data-testid="totp-secret">{setup.secret}</p>
              <p className="mt-3">{t('2. Enter the 6-digit code it shows.')}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Field label={t('Code from the app')} htmlFor={`${uid}-c`}><Input id={`${uid}-c`} value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="w-36" autoFocus /></Field>
            <Button type="submit" loading={busy} disabled={code.trim().length !== 6}>{t('Turn on')}</Button>
            <Button variant="ghost" onClick={() => setSetup(null)}>{t('Cancel')}</Button>
          </div>
        </form>
      ) : s.enabled ? (
        <div className="space-y-4">
          <p className="flex items-center gap-2 text-sm"><ShieldCheck className="h-4 w-4 text-emerald-600" aria-hidden="true" /> {tn(s.backupCodesLeft, 'On since {date}. {n} backup code left.', 'On since {date}. {n} backup codes left.', { date: day(s.enabledAt) })}</p>
          {mode ? (
            <form onSubmit={submitMode} className="grid grid-cols-1 gap-3 sm:grid-cols-2" noValidate>
              {mode === 'disable' && (
                <Field label={t('Your password')} htmlFor={`${uid}-p`}><PasswordInput id={`${uid}-p`} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></Field>
              )}
              <Field label={t('Code from the app (or a backup code)')} htmlFor={`${uid}-m`}><Input id={`${uid}-m`} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" maxLength={20} autoFocus /></Field>
              <div className="flex gap-2 sm:col-span-2">
                <Button type="submit" variant={mode === 'disable' ? 'danger' : 'primary'} loading={busy}>{mode === 'disable' ? t('Turn off') : t('Make new codes')}</Button>
                <Button variant="ghost" onClick={() => { setMode(null); setError(null); }}>{t('Cancel')}</Button>
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setMode('regenerate')}><KeyRound className="h-4 w-4" aria-hidden="true" /> {t('New backup codes')}</Button>
              <Button variant="secondary" onClick={() => setMode('disable')}>{t('Turn off')}</Button>
            </div>
          )}
        </div>
      ) : (
        <Button onClick={start} loading={busy}><ShieldCheck className="h-4 w-4" aria-hidden="true" /> {t('Set up two-factor login')}</Button>
      )}
    </Card>
  );
}

export function AppLockCard() {
  const uid = useId();
  const { user, refreshUser, lockNow } = useAuth();
  const lock = user.appLock;
  const [form, setForm] = useState(null); // 'on' | 'change' | 'off'
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [minutes, setMinutes] = useState(lock.timeoutMinutes);
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [platform, setPlatform] = useState(false);
  useEffect(() => {
    platformAuthenticatorIsAvailable().then(setPlatform).catch(() => setPlatform(false));
  }, []);

  const reset = () => { setForm(null); setPin(''); setPin2(''); setPassword(''); setErrors({}); };
  async function submit(e) {
    e.preventDefault();
    const local = {};
    if (form !== 'off' && (form === 'on' || pin)) {
      if (!/^\d{4,8}$/.test(pin)) local.pin = t('The PIN is 4 to 8 digits');
      else if (pin !== pin2) local.pin2 = t('The two PINs don’t match');
    }
    if (!password) local.password = t('Enter your password');
    setErrors(local);
    if (Object.keys(local).length) return;
    setBusy(true);
    try {
      if (form === 'off') await api('/auth/lock/disable', { method: 'POST', body: { password } });
      else await api('/auth/lock', { method: 'PUT', body: { password, timeoutMinutes: Number(minutes), ...(pin && { pin }) } });
      await refreshUser();
      toast.success(form === 'off' ? t('App lock is off') : form === 'on' ? t('App lock is on') : t('App lock updated'));
      reset();
    } catch (err) {
      setErrors(err.code === 'wrong_password' ? { password: err.message } : { ...err.fieldErrors(), form: err.details.length ? undefined : err.message });
    } finally {
      setBusy(false);
    }
  }
  async function addFingerprint() {
    setBusy(true);
    try {
      const optionsJSON = await api('/auth/lock/passkeys/options', { method: 'POST' });
      const response = await startRegistration({ optionsJSON });
      await api('/auth/lock/passkeys', { method: 'POST', body: { response } });
      await refreshUser();
      toast.success(t('Fingerprint added for this device'));
    } catch (err) {
      toast.error(err.name === 'NotAllowedError' ? t('The fingerprint set-up was cancelled') : err.message);
    } finally {
      setBusy(false);
    }
  }
  async function removeFingerprint(id) {
    try { await api(`/auth/lock/passkeys/${id}`, { method: 'DELETE' }); await refreshUser(); toast.success(t('Fingerprint removed')); } catch (err) { toast.error(err.message); }
  }

  return (
    <Card>
      <CardHeader title={t('App lock')} subtitle={t('Ask for a PIN or your fingerprint when you come back to Spendwise after a while.')} />
      {form ? (
        <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2" noValidate>
          {errors.form && <div className="sm:col-span-2"><ErrorNote error={{ message: errors.form }} /></div>}
          {form !== 'off' && (
            <>
              <Field label={form === 'on' ? t('PIN (4 to 8 digits)') : t('New PIN (optional)')} htmlFor={`${uid}-p1`} error={errors.pin}>
                <Input id={`${uid}-p1`} type="password" inputMode="numeric" autoComplete="new-password" maxLength={8} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
              </Field>
              <Field label={t('PIN again')} htmlFor={`${uid}-p2`} error={errors.pin2}>
                <Input id={`${uid}-p2`} type="password" inputMode="numeric" autoComplete="new-password" maxLength={8} value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))} />
              </Field>
              <Field label={t('Lock after')} htmlFor={`${uid}-t`}>
                <Select id={`${uid}-t`} value={minutes} onChange={(e) => setMinutes(e.target.value)}>
                  {LOCK_TIMES.map((m) => <option key={m} value={m}>{m === 60 ? t('1 hour without use') : tn(m, '{n} minute without use', '{n} minutes without use')}</option>)}
                </Select>
              </Field>
            </>
          )}
          <Field label={t('Your password')} htmlFor={`${uid}-pw`} error={errors.password}>
            <PasswordInput id={`${uid}-pw`} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </Field>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" variant={form === 'off' ? 'danger' : 'primary'} loading={busy}>{form === 'on' ? t('Turn on') : form === 'off' ? t('Turn off') : t('Save')}</Button>
            <Button variant="ghost" onClick={reset}>{t('Cancel')}</Button>
          </div>
        </form>
      ) : lock.enabled ? (
        <div className="space-y-4">
          <p className="flex items-center gap-2 text-sm"><Lock className="h-4 w-4 text-emerald-600" aria-hidden="true" /> {tn(lock.timeoutMinutes, 'On. Locks after {n} minute without use, on every device you’re signed in on.', 'On. Locks after {n} minutes without use, on every device you’re signed in on.')}</p>
          <div>
            <p className="text-sm font-medium">{t('Fingerprint')}</p>
            {lock.passkeys.length ? (
              <ul className="mt-2 divide-y divide-slate-900/[0.06] text-sm dark:divide-white/[0.06]">
                {lock.passkeys.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 py-2">
                    <Fingerprint className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{p.label}</span>
                      <span className="block text-xs text-slate-500 dark:text-slate-400">{t('Added {date}', { date: day(p.createdAt) })}{p.lastUsedAt ? `, ${t('last used {date}', { date: when(p.lastUsedAt) })}` : ''}</span>
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => removeFingerprint(p.id)}>{t('Remove')}</Button>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('None yet; the PIN unlocks.')}</p>}
            {platform ? (
              <Button size="sm" variant="secondary" className="mt-2" onClick={addFingerprint} loading={busy}><Fingerprint className="h-4 w-4" aria-hidden="true" /> {t('Add fingerprint on this device')}</Button>
            ) : <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('This device has no fingerprint or face sensor the browser can use.')}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={lockNow}><Lock className="h-4 w-4" aria-hidden="true" /> {t('Lock now')}</Button>
            <Button variant="secondary" onClick={() => { setMinutes(lock.timeoutMinutes); setForm('change'); }}>{t('Change PIN or time')}</Button>
            <Button variant="secondary" onClick={() => setForm('off')}>{t('Turn off')}</Button>
          </div>
        </div>
      ) : (
        <Button onClick={() => setForm('on')}><Lock className="h-4 w-4" aria-hidden="true" /> {t('Turn on app lock')}</Button>
      )}
      <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">{t('While locked, the server refuses to send your data to this device until the PIN or fingerprint is given. Five wrong PINs sign the device out.')}</p>
    </Card>
  );
}

export function DevicesCard() {
  const qc = useQueryClient();
  const sessions = useQuery({ queryKey: ['security', 'sessions'], queryFn: () => api('/auth/sessions') });
  const settings = useNotificationSettings();
  const update = useUpdateNotificationSettings();
  const [busy, setBusy] = useState(null);
  async function signOut(id) {
    setBusy(id);
    try {
      if (id === 'others') {
        const r = await api('/auth/sessions/sign-out-others', { method: 'POST' });
        toast.success(tn(r.signedOut, 'Signed out {n} other device', 'Signed out {n} other devices'));
      } else {
        await api(`/auth/sessions/${id}`, { method: 'DELETE' });
        toast.success(t('Signed out that device'));
      }
      await qc.invalidateQueries({ queryKey: ['security', 'sessions'] });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  }
  const list = sessions.data?.sessions;
  const others = list?.filter((x) => !x.current).length ?? 0;
  const s = settings.data;
  return (
    <Card>
      <CardHeader title={t('Signed-in devices')} subtitle={t('Where your account is signed in right now.')} />
      {sessions.error && <ErrorNote error={sessions.error} onRetry={sessions.refetch} />}
      {!list ? <Skeleton className="h-24 w-full" /> : (
        <ul className="divide-y divide-slate-900/[0.05] dark:divide-white/[0.05]" aria-label={t('Signed-in devices')}>
          {list.map((x) => (
            <li key={x.id} className="flex items-center gap-3 py-3">
              <Laptop className="h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">{x.label}{x.current && <Badge tone="green">{t('This device')}</Badge>}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{t('Signed in {date} · last active {seen}', { date: when(x.signedInAt), seen: when(x.lastSeenAt) })}{x.ip ? ` · ${x.ip}` : ''}</p>
              </div>
              {!x.current && <Button size="sm" variant="ghost" onClick={() => signOut(x.id)} loading={busy === x.id}>{t('Sign out')}</Button>}
            </li>
          ))}
        </ul>
      )}
      {others > 0 && <Button variant="secondary" className="mt-3" onClick={() => signOut('others')} loading={busy === 'others'}>{t('Sign out all other devices')}</Button>}
      {s && (
        <div className="mt-5 border-t border-slate-900/[0.06] pt-4 dark:border-white/[0.06]">
          <SettingRow title={t('Email me about new sign-ins')} control={<Switch checked={s.loginEmail} onChange={async (v) => { try { await update.mutateAsync({ loginEmail: v }); } catch (err) { toast.error(err.message); } }} disabled={!s.email.configured} label={t('Email me about new sign-ins')} />}>
            {s.email.configured ? t('When your account is signed in to from a device or browser it hasn’t been used on before.') : t('Email isn’t set up on this server.')}
          </SettingRow>
        </div>
      )}
    </Card>
  );
}

export function BackupCard() {
  const uid = useId();
  const qc = useQueryClient();
  const { space } = useSpace();
  const [file, setFile] = useState(null); // { name, backup }
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const spaceName = space?.kind === 'shared' ? space.name : 'your personal space';

  async function save() {
    setDownloading(true);
    try { await download('/backup'); } catch (err) { toast.error(err.message); } finally { setDownloading(false); }
  }
  async function pick(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    setError(null);
    if (!f) return;
    try {
      const backup = JSON.parse(await f.text());
      if (backup?.app !== 'spendwise' || !backup.data) throw new Error(t('This isn’t a Spendwise backup file'));
      setFile({ name: f.name, backup });
    } catch (err) {
      setError({ message: err instanceof SyntaxError ? t('That file isn’t valid JSON') : err.message });
    }
  }
  async function restore(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api('/backup/restore', { method: 'POST', body: { password, backup: file.backup } });
      toast.success(t('Restored {entries} and {accounts}', { entries: tn(r.restored.transactions, '{n} entry', '{n} entries'), accounts: tn(r.restored.accounts, '{n} account', '{n} accounts') }));
      setFile(null);
      setPassword('');
      qc.invalidateQueries();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  const c = file?.backup.counts ?? {};
  return (
    <Card>
      <CardHeader title={t('Backup and restore')} subtitle={t('Everything in {space} as one JSON file: accounts, entries, budgets, goals, loans, bills, investments and more.', { space: spaceName })} />
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={save} loading={downloading}><Download className="h-4 w-4" aria-hidden="true" /> {t('Download backup')}</Button>
        <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg px-4 text-sm font-medium ring-1 ring-slate-300 hover:bg-slate-50 dark:ring-slate-700 dark:hover:bg-slate-800">
          <Upload className="h-4 w-4" aria-hidden="true" /> {t('Restore from a backup')}
          <input type="file" accept="application/json,.json" className="sr-only" onChange={pick} aria-label={t('Choose a backup file')} />
        </label>
      </div>
      {error && <div className="mt-3"><ErrorNote error={error} /></div>}
      {file && (
        <form onSubmit={restore} className="mt-4 space-y-3 rounded-lg border border-rose-200 p-4 dark:border-rose-500/30" noValidate>
          <p className="text-sm"><span className="font-medium">{file.name}</span>{file.backup.exportedAt ? `, ${t('made {date}', { date: when(file.backup.exportedAt) })}` : ''}: {t('{entries}, {accounts}, {budgets} budgets, {goals} goals, {holdings} investments.', { entries: tn(c.transactions ?? 0, '{n} entry', '{n} entries'), accounts: tn(c.accounts ?? 0, '{n} account', '{n} accounts'), budgets: c.budgets ?? 0, goals: c.goals ?? 0, holdings: c.holdings ?? 0 })}</p>
          <p className="text-sm text-rose-700 dark:text-rose-300">{t('This replaces everything in {space} with the backup. Receipt photos aren’t in backups; entries keep theirs only if the photo is still stored here.', { space: spaceName })}</p>
          <Field label={t('Your password')} htmlFor={`${uid}-pw`}><PasswordInput id={`${uid}-pw`} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></Field>
          <div className="flex gap-2">
            <Button type="submit" variant="danger" loading={busy} disabled={!password}>{t('Replace with this backup')}</Button>
            <Button variant="ghost" onClick={() => { setFile(null); setError(null); }}>{t('Cancel')}</Button>
          </div>
        </form>
      )}
    </Card>
  );
}

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Bell, Mail, Monitor, Moon, Smartphone, Sun } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import {
  useNotificationSettings, useReportSettings, useSendTestPush, useSendTestReport, useUpdateNotificationSettings, useUpdateReportSettings,
} from '../hooks/api.js';
import { currentSubscription, disablePush, enablePush, pushSupport } from '../lib/push.js';
import { api } from '../lib/api.js';
import { currentMonth, shiftMonth } from '../lib/dates.js';
import { formatMonth } from '../lib/format.js';
import { useInstallPrompt } from '../lib/pwa.js';
import { highContrast, numberStyle, privacyOn, setHighContrast, setNumberStyle, setPrivacy, setTextSize, textSize } from '../lib/prefs.js';
import { t, tn } from '../lib/i18n.js';
import { Modal } from '../components/Modal.jsx';
import { Button, Card, CardHeader, ErrorNote, Field, Input, PageHeader, Segmented, Select, SettingRow, Skeleton, Switch } from '../components/ui.jsx';
import { AppLockCard, BackupCard, DevicesCard, TwoFactorCard } from '../components/SecuritySettings.jsx';
import { LanguageSwitch } from '../components/LanguageSwitch.jsx';
import { PasswordInput } from './Login.jsx';
import { useResendVerification } from '../hooks/api.js';
import { passwordProblem } from './Register.jsx';

function Profile() {
  const { user, updateUser } = useAuth();
  const resend = useResendVerification();
  const [name, setName] = useState(user.name);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api('/auth/me', { method: 'PATCH', body: { name: name.trim() } });
      updateUser(res.user);
      toast.success(t('Name updated'));
    } catch (err) {
      setError(err.fieldErrors().name ?? err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader title={t('Profile')} />
      <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2" noValidate>
        <Field label={t('Name')} htmlFor="profile-name" error={error}>
          <Input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} error={error} />
        </Field>
        <Field label={t('Email')} htmlFor="profile-email"
          hint={user.emailVerified ? t('Confirmed. Your email can’t be changed.') : t('Not confirmed yet, so nothing is emailed to it. Your email can’t be changed.')}>
          <Input id="profile-email" value={user.email} disabled />
          {!user.emailVerified && (
            <Button type="button" size="sm" variant="secondary" className="mt-2" loading={resend.isPending}
              onClick={() => resend.mutate(undefined, { onSuccess: (r) => toast.success(t('Link sent to {email}. It works for 24 hours.', { email: r.sentTo })), onError: (err) => toast.error(err.message) })}>
              {t('Send confirmation link')}
            </Button>
          )}
        </Field>
        <div className="sm:col-span-2">
          <Button type="submit" loading={busy} disabled={!name.trim() || name.trim() === user.name}>{t('Save')}</Button>
        </div>
      </form>
    </Card>
  );
}

function Appearance() {
  const { theme, setTheme } = useTheme();
  const { installed, canInstall, install } = useInstallPrompt();
  const [privacy, setPrivacyState] = useState(privacyOn);
  const [size, setSize] = useState(textSize);
  const [contrast, setContrast] = useState(highContrast);
  return (
    <Card>
      <CardHeader title={t('Appearance and app')} />
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">{t('Language')}</p>
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('The app’s language on this device. The Telegram bot answers in it too.')}</p>
          </div>
          <LanguageSwitch />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-medium">{t('Theme')}</p>
          <Segmented label={t('Theme')} value={theme} onChange={setTheme} options={[
            { value: 'light', label: t('Light'), icon: Sun },
            { value: 'system', label: t('System'), icon: Monitor },
            { value: 'dark', label: t('Dark'), icon: Moon },
          ]} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">{t('Text size')}</p>
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('Makes all text and buttons bigger on this device.')}</p>
          </div>
          <Segmented label={t('Text size')} value={size} onChange={(v) => { setTextSize(v); setSize(v); }} options={[
            { value: 'normal', label: t('Normal') },
            { value: 'large', label: t('Large') },
            { value: 'larger', label: t('Larger') },
          ]} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">{t('High contrast')}</p>
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('Darker grey text and stronger borders, easier to read in sunlight.')}</p>
          </div>
          <Switch checked={contrast} onChange={(on) => { setHighContrast(on); setContrast(on); }} label={t('High contrast')} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">{t('Big numbers')}</p>
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('Lakh and crore (₹1,23,456 · ₹1.2L) or million (₹123,456 · ₹1.2M).')}</p>
          </div>
          <Segmented label={t('Number style')} value={numberStyle()} onChange={setNumberStyle} options={[
            { value: 'indian', label: t('Lakh / crore') },
            { value: 'international', label: t('Million') },
          ]} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">{t('Privacy mode')}</p>
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('Blur every amount for using the app in public. Hover or tap an amount to peek. Shortcut: P.')}</p>
          </div>
          <Switch checked={privacy} onChange={(on) => { setPrivacy(on); setPrivacyState(on); }} label={t('Privacy mode')} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">{t('Install Spendwise')}</p>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {installed ? t('Installed on this device.')
                : canInstall ? t('Add it to your home screen or desktop like an app.')
                  : t('Use your browser’s menu: “Install app” or “Add to Home Screen”.')}
            </p>
          </div>
          {canInstall && !installed && (
            <Button variant="secondary" onClick={install}><Smartphone className="h-4 w-4" aria-hidden="true" /> {t('Install')}</Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function MonthlyEmail() {
  const settings = useReportSettings();
  const update = useUpdateReportSettings();
  const sendTest = useSendTestReport();
  const lastMonth = shiftMonth(currentMonth(), -1);
  const [month, setMonth] = useState(lastMonth);
  const [preview, setPreview] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const s = settings.data;

  async function toggle(enabled) {
    try {
      await update.mutateAsync({ enabled });
      toast.success(enabled ? t('On. Your first report, for {month}, arrives early next month.', { month: formatMonth(currentMonth()) }) : t('Monthly emails turned off'));
    } catch (err) {
      toast.error(err.message);
    }
  }
  async function test() {
    try {
      const res = await sendTest.mutateAsync({ month });
      toast.success(t('Sent to {email}', { email: res.sentTo }));
    } catch (err) {
      toast.error(err.message);
    }
  }
  async function openPreview() {
    setLoadingPreview(true);
    try {
      setPreview(await api('/reports/preview', { query: { month } }));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoadingPreview(false);
    }
  }

  const months = Array.from({ length: 12 }, (_, i) => shiftMonth(currentMonth(), -i));
  return (
    <Card>
      <CardHeader title={t('Monthly email report')} subtitle={t('A summary of last month on the 1st: totals, top categories and budgets.')} />
      {settings.error && <ErrorNote error={settings.error} onRetry={settings.refetch} />}
      {!s ? <Skeleton className="h-16 w-full" /> : (
        <div className="space-y-5">
          {!s.emailConfigured && (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
              {t('Email isn’t set up on this server, so monthly reports are unavailable.')}
            </p>
          )}
          {s.emailConfigured && s.emailVerified === false && (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
              {t('Confirm your email address first: open the link we sent you, or send a new one from Profile above.')}
            </p>
          )}
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">{t('Send me a monthly report')}</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {s.enabled ? (s.lastSentMonth ? t('Covered up to {month}.', { month: formatMonth(s.lastSentMonth) }) : t('On.')) : t('Off.')}
              </p>
            </div>
            <Switch checked={s.enabled} onChange={toggle} disabled={!s.emailConfigured || (s.emailVerified === false && !s.enabled) || update.isPending} label={t('Monthly email report')} />
          </div>
          <div className="flex flex-wrap items-end gap-2 border-t border-slate-900/[0.06] pt-4 dark:border-white/[0.06]">
            <Field label={t('Report month')} htmlFor="report-month" className="w-48">
              <Select id="report-month" value={month} onChange={(e) => setMonth(e.target.value)}>
                {months.map((m) => <option key={m} value={m}>{formatMonth(m)}</option>)}
              </Select>
            </Field>
            <Button variant="secondary" onClick={openPreview} loading={loadingPreview}>{t('Preview')}</Button>
            <Button variant="secondary" onClick={test} loading={sendTest.isPending} disabled={!s.emailConfigured || s.emailVerified === false}>
              <Mail className="h-4 w-4" aria-hidden="true" /> {t('Email it to me now')}
            </Button>
          </div>
        </div>
      )}
      <Modal open={preview !== null} onClose={() => setPreview(null)} title={preview?.subject ?? t('Preview')} size="lg">
        {/* sandbox="" keeps the email's HTML from running scripts or reaching the app. */}
        {preview && <iframe title={t('Email preview')} srcDoc={preview.html} sandbox="" className="h-[60vh] w-full rounded-lg bg-white ring-1 ring-slate-200" />}
      </Modal>
    </Card>
  );
}

const REMINDER_TIMES = Array.from({ length: 13 }, (_, i) => `${String(17 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);

function Notifications() {
  const settings = useNotificationSettings();
  const update = useUpdateNotificationSettings();
  const testPush = useSendTestPush();
  const [support] = useState(pushSupport);
  const [here, setHere] = useState(null); // is this browser subscribed? null while checking
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    currentSubscription().then((sub) => setHere(Boolean(sub))).catch(() => setHere(false));
  }, []);
  const s = settings.data;

  const change = async (changes) => {
    try { await update.mutateAsync(changes); } catch (err) { toast.error(err.message); }
  };
  async function togglePush(on) {
    setBusy(true);
    try {
      if (on) await enablePush(s.push.publicKey);
      else await disablePush();
      setHere(on);
      toast.success(on ? t('Notifications are on in this browser') : t('Notifications are off in this browser'));
      settings.refetch();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    try {
      const r = await testPush.mutateAsync();
      toast.success(r.sent ? tn(r.sent, 'Sent to {n} device. It should appear in a few seconds.', 'Sent to {n} devices. It should appear in a few seconds.') : t('No device could be reached'));
    } catch (err) {
      toast.error(err.message);
    }
  }

  const blocked = support.supported && support.permission === 'denied' && !here;
  let pushStatus;
  if (!support.supported) pushStatus = support.reason;
  else if (!s?.push.configured) pushStatus = t('Push isn’t set up on this server.');
  else if (blocked) pushStatus = t('Blocked for this site. Allow notifications in the browser’s site settings, then turn this on.');
  else if (here) pushStatus = s.devices > 1 ? tn(s.devices - 1, 'On here, and on {n} other device.', 'On here, and on {n} other devices.') : t('On here.');
  else pushStatus = s.devices ? tn(s.devices, 'Off here (on for {n} other device).', 'Off here (on for {n} other devices).') : t('Off.');

  const noEmail = t('Email isn’t set up on this server.');
  return (
    <Card>
      <CardHeader title={t('Notifications')} subtitle={t('Budget alerts at 80% and 100%, and a reminder to log the day’s spending.')} />
      {settings.error && <ErrorNote error={settings.error} onRetry={settings.refetch} />}
      {!s || here === null ? <Skeleton className="h-32 w-full" /> : (
        <div className="space-y-5">
          <SettingRow title={t('Notifications in this browser')} control={(
            <Switch checked={here} onChange={togglePush} disabled={busy || !support.supported || !s.push.configured} label={t('Notifications in this browser')} />
          )}>
            {pushStatus}
          </SettingRow>
          {here && (
            <Button variant="secondary" size="sm" onClick={test} loading={testPush.isPending}><Bell className="h-4 w-4" aria-hidden="true" /> {t('Send a test notification')}</Button>
          )}
          <div className="space-y-4 border-t border-slate-900/[0.06] pt-4 dark:border-white/[0.06]">
            <SettingRow title={t('Budget alerts by notification')} control={<Switch checked={s.budgetPush} onChange={(v) => change({ budgetPush: v })} label={t('Budget alerts by notification')} />}>
              {t('When a monthly or weekly budget reaches 80% and again at 100%. Everyone in a shared space who has this on gets them.')}
            </SettingRow>
            <SettingRow title={t('Budget alerts by email')} control={<Switch checked={s.budgetEmail} onChange={(v) => change({ budgetEmail: v })} disabled={!s.email.configured} label={t('Budget alerts by email')} />}>
              {s.email.configured ? t('The same alerts, sent to your email address.') : noEmail}
            </SettingRow>
          </div>
          <div className="space-y-4 border-t border-slate-900/[0.06] pt-4 dark:border-white/[0.06]">
            <SettingRow title={t('Bill and maturity reminders by notification')} control={<Switch checked={s.billPush} onChange={(v) => change({ billPush: v })} label={t('Bill and maturity reminders by notification')} />}>
              {t('3 days before each bill on the Bills page is due, and a week before an FD, RD or PPF matures.')}
            </SettingRow>
            <SettingRow title={t('Bill and maturity reminders by email')} control={<Switch checked={s.billEmail} onChange={(v) => change({ billEmail: v })} disabled={!s.email.configured} label={t('Bill and maturity reminders by email')} />}>
              {s.email.configured ? t('The same reminders, sent to your email address.') : noEmail}
            </SettingRow>
          </div>
          <div className="space-y-3 border-t border-slate-900/[0.06] pt-4 dark:border-white/[0.06]">
            <SettingRow title={t('Daily reminder')} control={<Switch checked={s.reminder} onChange={(v) => change({ reminder: v })} label={t('Daily reminder')} />}>
              {t('A notification if you haven’t added anything that day.')}
            </SettingRow>
            {s.reminder && (
              <Field label={t('Remind me at')} htmlFor="reminder-time" className="w-40">
                <Select id="reminder-time" value={s.reminderTime} onChange={(e) => change({ reminderTime: e.target.value })}>
                  {[...new Set([...REMINDER_TIMES, s.reminderTime])].sort().map((x) => <option key={x} value={x}>{x}</option>)}
                </Select>
              </Field>
            )}
            {s.reminder && !here && <p className="text-sm text-amber-700 dark:text-amber-300">{t('Turn on notifications in this browser (above) to receive the reminder here.')}</p>}
          </div>
        </div>
      )}
    </Card>
  );
}

function Security() {
  const { replaceToken, endSession } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  async function submit(e) {
    e.preventDefault();
    const problem = passwordProblem(next);
    const local = {};
    if (!current) local.currentPassword = t('Enter your current password');
    if (problem) local.newPassword = problem;
    setErrors(local);
    if (Object.keys(local).length) return;
    setBusy(true);
    try {
      const res = await api('/auth/password', { method: 'POST', body: { currentPassword: current, newPassword: next } });
      replaceToken(res.token);
      setCurrent('');
      setNext('');
      toast.success(t('Password changed. Other devices were logged out.'));
    } catch (err) {
      setErrors(err.code === 'wrong_password' ? { currentPassword: err.message } : { ...err.fieldErrors(), form: err.details.length ? undefined : err.message });
    } finally {
      setBusy(false);
    }
  }

  async function logoutEverywhere() {
    setSigningOut(true);
    try {
      await api('/auth/logout-all', { method: 'POST' });
      endSession();
      toast.success(t('Logged out on every device'));
    } catch (err) {
      toast.error(err.message);
      setSigningOut(false);
    }
  }

  return (
    <Card>
      <CardHeader title={t('Password')} />
      <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2" noValidate>
        {errors.form && <div className="sm:col-span-2"><ErrorNote error={{ message: errors.form }} /></div>}
        <Field label={t('Current password')} htmlFor="pw-current" error={errors.currentPassword}>
          <PasswordInput id="pw-current" value={current} onChange={(e) => setCurrent(e.target.value)} error={errors.currentPassword} autoComplete="current-password" />
        </Field>
        <Field label={t('New password')} htmlFor="pw-new" error={errors.newPassword} hint={t('At least 8 characters, with a letter and a number.')}>
          <PasswordInput id="pw-new" value={next} onChange={(e) => setNext(e.target.value)} error={errors.newPassword} autoComplete="new-password" />
        </Field>
        <div className="sm:col-span-2"><Button type="submit" loading={busy}>{t('Change password')}</Button></div>
      </form>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-900/[0.06] pt-4 dark:border-white/[0.06]">
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('Lost a phone or used a shared computer? End every session, including this one.')}</p>
        <Button variant="secondary" onClick={logoutEverywhere} loading={signingOut}>{t('Log out everywhere')}</Button>
      </div>
    </Card>
  );
}

function DangerZone() {
  const { endSession } = useAuth();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api('/auth/me', { method: 'DELETE', body: { password } });
      endSession();
      toast.success(t('Your account and all its data were deleted'));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }
  return (
    <Card className="ring-rose-200 dark:ring-rose-500/30">
      <CardHeader title={t('Delete account')} subtitle={t('Permanently deletes your account, transactions, budgets and recurring rules.')} />
      <Button variant="danger" onClick={() => { setOpen(true); setPassword(''); setError(null); }}>{t('Delete my account')}</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={t('Delete your account?')}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>{t('Cancel')}</Button>
            <Button variant="danger" onClick={remove} loading={busy} disabled={!password}>{t('Delete forever')}</Button>
          </>
        )}>
        <p className="text-sm text-slate-600 dark:text-slate-300">{t('This can’t be undone. Download a backup first if you want to keep a copy.')}</p>
        <Field label={t('Your password')} htmlFor="delete-pw" error={error} className="mt-4">
          <PasswordInput id="delete-pw" value={password} onChange={(e) => setPassword(e.target.value)} error={error} autoComplete="current-password" />
        </Field>
      </Modal>
    </Card>
  );
}

export default function Settings() {
  return (
    <>
      <PageHeader title={t('Settings')} />
      <div className="mx-auto max-w-3xl space-y-4">
        <Profile />
        <Appearance />
        <Notifications />
        <MonthlyEmail />
        <Security />
        <TwoFactorCard />
        <AppLockCard />
        <DevicesCard />
        <BackupCard />
        <DangerZone />
      </div>
    </>
  );
}

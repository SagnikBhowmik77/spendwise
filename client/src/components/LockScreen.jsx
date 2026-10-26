import { useState } from 'react';
import toast from 'react-hot-toast';
import { Fingerprint, Lock } from 'lucide-react';
import { browserSupportsWebAuthn, startAuthentication } from '@simplewebauthn/browser';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Logo } from './Brand.jsx';
import { Button, ErrorNote, Field, Input } from './ui.jsx';
import { t } from '../lib/i18n.js';

// Shown instead of the app while this device is locked. The server refuses data until it's unlocked.
export default function LockScreen() {
  const { user, unlocked, logout } = useAuth();
  const [pin, setPin] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const canFingerprint = user.appLock.passkeys.length > 0 && browserSupportsWebAuthn();

  async function withPin(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api('/auth/lock/unlock', { method: 'POST', body: { pin } });
      unlocked();
    } catch (err) {
      setPin('');
      setBusy(false);
      // Too many wrong PINs: the device was signed out, so this screen is about to close.
      if (err.status === 401) toast.error(err.message, { id: 'session-ended', duration: 8000 });
      else setError(err);
    }
  }

  async function withFingerprint() {
    setError(null);
    setBusy(true);
    try {
      const optionsJSON = await api('/auth/lock/unlock/options', { method: 'POST' });
      const response = await startAuthentication({ optionsJSON });
      await api('/auth/lock/unlock/passkey', { method: 'POST', body: { response } });
      unlocked();
    } catch (err) {
      setBusy(false);
      setError({ message: err.name === 'NotAllowedError' ? t('The fingerprint check was cancelled. Try again or use your PIN.') : err.message });
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-slate-50 px-4 dark:bg-slate-950">
      <div className="w-full max-w-xs text-center">
        <Logo className="justify-center" />
        <span className="mx-auto mt-8 grid h-14 w-14 place-items-center rounded-full bg-white text-slate-700 shadow-xs ring-1 ring-slate-900/[0.06] dark:bg-slate-900 dark:text-slate-200 dark:ring-white/[0.08]">
          <Lock className="h-6 w-6" aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-heading font-semibold text-slate-900 dark:text-white">{t('Spendwise is locked')}</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('Hi {name}. Enter your PIN to carry on.', { name: user.name })}</p>
        <form onSubmit={withPin} className="mt-6 space-y-3 text-left" noValidate>
          {error && <ErrorNote error={error} />}
          <Field label={t('PIN')} htmlFor="lock-pin">
            <Input id="lock-pin" type="password" inputMode="numeric" autoComplete="off" maxLength={8} value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} autoFocus className="text-center text-heading tracking-[0.5em]" />
          </Field>
          <Button type="submit" className="w-full" loading={busy} disabled={pin.length < 4}>{t('Unlock')}</Button>
        </form>
        {canFingerprint && (
          <Button variant="secondary" className="mt-3 w-full" onClick={withFingerprint} disabled={busy}>
            <Fingerprint className="h-4 w-4" aria-hidden="true" /> {t('Use fingerprint')}
          </Button>
        )}
        <button type="button" onClick={logout} className="mt-6 text-sm font-medium text-slate-500 hover:underline dark:text-slate-400">
          {t('Not you? Sign out')}
        </button>
      </div>
    </div>
  );
}

import { useState } from 'react';
import toast from 'react-hot-toast';
import { Link } from 'react-router';
import { ArrowLeft, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import AuthLayout from '../components/AuthLayout.jsx';
import { Button, ErrorNote, Field, Input } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { t } from '../lib/i18n.js';

export function PasswordInput({ id, value, onChange, error, autoComplete }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input id={id} type={shown ? 'text' : 'password'} value={value} onChange={onChange} error={error}
        autoComplete={autoComplete} required className="pr-10" />
      <button type="button" onClick={() => setShown((s) => !s)} aria-label={shown ? t('Hide password') : t('Show password')}
        className="absolute inset-y-0 right-0 grid w-10 place-items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
        {shown ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
      </button>
    </div>
  );
}

// The second step with two-factor login on: a code from the authenticator app, or a backup code.
function CodeStep({ challenge, onBack }) {
  const { verifyTwoFactor } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await verifyTwoFactor(challenge, code.trim());
      if (res.usedBackup) toast(t('You used a backup code. {n} left; make new ones in Settings if you’re running low.', { n: res.backupCodesLeft }), { duration: 8000 });
    } catch (err) {
      setError(err);
      setBusy(false);
      if (err.code === 'challenge_expired') onBack(err);
    }
  }
  return (
    <AuthLayout title={t('Two-step check')} subtitle={t('Enter the 6-digit code from your authenticator app.')}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <ErrorNote error={error} />}
        <Field label={t('Code')} htmlFor="code" hint={t('Lost your phone? Enter one of your backup codes instead.')}>
          <Input id="code" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={20} placeholder="123456" />
        </Field>
        <Button type="submit" className="w-full" loading={busy} disabled={code.trim().length < 6}><ShieldCheck className="h-4 w-4" aria-hidden="true" /> {t('Verify')}</Button>
      </form>
      <button type="button" onClick={() => onBack(null)} className="mt-6 inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {t('Use a different account')}
      </button>
    </AuthLayout>
  );
}

export default function Login() {
  const { login } = useAuth();
  const [challenge, setChallenge] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const next = await login(email.trim(), password);
      // The PublicOnly route sends the user on to where they were going; with two-factor on, the code comes first.
      if (next?.challenge) { setChallenge(next.challenge); setBusy(false); }
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  const fields = error?.fieldErrors?.() || {};
  if (challenge) return <CodeStep challenge={challenge} onBack={(err) => { setChallenge(null); setPassword(''); setError(err); }} />;
  return (
    <AuthLayout title={t('Welcome back')} subtitle={t('Log in to see your spending.')}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && !Object.keys(fields).length && <ErrorNote error={error} />}
        <Field label={t('Email')} htmlFor="email" error={fields.email}>
          <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={fields.email} required />
        </Field>
        <Field label={t('Password')} htmlFor="password" error={fields.password}>
          <PasswordInput id="password" value={password} onChange={(e) => setPassword(e.target.value)} error={fields.password} autoComplete="current-password" />
        </Field>
        <div className="-mt-1 flex justify-end">
          <Link to="/forgot-password" className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">{t('Forgot password?')}</Link>
        </div>
        <Button type="submit" className="w-full" loading={busy}>{t('Log in')}</Button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
        {t('New to Spendwise?')} <Link to="/register" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">{t('Create an account')}</Link>
      </p>
    </AuthLayout>
  );
}

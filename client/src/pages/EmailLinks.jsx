// Pages behind the links Spendwise emails: "forgot password", choosing a new password, and confirming the address.
// Links carry their token after "#", which never reaches a server log; the page reads it once and clears it from the address bar.
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Link, useNavigate } from 'react-router';
import { ArrowLeft, CircleCheck, MailCheck } from 'lucide-react';
import AuthLayout from '../components/AuthLayout.jsx';
import { Button, ErrorNote, Field, Input, Skeleton } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/api.js';
import { t } from '../lib/i18n.js';
import { PasswordInput } from './Login.jsx';

const linkClass = 'font-medium text-indigo-600 hover:underline dark:text-indigo-400';

// Read on first render only, then removed from the address bar (and so from history and screenshots).
function useLinkToken() {
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '');
  useEffect(() => {
    if (window.location.hash) window.history.replaceState(window.history.state, '', window.location.pathname);
  }, []);
  return token;
}

function BackToLogin() {
  return (
    <Link to="/login" className={`mt-6 inline-flex items-center gap-1 text-sm ${linkClass}`}>
      <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {t('Back to log in')}
    </Link>
  );
}

function Done({ icon: Icon = CircleCheck, title, children, action }) {
  return (
    <div className="space-y-4">
      <span className="grid h-11 w-11 place-items-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <div>
        <h2 className="font-semibold text-slate-900 dark:text-white">{title}</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{children}</p>
      </div>
      {action}
    </div>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api('/auth/password/forgot', { method: 'POST', body: { email: email.trim() } });
      setSentTo(email.trim());
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  const fields = error?.fieldErrors?.() || {};
  return (
    <AuthLayout title={t('Forgot your password?')} subtitle={t('Enter the email you signed up with and we’ll send a link to choose a new one.')}>
      {sentTo ? (
        <Done icon={MailCheck} title={t('Check your inbox')}>
          {t('If {email} has a Spendwise account, a link is on its way. It works once, for 30 minutes. Not there in a few minutes? Look in spam.', { email: sentTo })}
        </Done>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error && !Object.keys(fields).length && <ErrorNote error={error} />}
          <Field label={t('Email')} htmlFor="email" error={fields.email}>
            <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={fields.email} required autoFocus />
          </Field>
          <Button type="submit" className="w-full" loading={busy} disabled={!email.trim()}>{t('Send reset link')}</Button>
        </form>
      )}
      <BackToLogin />
    </AuthLayout>
  );
}

export function ResetPassword() {
  const token = useLinkToken();
  const { status, endSession } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api('/auth/password/reset', { method: 'POST', body: { token, password } });
      // Every device was signed out, this one included.
      if (status === 'authenticated') endSession();
      toast.success(t('Password changed. Log in with your new one.'));
      navigate('/login', { replace: true });
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }
  const fields = error?.fieldErrors?.() || {};
  const deadLink = !token || error?.code === 'invalid_link' || fields.token;
  return (
    <AuthLayout title={t('Choose a new password')} subtitle={t('This signs you out on every device. Two-step login, if you use it, stays on.')}>
      {deadLink ? (
        <div className="space-y-4">
          <ErrorNote error={{ message: t('This link is invalid, has expired or was already used. Ask for a new one.') }} />
          <Link to="/forgot-password" className={`inline-flex text-sm ${linkClass}`}>{t('Send me a new link')}</Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error && !Object.keys(fields).length && <ErrorNote error={error} />}
          <Field label={t('New password')} htmlFor="new-password" error={fields.password} hint={t('At least 8 characters, with a letter and a number.')}>
            <PasswordInput id="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={fields.password} autoComplete="new-password" />
          </Field>
          <Button type="submit" className="w-full" loading={busy} disabled={!password}>{t('Save new password')}</Button>
        </form>
      )}
      <BackToLogin />
    </AuthLayout>
  );
}

// One request per token, even when React runs the effect twice in development.
const confirming = new Map();
const confirmOnce = (token) => {
  if (!confirming.has(token)) confirming.set(token, api('/auth/verify-email', { method: 'POST', body: { token } }));
  return confirming.get(token);
};

export function VerifyEmail() {
  const token = useLinkToken();
  const { status, user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [state, setState] = useState(token ? { busy: true } : { error: true });
  useEffect(() => {
    if (!token) return undefined;
    let live = true;
    confirmOnce(token)
      .then((res) => { if (live) setState({ email: res.email }); })
      .catch((err) => { if (live) setState({ error: err }); });
    return () => { live = false; };
  }, [token]);
  // Signed in on this device: the banner and Settings update straight away.
  const confirmed = Boolean(state.email);
  useEffect(() => {
    if (confirmed && status === 'authenticated' && !user?.emailVerified) refreshUser().catch(() => {});
  }, [confirmed, status, user?.emailVerified, refreshUser]);

  const signedIn = status === 'authenticated';
  return (
    <AuthLayout title={t('Confirm your email')}>
      {state.busy && <Skeleton className="h-24 w-full" />}
      {confirmed && (
        <Done title={t('Email confirmed')} action={(
          <Button onClick={() => navigate(signedIn ? '/' : '/login', { replace: true })}>{signedIn ? t('Go to the dashboard') : t('Log in')}</Button>
        )}>
          {t('Thanks. Reports, alerts and sign-in warnings can now go to {email}.', { email: state.email })}
        </Done>
      )}
      {state.error && (
        <div className="space-y-4">
          <ErrorNote error={{ message: t('This link is invalid, has expired or was already used. Ask for a new one.') }} />
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {signedIn ? t('Send a new link from the banner at the top of the app or from Settings.') : t('Log in, then send a new link from the banner at the top of the app.')}
          </p>
          <Link to={signedIn ? '/settings' : '/login'} className={`inline-flex text-sm ${linkClass}`}>{signedIn ? t('Open Settings') : t('Log in')}</Link>
        </div>
      )}
    </AuthLayout>
  );
}

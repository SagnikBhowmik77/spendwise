import { useState } from 'react';
import { Link } from 'react-router';
import toast from 'react-hot-toast';
import AuthLayout from '../components/AuthLayout.jsx';
import { Button, ErrorNote, Field, Input } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { PasswordInput } from './Login.jsx';
import { t, tr } from '../lib/i18n.js';

// The same rules the API enforces, checked first so mistakes show without a round trip.
export function passwordProblem(p) {
  if (p.length < 8) return t('Password must be at least 8 characters');
  if (new TextEncoder().encode(p).length > 72) return t('Password must be at most 72 bytes');
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return t('Password must contain a letter and a number');
  return null;
}

export default function Register() {
  const { register } = useAuth();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [fields, setFields] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setError(null);
    const local = {};
    if (!form.name.trim()) local.name = t('Name is required');
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) local.email = t('Enter a valid email address');
    const pw = passwordProblem(form.password);
    if (pw) local.password = pw;
    setFields(local);
    if (Object.keys(local).length) return;

    setBusy(true);
    try {
      await register(form.name.trim(), form.email.trim(), form.password);
      toast.success(t('Welcome to Spendwise, {name}!', { name: form.name.trim().split(' ')[0] }));
    } catch (err) {
      setFields(err.fieldErrors());
      if (!err.details.length) setError(err);
      setBusy(false);
    }
  }

  return (
    <AuthLayout title={t('Create your account')} subtitle={t('Free, and your data stays private to you.')}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <ErrorNote error={error} />}
        <Field label={t('Name')} htmlFor="name" error={fields.name}>
          <Input id="name" autoComplete="name" value={form.name} onChange={set('name')} error={fields.name} maxLength={60} required />
        </Field>
        <Field label={t('Email')} htmlFor="email" error={fields.email}>
          <Input id="email" type="email" autoComplete="email" value={form.email} onChange={set('email')} error={fields.email} required />
        </Field>
        <Field label={t('Password')} htmlFor="password" error={fields.password} hint={t('At least 8 characters, with a letter and a number.')}>
          <PasswordInput id="password" value={form.password} onChange={set('password')} error={fields.password} autoComplete="new-password" />
        </Field>
        <p className="text-caption text-slate-500 dark:text-slate-400">
          {tr('By creating an account you agree to the <terms>Terms</terms> and the <privacy>Privacy policy</privacy>.', {}, {
            terms: (x) => <Link to="/terms" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">{x}</Link>,
            privacy: (x) => <Link to="/privacy" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">{x}</Link>,
          })}
        </p>
        <Button type="submit" className="w-full" loading={busy}>{t('Create account')}</Button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
        {t('Already have an account?')} <Link to="/login" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">{t('Log in')}</Link>
      </p>
    </AuthLayout>
  );
}

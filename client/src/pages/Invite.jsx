import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Users } from 'lucide-react';
import { api } from '../lib/api.js';
import { localeTag, t } from '../lib/i18n.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useSpace } from '../context/SpaceContext.jsx';
import { Logo } from '../components/Brand.jsx';
import { Button, Card, ErrorNote, Skeleton } from '../components/ui.jsx';

// Landing page for an invite link: explains it, then asks the right account to accept.
export default function Invite() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { status, user, logout } = useAuth();
  const { switchTo, refresh } = useSpace();
  const invite = useQuery({ queryKey: ['invite', token], queryFn: () => api(`/invites/${token}`), retry: false });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const here = `/invite/${token}`;
  const inv = invite.data?.invite;

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const { space } = await api(`/invites/${token}/accept`, { method: 'POST' });
      await refresh();
      switchTo(space.id);
      toast.success(t('You joined “{name}”', { name: space.name }));
      navigate('/');
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <Logo className="mb-6" />
        <Card>
          {invite.isLoading ? <Skeleton className="h-32 w-full" /> : invite.error ? (
            <ErrorNote error={invite.error} />
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
                  <Users className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <h1 className="font-semibold">{t('{name} invited you to “{space}”', { name: inv.invitedBy, space: inv.spaceName })}</h1>
                  <p className="text-sm text-slate-500 dark:text-slate-400">{t('For {email} · works until {date}', { email: inv.email, date: new Date(inv.expiresAt).toLocaleDateString(localeTag(), { day: 'numeric', month: 'short', year: 'numeric' }) })}</p>
                </div>
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {t('You’ll share this space’s accounts, entries and budgets with everyone in it. Your personal space stays private.')}
              </p>
              {error && <ErrorNote error={error} />}
              {status === 'authenticated' ? (
                user.email === inv.email ? (
                  <Button className="w-full" onClick={accept} loading={busy}>{t('Join “{space}”', { space: inv.spaceName })}</Button>
                ) : (
                  <div className="space-y-2 text-sm">
                    <p>{t('You’re logged in as {email}. Log in with {invited} to accept.', { email: user.email, invited: inv.email })}</p>
                    <Button variant="secondary" onClick={logout}>{t('Log out')}</Button>
                  </div>
                )
              ) : (
                <div className="flex gap-2">
                  <Link to="/login" state={{ from: here }} className="flex-1"><Button className="w-full">{t('Log in')}</Button></Link>
                  <Link to="/register" state={{ from: here }} className="flex-1"><Button variant="secondary" className="w-full">{t('Sign up')}</Button></Link>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

import { Suspense, lazy, useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { CloudOff, LoaderCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { Button } from './ui.jsx';
import LockScreen from './LockScreen.jsx';
import { t } from '../lib/i18n.js';

// The public front page; only people who aren't signed in download it.
const Landing = lazy(() => import('../pages/Landing.jsx'));

function FullScreen({ children }) {
  return <div className="grid min-h-dvh place-items-center px-4 text-center">{children}</div>;
}

// The free API host sleeps when idle; after a few seconds, say so instead of spinning silently.
function Loading() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setSlow(true), 6000);
    return () => clearTimeout(id);
  }, []);
  return (
    <FullScreen>
      <div className="max-w-sm">
        <LoaderCircle className="mx-auto h-8 w-8 animate-spin text-slate-400" aria-hidden="true" />
        <p className="mt-3 font-medium">{t('Loading your account…')}</p>
        {slow && (
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            {t('The server is waking up. Free hosting sleeps when nobody is using it, so this can take up to a minute.')}
          </p>
        )}
      </div>
    </FullScreen>
  );
}

export function RequireAuth() {
  const { status, error, retry, locked } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <Loading />;
  if (status === 'unreachable') {
    return (
      <FullScreen>
        <div className="max-w-sm">
          <CloudOff className="mx-auto h-8 w-8 text-slate-400" aria-hidden="true" />
          <p className="mt-3 font-medium">{t('Can’t reach Spendwise right now')}</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{error?.message}</p>
          <Button className="mt-4" onClick={retry}>{t('Try again')}</Button>
        </div>
      </FullScreen>
    );
  }
  if (status !== 'authenticated') {
    if (location.pathname === '/') return <Suspense fallback={null}><Landing /></Suspense>;
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  if (locked) return <LockScreen />;
  return <Outlet />;
}

export function PublicOnly() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <Loading />;
  if (status === 'authenticated') return <Navigate to={location.state?.from || '/'} replace />;
  return <Outlet />;
}

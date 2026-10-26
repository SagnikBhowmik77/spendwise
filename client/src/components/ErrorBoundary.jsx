// Catches a crash while drawing a page, so one broken card shows a way out instead of blanking the whole app.
// Around each page it resets when you go to another page; around the whole app it fills the screen.
import { Component } from 'react';
import { useLocation } from 'react-router';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import { Button } from './ui.jsx';
import { t } from '../lib/i18n.js';

// After a new version is deployed, a browser still running the old one can't download that version's page files.
const isStaleBuild = (error) => /dynamically imported module|Importing a module script failed|Loading chunk|ChunkLoadError/i.test(error?.message ?? '');

export class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Spendwise hit an error while drawing this screen:', error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const stale = isStaleBuild(error);
    const full = this.props.fullScreen;
    return (
      <div role="alert" className={full ? 'grid min-h-dvh place-items-center bg-slate-50 px-4 dark:bg-slate-950' : 'py-16'}>
        <div className="mx-auto max-w-md text-center">
          <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
            {stale ? <RefreshCw className="h-5 w-5" aria-hidden="true" /> : <TriangleAlert className="h-5 w-5" aria-hidden="true" />}
          </span>
          <h1 className="mt-4 text-heading font-semibold text-slate-900 dark:text-white">
            {stale ? t('Spendwise was updated') : t('Something went wrong on this screen')}
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            {stale
              ? t('Reload to get the new version. Nothing you saved is lost.')
              : t('Your data is safe: nothing was changed. Reload to try again, or open another page.')}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Button onClick={() => window.location.reload()}><RefreshCw className="h-4 w-4" aria-hidden="true" /> {t('Reload')}</Button>
            {!full && !stale && <Button variant="secondary" onClick={() => { window.location.href = '/'; }}>{t('Go to the dashboard')}</Button>}
          </div>
          {!stale && error.message && (
            <details className="mt-6 text-left text-caption text-slate-500 dark:text-slate-400">
              <summary className="cursor-pointer text-center">{t('Details for a bug report')}</summary>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-slate-900/[0.04] p-3 dark:bg-white/[0.05]">{String(error.message).slice(0, 500)}</pre>
            </details>
          )}
        </div>
      </div>
    );
  }
}

// Per page: a new address starts with a clean slate.
export function PageBoundary({ children }) {
  const { pathname } = useLocation();
  return <ErrorBoundary key={pathname}>{children}</ErrorBoundary>;
}

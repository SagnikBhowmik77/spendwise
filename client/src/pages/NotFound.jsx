import { Link } from 'react-router';
import { Logo } from '../components/Brand.jsx';
import { t } from '../lib/i18n.js';

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col bg-slate-50 px-4 dark:bg-slate-950">
      <Link to="/" className="mx-auto mt-8 w-full max-w-md rounded-lg sm:mt-12"><Logo /></Link>
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center pb-24">
        <p className="tabular text-caption font-semibold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">404</p>
        <h1 className="mt-2 text-title font-semibold text-slate-900 dark:text-white">{t('Page not found')}</h1>
        <p className="mt-2 text-body text-slate-600 dark:text-slate-400">{t('That page doesn’t exist.')}</p>
        <Link to="/" className="mt-8 inline-flex h-10 w-fit items-center rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white shadow-sm transition-colors duration-150 hover:bg-indigo-700 dark:bg-indigo-600 dark:hover:bg-indigo-500">
          {t('Go to the dashboard')}
        </Link>
      </div>
    </div>
  );
}

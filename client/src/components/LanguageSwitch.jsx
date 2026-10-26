import { Languages } from 'lucide-react';
import { api } from '../lib/api.js';
import { LANGUAGES, language, setLanguage, t } from '../lib/i18n.js';
import { useAuth } from '../context/AuthContext.jsx';
import { cx } from './ui.jsx';

// English / हिन्दी. Signed in, the choice is also saved on the account (the Telegram bot answers in it).
export function LanguageSwitch({ className }) {
  const { status } = useAuth();
  async function change(next) {
    if (status === 'authenticated') {
      try { await api('/auth/me', { method: 'PATCH', body: { language: next } }); } catch { /* still changed on this device */ }
    }
    setLanguage(next);
  }
  return (
    <label className={cx('relative inline-flex items-center', className)}>
      <Languages className="pointer-events-none absolute left-2 h-4 w-4 text-slate-500 dark:text-slate-400" aria-hidden="true" />
      <span className="sr-only">{t('Language')}</span>
      <select value={language()} onChange={(e) => change(e.target.value)}
        className="h-8 appearance-none rounded-lg bg-slate-100 pl-7 pr-2 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:bg-slate-800 dark:text-slate-200">
        {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
      </select>
    </label>
  );
}

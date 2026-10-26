// The Spendwise mark and the theme switch: small, shared by the public pages and the signed-in app.
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from '../context/ThemeContext.jsx';
import { Segmented, cx } from './ui.jsx';
import { t } from '../lib/i18n.js';

// The mark: a quiet ink tile with a cobalt bar chart, no gradient.
export function Logo({ className }) {
  return (
    <span className={cx('inline-flex items-center gap-2.5 text-[0.9375rem] font-semibold tracking-[-0.01em]', className)}>
      <span className="grid h-7 w-7 place-items-center rounded-lg bg-slate-900 text-white shadow-xs dark:bg-white dark:text-slate-900">
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true">
          <rect x="2" y="8" width="3" height="6" rx="1" fill="currentColor" opacity="0.55" />
          <rect x="6.5" y="5" width="3" height="9" rx="1" fill="currentColor" opacity="0.8" />
          <rect x="11" y="2" width="3" height="12" rx="1" className="fill-indigo-400 dark:fill-indigo-600" />
        </svg>
      </span>
      Spendwise
    </span>
  );
}

export function ThemeSwitch({ size }) {
  const { theme, setTheme } = useTheme();
  return (
    <Segmented
      label={t('Theme')}
      size={size}
      value={theme}
      onChange={setTheme}
      options={[
        { value: 'light', label: null, ariaLabel: t('Light theme'), icon: Sun },
        { value: 'system', label: null, ariaLabel: t('System theme'), icon: Monitor },
        { value: 'dark', label: null, ariaLabel: t('Dark theme'), icon: Moon },
      ]}
    />
  );
}

// Shared UI pieces (buttons, fields, cards, badges, tabs, skeletons, empty states), built on the tokens in index.css.
// Every page uses these, so they keep their names and props; the look lives here.
import { forwardRef, useEffect, useRef } from 'react';
import { AlertTriangle, LoaderCircle, MoreHorizontal } from 'lucide-react';
import { formatINR } from '../lib/format.js';
import { t } from '../lib/i18n.js';

export const cx = (...classes) => classes.filter(Boolean).join(' ');

// ───────────── Buttons ─────────────

const VARIANTS = {
  primary: 'bg-indigo-600 text-white shadow-sm hover:bg-indigo-700 active:bg-indigo-800 dark:bg-indigo-600 dark:hover:bg-indigo-500 dark:active:bg-indigo-600',
  secondary:
    'bg-white text-slate-800 shadow-xs ring-1 ring-inset ring-slate-900/10 hover:bg-slate-50 hover:ring-slate-900/15 active:bg-slate-100 dark:bg-slate-800/80 dark:text-slate-100 dark:ring-white/10 dark:hover:bg-slate-800 dark:hover:ring-white/15',
  ghost: 'text-slate-600 hover:bg-slate-900/5 hover:text-slate-900 active:bg-slate-900/10 dark:text-slate-300 dark:hover:bg-white/5 dark:hover:text-white',
  danger: 'bg-rose-600 text-white shadow-sm hover:bg-rose-700 active:bg-rose-800',
};
const SIZES = { sm: 'h-8 px-3 text-sm gap-1.5', md: 'h-10 px-4 text-sm gap-2', lg: 'h-11 px-5 text-body gap-2', icon: 'h-9 w-9' };

export function Button({ variant = 'primary', size = 'md', loading = false, className, children, disabled, ...props }) {
  return (
    <button
      type="button"
      className={cx(
        'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-lg font-medium',
        'transition-[background-color,box-shadow,color,transform] duration-150 ease-out active:scale-[0.98]',
        'disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0',
        VARIANTS[variant], SIZES[size], className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}

// ───────────── Fields ─────────────

const fieldBase = cx(
  'block w-full min-w-0 rounded-lg border-0 bg-white px-3 text-sm text-slate-900 shadow-xs ring-1 ring-inset',
  'placeholder:text-slate-400 transition-[box-shadow,background-color] duration-150',
  'hover:ring-slate-900/20 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400',
  'disabled:cursor-not-allowed disabled:bg-slate-100 disabled:opacity-70',
  'dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:hover:ring-white/20 dark:disabled:bg-slate-800',
);
const ringFor = (error) => (error ? 'ring-rose-400 dark:ring-rose-500/70' : 'ring-slate-900/12 dark:ring-white/10');

export const Input = forwardRef(function Input({ error, className, ...props }, ref) {
  return <input ref={ref} className={cx(fieldBase, 'h-10', ringFor(error), className)} aria-invalid={error ? true : undefined} {...props} />;
});

export const Select = forwardRef(function Select({ error, className, children, ...props }, ref) {
  return (
    <select ref={ref} className={cx(fieldBase, 'sw-select h-10 cursor-pointer pr-9', ringFor(error), className)} aria-invalid={error ? true : undefined} {...props}>
      {children}
    </select>
  );
});

export const Textarea = forwardRef(function Textarea({ error, className, ...props }, ref) {
  return <textarea ref={ref} className={cx(fieldBase, 'py-2.5 leading-relaxed', ringFor(error), className)} {...props} />;
});

// Label + control + hint/error. Pass the control's id as htmlFor.
export function Field({ label, htmlFor, error, hint, children, className }) {
  return (
    <div className={cx('min-w-0', className)}>
      {label && (
        <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
          {label}
        </label>
      )}
      {children}
      {error ? (
        <p className="mt-1.5 text-sm text-rose-600 dark:text-rose-400" role="alert">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-caption text-slate-500 dark:text-slate-400">{hint}</p>
      ) : null}
    </div>
  );
}

// ───────────── Surfaces ─────────────

// A resting surface: a step lighter than the page (darker in dark mode), a hairline and almost no shadow.
// padding: 'md' (default), 'lg', or 'none' for lists and charts that run to the edges.
const PADDING = { none: '', md: 'p-4 sm:p-5', lg: 'p-5 sm:p-6' };
export function Card({ className, children, padding = 'md', ...props }) {
  return (
    <section
      className={cx('min-w-0 rounded-xl bg-white shadow-xs ring-1 ring-slate-900/[0.06] dark:bg-slate-900 dark:shadow-none dark:ring-white/[0.06]', PADDING[padding], className)}
      {...props}
    >
      {children}
    </section>
  );
}

export function CardHeader({ title, subtitle, action }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-[0.9375rem] font-semibold leading-6 tracking-[-0.006em] text-slate-900 dark:text-slate-50">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

// ───────────── Badges and status ─────────────

const TONES = {
  slate: 'bg-slate-900/[0.05] text-slate-700 dark:bg-white/[0.07] dark:text-slate-300',
  green: 'bg-emerald-500/10 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300',
  amber: 'bg-amber-500/12 text-amber-800 dark:bg-amber-400/10 dark:text-amber-300',
  rose: 'bg-rose-500/10 text-rose-700 dark:bg-rose-400/10 dark:text-rose-300',
  indigo: 'bg-indigo-500/10 text-indigo-700 dark:bg-indigo-400/12 dark:text-indigo-300',
};
const DOTS = { slate: 'bg-slate-400', green: 'bg-emerald-500', amber: 'bg-amber-500', rose: 'bg-rose-500', indigo: 'bg-indigo-500' };
export function Badge({ tone = 'slate', dot = false, children }) {
  return (
    <span className={cx('inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-caption font-medium', TONES[tone])}>
      {dot && <span className={cx('h-1.5 w-1.5 rounded-full', DOTS[tone])} aria-hidden="true" />}
      {children}
    </span>
  );
}

export const STATUS_TONE = { ok: 'green', warning: 'amber', over: 'rose', active: 'green', paused: 'amber', ended: 'slate' };
export const STATUS_LABEL = { ok: t('On track'), warning: t('Close to limit'), over: t('Over budget'), active: t('Active'), paused: t('Paused'), ended: t('Ended') };

// On track is plain ink; only nearly-there and over get colour.
const BAR = { ok: 'bg-slate-800 dark:bg-slate-200', warning: 'bg-amber-500', over: 'bg-rose-500' };
export function ProgressBar({ percent, status = 'ok', label }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-900/[0.07] dark:bg-white/[0.08]" role="progressbar" aria-label={label}
      aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cx('h-full rounded-full transition-[width] duration-500 ease-out', BAR[status])} style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
    </div>
  );
}

// ───────────── Loading, empty and error ─────────────

export function Skeleton({ className }) {
  return <div className={cx('sw-skeleton rounded-md bg-slate-900/[0.06] dark:bg-white/[0.05]', className)} aria-hidden="true" />;
}

// compact: for a slot inside a card (less height, so a quiet card doesn't leave a hole in the layout).
export function EmptyState({ icon: Icon, title, children, action, compact = false }) {
  return (
    <div className={cx('flex flex-col items-center text-center', compact ? 'px-3 py-6' : 'px-4 py-10 sm:py-12')}>
      {Icon && (
        <div className={cx('mb-3 grid place-items-center rounded-xl bg-slate-900/[0.04] text-slate-500 ring-1 ring-inset ring-slate-900/[0.06] dark:bg-white/[0.04] dark:text-slate-400 dark:ring-white/[0.06]', compact ? 'h-9 w-9' : 'h-11 w-11')}>
          <Icon className={compact ? 'h-4 w-4' : 'h-5 w-5'} aria-hidden="true" strokeWidth={1.75} />
        </div>
      )}
      <p className="text-[0.9375rem] font-semibold text-slate-900 dark:text-slate-100">{title}</p>
      {children && <p className="mt-1 max-w-xs text-sm text-slate-500 dark:text-slate-400">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorNote({ error, onRetry }) {
  return (
    <div className="flex items-start gap-3 rounded-lg bg-rose-500/[0.07] p-3 text-sm text-rose-800 ring-1 ring-inset ring-rose-500/15 dark:bg-rose-400/[0.08] dark:text-rose-200 dark:ring-rose-400/15" role="alert">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">{error?.message || t('Something went wrong.')}</div>
      {onRetry && <button type="button" className="font-medium underline underline-offset-2" onClick={onRetry}>{t('Retry')}</button>}
    </div>
  );
}

// ───────────── Switchers ─────────────

// Radio-style pill switcher for small choices (theme, kind, period): options [{ value, label, icon?, ariaLabel? }].
export function Segmented({ options, value, onChange, label, size = 'md' }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex max-w-full overflow-x-auto rounded-lg bg-slate-900/[0.05] p-0.5 [scrollbar-width:none] dark:bg-white/[0.06]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          aria-label={o.ariaLabel}
          onClick={() => onChange(o.value)}
          className={cx(
            'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-[background-color,color,box-shadow] duration-150',
            size === 'sm' ? 'h-7 px-2.5 text-caption' : 'h-8 px-3 text-sm',
            value === o.value
              ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-900/[0.06] dark:bg-slate-700 dark:text-white dark:ring-white/10'
              : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white',
          )}
        >
          {o.icon && <o.icon className="h-4 w-4" aria-hidden="true" />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Page sections: an underlined tab row. Same props as Segmented, so a page can swap one for the other.
export function Tabs({ options, value, onChange, label, className }) {
  return (
    <div role="tablist" aria-label={label} className={cx('flex max-w-full gap-1 overflow-x-auto border-b border-slate-900/[0.08] dark:border-white/[0.08]', className)}>
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.value)}
            className={cx(
              'relative inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap px-3 text-sm font-medium transition-colors duration-150',
              'after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:transition-colors after:duration-150',
              on ? 'text-slate-900 after:bg-slate-900 dark:text-white dark:after:bg-white' : 'text-slate-500 after:bg-transparent hover:text-slate-900 dark:text-slate-400 dark:hover:text-white',
            )}
          >
            {o.icon && <o.icon className="h-4 w-4" aria-hidden="true" />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ───────────── Money ─────────────

// Rupees in full weight, paise smaller and muted: ₹43,609.00 reads as ₹43,609 with a quiet .00.
export function Money({ paise, className, sign = '', muteDecimals = true }) {
  const text = formatINR(Math.abs(paise));
  const dot = text.lastIndexOf('.');
  const whole = dot > 0 ? text.slice(0, dot) : text;
  const decimals = dot > 0 ? text.slice(dot) : '';
  return (
    <span className={cx('tabular', className)}>
      {sign}{whole}{decimals && <span className={muteDecimals ? 'text-[0.72em] font-normal' : undefined}>{decimals}</span>}
    </span>
  );
}

// Signed amount: +₹500.00 in green (income) / −₹120.00 in ink (expense) / ₹2,000.00 muted (transfer).
const AMOUNT_STYLE = {
  income: ['+', 'text-emerald-600 dark:text-emerald-400'],
  expense: ['−', 'text-slate-900 dark:text-slate-100'],
  transfer: ['', 'text-slate-500 dark:text-slate-400'],
};
export function Amount({ paise, type, className }) {
  const [sign, color] = AMOUNT_STYLE[type] ?? AMOUNT_STYLE.expense;
  return <Money paise={paise} sign={sign} className={cx('font-semibold', color, className)} />;
}

// ───────────── Page structure ─────────────

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-3 sm:mb-8">
      <div className="min-w-0">
        <h1 className="text-title font-semibold text-slate-900 dark:text-white">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// A row's less-used actions behind a "⋯" button: items [{ label, onClick, danger? }] (falsy items are skipped).
// Closes on choosing, on Escape and on a click anywhere else.
export function RowMenu({ label, items }) {
  const ref = useRef(null);
  const list = items.filter(Boolean);
  useEffect(() => {
    const close = (e) => { if (ref.current?.open && !ref.current.contains(e.target)) ref.current.open = false; };
    const esc = (e) => { if (e.key === 'Escape' && ref.current?.open) { ref.current.open = false; ref.current.querySelector('summary')?.focus(); } };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, []);
  if (!list.length) return null;
  return (
    <details ref={ref} className="relative">
      <summary aria-label={label} title={label}
        className="grid h-8 w-8 cursor-pointer list-none place-items-center rounded-lg text-slate-500 transition-colors hover:bg-slate-900/[0.05] hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/[0.06] dark:hover:text-white [&::-webkit-details-marker]:hidden">
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
      </summary>
      <div role="menu" className="absolute right-0 top-9 z-30 min-w-44 animate-rise rounded-xl bg-white p-1 shadow-lg ring-1 ring-slate-900/[0.08] dark:bg-slate-800 dark:ring-white/10">
        {list.map((item) => (
          <button key={item.label} type="button" role="menuitem"
            onClick={() => { ref.current.open = false; item.onClick(); }}
            className={cx('flex h-9 w-full items-center rounded-lg px-3 text-left text-sm transition-colors',
              item.danger ? 'text-rose-600 hover:bg-rose-500/[0.08] dark:text-rose-400' : 'text-slate-700 hover:bg-slate-900/[0.05] dark:text-slate-200 dark:hover:bg-white/[0.06]')}>
            {item.label}
          </button>
        ))}
      </div>
    </details>
  );
}

// On/off switch for settings.
export function Switch({ checked, onChange, disabled, label }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={cx('relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-indigo-600 dark:bg-indigo-500' : 'bg-slate-900/15 dark:bg-white/15')}>
      <span className={cx('inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out', checked ? 'translate-x-[1.125rem]' : 'translate-x-0.5')} />
    </button>
  );
}

// A setting: title and explanation on the left, its control on the right.
export function SettingRow({ title, children, control }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{title}</p>
        <div className="text-sm text-slate-500 dark:text-slate-400">{children}</div>
      </div>
      {control}
    </div>
  );
}

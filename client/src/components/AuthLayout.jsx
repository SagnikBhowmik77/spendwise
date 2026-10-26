import { Link } from 'react-router';
import { ChartPie, PiggyBank, Repeat } from 'lucide-react';
import { Logo, ThemeSwitch } from './Brand.jsx';
import { LanguageSwitch } from './LanguageSwitch.jsx';
import { cx } from './ui.jsx';
import { LegalFooter } from '../pages/Legal.jsx';
import { t } from '../lib/i18n.js';

const POINTS = [
  { icon: ChartPie, title: t('See where it goes'), text: t('Every rupee by category and month, in clear charts.') },
  { icon: PiggyBank, title: t('Budgets that warn you'), text: t('Set monthly limits and get a heads-up at 80%.') },
  { icon: Repeat, title: t('Rent and salary on autopilot'), text: t('Recurring entries are added on their due date.') },
];

// A smooth wave that repeats every `period` units, long enough to slide one period left and loop without a seam.
function wave(y, amp, period = 400, length = 2400) {
  let d = `M0 ${y} Q ${period / 4} ${y - amp} ${period / 2} ${y}`;
  for (let x = period; x <= length; x += period / 2) d += ` T ${x} ${y}`;
  return d;
}
const WAVES = [
  { y: 150, amp: 34, width: 1.6, opacity: 0.9, duration: 26, tone: 'stroke-indigo-400' },
  { y: 190, amp: 22, width: 1.2, opacity: 0.5, duration: 38, tone: 'stroke-indigo-300' },
  { y: 228, amp: 14, width: 1, opacity: 0.35, duration: 52, tone: 'stroke-slate-400' },
];

// Quiet, slow motion: money moving, nothing to read. Stops entirely when the system asks for reduced motion.
export function FlowArt({ className }) {
  return (
    <svg className={cx('pointer-events-none', className)} viewBox="0 0 800 320" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <pattern id="sw-dots" width="24" height="24" patternUnits="userSpaceOnUse">
          <circle cx="1.5" cy="1.5" r="1.1" className="fill-white" opacity="0.08" />
        </pattern>
        <linearGradient id="sw-fade" x1="0" x2="1">
          <stop offset="0" stopColor="white" stopOpacity="0" />
          <stop offset="0.18" stopColor="white" stopOpacity="1" />
          <stop offset="0.82" stopColor="white" stopOpacity="1" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </linearGradient>
        <mask id="sw-edges"><rect width="800" height="320" fill="url(#sw-fade)" /></mask>
      </defs>
      <rect width="800" height="320" fill="url(#sw-dots)" />
      <g mask="url(#sw-edges)">
        {WAVES.map((w) => (
          <g key={w.y} className="sw-drift" style={{ animationDuration: `${w.duration}s` }}>
            <path d={wave(w.y, w.amp)} fill="none" className={w.tone} strokeWidth={w.width} strokeOpacity={w.opacity} strokeLinecap="round" />
            {w.y === 150 && [100, 500, 900, 1300].map((x) => (
              <circle key={x} cx={x} cy={w.y - w.amp / 2} r="3" className="fill-indigo-300" opacity="0.9" />
            ))}
          </g>
        ))}
      </g>
    </svg>
  );
}

export default function AuthLayout({ title, subtitle, children }) {
  return (
    <div className="grid min-h-dvh bg-slate-50 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] dark:bg-slate-950">
      <div className="relative m-3 hidden flex-col justify-between overflow-hidden rounded-2xl bg-[oklch(0.19_0.005_75)] p-10 text-slate-100 ring-1 ring-white/[0.06] lg:flex">
        <FlowArt className="absolute inset-x-0 bottom-0 h-[46%] w-full" />
        <Link to="/" className="relative w-fit rounded-lg"><Logo className="text-white [&>span:first-child]:bg-white [&>span:first-child]:text-slate-900" /></Link>
        <div className="relative max-w-md pb-[30%]">
          <h2 className="text-[2rem] font-semibold leading-[1.15] tracking-[-0.025em] text-white">{t('Know where your money goes, every month.')}</h2>
          <ul className="mt-8 space-y-5">
            {POINTS.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-3.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/[0.06] ring-1 ring-inset ring-white/[0.08]">
                  <Icon className="h-4 w-4 text-indigo-300" aria-hidden="true" strokeWidth={1.85} />
                </span>
                <span>
                  <span className="block text-sm font-medium text-white">{title}</span>
                  <span className="text-sm text-slate-400">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-caption text-slate-500 dark:text-slate-400">{t('Your data is private to your account.')}</p>
      </div>

      <div className="flex min-w-0 flex-col px-4 py-5 sm:px-8">
        <div className="flex items-center justify-between gap-3">
          <Link to="/" className="rounded-lg lg:invisible"><Logo /></Link>
          <div className="flex items-center gap-2">
            <LanguageSwitch />
            <ThemeSwitch size="sm" />
          </div>
        </div>
        {/* Phones and tablets: the same art as a short band above the form. */}
        <div className="relative mt-5 overflow-hidden rounded-2xl bg-[oklch(0.19_0.005_75)] px-5 pb-24 pt-5 ring-1 ring-white/[0.06] lg:hidden">
          <FlowArt className="absolute inset-x-0 bottom-0 h-24 w-full" />
          <p className="relative max-w-[16rem] text-heading font-semibold text-white">{t('Know where your money goes, every month.')}</p>
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col pb-10 pt-8 lg:justify-center lg:py-10">
          <h1 className="text-title font-semibold text-slate-900 dark:text-white">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
          <div className="mt-8">{children}</div>
        </div>
        <LegalFooter className="mx-auto w-full max-w-sm justify-center pb-1" />
      </div>
    </div>
  );
}

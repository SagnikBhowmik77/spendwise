// The public front page at "/" for anyone not signed in. It describes real features only: no screenshots of
// made-up accounts, no invented numbers, no testimonials.
import { Link } from 'react-router';
import {
  ArrowRight, Bell, CalendarClock, ChartPie, FileSpreadsheet, Landmark, Languages, Lock, MessageCircle, PiggyBank, Receipt, Users,
} from 'lucide-react';
import { FlowArt } from '../components/AuthLayout.jsx';
import { Logo, ThemeSwitch } from '../components/Brand.jsx';
import { LanguageSwitch } from '../components/LanguageSwitch.jsx';
import { LegalFooter } from './Legal.jsx';
import { t, tr } from '../lib/i18n.js';

const FEATURES = [
  { icon: ChartPie, title: t('See where it goes'), text: t('Every rupee by category, account and month, with charts that stay readable.') },
  { icon: PiggyBank, title: t('Budgets that warn you'), text: t('Monthly and weekly limits, envelopes and sinking funds, with a heads-up at 80% and 100%.') },
  { icon: FileSpreadsheet, title: t('Import bank statements'), text: t('Bring in a month of CSV or Excel entries at once; categories are suggested and duplicates caught.') },
  { icon: CalendarClock, title: t('Bills and recurring entries'), text: t('Rent, salary, EMIs and subscriptions are added on their due date, with reminders before bills.') },
  { icon: Landmark, title: t('Investments and net worth'), text: t('Mutual funds priced from AMFI, FDs, PPF, EPF and gold, with XIRR and a monthly net-worth history.') },
  { icon: Receipt, title: t('Indian tax helpers'), text: t('Old vs new regime, capital gains, TDS and rent receipts, worked out from your own entries.') },
  { icon: Users, title: t('Shared households'), text: t('Share a space with a partner or flatmates, with roles, private accounts and approvals.') },
  { icon: MessageCircle, title: t('Add from anywhere'), text: t('Type “200 chai”, scan a receipt, use your voice, or message the Telegram bot. Works offline too.') },
  { icon: Languages, title: t('English and Hindi'), text: t('The whole app in either language, with larger text and high contrast if you need them.') },
];

const PRIVATE = [
  t('No ads, no tracking scripts, and your data is never sold.'),
  t('Two-step login, an app lock with PIN or fingerprint, and a list of signed-in devices.'),
  t('Export everything as CSV, PDF or a full backup, or delete your account, whenever you like.'),
];

const cta = 'inline-flex h-11 items-center justify-center gap-1.5 rounded-lg px-5 text-sm font-medium transition-colors duration-150';

export default function Landing() {
  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-5 sm:px-8">
        <Logo />
        <nav className="flex items-center gap-2" aria-label={t('Account')}>
          <span className="max-sm:hidden"><LanguageSwitch /></span>
          <ThemeSwitch size="sm" />
          <Link to="/login" className="ml-1 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-900/[0.05] dark:text-slate-200 dark:hover:bg-white/[0.06]">{t('Log in')}</Link>
        </nav>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 px-4 pb-16 pt-8 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-14 lg:pb-24 lg:pt-14">
          <div>
            <p className="text-caption font-semibold uppercase tracking-[0.08em] text-indigo-600 dark:text-indigo-400">{t('Personal finance, made for India')}</p>
            <h1 className="mt-3 text-title font-semibold tracking-[-0.025em] text-slate-900 sm:text-display dark:text-white">{t('Know where your money goes, every month.')}</h1>
            <p className="mt-4 max-w-xl text-body text-slate-600 dark:text-slate-400">
              {t('Spendwise tracks your spending, budgets, bills and investments in rupees, and tells you what changed. Free, private, and it works on your phone.')}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/register" className={`${cta} bg-indigo-600 text-white shadow-sm hover:bg-indigo-700 dark:bg-indigo-600 dark:hover:bg-indigo-500`}>
                {t('Create a free account')} <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link to="/login" className={`${cta} bg-white text-slate-900 shadow-xs ring-1 ring-slate-900/[0.08] hover:bg-slate-100 dark:bg-slate-900 dark:text-white dark:ring-white/[0.1] dark:hover:bg-slate-800`}>
                {t('Log in')}
              </Link>
            </div>
          </div>
          <div className="relative min-h-[18rem] overflow-hidden rounded-2xl bg-[oklch(0.19_0.005_75)] p-8 text-slate-100 ring-1 ring-white/[0.06] sm:min-h-[22rem] sm:p-10">
            <FlowArt className="absolute inset-x-0 bottom-0 h-[55%] w-full" />
            <ul className="relative space-y-4">
              {[[Bell, t('Alerts before a budget runs out')], [CalendarClock, t('Reminders before bills are due')], [Lock, t('Your data stays private to your account')]].map(([Icon, text]) => (
                <li key={text} className="flex items-center gap-3 text-sm text-slate-200">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/[0.06] ring-1 ring-inset ring-white/[0.08]">
                    <Icon className="h-4 w-4 text-indigo-300" aria-hidden="true" />
                  </span>
                  {text}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-labelledby="features" className="border-t border-slate-900/[0.06] bg-white dark:border-white/[0.06] dark:bg-slate-900/40">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-8 lg:py-20">
            <h2 id="features" className="text-heading font-semibold text-slate-900 sm:text-title dark:text-white">{t('Everything in one place')}</h2>
            <p className="mt-2 max-w-2xl text-body text-slate-600 dark:text-slate-400">{t('Built around how money works in India: UPI, salary credits, EMIs, FDs, PPF and the financial year.')}</p>
            <ul className="mt-10 grid grid-cols-1 gap-x-10 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, text }) => (
                <li key={title} className="flex gap-4">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-500/[0.08] text-indigo-600 dark:bg-indigo-400/[0.1] dark:text-indigo-300">
                    <Icon className="h-5 w-5" aria-hidden="true" strokeWidth={1.85} />
                  </span>
                  <div>
                    <h3 className="font-semibold text-slate-900 dark:text-white">{title}</h3>
                    <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-400">{text}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-labelledby="private" className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-4 py-16 sm:px-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:py-20">
          <div>
            <h2 id="private" className="text-heading font-semibold text-slate-900 sm:text-title dark:text-white">{t('Private by design')}</h2>
            <p className="mt-2 text-body text-slate-600 dark:text-slate-400">
              {tr('Read exactly what is stored, and where, in the <privacy>privacy policy</privacy>.', {}, {
                privacy: (x) => <Link to="/privacy" className="font-medium text-indigo-600 underline underline-offset-2 dark:text-indigo-400">{x}</Link>,
              })}
            </p>
          </div>
          <ul className="space-y-4">
            {PRIVATE.map((text) => (
              <li key={text} className="flex gap-3 text-body text-slate-700 dark:text-slate-300">
                <Lock className="mt-1 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />{text}
              </li>
            ))}
          </ul>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-8">
          <div className="flex flex-col items-start justify-between gap-6 rounded-2xl bg-white p-8 ring-1 ring-slate-900/[0.06] sm:flex-row sm:items-center dark:bg-slate-900 dark:ring-white/[0.06]">
            <div>
              <h2 className="text-heading font-semibold text-slate-900 dark:text-white">{t('Start with this month')}</h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{t('Add an account and your first entry; the charts fill in from there.')}</p>
            </div>
            <Link to="/register" className={`${cta} shrink-0 bg-indigo-600 text-white shadow-sm hover:bg-indigo-700 dark:bg-indigo-600 dark:hover:bg-indigo-500`}>{t('Create a free account')}</Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-900/[0.06] dark:border-white/[0.06]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-6 sm:px-8">
          <Logo className="text-sm" />
          <LegalFooter />
        </div>
      </footer>
    </div>
  );
}

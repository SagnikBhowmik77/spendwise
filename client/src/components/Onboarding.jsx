// The "confirm your email" banner and the dashboard's "Get started" checklist.
// Both read what is really true on the server (GET /api/onboarding); nothing here is stored on the device but a dismissal.
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Link } from 'react-router';
import { Check, MailWarning, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useDismissChecklist, useOnboarding, useResendVerification } from '../hooks/api.js';
import { t } from '../lib/i18n.js';
import { startEntry } from './CommandPalette.jsx';
import { Button, Card, cx } from './ui.jsx';

const HIDE_KEY = 'spendwise.verifyBannerHidden';
const sessionGet = () => { try { return sessionStorage.getItem(HIDE_KEY) === '1'; } catch { return false; } };
const sessionSet = () => { try { sessionStorage.setItem(HIDE_KEY, '1'); } catch { /* shown again next time */ } };

function useResend() {
  const resend = useResendVerification();
  return {
    pending: resend.isPending,
    send: () => resend.mutate(undefined, {
      onSuccess: (res) => toast.success(t('Link sent to {email}. It works for 24 hours.', { email: res.sentTo })),
      onError: (err) => toast.error(err.message),
    }),
  };
}

// Only when this server can send email and the address isn't confirmed yet. Hidden for the rest of the visit on "×".
export function VerifyBanner() {
  const { user, refreshUser } = useAuth();
  const q = useOnboarding();
  const [hidden, setHidden] = useState(sessionGet);
  const { send, pending } = useResend();
  const needed = q.data?.steps && 'email' in q.data.steps && !q.data.steps.email;
  // Confirmed in another tab: the server knows first; bring this tab's copy of the account up to date.
  const confirmedElsewhere = q.data?.steps?.email === true && user && !user.emailVerified;
  useEffect(() => { if (confirmedElsewhere) refreshUser().catch(() => {}); }, [confirmedElsewhere, refreshUser]);
  if (!needed || hidden) return null;
  return (
    <div className="mb-6 flex items-start gap-3 rounded-xl bg-amber-500/[0.08] px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-500/20 dark:bg-amber-400/[0.08] dark:text-amber-100 dark:ring-amber-400/20">
      <MailWarning className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        <span className="font-medium">{t('Confirm your email.')}</span>{' '}
        {t('Open the link we sent to {email}. Until then, reports, alerts and sign-in warnings aren’t emailed, and invites can’t be accepted.', { email: user.email })}
        {' '}
        <button type="button" onClick={send} disabled={pending} className="font-medium underline underline-offset-2 hover:no-underline disabled:opacity-60">
          {pending ? t('Sending…') : t('Send a new link')}
        </button>
      </p>
      <button type="button" onClick={() => { sessionSet(); setHidden(true); }} aria-label={t('Hide for now')}
        className="-m-1 grid h-7 w-7 shrink-0 place-items-center rounded-md hover:bg-amber-500/10">
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

function Step({ done, title, text, action, optional }) {
  return (
    <li className="flex items-center gap-3 py-3">
      <span className={cx('grid h-6 w-6 shrink-0 place-items-center rounded-full ring-1 ring-inset',
        done ? 'bg-emerald-600 text-white ring-emerald-600 dark:bg-emerald-500 dark:ring-emerald-500' : 'text-transparent ring-slate-900/15 dark:ring-white/20')}>
        <Check className="h-3.5 w-3.5" aria-hidden="true" strokeWidth={3} />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cx('text-sm font-medium', done ? 'text-slate-500 line-through decoration-slate-400/60 dark:text-slate-400' : 'text-slate-900 dark:text-white')}>
          {title}{optional && <span className="ml-1.5 text-caption font-normal text-slate-500 no-underline dark:text-slate-400">{t('optional')}</span>}
          <span className="sr-only">{done ? ` (${t('done')})` : ''}</span>
        </p>
        {!done && <p className="text-caption text-slate-500 dark:text-slate-400">{text}</p>}
      </div>
      {!done && action}
    </li>
  );
}

const stepClass = 'inline-flex h-8 shrink-0 items-center rounded-lg px-3 text-sm font-medium text-indigo-600 hover:bg-indigo-500/[0.08] disabled:opacity-60 dark:text-indigo-400';
const stepLink = (to, label) => <Link to={to} className={stepClass}>{label}</Link>;
const stepButton = (onClick, label, busy = false) => <button type="button" onClick={onClick} disabled={busy} className={stepClass}>{busy ? t('Sending…') : label}</button>;

// Shown until every required step is done (Telegram is optional), or until dismissed.
export function GetStarted() {
  const q = useOnboarding();
  const dismiss = useDismissChecklist();
  const { send, pending } = useResend();
  const s = q.data?.steps;
  if (!s || q.data.dismissed) return null;
  const required = ['account', 'entry', 'budget', ...('email' in s ? ['email'] : [])];
  const doneCount = required.filter((k) => s[k]).length;
  if (doneCount === required.length) return null;
  return (
    <Card className="mb-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[0.9375rem] font-semibold text-slate-900 dark:text-white">{t('Get started')}</h2>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{t('{done} of {total} done. Each step is checked from what’s really in your space.', { done: doneCount, total: required.length })}</p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => dismiss.mutate()} loading={dismiss.isPending}>{t('Hide')}</Button>
      </div>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-slate-900/[0.06] dark:bg-white/[0.08]" aria-hidden="true">
        <div className="h-full rounded-full bg-emerald-600 transition-[width] duration-200 dark:bg-emerald-500" style={{ width: `${(doneCount / required.length) * 100}%` }} />
      </div>
      <ul className="mt-1 divide-y divide-slate-900/[0.06] dark:divide-white/[0.06]">
        <Step done={s.account} title={t('Add your bank account or card')} text={t('So balances and card bills match your real accounts. “Cash” is already there.')} action={stepLink('/accounts', t('Add account'))} />
        <Step done={s.entry} title={t('Add your first entry')} text={t('A salary, the rent or today’s groceries. Charts fill in as you go.')}
          action={stepButton(startEntry, t('Add entry'))} />
        <Step done={s.budget} title={t('Set a budget')} text={t('A monthly limit for a category; you get a heads-up at 80%.')} action={stepLink('/budgets', t('Set budget'))} />
        {'email' in s && (
          <Step done={s.email} title={t('Confirm your email')} text={t('Needed for monthly reports, alerts and invites.')}
            action={stepButton(send, t('Send link'), pending)} />
        )}
        <Step done={s.telegram} optional title={t('Connect Telegram')} text={t('Add entries by messaging a bot, like “200 chai”.')} action={stepLink('/integrations', t('Connect'))} />
      </ul>
    </Card>
  );
}

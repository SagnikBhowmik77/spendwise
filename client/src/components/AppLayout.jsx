import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { Ellipsis, Eye, EyeOff, Lock, LogOut, Monitor, Moon, Plus, Search, Sun } from 'lucide-react';
import { formatINR } from '../lib/format.js';
import { flushQueue, offlineSupported, queuedEntries } from '../lib/offline.js';
import CommandPalette, { PaletteButton, openPalette, startEntry } from './CommandPalette.jsx';
import { privacyOn, setPrivacy } from '../lib/prefs.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { useSpace } from '../context/SpaceContext.jsx';
import { Modal } from './Modal.jsx';
import { Segmented, Select, cx } from './ui.jsx';
import { LanguageSwitch } from './LanguageSwitch.jsx';
import { NAV_GROUPS, PHONE_TABS, visibleIn } from './nav.js';
import { Logo, ThemeSwitch } from './Brand.jsx';
import { VerifyBanner } from './Onboarding.jsx';
import { t, tn } from '../lib/i18n.js';

// Personal space or a shared household. Hidden when you only have your personal space.
function SpaceSwitcher({ className }) {
  const { spaces, space, switchTo } = useSpace();
  const navigate = useNavigate();
  if (spaces.length < 2) return null;
  return (
    <Select
      aria-label={t('Space')}
      className={className}
      value={space?.id ?? ''}
      onChange={(e) => {
        const next = spaces.find((s) => s.id === e.target.value);
        switchTo(next.kind === 'personal' ? null : next.id);
        navigate('/');
      }}
    >
      {spaces.map((s) => (
        <option key={s.id} value={s.id}>{s.kind === 'personal' ? t('Personal') : t('{name} (shared)', { name: s.name })}</option>
      ))}
    </Select>
  );
}

const iconButton = 'grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-500 transition-colors duration-150 hover:bg-slate-900/[0.05] hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/[0.06] dark:hover:text-white';

// Eye button: blur every amount (for using the app in public). Shortcut: P.
function PrivacyToggle({ className }) {
  const [on, setOn] = useState(privacyOn);
  useEffect(() => {
    const sync = (e) => setOn(e.detail);
    window.addEventListener('spendwise:privacy', sync);
    return () => window.removeEventListener('spendwise:privacy', sync);
  }, []);
  const Icon = on ? EyeOff : Eye;
  return (
    <button type="button" onClick={() => setPrivacy(!on)} aria-pressed={on} title={on ? t('Show amounts (P)') : t('Hide amounts (P)')}
      className={cx(iconButton, on && 'bg-slate-900/[0.06] text-slate-900 dark:bg-white/[0.08] dark:text-white', className)}>
      <Icon className="h-4 w-4" aria-hidden="true" />
      <span className="sr-only">{on ? t('Show amounts') : t('Hide amounts')}</span>
    </button>
  );
}

// Batch 12Q: entries saved with no connection. Sent when the app opens or comes back online; the pill shows
// how many are still waiting.
function OfflineQueue({ className }) {
  const qc = useQueryClient();
  const [waiting, setWaiting] = useState(0);
  const count = useCallback(() => queuedEntries().then((x) => setWaiting(x.length)), []);
  const send = useCallback(async () => {
    if (!navigator.onLine) return;
    const r = await flushQueue();
    if (r.sent) {
      toast.success(tn(r.sent, '{n} entry saved offline was added', '{n} entries saved offline were added'));
      qc.invalidateQueries();
    }
    for (const x of r.rejected) toast.error(t('An offline entry of ₹{amount} couldn’t be added: {error}', { amount: x.body.amount ?? x.body.originalAmount, error: x.message }), { duration: 8000 });
  }, [qc]);
  useEffect(() => {
    if (!offlineSupported()) return undefined;
    count();
    send();
    window.addEventListener('online', send);
    window.addEventListener('spendwise:queue', count);
    return () => { window.removeEventListener('online', send); window.removeEventListener('spendwise:queue', count); };
  }, [count, send]);
  if (!waiting) return null;
  return (
    <button type="button" onClick={send} title={t('Send now')}
      className={cx('inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-amber-500/12 px-2.5 text-caption font-medium text-amber-800 dark:bg-amber-400/10 dark:text-amber-200', className)}>
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
      {tn(waiting, '{n} waiting to sync', '{n} waiting to sync')}
    </button>
  );
}

// Batch 12R: viewers and children see what their role allows, before they try something that isn't.
function RoleNotice() {
  const { space } = useSpace();
  const role = space?.kind === 'shared' ? space.role : null;
  if (role !== 'viewer' && role !== 'child') return null;
  const me = space.members.find((m) => m.you);
  return (
    <p className="mb-6 flex items-start gap-2 rounded-lg bg-amber-500/[0.08] px-3 py-2.5 text-sm text-amber-900 ring-1 ring-inset ring-amber-500/15 dark:bg-amber-400/[0.07] dark:text-amber-100 dark:ring-amber-400/15">
      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
      {role === 'viewer' ? t('You’re a viewer in {space}: you can look at everything but not change it.', { space: space.name })
        : me?.pocketMoney ? t('In {space} you can add your own expenses, up to {amount} a month.', { space: space.name, amount: formatINR(me.pocketMoney.paise) })
          : t('In {space} you can add your own expenses.', { space: space.name })}
    </p>
  );
}

const linkClass = ({ isActive }) => cx(
  'group flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium transition-colors duration-150',
  isActive
    ? 'bg-white text-slate-900 shadow-xs ring-1 ring-slate-900/[0.06] dark:bg-white/[0.07] dark:text-white dark:shadow-none dark:ring-white/[0.06]'
    : 'text-slate-600 hover:bg-slate-900/[0.04] hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/[0.04] dark:hover:text-white',
);
const linkIcon = ({ isActive }) => cx('h-4 w-4 shrink-0', isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400 group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-300');

function NavItem({ item, onClick }) {
  const Icon = item.icon;
  return (
    <NavLink to={item.to} end={item.end} className={linkClass} onClick={onClick}>
      {({ isActive }) => (<><Icon className={linkIcon({ isActive })} aria-hidden="true" strokeWidth={1.85} /><span className="truncate">{item.label}</span></>)}
    </NavLink>
  );
}

const initials = (name = '') => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '·';

// Sidebar on large screens; a slim top bar and a bottom tab bar on phones and tablets.
export default function AppLayout() {
  const { shared } = useSpace();
  const visible = visibleIn(shared);
  const { user, logout, lockNow } = useAuth();
  const [more, setMore] = useState(false);
  const canLock = Boolean(user?.appLock?.enabled);
  return (
    <div className="min-h-dvh">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col border-r border-slate-900/[0.06] bg-slate-50 lg:flex dark:border-white/[0.06] dark:bg-slate-950">
        <div className="space-y-3 px-3 pb-3 pt-4">
          <div className="flex h-8 items-center gap-1 pl-1.5">
            <Logo className="mr-auto" />
            <OfflineQueue />
            <PrivacyToggle />
          </div>
          <SpaceSwitcher className="h-9" />
          <div className="flex gap-2">
            <PaletteButton />
            <button type="button" onClick={startEntry} title={t('New expense (N)')}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-indigo-600 text-white shadow-sm transition-colors duration-150 hover:bg-indigo-700 active:scale-[0.97] dark:bg-indigo-600 dark:hover:bg-indigo-500">
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">{t('New expense')}</span>
            </button>
          </div>
        </div>
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4 pt-1" aria-label={t('Main')}>
          {NAV_GROUPS.map((g) => {
            const items = g.items.filter(visible);
            if (!items.length) return null;
            return (
              <div key={g.label ?? 'main'}>
                {g.label && <p className="mb-1 px-2.5 text-caption font-medium text-slate-500 dark:text-slate-400">{g.label}</p>}
                <div className="space-y-0.5">{items.map((item) => <NavItem key={item.to} item={item} />)}</div>
              </div>
            );
          })}
        </nav>
        <div className="space-y-3 border-t border-slate-900/[0.06] px-3 py-3 dark:border-white/[0.06]">
          <div className="flex items-center justify-between gap-2 px-1">
            <ThemeSwitch size="sm" />
            <LanguageSwitch />
          </div>
          <div className="flex items-center gap-2.5 rounded-lg px-1.5 py-1">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-900/[0.07] text-caption font-semibold text-slate-700 dark:bg-white/[0.08] dark:text-slate-200" aria-hidden="true">{initials(user?.name)}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{user?.name}</p>
              <p className="truncate text-caption text-slate-500 dark:text-slate-400">{user?.email}</p>
            </div>
            {canLock && (
              <button type="button" onClick={lockNow} className={iconButton} title={t('Lock')}>
                <Lock className="h-4 w-4" aria-hidden="true" /><span className="sr-only">{t('Lock')}</span>
              </button>
            )}
            <button type="button" onClick={logout} className={iconButton} title={t('Log out')}>
              <LogOut className="h-4 w-4" aria-hidden="true" /><span className="sr-only">{t('Log out')}</span>
            </button>
          </div>
        </div>
      </aside>

      <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-slate-900/[0.06] bg-slate-50/85 px-4 backdrop-blur-md lg:hidden dark:border-white/[0.06] dark:bg-slate-950/85">
        <Logo className="mr-auto" />
        <SpaceSwitcher className="h-8 max-w-[8.5rem] text-caption" />
        <OfflineQueue />
        <button type="button" onClick={openPalette} className={iconButton} title={t('Search or add…')}>
          <Search className="h-4 w-4" aria-hidden="true" /><span className="sr-only">{t('Search or add…')}</span>
        </button>
        <PrivacyToggle />
      </header>
      <CommandPalette />

      <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-6 sm:px-6 lg:pb-12 lg:pl-[18rem] lg:pr-10 lg:pt-10">
        <VerifyBanner />
        <RoleNotice />
        <Outlet />
      </main>

      <nav
        aria-label={t('Main')}
        className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-900/[0.06] bg-white/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden dark:border-white/[0.06] dark:bg-slate-900/90"
      >
        <div className="mx-auto grid h-16 max-w-md grid-cols-5 items-center px-2">
          {PHONE_TABS.slice(0, 2).map((item) => <PhoneTab key={item.to} item={item} />)}
          <div className="grid place-items-center">
            <button type="button" onClick={startEntry}
              className="grid h-11 w-11 place-items-center rounded-full bg-indigo-600 text-white shadow-md transition-transform duration-150 active:scale-95 dark:bg-indigo-600">
              <Plus className="h-5 w-5" aria-hidden="true" />
              <span className="sr-only">{t('New expense')}</span>
            </button>
          </div>
          <PhoneTab item={PHONE_TABS[2]} />
          <button type="button" onClick={() => setMore(true)} className="flex flex-col items-center gap-1 text-[0.6875rem] font-medium text-slate-500 dark:text-slate-400">
            <Ellipsis className="h-5 w-5" aria-hidden="true" />
            {t('More')}
          </button>
        </div>
      </nav>

      <Modal open={more} onClose={() => setMore(false)} title={t('More')}>
        <nav className="space-y-5" aria-label={t('More')}>
          {NAV_GROUPS.map((g) => {
            const items = g.items.filter(visible).filter((i) => !PHONE_TABS.includes(i));
            if (!items.length) return null;
            return (
              <div key={g.label ?? 'main'}>
                {g.label && <p className="mb-2 text-caption font-medium text-slate-500 dark:text-slate-400">{g.label}</p>}
                {/* One list per group, so a group of any size fills its block without holes. */}
                <div className="divide-y divide-slate-900/[0.06] overflow-hidden rounded-xl bg-slate-900/[0.03] dark:divide-white/[0.06] dark:bg-white/[0.04]">
                  {items.map(({ to, label, icon: Icon, end }) => (
                    <NavLink key={to} to={to} end={end} onClick={() => setMore(false)}
                      className={({ isActive }) => cx('flex h-11 items-center gap-3 px-3.5 text-sm font-medium transition-colors',
                        isActive ? 'text-indigo-700 dark:text-indigo-300' : 'text-slate-700 active:bg-slate-900/[0.05] dark:text-slate-200 dark:active:bg-white/[0.05]')}>
                      <Icon className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" strokeWidth={1.85} />
                      <span className="truncate">{label}</span>
                    </NavLink>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>
        <div className="mt-6 space-y-3 border-t border-slate-900/[0.06] pt-4 dark:border-white/[0.06]">
          <div className="flex items-center justify-between gap-2">
            <ThemeSwitch size="sm" />
            <LanguageSwitch />
          </div>
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-900/[0.07] text-caption font-semibold dark:bg-white/[0.08]" aria-hidden="true">{initials(user?.name)}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{user?.name}</p>
              <p className="truncate text-caption text-slate-500 dark:text-slate-400">{user?.email}</p>
            </div>
            {canLock && (
              <button type="button" onClick={() => { setMore(false); lockNow(); }} className={iconButton} title={t('Lock now')}>
                <Lock className="h-4 w-4" aria-hidden="true" /><span className="sr-only">{t('Lock now')}</span>
              </button>
            )}
            <button type="button" onClick={() => { setMore(false); logout(); }} className={iconButton} title={t('Log out')}>
              <LogOut className="h-4 w-4" aria-hidden="true" /><span className="sr-only">{t('Log out')}</span>
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function PhoneTab({ item }) {
  const Icon = item.icon;
  return (
    <NavLink to={item.to} end={item.end}
      className={({ isActive }) => cx('flex flex-col items-center gap-1 text-[0.6875rem] font-medium transition-colors', isActive ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400')}>
      {({ isActive }) => (
        <>
          <span className={cx('grid h-7 w-12 place-items-center rounded-full transition-colors duration-200', isActive && 'bg-slate-900/[0.07] dark:bg-white/[0.1]')}>
            <Icon className={cx('h-5 w-5', isActive && 'text-indigo-600 dark:text-indigo-400')} aria-hidden="true" strokeWidth={isActive ? 2.1 : 1.8} />
          </span>
          <span className="max-w-full truncate px-0.5">{item.label}</span>
        </>
      )}
    </NavLink>
  );
}

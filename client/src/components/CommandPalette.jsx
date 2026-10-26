import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, CornerDownLeft, EyeOff, Keyboard, Layers, Moon, Search, Sparkles, Sun } from 'lucide-react';
import { useSpace } from '../context/SpaceContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { privacyOn, setPrivacy } from '../lib/prefs.js';
import { Modal } from './Modal.jsx';
import TransactionForm from './TransactionForm.jsx';
import { useQuickAddParser } from './QuickAdd.jsx';
import VoiceButton from './VoiceButton.jsx';
import { NAV, visibleIn } from './nav.js';
import { cx } from './ui.jsx';
import { t } from '../lib/i18n.js';

export const SHORTCUTS = [
  [t('Ctrl/⌘ K or /'), t('Open this palette')], ['N', t('New expense')], ['I', t('New income')], ['T', t('New transfer')],
  ['P', t('Privacy mode on/off')], ['?', t('Show shortcuts')], ['Esc', t('Close')],
];

// The shell's search and "+" buttons go through the same keys as the keyboard, so there is one code path.
export const openPalette = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
export const startEntry = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n' }));
const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

// Typing in a field, or a dialog already open: single-letter shortcuts stay out of the way.
const busy = (e) => {
  const el = e.target;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || document.querySelector('dialog[open]');
};

const Kbd = ({ children }) => (
  <kbd className="inline-flex h-5 min-w-5 shrink-0 whitespace-nowrap items-center justify-center rounded border border-slate-900/10 bg-slate-50 px-1 font-sans text-[0.6875rem] font-medium text-slate-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-400">{children}</kbd>
);

export default function CommandPalette() {
  const navigate = useNavigate();
  const { spaces, space, shared, switchTo } = useSpace();
  const { theme, setTheme } = useTheme();
  const parse = useQuickAddParser();
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const [form, setForm] = useState(null); // defaults for the add form
  const input = useRef(null);
  const list = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(true); return; }
      if (busy(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (e.key === '/') { e.preventDefault(); setOpen(true); }
      else if (k === 'n') { e.preventDefault(); setForm({ type: 'expense' }); }
      else if (k === 'i') { e.preventDefault(); setForm({ type: 'income' }); }
      else if (k === 't') { e.preventDefault(); setForm({ type: 'transfer' }); }
      else if (k === 'p') { e.preventDefault(); setPrivacy(!privacyOn()); }
      else if (e.key === '?') { e.preventDefault(); setHelp(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => { if (open) { setText(''); setActive(0); setTimeout(() => input.current?.focus(), 0); } }, [open]);

  // Groups of { label, icon, hint, run }; the list keeps one running index across them for the arrow keys.
  const groups = useMemo(() => {
    const q = text.trim().toLowerCase();
    const match = (i) => !q || i.label.toLowerCase().includes(q);
    const actions = [
      { label: t('New expense'), icon: ArrowUpRight, hint: 'N', run: () => setForm({ type: 'expense' }) },
      { label: t('New income'), icon: ArrowDownLeft, hint: 'I', run: () => setForm({ type: 'income' }) },
      { label: t('New transfer between accounts'), icon: ArrowLeftRight, hint: 'T', run: () => setForm({ type: 'transfer' }) },
      { label: privacyOn() ? t('Turn privacy mode off') : t('Turn privacy mode on (blur amounts)'), icon: EyeOff, hint: 'P', run: () => setPrivacy(!privacyOn()) },
      { label: theme === 'dark' ? t('Switch to light theme') : t('Switch to dark theme'), icon: theme === 'dark' ? Sun : Moon, run: () => setTheme(theme === 'dark' ? 'light' : 'dark') },
      ...spaces.filter((s) => s.id !== space?.id).map((s) => ({
        label: t('Open space: {name}', { name: s.kind === 'personal' ? t('Personal') : s.name }), icon: Layers,
        run: () => { switchTo(s.kind === 'personal' ? null : s.id); navigate('/'); },
      })),
      { label: t('Keyboard shortcuts'), icon: Keyboard, hint: '?', run: () => setHelp(true) },
    ].filter(match);
    const pages = NAV.filter(visibleIn(shared)).map((n) => ({ label: t('Go to {page}', { page: n.label }), icon: n.icon, run: () => navigate(n.to) })).filter(match);
    const out = [];
    // Text starting with a number reads as a quick add: "450 swiggy dinner yesterday".
    if (/^\s*(₹|rs\.?\s*)?\d/.test(text)) {
      const parsed = parse(text);
      out.push({ title: t('Quick add'), items: [{ label: t('Add: {text}', { text: text.trim() }), icon: Sparkles, hint: '↵', run: () => setForm(parsed) }] });
    }
    if (actions.length) out.push({ title: t('Actions'), items: actions });
    if (pages.length) out.push({ title: t('Go to'), items: pages });
    return out;
  }, [text, navigate, spaces, space, shared, switchTo, theme, setTheme, parse]);
  const items = groups.flatMap((g) => g.items);

  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [active]);

  const run = (item) => { setOpen(false); item?.run(); };
  let index = -1;

  return (
    <>
      <Modal open={open} onClose={() => setOpen(false)} title={t('Go to or do…')} bare placement="top">
        <div className="flex items-center gap-2 border-b border-slate-900/[0.06] px-4 py-2 dark:border-white/[0.06]">
          <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
          <input
            ref={input}
            value={text}
            onChange={(e) => { setText(e.target.value); setActive(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
              if (e.key === 'Enter') { e.preventDefault(); run(items[active]); }
            }}
            placeholder={t('Search, or type “450 swiggy dinner” to add')}
            aria-label={t('Command')}
            className="h-11 min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-slate-400 sm:text-sm"
          />
          <VoiceButton className="h-9 w-9" onHeard={setText} onText={(said) => { setOpen(false); setForm(parse(said)); }} />
        </div>
        <ul ref={list} role="listbox" aria-label={t('Commands')} className="max-h-[min(60vh,26rem)] overflow-y-auto p-2">
          {groups.map((g) => (
            <li key={g.title} role="presentation">
              <p className="px-2.5 pb-1 pt-2 text-caption font-medium text-slate-400 dark:text-slate-500">{g.title}</p>
              <ul role="presentation">
                {g.items.map((item) => {
                  index += 1;
                  const i = index;
                  const Icon = item.icon;
                  return (
                    <li key={item.label} role="option" aria-selected={i === active}>
                      <button type="button" onMouseMove={() => setActive(i)} onClick={() => run(item)}
                        className={cx('flex h-10 w-full items-center gap-3 rounded-lg px-2.5 text-left text-sm transition-colors duration-100',
                          i === active ? 'bg-slate-900/[0.05] text-slate-900 dark:bg-white/[0.07] dark:text-white' : 'text-slate-700 dark:text-slate-300')}>
                        {Icon && <Icon className={cx('h-4 w-4 shrink-0', i === active ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400')} aria-hidden="true" strokeWidth={1.85} />}
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        {item.hint && <Kbd>{item.hint}</Kbd>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
          {!items.length && <li className="px-3 py-10 text-center text-sm text-slate-500 dark:text-slate-400">{t('Nothing matches.')}</li>}
        </ul>
        <div className="hidden items-center gap-4 border-t border-slate-900/[0.06] px-4 py-2.5 text-caption text-slate-500 sm:flex dark:border-white/[0.06] dark:text-slate-400">
          <span className="flex items-center gap-1.5"><Kbd>↑</Kbd><Kbd>↓</Kbd> {t('to move')}</span>
          <span className="flex items-center gap-1.5"><Kbd><CornerDownLeft className="h-3 w-3" aria-hidden="true" /></Kbd> {t('to open')}</span>
          <span className="ml-auto flex items-center gap-1.5"><Kbd>Esc</Kbd> {t('to close')}</span>
        </div>
      </Modal>
      <Modal open={help} onClose={() => setHelp(false)} title={t('Keyboard shortcuts')}>
        <ul className="divide-y divide-slate-900/[0.06] text-sm dark:divide-white/[0.06]">
          {SHORTCUTS.map(([key, what]) => (
            <li key={key} className="flex items-center justify-between gap-4 py-2.5"><span>{what}</span><Kbd>{key}</Kbd></li>
          ))}
        </ul>
      </Modal>
      <TransactionForm open={form !== null} defaults={form ?? undefined} onClose={() => setForm(null)} />
    </>
  );
}

export function PaletteButton() {
  return (
    <button type="button" onClick={openPalette}
      className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg bg-white px-2.5 text-sm text-slate-500 shadow-xs ring-1 ring-slate-900/[0.08] transition-colors duration-150 hover:text-slate-700 hover:ring-slate-900/15 dark:bg-white/[0.04] dark:text-slate-400 dark:shadow-none dark:ring-white/[0.08] dark:hover:text-slate-200">
      <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="truncate">{t('Search')}</span>
      <span className="ml-auto whitespace-nowrap"><Kbd>{MAC ? '⌘K' : 'Ctrl K'}</Kbd></span>
    </button>
  );
}

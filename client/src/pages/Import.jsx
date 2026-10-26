import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import toast from 'react-hot-toast';
import { FileSpreadsheet, Upload, Wand2, X } from 'lucide-react';
import {
  useAccounts, useCategories, useCommitImport, useDeleteLayout, useDeleteRule, useImportLayouts, useImportRules, useImports,
  usePreviewImport, useRedoImport, useSaveRule, useUndoImport,
} from '../hooks/api.js';
import { MAX_FILE_BYTES, bodyRows, findHeaderRow, guessMapping, matchLayout, readStatement } from '../lib/importFile.js';
import { formatDay, formatINR } from '../lib/format.js';
import { Modal } from '../components/Modal.jsx';
import {
  Amount, Badge, Button, Card, CardHeader, EmptyState, ErrorNote, Field, Input, PageHeader, Segmented, Select, Skeleton, cx,
} from '../components/ui.jsx';
import { localeTag, t, tn } from '../lib/i18n.js';
import { catLabel } from '../lib/labels.js';

const MAX_LINES = 5000;
const PAGE = 100;
const SOURCE = { rule: [t('Your rule'), 'indigo'], learned: [t('Learned'), 'green'], suggested: [t('Suggested'), 'slate'] };
const NO_COLUMNS = { time: null, amount: null, debit: null, credit: null, drcr: null };
const colName = (header, i) => `${i < 26 ? String.fromCharCode(65 + i) : `#${i + 1}`}: ${header[i] || '(no name)'}`;

function ColumnSelect({ id, label, header, value, onChange, optional = false, hint }) {
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <Select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}>
        {optional && <option value="">{t('None')}</option>}
        {header.map((_, i) => <option key={i} value={i}>{colName(header, i)}</option>)}
      </Select>
    </Field>
  );
}

function FilePicker({ onFile, reading }) {
  const input = useRef(null);
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); onFile(e.dataTransfer.files[0]); }}
      className={cx('flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-4 py-10 text-center',
        over ? 'border-brand-500 bg-indigo-50 dark:bg-indigo-500/10' : 'border-slate-300 dark:border-slate-700')}
    >
      <FileSpreadsheet className="h-8 w-8 text-slate-400" aria-hidden="true" />
      <div>
        <p className="font-medium">{t('Drop your bank or card statement here')}</p>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('CSV or Excel (.csv, .xls, .xlsx), up to 5 MB. PDF statements can’t be read reliably, so download the CSV or Excel version from net banking.')}</p>
      </div>
      <input ref={input} type="file" accept=".csv,.txt,.tsv,.xls,.xlsx,.ods" className="sr-only" aria-label={t('Statement file')}
        onChange={(e) => { onFile(e.target.files[0]); e.target.value = ''; }} />
      <Button variant="secondary" loading={reading} onClick={() => input.current.click()}><Upload className="h-4 w-4" aria-hidden="true" /> {t('Choose file')}</Button>
    </div>
  );
}

function RuleDialog({ row, onClose, onSaved }) {
  const save = useSaveRule();
  const [pattern, setPattern] = useState(() => (row?.merchant ?? row?.description.split(/[/-]/)[0] ?? '').toLowerCase().slice(0, 60));
  const [category, setCategory] = useState(row?.category ?? '');
  async function submit(e) {
    e.preventDefault();
    try {
      const { rule } = await save.mutateAsync({ pattern: pattern.trim(), type: row.type, category: category.trim() });
      onSaved(rule);
    } catch (err) {
      toast.error(err.details?.[0]?.message ?? err.message);
    }
  }
  return (
    <Modal open={Boolean(row)} onClose={onClose} title={t('Always categorise like this')}>
      {row && (
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-400">{row.type === 'income' ? t('Every income whose narration contains this text gets the category, in this import and future ones.') : t('Every expense whose narration contains this text gets the category, in this import and future ones.')}</p>
          <Field label={t('When the narration contains')} htmlFor="rule-pattern" hint={t('Not case-sensitive. Keep it short, like a merchant name.')}>
            <Input id="rule-pattern" value={pattern} onChange={(e) => setPattern(e.target.value)} maxLength={60} />
          </Field>
          <Field label={t('Use the category')} htmlFor="rule-category">
            <Input id="rule-category" value={category} onChange={(e) => setCategory(e.target.value)} list={`imp-cat-${row.type}`} maxLength={40} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>{t('Cancel')}</Button>
            <Button type="submit" loading={save.isPending} disabled={pattern.trim().length < 2 || !category.trim()}>{t('Save rule')}</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function ReviewRow({ row, others, onChange, onType, onRule }) {
  const transfer = row.type === 'transfer';
  const source = SOURCE[row.categorySource];
  return (
    <li className={cx('grid gap-x-3 gap-y-2 py-3 sm:grid-cols-[auto_6rem_minmax(0,1fr)_minmax(0,20rem)_auto] sm:items-center', row.error && 'opacity-60')}>
      <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={row.include} disabled={Boolean(row.error)}
        onChange={(e) => onChange({ include: e.target.checked })} aria-label={t('Import line {n}', { n: row.line })} />
      <div className="text-xs text-slate-500 dark:text-slate-400">
        {row.date ? formatDay(row.date) : t('Line {n}', { n: row.line })}{row.time ? `, ${row.time}` : ''}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{row.merchant ?? (row.description || '(no description)')}</p>
        {row.merchant && <p className="truncate text-xs text-slate-500 dark:text-slate-400" title={row.description}>{row.description}</p>}
        {row.error && <p className="text-xs text-rose-600 dark:text-rose-400">{t('Skipped: {reason}', { reason: row.error })}</p>}
        {row.duplicate && <p className="text-xs text-amber-700 dark:text-amber-300">{t('Possible duplicate.')} {row.duplicate.message}</p>}
        {!row.error && row.transferHint && !transfer && (
          <p className="text-xs text-slate-500 dark:text-slate-400">{row.transferHint === 'atm' ? t('Looks like cash from an ATM.') : t('Looks like a credit card bill.')} {t('Make it a transfer to keep it out of your spending.')}</p>
        )}
      </div>
      {row.error ? <span /> : (
        <div className="min-w-0 space-y-1">
        <div className="flex min-w-0 gap-1.5">
          <Select value={row.type} onChange={(e) => onType(e.target.value)} aria-label={t('Type for line {n}', { n: row.line })} className="w-32! shrink-0">
            <option value="expense">{t('Expense')}</option>
            <option value="income">{t('Income')}</option>
            <option value="transfer">{t('Transfer')}</option>
          </Select>
          {transfer ? (
            <Select value={row.otherAccount ?? ''} onChange={(e) => onChange({ otherAccount: e.target.value || null })} aria-label={row.direction === 'in' ? t('From account for line {n}', { n: row.line }) : t('To account for line {n}', { n: row.line })}>
              <option value="">{row.direction === 'in' ? t('From…') : t('To…')}</option>
              {others.map((a) => <option key={a.id} value={a.id}>{row.direction === 'in' ? t('From') : t('To')} {a.name}</option>)}
            </Select>
          ) : (
            <div className="relative min-w-0 flex-1">
              <Input value={row.category ?? ''} onChange={(e) => onChange({ category: e.target.value, categorySource: null })} list={`imp-cat-${row.type}`}
                aria-label={t('Category for line {n}', { n: row.line })} maxLength={40} className={cx(row.category === 'Other' && 'ring-amber-400')} />
            </div>
          )}
        </div>
        {!transfer && (
          <div className="flex items-center gap-1">
            {source && <Badge tone={source[1]}>{source[0]}</Badge>}
            <button type="button" onClick={onRule} aria-label={t('Make a rule from line {n}', { n: row.line })}
              className="inline-flex items-center gap-1 rounded px-1 text-xs text-slate-500 hover:text-brand-600 dark:text-slate-400 dark:hover:text-indigo-300">
              <Wand2 className="h-3.5 w-3.5" aria-hidden="true" /> Always
            </button>
          </div>
        )}
        </div>
      )}
      <div className="whitespace-nowrap sm:text-right">
        {row.amountPaise ? <Amount paise={row.amountPaise} type={row.type} className="text-sm" /> : null}
      </div>
    </li>
  );
}

function PastImports() {
  const { data, error, refetch } = useImports();
  const undo = useUndoImport();
  const redo = useRedoImport();
  const act = async (fn, id, message) => {
    try { await fn.mutateAsync(id); toast.success(message); } catch (err) { toast.error(err.message); }
  };
  return (
    <Card>
      <CardHeader title={t('Past imports')} subtitle={t('Undo removes every entry an import added. You can bring them back for 30 days.')} />
      {error ? <ErrorNote error={error} onRetry={refetch} /> : !data ? <Skeleton className="h-16 w-full" /> : !data.imports.length ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('Nothing imported yet.')}</p>
      ) : (
        <ul className="divide-y divide-slate-900/[0.05] dark:divide-white/[0.05]">
          {data.imports.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{b.fileName || t('Statement')} <span className="font-normal text-slate-500 dark:text-slate-400">{t('into {account}', { account: b.accountName })}</span></p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{tn(b.count, '{n} entry', '{n} entries')} · {new Date(b.createdAt).toLocaleDateString(localeTag(), { day: 'numeric', month: 'short', year: 'numeric' })}</p>
              </div>
              {b.undoneAt ? (
                <>
                  <Badge>{t('Undone')}</Badge>
                  <Button variant="secondary" size="sm" loading={redo.isPending && redo.variables === b.id} onClick={() => act(redo, b.id, t('Import brought back'))}>{t('Bring back')}</Button>
                </>
              ) : (
                <Button variant="secondary" size="sm" loading={undo.isPending && undo.variables === b.id} onClick={() => act(undo, b.id, t('Import undone'))}>{t('Undo import')}</Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function RulesAndLayouts() {
  const rules = useImportRules();
  const layouts = useImportLayouts();
  const save = useSaveRule();
  const removeRule = useDeleteRule();
  const removeLayout = useDeleteLayout();
  const [draft, setDraft] = useState({ pattern: '', type: 'expense', category: '' });
  async function add(e) {
    e.preventDefault();
    try {
      await save.mutateAsync({ ...draft, pattern: draft.pattern.trim(), category: draft.category.trim() });
      setDraft((d) => ({ ...d, pattern: '', category: '' }));
    } catch (err) {
      toast.error(err.details?.[0]?.message ?? err.message);
    }
  }
  return (
    <Card>
      <CardHeader title={t('Category rules')} subtitle={t('Checked before anything else when a statement is imported. Spendwise also learns from the categories you’ve used before.')} />
      <form onSubmit={add} className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:items-end">
        <Field label={t('Narration contains')} htmlFor="new-rule-pattern"><Input id="new-rule-pattern" value={draft.pattern} onChange={(e) => setDraft({ ...draft, pattern: e.target.value })} placeholder={t('e.g. swiggy')} maxLength={60} /></Field>
        <Segmented label={t('Rule type')} size="sm" value={draft.type} onChange={(type) => setDraft({ ...draft, type })} options={[{ value: 'expense', label: t('Expense') }, { value: 'income', label: t('Income') }]} />
        <Field label={t('Category')} htmlFor="new-rule-category"><Input id="new-rule-category" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} list={`imp-cat-${draft.type}`} maxLength={40} /></Field>
        <Button type="submit" variant="secondary" loading={save.isPending} disabled={draft.pattern.trim().length < 2 || !draft.category.trim()}>{t('Add rule')}</Button>
      </form>
      {!rules.data ? <Skeleton className="h-10 w-full" /> : (
        <ul className="divide-y divide-slate-900/[0.06] text-sm dark:divide-white/[0.06]">
          {rules.data.rules.map((r) => (
            <li key={r.id} className="flex items-center gap-2 py-2">
              <span className="min-w-0 flex-1 truncate">"{r.pattern}" → {r.category} <span className="text-slate-500 dark:text-slate-400">({r.type})</span></span>
              <Button variant="ghost" size="icon" onClick={() => removeRule.mutate(r.id)} aria-label={t('Delete rule {name}', { name: r.pattern })}><X className="h-4 w-4" aria-hidden="true" /></Button>
            </li>
          ))}
          {!rules.data.rules.length && <li className="py-2 text-slate-500 dark:text-slate-400">{t('No rules yet.')}</li>}
        </ul>
      )}
      {layouts.data?.layouts.length > 0 && (
        <div className="mt-5">
          <h3 className="mb-1 text-sm font-semibold">{t('Saved bank layouts')}</h3>
          <ul className="divide-y divide-slate-900/[0.06] text-sm dark:divide-white/[0.06]">
            {layouts.data.layouts.map((l) => (
              <li key={l.id} className="flex items-center gap-2 py-2">
                <span className="min-w-0 flex-1 truncate">{l.name}</span>
                <Button variant="ghost" size="icon" onClick={() => removeLayout.mutate(l.id)} aria-label={t('Delete layout {name}', { name: l.name })}><X className="h-4 w-4" aria-hidden="true" /></Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

export default function Import() {
  const accounts = useAccounts();
  const layouts = useImportLayouts();
  const categories = useCategories();
  const preview = usePreviewImport();
  const commit = useCommitImport();
  const undo = useUndoImport();

  const [file, setFile] = useState(null); // { name, sheets: [{ name, rows }] }
  const [sheet, setSheet] = useState(0);
  const [headerIndex, setHeaderIndex] = useState(0);
  const [mapping, setMapping] = useState(null);
  const [matched, setMatched] = useState(null);
  const [accountId, setAccountId] = useState('');
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState(null);
  const [result, setResult] = useState(null);
  const [edits, setEdits] = useState({});
  const [filter, setFilter] = useState('ready');
  const [shown, setShown] = useState(PAGE);
  const [layoutName, setLayoutName] = useState('');
  const [rememberLayout, setRememberLayout] = useState(true);
  const [ruleFor, setRuleFor] = useState(null);
  const [done, setDone] = useState(null);

  const usable = (accounts.data?.accounts ?? []).filter((a) => !a.archived);
  const account = usable.find((a) => a.id === accountId) ?? usable.find((a) => a.type === 'bank') ?? usable[0];
  const others = usable.filter((a) => a.id !== account?.id);
  const rows = file?.sheets[sheet]?.rows ?? [];
  const header = rows[headerIndex] ?? [];
  const width = Math.max(header.length, ...rows.slice(headerIndex, headerIndex + 20).map((r) => r.length));
  const columns = Array.from({ length: width }, (_, i) => header[i] ?? '');
  const lines = useMemo(() => (file ? bodyRows(rows, headerIndex) : []), [file, rows, headerIndex]);

  function openSheet(sheets, i, forAccount = account) {
    const r = sheets[i].rows;
    const m = matchLayout(r, layouts.data?.layouts ?? []);
    if (m) {
      setHeaderIndex(m.headerIndex);
      setMapping({ ...NO_COLUMNS, ...m.layout.mapping });
      setMatched(m.layout.name);
      setLayoutName(m.layout.name);
    } else {
      const h = findHeaderRow(r);
      setHeaderIndex(h);
      setMapping(guessMapping(r[h] ?? [], { card: forAccount?.type === 'credit_card' }));
      setMatched(null);
      setLayoutName(forAccount?.name ?? '');
    }
    setSheet(i);
    setResult(null);
    setEdits({});
  }

  async function onFile(f) {
    setReadError(null);
    setDone(null);
    if (!f) return;
    if (f.size > MAX_FILE_BYTES) { setReadError(t('That file is over 5 MB. Download a shorter period and import it in parts.')); return; }
    setReading(true);
    try {
      const sheets = await readStatement(new Uint8Array(await f.arrayBuffer()), f.name);
      if (!sheets.length) throw new Error(t('This file is empty.'));
      setFile({ name: f.name, sheets });
      openSheet(sheets, 0);
    } catch (err) {
      setFile(null);
      setReadError(err.message);
    } finally {
      setReading(false);
    }
  }

  const changeMapping = (changes) => { setMapping((m) => ({ ...m, ...changes })); setResult(null); setMatched(null); };
  const split = mapping?.debit !== null && mapping?.debit !== undefined;
  const setAmountStyle = (style) => {
    if ((style === 'two') === split) return;
    const guess = guessMapping(header);
    changeMapping(style === 'two'
      ? { amount: null, debit: guess.debit ?? mapping.amount ?? 0, credit: guess.credit ?? Math.min(width - 1, (mapping.amount ?? 0) + 1) }
      : { amount: mapping.debit, debit: null, credit: null });
  };

  async function runPreview() {
    if (lines.length > MAX_LINES) { toast.error(t('This file has {n} lines; up to {max} can be imported at once. Split it into smaller periods.', { n: lines.length, max: MAX_LINES })); return; }
    try {
      const data = await preview.mutateAsync({ account: account.id, header: columns, rows: lines, mapping });
      setResult(data);
      setEdits({});
      setFilter(data.counts.ready ? 'ready' : 'all');
      setShown(PAGE);
    } catch {
      // Shown under the button.
    }
  }

  const view = useMemo(
    () => (result?.rows ?? []).map((r) => ({ ...r, include: !r.error && !r.duplicate, ...edits[r.ref ?? `line-${r.line}`] })),
    [result, edits],
  );
  const edit = (row, changes) => setEdits((e) => ({ ...e, [row.ref]: { ...e[row.ref], ...changes } }));
  const setType = (row, type) => {
    if (type === 'transfer') edit(row, { type, direction: row.type === 'income' ? 'in' : row.direction ?? 'out', otherAccount: row.otherAccount ?? null });
    else edit(row, { type, category: row.category ?? t('Other'), categorySource: null });
  };
  const chosen = view.filter((r) => r.include && !r.error);
  const counts = {
    ready: chosen.length,
    duplicates: view.filter((r) => r.duplicate).length,
    skipped: view.filter((r) => r.error).length,
    other: chosen.filter((r) => r.type !== 'transfer' && r.category === 'Other').length,
    all: view.length,
  };
  const FILTERS = {
    ready: (r) => r.include && !r.error, duplicates: (r) => r.duplicate, skipped: (r) => r.error,
    other: (r) => r.include && r.type !== 'transfer' && r.category === 'Other', all: () => true,
  };
  const visible = view.filter(FILTERS[filter]);
  const totals = chosen.reduce((sum, r) => ({ ...sum, [r.type]: (sum[r.type] ?? 0) + r.amountPaise }), {});

  function applyRule(rule) {
    const matches = view.filter((r) => !r.error && r.type === rule.type && `${r.description} ${r.merchant ?? ''}`.toLowerCase().includes(rule.pattern));
    setEdits((e) => {
      const next = { ...e };
      for (const r of matches) next[r.ref] = { ...next[r.ref], category: rule.category, categorySource: 'rule' };
      return next;
    });
    toast.success(tn(matches.length, 'Rule saved. {n} line here now uses {category}.', 'Rule saved. {n} lines here now use {category}.', { category: catLabel(rule.category) }));
    setRuleFor(null);
  }

  async function runImport() {
    const missing = chosen.find((r) => (r.type === 'transfer' ? !r.otherAccount : !r.category?.trim()));
    if (missing) {
      toast.error(missing.type === 'transfer' ? t('Line {n}: choose the other account of the transfer.', { n: missing.line }) : t('Line {n}: choose a category.', { n: missing.line }));
      setFilter('all');
      return;
    }
    try {
      const { import: batch } = await commit.mutateAsync({
        account: account.id,
        fileName: file.name.slice(0, 120),
        rows: chosen.map((r) => ({
          ref: r.ref, date: r.date, time: r.time, type: r.type, amountPaise: r.amountPaise, merchant: r.merchant, note: r.description, paymentMethod: r.paymentMethod,
          ...(r.type === 'transfer' ? { direction: r.direction, otherAccount: r.otherAccount } : { category: r.category.trim() }),
        })),
        layout: rememberLayout && layoutName.trim() ? { name: layoutName.trim(), header, mapping } : undefined,
      });
      toast.success(tn(batch.count, 'Imported {n} entry into {account}', 'Imported {n} entries into {account}', { account: batch.accountName }));
      setDone(batch);
      setFile(null);
      setResult(null);
    } catch (err) {
      toast.error(err.details?.[0] ? `${err.details[0].field}: ${err.details[0].message}` : err.message);
    }
  }

  const catList = (type) => {
    const c = categories.data;
    return c ? [...new Set([...c.defaults[type], ...c.custom[type]])] : [];
  };

  return (
    <>
      <PageHeader title={t('Import a statement')} subtitle={t('Bring in a month of bank or card entries at once. Check every line before anything is saved.')} />
      {['expense', 'income'].map((type) => (
        <datalist key={type} id={`imp-cat-${type}`}>{catList(type).map((c) => <option key={c} value={c} />)}</datalist>
      ))}
      <div className="space-y-4">
        {done && (
          <Card className="bg-emerald-50/60 dark:bg-emerald-500/10">
            <div className="flex flex-wrap items-center gap-3">
              <p className="min-w-0 flex-1 text-sm">{tn(done.count, 'Imported {n} entry into {account}', 'Imported {n} entries into {account}', { account: done.accountName })}.</p>
              <Link to={`/transactions?account=${done.account}&preset=all`} className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">{t('See them')}</Link>
              <Button variant="secondary" size="sm" loading={undo.isPending}
                onClick={async () => { try { await undo.mutateAsync(done.id); toast.success(t('Import undone')); setDone(null); } catch (err) { toast.error(err.message); } }}>
                {t('Undo import')}
              </Button>
            </div>
          </Card>
        )}

        <Card>
          <CardHeader title={t('1. Statement and account')} />
          {accounts.error ? <ErrorNote error={accounts.error} onRetry={accounts.refetch} /> : !accounts.data ? <Skeleton className="h-24 w-full" /> : (
            <div className="space-y-4">
              <Field label={t('Import into')} htmlFor="imp-account" hint={t('The account this statement belongs to.')}>
                <Select id="imp-account" value={account?.id ?? ''} className="max-w-sm"
                  onChange={(e) => { setAccountId(e.target.value); const next = usable.find((a) => a.id === e.target.value); if (file) openSheet(file.sheets, sheet, next); }}>
                  {usable.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </Select>
              </Field>
              {file ? (
                <div className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/60">
                  <FileSpreadsheet className="h-4 w-4 text-slate-500 dark:text-slate-400" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate font-medium">{file.name}</span>
                  <span className="text-slate-500 dark:text-slate-400">{tn(lines.length, '{n} line', '{n} lines')}</span>
                  <Button variant="ghost" size="sm" onClick={() => { setFile(null); setResult(null); }}>{t('Choose another file')}</Button>
                </div>
              ) : <FilePicker onFile={onFile} reading={reading} />}
              {readError && <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">{readError}</p>}
            </div>
          )}
        </Card>

        {file && mapping && (
          <Card>
            <CardHeader title={t('2. Columns')} subtitle={matched ? t('Using your saved “{name}” layout.', { name: matched }) : t('Check which column holds what. Spendwise guessed from the column names.')} />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {file.sheets.length > 1 && (
                <Field label={t('Sheet')} htmlFor="imp-sheet">
                  <Select id="imp-sheet" value={sheet} onChange={(e) => openSheet(file.sheets, Number(e.target.value))}>
                    {file.sheets.map((s, i) => <option key={s.name} value={i}>{s.name}</option>)}
                  </Select>
                </Field>
              )}
              <Field label={t('Header line')} htmlFor="imp-header" hint={t('The line with the column names.')}>
                <Select id="imp-header" value={headerIndex} onChange={(e) => { setHeaderIndex(Number(e.target.value)); setResult(null); setMatched(null); }}>
                  {rows.slice(0, 40).map((r, i) => <option key={i} value={i}>{t('Line {n}', { n: i + 1 })}: {r.filter(Boolean).slice(0, 4).join(' · ').slice(0, 70) || t('(empty)')}</option>)}
                </Select>
              </Field>
              <ColumnSelect id="imp-date" label={t('Date')} header={columns} value={mapping.date} onChange={(date) => changeMapping({ date })} />
              <ColumnSelect id="imp-desc" label={t('Description (narration)')} header={columns} value={mapping.description} onChange={(description) => changeMapping({ description })} />
              <Field label={t('Date format')} htmlFor="imp-datefmt" hint={result ? { DMY: t('Read as day/month/year.'), MDY: t('Read as month/day/year.'), YMD: t('Read as year-month-day.') }[result.dateFormat] : undefined}>
                <Select id="imp-datefmt" value={mapping.dateFormat} onChange={(e) => changeMapping({ dateFormat: e.target.value })}>
                  <option value="auto">{t('Work it out')}</option>
                  <option value="DMY">DD/MM/YYYY</option>
                  <option value="MDY">MM/DD/YYYY</option>
                  <option value="YMD">{t('YYYY-MM-DD')}</option>
                </Select>
              </Field>
              <ColumnSelect id="imp-time" label={t('Time (optional)')} header={columns} value={mapping.time} optional onChange={(time) => changeMapping({ time })} />
            </div>
            <div className="mt-5 space-y-4">
              <Segmented label={t('Amount columns')} value={split ? 'two' : 'one'} onChange={setAmountStyle}
                options={[{ value: 'two', label: t('Separate debit and credit') }, { value: 'one', label: t('One amount column') }]} />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {split ? (
                  <>
                    <ColumnSelect id="imp-debit" label={t('Debit (withdrawal) column')} header={columns} value={mapping.debit} onChange={(debit) => changeMapping({ debit })} />
                    <ColumnSelect id="imp-credit" label={t('Credit (deposit) column')} header={columns} value={mapping.credit} onChange={(credit) => changeMapping({ credit })} />
                  </>
                ) : (
                  <>
                    <ColumnSelect id="imp-amount" label={t('Amount column')} header={columns} value={mapping.amount} onChange={(amount) => changeMapping({ amount })} />
                    <ColumnSelect id="imp-drcr" label={t('Dr/Cr column (optional)')} header={columns} value={mapping.drcr} optional onChange={(drcr) => changeMapping({ drcr })} />
                    <Field label={t('Spending shows as')} htmlFor="imp-sign" hint={t('Used when a line has no Dr/Cr.')}>
                      <Select id="imp-sign" value={mapping.sign} onChange={(e) => changeMapping({ sign: e.target.value })}>
                        <option value="negative-is-spending">{t('Negative amounts (−450)')}</option>
                        <option value="positive-is-spending">{t('Positive amounts (card statements)')}</option>
                      </Select>
                    </Field>
                  </>
                )}
              </div>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Button onClick={runPreview} loading={preview.isPending} disabled={!account || !lines.length}>{tn(lines.length, 'Preview {n} line', 'Preview {n} lines')}</Button>
              {preview.error && <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">{preview.error.details?.map((d) => d.message).join(' ') || preview.error.message}</p>}
            </div>
          </Card>
        )}

        {result && (
          <Card>
            <CardHeader title={t('3. Check and import')} subtitle={t('Nothing is saved until you press Import. Lines marked as possible duplicates are left out unless you tick them.')} />
            <div className="mb-3 flex flex-wrap gap-2">
              <Segmented label={t('Show lines')} size="sm" value={filter} onChange={(f) => { setFilter(f); setShown(PAGE); }} options={[
                { value: 'ready', label: t('To import ({n})', { n: counts.ready }) },
                { value: 'other', label: t('Category “{name}” ({n})', { name: catLabel('Other'), n: counts.other }) },
                { value: 'duplicates', label: t('Possible duplicates ({n})', { n: counts.duplicates }) },
                { value: 'skipped', label: t('Skipped ({n})', { n: counts.skipped }) },
                { value: 'all', label: t('All ({n})', { n: counts.all }) },
              ]} />
            </div>
            {visible.length ? (
              <ul className="divide-y divide-slate-900/[0.05] dark:divide-white/[0.05]">
                {visible.slice(0, shown).map((r) => (
                  <ReviewRow key={r.ref ?? `line-${r.line}`} row={r} others={others}
                    onChange={(c) => edit(r, c)} onType={(type) => setType(r, type)} onRule={() => setRuleFor(r)} />
                ))}
              </ul>
            ) : <EmptyState icon={FileSpreadsheet} title={t('No lines here')} />}
            {visible.length > shown && (
              <div className="mt-3 text-center"><Button variant="secondary" size="sm" onClick={() => setShown((n) => n + PAGE)}>{t('Show {n} more', { n: Math.min(PAGE, visible.length - shown) })}</Button></div>
            )}
            <div className="mt-5 space-y-4 border-t border-slate-900/[0.06] pt-4 dark:border-white/[0.06]">
              <label className="flex flex-wrap items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={rememberLayout} onChange={(e) => setRememberLayout(e.target.checked)} />
                {t('Remember these columns as')}
                <Input value={layoutName} onChange={(e) => setLayoutName(e.target.value)} maxLength={40} aria-label={t('Layout name')} className="w-56" disabled={!rememberLayout} />
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={runImport} loading={commit.isPending} disabled={!chosen.length}>{tn(chosen.length, 'Import {n} entry', 'Import {n} entries')}</Button>
                <span className="tabular text-sm text-slate-500 dark:text-slate-400">
                  {t('{spent} spent · {received} received', { spent: formatINR(totals.expense ?? 0), received: formatINR(totals.income ?? 0) })}{totals.transfer ? ` · ${t('{amount} moved', { amount: formatINR(totals.transfer) })}` : ''}
                </span>
              </div>
            </div>
          </Card>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <PastImports />
          <RulesAndLayouts />
        </div>
      </div>
      <RuleDialog key={ruleFor?.ref} row={ruleFor} onClose={() => setRuleFor(null)} onSaved={applyRule} />
    </>
  );
}

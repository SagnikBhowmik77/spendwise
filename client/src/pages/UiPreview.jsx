// Design-system specimen (development only, at /ui): every shared primitive in every state, in both themes.
// The numbers here are specimen values for judging type and spacing; this page is not part of the built app.
import { useState } from 'react';
import toast from 'react-hot-toast';
import { ArrowDownLeft, ArrowUpRight, Inbox, Landmark, Plus, Search, Wallet } from 'lucide-react';
import { ThemeSwitch } from '../components/Brand.jsx';
import StatCard from '../components/StatCard.jsx';
import { ConfirmDialog, Modal } from '../components/Modal.jsx';
import {
  Amount, Badge, Button, Card, CardHeader, EmptyState, ErrorNote, Field, Input, Money, PageHeader, ProgressBar, Segmented, Select,
  SettingRow, Skeleton, Switch, Tabs, Textarea,
} from '../components/ui.jsx';

const SWATCHES = [
  ['Canvas', 'bg-slate-50 dark:bg-slate-950'], ['Surface', 'bg-white dark:bg-slate-900'], ['Raised', 'bg-slate-100 dark:bg-slate-800'],
  ['Line', 'bg-slate-200 dark:bg-slate-700'], ['Muted text', 'bg-slate-500 dark:bg-slate-400'], ['Ink', 'bg-slate-900 dark:bg-slate-100'],
  ['Accent', 'bg-indigo-600'], ['Money in', 'bg-emerald-600'], ['Money out', 'bg-rose-600'], ['Warning', 'bg-amber-500'],
];
const TYPE = [
  ['Display · 40', 'text-display font-semibold', '₹2,34,171'], ['Title · 28', 'text-title font-semibold', 'Good evening, Aarav'],
  ['Heading · 20', 'text-heading font-semibold', 'Where the money went'], ['Body · 16', 'text-body', 'Every rupee by category and month.'],
  ['Small · 14', 'text-sm', 'Groceries · HDFC Savings · UPI'], ['Caption · 12', 'text-caption text-slate-500 dark:text-slate-400', '21 Oct 2026 · 3 days left'],
];

const Section = ({ title, children }) => (
  <section className="space-y-4">
    <h2 className="text-caption font-semibold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">{title}</h2>
    {children}
  </section>
);

export default function UiPreview() {
  const [seg, setSeg] = useState('month');
  const [tab, setTab] = useState('overview');
  const [on, setOn] = useState(true);
  const [modal, setModal] = useState(false);
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="mx-auto max-w-6xl space-y-12 px-4 py-8 sm:px-8 sm:py-12">
      <PageHeader title="Spendwise design system" subtitle="Tokens and shared primitives in one place. Specimen values only; this page exists in development."
        actions={<ThemeSwitch />} />

      <Section title="Colour">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {SWATCHES.map(([name, cls]) => (
            <div key={name} className="overflow-hidden rounded-xl ring-1 ring-slate-900/[0.06] dark:ring-white/[0.06]">
              <div className={`h-14 ${cls}`} />
              <p className="bg-white px-3 py-2 text-caption font-medium dark:bg-slate-900">{name}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Type">
        <Card padding="lg" className="space-y-4">
          {TYPE.map(([name, cls, sample]) => (
            <div key={name} className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-6">
              <span className="w-32 shrink-0 text-caption text-slate-500 dark:text-slate-400">{name}</span>
              <span className={`tabular ${cls}`}>{sample}</span>
            </div>
          ))}
        </Card>
      </Section>

      <Section title="Buttons">
        <Card padding="lg" className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button><Plus className="h-4 w-4" aria-hidden="true" /> Add transaction</Button>
            <Button variant="secondary">Copy September</Button>
            <Button variant="ghost">Cancel</Button>
            <Button variant="danger">Delete</Button>
            <Button loading>Saving</Button>
            <Button disabled>Disabled</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm">Small</Button><Button size="sm" variant="secondary">Small</Button><Button size="lg">Large</Button>
            <Button size="icon" variant="ghost" aria-label="Search"><Search className="h-4 w-4" aria-hidden="true" /></Button>
          </div>
        </Card>
      </Section>

      <Section title="Fields">
        <Card padding="lg" className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Amount (₹)" htmlFor="p-a" hint="Up to ₹1 crore per entry."><Input id="p-a" inputMode="decimal" placeholder="450" /></Field>
          <Field label="Category" htmlFor="p-c" error="Category is required"><Input id="p-c" error="x" /></Field>
          <Field label="Account" htmlFor="p-s"><Select id="p-s"><option>HDFC Savings</option><option>Cash</option></Select></Field>
          <Field label="Date" htmlFor="p-d"><Input id="p-d" type="date" defaultValue="2026-10-25" /></Field>
          <Field label="Note" htmlFor="p-n" className="sm:col-span-2"><Textarea id="p-n" rows={2} placeholder="What was it for?" /></Field>
        </Card>
      </Section>

      <Section title="Switchers, badges, progress">
        <Card padding="lg" className="space-y-6">
          <Tabs label="Sections" value={tab} onChange={setTab} options={[{ value: 'overview', label: 'Overview' }, { value: 'patterns', label: 'Patterns' }, { value: 'merchants', label: 'Merchants' }, { value: 'compare', label: 'Compare' }]} />
          <Segmented label="Period" value={seg} onChange={setSeg} options={[{ value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }, { value: 'year', label: 'Year' }]} />
          <div className="flex flex-wrap gap-2">
            <Badge>Archived</Badge><Badge tone="green" dot>On track</Badge><Badge tone="amber" dot>Close to limit</Badge>
            <Badge tone="rose" dot>Over budget</Badge><Badge tone="indigo">Default</Badge>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {[['Shopping', 68, 'ok'], ['Fuel', 86, 'warning'], ['Eating out', 112, 'over']].map(([n, p, s]) => (
              <div key={n} className="space-y-2"><div className="flex justify-between text-sm"><span>{n}</span><span className="tabular text-slate-500 dark:text-slate-400">{p}%</span></div><ProgressBar percent={p} status={s} label={n} /></div>
            ))}
          </div>
          <SettingRow title="High contrast" control={<Switch checked={on} onChange={setOn} label="High contrast" />}>Darker grey text and stronger borders.</SettingRow>
        </Card>
      </Section>

      <Section title="Numbers and stat cards">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Income" paise={9200000} tone="income" icon={ArrowDownLeft} sub="Specimen value" />
          <StatCard label="Expenses" paise={4360900} tone="expense" icon={ArrowUpRight} sub="2.9% more than September" />
          <StatCard label="Balance" paise={-125000} tone="balance" icon={Wallet} sub="Negative shows in red" />
          <StatCard label="Net worth" paise={0} loading icon={Landmark} />
        </div>
        <Card padding="lg" className="flex flex-wrap items-baseline gap-6">
          <span className="text-display font-semibold"><Money paise={23417100} /></span>
          <Amount paise={9200000} type="income" /><Amount paise={64000} type="expense" /><Amount paise={800000} type="transfer" />
        </Card>
      </Section>

      <Section title="Cards, empty, loading, errors">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card><CardHeader title="Recent transactions" subtitle="October 2026" action={<Button size="sm" variant="ghost">View all</Button>} />
            <div className="space-y-3"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-4 w-1/2" /><Skeleton className="h-4 w-2/3" /></div></Card>
          <Card><EmptyState icon={Inbox} title="Nothing scheduled" compact>Recurring rent, salary or bills show up here before they’re due.</EmptyState></Card>
          <Card className="space-y-3"><CardHeader title="Couldn’t load" /><ErrorNote error={{ message: 'Can’t reach the Spendwise server.' }} onRetry={() => {}} /></Card>
        </div>
        <Card><EmptyState icon={Wallet} title="No budgets yet" action={<Button>Add budget</Button>}>Set a monthly limit for a category and Spendwise warns you at 80%.</EmptyState></Card>
      </Section>

      <Section title="Overlays">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setModal(true)}>Open dialog</Button>
          <Button variant="secondary" onClick={() => setConfirm(true)}>Open confirm</Button>
          <Button variant="secondary" onClick={() => toast.success('Expense added')}>Success toast</Button>
          <Button variant="secondary" onClick={() => toast.error('Couldn’t save the entry')}>Error toast</Button>
        </div>
      </Section>

      <Modal open={modal} onClose={() => setModal(false)} title="Add transaction">
        <div className="space-y-4">
          <Segmented label="Type" value="expense" onChange={() => {}} options={[{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }, { value: 'transfer', label: 'Transfer' }]} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Amount (₹)" htmlFor="m-a"><Input id="m-a" inputMode="decimal" /></Field>
            <Field label="Date" htmlFor="m-d"><Input id="m-d" type="date" defaultValue="2026-10-25" /></Field>
          </div>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setModal(false)}>Cancel</Button><Button>Add</Button></div>
        </div>
      </Modal>
      <ConfirmDialog open={confirm} title="Delete this entry?" confirmLabel="Delete" danger onClose={() => setConfirm(false)} onConfirm={() => setConfirm(false)}>
        It moves to the bin for 30 days, then goes for good.
      </ConfirmDialog>
    </div>
  );
}

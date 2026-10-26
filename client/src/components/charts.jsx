// Charts (Recharts). Every chart also lists its numbers in text, so nothing depends on colour alone.
// Colours come from the --chart-* tokens in index.css: one accent hue, neutrals, and money colours only where they mean money.
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { formatDayShort, formatINR, formatINRCompact, formatMonthShort } from '../lib/format.js';
import { catLabel } from '../lib/labels.js';
import { t } from '../lib/i18n.js';

export const INCOME_COLOR = 'var(--chart-accent)';
export const EXPENSE_COLOR = 'var(--chart-ink)';
const ACCENT = 'var(--chart-accent)';
const ACCENT_SOFT = 'var(--chart-accent-soft)';
const MUTED = 'var(--chart-muted)';
const PALETTE = [1, 2, 3, 4, 5, 6].map((i) => `var(--chart-cat-${i})`);
const OTHER_COLOR = 'var(--chart-other)';

const axis = { tick: { fill: 'var(--chart-tick)', fontSize: 11 }, tickLine: false, axisLine: false };
const grid = <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 4" />;
const yAxis = (width = 52) => <YAxis tickFormatter={formatINRCompact} width={width} tickCount={4} {...axis} />;
const BAR_RADIUS = [5, 5, 2, 2];

function TooltipBox({ active, payload, label, labelFormatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-36 rounded-lg bg-white px-3 py-2 text-caption shadow-lg ring-1 ring-slate-900/[0.08] dark:bg-slate-800 dark:ring-white/10">
      {label !== undefined && <p className="mb-1.5 font-semibold text-slate-900 dark:text-white">{labelFormatter ? labelFormatter(label) : label}</p>}
      {payload.map((p) => (
        <p key={p.dataKey ?? p.name} className="flex items-center gap-2 py-0.5">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.color || p.payload?.fill }} />
          <span className="text-slate-500 dark:text-slate-400">{p.name}</span>
          <span className="tabular ml-auto pl-3 font-semibold text-slate-900 dark:text-white">{formatINR(Math.round(p.value * 100))}</span>
        </p>
      ))}
    </div>
  );
}

// A small legend above the plot, instead of Recharts' own under it: [{ name, color, dashed? }].
export function ChartLegend({ items }) {
  return (
    <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-caption text-slate-500 dark:text-slate-400">
      {items.map((i) => (
        <li key={i.name} className="flex items-center gap-1.5">
          <span className={i.dashed ? 'h-0 w-3 border-t-2 border-dashed' : 'h-2 w-2 rounded-full'} style={i.dashed ? { borderColor: i.color } : { background: i.color }} aria-hidden="true" />
          {i.name}
        </li>
      ))}
    </ul>
  );
}

// A chart's box: a fixed height, or with fill the rest of its card (min `height`), so cards side by side line up.
function Frame({ height, fill, children }) {
  return <div className={fill ? 'min-h-0 flex-1' : undefined} style={fill ? { minHeight: height } : { height }}><ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer></div>;
}

// Leading months with nothing recorded are left off, so a new account doesn't show a half-empty chart.
const trimLeading = (rows, empty) => { const i = rows.findIndex((r) => !empty(r)); return i <= 0 ? rows : rows.slice(i); };

// Donut of expenses by category: the biggest six, then "Other" for the rest.
export function CategoryPie({ categories, total }) {
  const top = categories.slice(0, 6);
  const rest = categories.slice(6);
  const slices = [
    ...top.map((c, i) => ({ name: catLabel(c.category), value: c.total.rupees, paise: c.total.paise, share: c.share, color: PALETTE[i] })),
    ...(rest.length
      ? [{
        name: t('Other ({n})', { n: rest.length }),
        value: rest.reduce((s, c) => s + c.total.rupees, 0),
        paise: rest.reduce((s, c) => s + c.total.paise, 0),
        share: Math.round(rest.reduce((s, c) => s + c.share, 0) * 10) / 10,
        color: OTHER_COLOR,
      }]
      : []),
  ];
  return (
    // Side by side only when the card itself is wide enough (a container query, not the screen width).
    <div className="@container">
      <div className="grid items-center gap-5 @md:grid-cols-[180px_minmax(0,1fr)]">
        <div className="relative mx-auto h-[180px] w-[180px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={slices} dataKey="value" nameKey="name" innerRadius={64} outerRadius={86} paddingAngle={slices.length > 1 ? 1.5 : 0} cornerRadius={3} stroke="none" isAnimationActive={false}>
                {slices.map((s) => <Cell key={s.name} fill={s.color} />)}
              </Pie>
              <Tooltip content={<TooltipBox />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
            <div>
              <p className="text-caption text-slate-500 dark:text-slate-400">{t('Spent')}</p>
              <p className="tabular text-[0.9375rem] font-semibold tracking-[-0.01em] text-slate-900 dark:text-white">{formatINR(total)}</p>
            </div>
          </div>
        </div>
        <ul className="min-w-0 space-y-2.5 text-sm">
          {slices.map((s) => (
            <li key={s.name} className="flex items-center gap-2.5">
              <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: s.color }} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-300">{s.name}</span>
              <span className="tabular w-12 text-right text-caption text-slate-500 dark:text-slate-400">{s.share}%</span>
              <span className="tabular w-24 text-right font-medium text-slate-900 dark:text-white">{formatINR(s.paise)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// Income vs expenses per month: income in the accent, spending in ink.
export function MonthlyBars({ months, height = 240, fill = false }) {
  const data = trimLeading(months, (m) => !m.income.paise && !m.expense.paise)
    .map((m) => ({ month: m.month, Income: m.income.rupees, Expenses: m.expense.rupees }));
  return (
    <>
      <ChartLegend items={[{ name: t('Income'), color: INCOME_COLOR }, { name: t('Expenses'), color: EXPENSE_COLOR }]} />
      <Frame height={height} fill={fill}>
        <BarChart data={data} margin={{ top: 4, right: 0, left: -4, bottom: 0 }} barGap={4} barCategoryGap="28%">
          {grid}
          <XAxis dataKey="month" tickFormatter={formatMonthShort} {...axis} />
          {yAxis()}
          <Tooltip content={<TooltipBox labelFormatter={formatMonthShort} />} cursor={{ fill: 'var(--chart-cursor)', radius: 6 }} />
          <Bar dataKey="Income" name={t('Income')} fill={INCOME_COLOR} radius={BAR_RADIUS} maxBarSize={22} isAnimationActive={false} />
          <Bar dataKey="Expenses" name={t('Expenses')} fill={EXPENSE_COLOR} radius={BAR_RADIUS} maxBarSize={22} isAnimationActive={false} />
        </BarChart>
      </Frame>
    </>
  );
}

// Daily spending as a thin line over a soft fill.
export function DailyArea({ days, height = 180 }) {
  const data = days.map((d) => ({ date: d.date, Expenses: d.expense.rupees }));
  return (
    <Frame height={height}>
      <AreaChart data={data} margin={{ top: 6, right: 0, left: -4, bottom: 0 }}>
        <defs>
          <linearGradient id="spend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ACCENT} stopOpacity={0.16} />
            <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
          </linearGradient>
        </defs>
        {grid}
        <XAxis dataKey="date" tickFormatter={formatDayShort} minTickGap={28} {...axis} />
        {yAxis()}
        <Tooltip content={<TooltipBox labelFormatter={formatDayShort} />} cursor={{ stroke: 'var(--chart-grid)', strokeWidth: 1 }} />
        <Area type="monotoneX" dataKey="Expenses" name={t('Expenses')} stroke={ACCENT} strokeWidth={1.75} fill="url(#spend-fill)" activeDot={{ r: 3.5, strokeWidth: 0 }} isAnimationActive={false} />
      </AreaChart>
    </Frame>
  );
}

// Budget vs what it covers, per month: the overall limit against all spending, or (with only category
// budgets) the category limits added up against spending in those same categories.
export function BudgetHistoryBars({ months, height = 220, fill = false }) {
  const data = trimLeading(months.map((m) => ({
    month: m.month,
    Budget: m.overall ? m.overall.limit.rupees : m.totals.budgeted.rupees,
    Spent: m.overall ? m.totals.spentTotal.rupees : m.totals.spentInBudgeted.rupees,
  })), (r) => !r.Budget && !r.Spent);
  return (
    <>
      <ChartLegend items={[{ name: t('Budget'), color: MUTED }, { name: t('Spent'), color: ACCENT }]} />
      <Frame height={height} fill={fill}>
        <BarChart data={data} margin={{ top: 4, right: 0, left: -4, bottom: 0 }} barGap={4} barCategoryGap="28%">
          {grid}
          <XAxis dataKey="month" tickFormatter={formatMonthShort} {...axis} />
          {yAxis()}
          <Tooltip content={<TooltipBox labelFormatter={formatMonthShort} />} cursor={{ fill: 'var(--chart-cursor)', radius: 6 }} />
          <Bar dataKey="Budget" name={t('Budget')} fill={MUTED} radius={BAR_RADIUS} maxBarSize={22} isAnimationActive={false} />
          <Bar dataKey="Spent" name={t('Spent')} fill={ACCENT} radius={BAR_RADIUS} maxBarSize={22} isAnimationActive={false} />
        </BarChart>
      </Frame>
    </>
  );
}

// One series of bars: rows of { label, value (rupees) }.
export function ValueBars({ rows, height = 220, color = ACCENT, name = t('Spent'), formatLabel = (x) => x }) {
  return (
    <Frame height={height}>
      <BarChart data={rows} margin={{ top: 4, right: 0, left: -4, bottom: 0 }} barCategoryGap="24%">
        {grid}
        <XAxis dataKey="label" tickFormatter={formatLabel} {...axis} interval="preserveStartEnd" />
        {yAxis()}
        <Tooltip content={<TooltipBox labelFormatter={formatLabel} />} cursor={{ fill: 'var(--chart-cursor)', radius: 6 }} />
        <Bar dataKey="value" name={name} fill={color} radius={BAR_RADIUS} maxBarSize={28} isAnimationActive={false} />
      </BarChart>
    </Frame>
  );
}

// Two lines over months, e.g. spending as recorded vs in today's prices: rows of { month, a, b } in rupees.
export function TwoLines({ rows, aName, bName, height = 220 }) {
  return (
    <>
      <ChartLegend items={[{ name: aName, color: MUTED }, { name: bName, color: ACCENT }]} />
      <Frame height={height}>
        <LineChart data={rows} margin={{ top: 4, right: 4, left: -4, bottom: 0 }}>
          {grid}
          <XAxis dataKey="month" tickFormatter={formatMonthShort} {...axis} />
          {yAxis()}
          <Tooltip content={<TooltipBox labelFormatter={formatMonthShort} />} cursor={{ stroke: 'var(--chart-grid)' }} />
          <Line dataKey="a" name={aName} stroke={MUTED} strokeWidth={1.75} dot={false} isAnimationActive={false} />
          <Line dataKey="b" name={bName} stroke={ACCENT} strokeWidth={1.75} dot={false} isAnimationActive={false} />
        </LineChart>
      </Frame>
    </>
  );
}

// A running balance by day (rows of { date, balance } in rupees), with zero marked.
export function BalanceLine({ rows, height = 220 }) {
  return (
    <Frame height={height}>
      <AreaChart data={rows} margin={{ top: 6, right: 4, left: -4, bottom: 0 }}>
        <defs>
          <linearGradient id="balance-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ACCENT} stopOpacity={0.14} />
            <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
          </linearGradient>
        </defs>
        {grid}
        <XAxis dataKey="date" tickFormatter={formatDayShort} {...axis} minTickGap={28} />
        {yAxis(58)}
        <Tooltip content={<TooltipBox labelFormatter={formatDayShort} />} cursor={{ stroke: 'var(--chart-grid)' }} />
        <ReferenceLine y={0} stroke="var(--chart-out)" strokeDasharray="4 4" />
        <Area dataKey="balance" name={t('Balance')} type="stepAfter" stroke={ACCENT} fill="url(#balance-fill)" strokeWidth={1.75} isAnimationActive={false} />
      </AreaChart>
    </Frame>
  );
}

// Net worth by month end (rows of { month, accounts, investments, netWorth } in rupees): the two parts as
// lines, the total as a filled area.
export function NetWorthChart({ rows, height = 240 }) {
  return (
    <>
      <ChartLegend items={[{ name: t('Net worth'), color: ACCENT }, { name: t('Accounts'), color: MUTED, dashed: true }, { name: t('Investments'), color: ACCENT_SOFT }]} />
      <Frame height={height}>
        <AreaChart data={rows} margin={{ top: 6, right: 4, left: -4, bottom: 0 }}>
          <defs>
            <linearGradient id="worth-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={ACCENT} stopOpacity={0.14} />
              <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
            </linearGradient>
          </defs>
          {grid}
          <XAxis dataKey="month" tickFormatter={formatMonthShort} {...axis} />
          {yAxis(58)}
          <Tooltip content={<TooltipBox labelFormatter={formatMonthShort} />} cursor={{ stroke: 'var(--chart-grid)' }} />
          <ReferenceLine y={0} stroke="var(--chart-grid)" />
          <Area dataKey="netWorth" name={t('Net worth')} stroke={ACCENT} fill="url(#worth-fill)" strokeWidth={1.75} isAnimationActive={false} />
          <Area dataKey="accounts" name={t('Accounts')} stroke={MUTED} fill="none" strokeWidth={1.5} strokeDasharray="4 3" isAnimationActive={false} />
          <Area dataKey="investments" name={t('Investments')} stroke={ACCENT_SOFT} fill="none" strokeWidth={1.5} isAnimationActive={false} />
        </AreaChart>
      </Frame>
    </>
  );
}

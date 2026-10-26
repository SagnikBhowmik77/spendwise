import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatMonth } from '../lib/format.js';
import { shiftMonth } from '../lib/dates.js';
import { Button } from './ui.jsx';
import { t } from '../lib/i18n.js';

// ‹ October 2026 › ; `max` stops it going past a month (e.g. the current one).
export default function MonthPicker({ value, onChange, max }) {
  const atMax = max && value >= max;
  return (
    <div className="inline-flex h-10 items-center gap-0.5 rounded-lg bg-white px-1 shadow-xs ring-1 ring-slate-900/10 dark:bg-slate-900 dark:shadow-none dark:ring-white/10">
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onChange(shiftMonth(value, -1))} aria-label={t('Previous month')}>
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </Button>
      <span className="tabular min-w-[7.5rem] text-center text-sm font-medium" aria-live="polite">{formatMonth(value)}</span>
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onChange(shiftMonth(value, 1))} disabled={atMax} aria-label={t('Next month')}>
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );
}

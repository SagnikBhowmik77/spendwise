import { useState } from 'react';
import toast from 'react-hot-toast';
import { History } from 'lucide-react';
import { useActivity, useRevertActivity } from '../hooks/api.js';
import { formatINR } from '../lib/format.js';
import { localeTag, t } from '../lib/i18n.js';
import { catLabel } from '../lib/labels.js';
import { Badge, Button, Card, EmptyState, ErrorNote, PageHeader, Skeleton } from '../components/ui.jsx';

const ACTION = {
  create: [t('Added'), 'green'], update: [t('Edited'), 'indigo'], delete: [t('Deleted'), 'rose'], restore: [t('Restored'), 'green'],
  revert: [t('Restored version'), 'green'], join: [t('Joined'), 'green'], leave: [t('Left'), 'slate'], remove: [t('Removed'), 'rose'],
};
const when = new Intl.DateTimeFormat(localeTag(), { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export default function Activity() {
  const [limit, setLimit] = useState(30);
  const { data, error, refetch, isFetching } = useActivity({ limit });
  const revert = useRevertActivity();

  async function restore(item) {
    try {
      await revert.mutateAsync(item.id);
      toast.success(item.action === 'delete' ? t('Entry restored') : t('Earlier version restored'));
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <>
      <PageHeader title={t('Activity')} subtitle={t('Every change in this space: who made it and when. Undo a deletion or go back to an earlier version of an entry.')} />
      <Card className="mx-auto max-w-3xl">
        {error && <ErrorNote error={error} onRetry={refetch} />}
        {!data ? <Skeleton className="h-48 w-full" /> : data.items.length ? (
          <>
            <ul className="-my-3 divide-y divide-slate-900/[0.05] dark:divide-white/[0.05]">
              {data.items.map((item) => {
                const [label, tone] = ACTION[item.action];
                const before = item.action === 'update' && item.before;
                return (
                  <li key={item.id} className="flex flex-wrap items-start gap-x-3 gap-y-2 py-3">
                    <Badge tone={tone}>{label}</Badge>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">{item.summary}</p>
                      {before && (
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {t('Before:')} {formatINR(before.amountPaise)}{before.type !== 'transfer' ? ` · ${catLabel(before.category)}` : ''} · {String(before.date).slice(0, 10)}
                        </p>
                      )}
                      <p className="text-xs text-slate-500 dark:text-slate-400">{item.user.name} · {when.format(new Date(item.at))}</p>
                    </div>
                    {item.canRestore && (
                      <Button variant="secondary" size="sm" loading={revert.isPending && revert.variables === item.id} onClick={() => restore(item)}>
                        {item.action === 'delete' ? t('Undo delete') : t('Restore this version')}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
            {data.total > data.items.length && (
              <Button variant="secondary" className="mt-4 w-full" loading={isFetching} onClick={() => setLimit((l) => Math.min(100, l + 30))} disabled={limit >= 100}>
                {limit >= 100 ? t('Showing the latest 100 changes') : t('Show more')}
              </Button>
            )}
          </>
        ) : (
          <EmptyState icon={History} title={t('Nothing yet')}>{t('Changes to entries, accounts and the space show up here.')}</EmptyState>
        )}
      </Card>
    </>
  );
}

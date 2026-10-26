// Batch 12R: big expenses in a shared space, waiting for the owner. Until approved they count nowhere.
import toast from 'react-hot-toast';
import { CheckCheck } from 'lucide-react';
import { useApprovals, usePlanMutation } from '../hooks/api.js';
import { useSpace } from '../context/SpaceContext.jsx';
import { formatDay, formatINR } from '../lib/format.js';
import { catLabel } from '../lib/labels.js';
import { t } from '../lib/i18n.js';
import { Button, Card, EmptyState, ErrorNote, PageHeader, Skeleton } from '../components/ui.jsx';

export default function Approvals() {
  const { space, shared } = useSpace();
  const q = useApprovals(shared);
  const decide = usePlanMutation('transactions', { money: true });
  const owner = space?.role === 'owner';
  async function act(x, decision) {
    try {
      await decide.mutateAsync({ path: `/approvals/${x.id}`, body: { decision } });
      toast.success(decision === 'approve' ? t('Approved: it counts now') : t('Turned down and removed'));
    } catch (err) { toast.error(err.message); }
  }
  const limit = space?.approvalAbove;
  return (
    <>
      <PageHeader title={t('Approvals')} subtitle={limit
        ? t('Expenses over {amount} added by anyone but the owner wait here.', { amount: formatINR(limit.paise) })
        : t('Approval is off. The owner can turn it on in Household.')} />
      {!shared ? <Card><p className="text-sm">{t('Approvals are for shared spaces.')}</p></Card>
        : !q.data ? (q.error ? <ErrorNote error={q.error} onRetry={q.refetch} /> : <Skeleton className="h-32 w-full" />)
          : q.data.pending.length === 0 ? (
            <Card><EmptyState icon={CheckCheck} title={t('Nothing waiting')}>{t('When someone adds a big expense, it shows up here for the owner to approve.')}</EmptyState></Card>
          ) : (
            <Card>
              <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                {q.data.pending.map((x) => (
                  <li key={x.id} className="flex flex-wrap items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{catLabel(x.category)}{x.note ? ` · ${x.note}` : ''}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{t('{name} on {date}', { name: x.requestedBy, date: formatDay(x.date) })}</p>
                    </div>
                    <span className="tabular text-base font-semibold">{formatINR(x.amountPaise)}</span>
                    {owner ? (
                      <div className="flex gap-1.5">
                        <Button size="sm" onClick={() => act(x, 'approve')} loading={decide.isPending}>{t('Approve')}</Button>
                        <Button size="sm" variant="secondary" className="hover:text-rose-600" onClick={() => act(x, 'reject')}>{t('Turn down')}</Button>
                      </div>
                    ) : <span className="text-xs text-slate-500 dark:text-slate-400">{t('Waiting for the owner')}</span>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
    </>
  );
}

// Batch 12Q: what another app shared to Spendwise (Android share sheet, once the app is installed): a payment
// message is read like quick add, a receipt photo is read by OCR. Either way, the add form opens for checking.
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Share2 } from 'lucide-react';
import { useQuickAddParser } from '../components/QuickAdd.jsx';
import { ScanPreview, readReceipt } from '../components/ReceiptScan.jsx';
import TransactionForm from '../components/TransactionForm.jsx';
import { Button, Card, EmptyState, PageHeader, Skeleton } from '../components/ui.jsx';
import { t } from '../lib/i18n.js';

async function takeShared() {
  if (!('caches' in window)) return { text: '', file: null };
  const cache = await caches.open('spendwise-shared');
  const [textRes, fileRes] = await Promise.all([cache.match('/shared/text'), cache.match('/shared/file')]);
  const text = textRes ? await textRes.text() : '';
  const file = fileRes ? new File([await fileRes.blob()], 'shared-receipt', { type: fileRes.headers.get('content-type') || 'image/jpeg' }) : null;
  await Promise.all([cache.delete('/shared/text'), cache.delete('/shared/file')]);
  return { text, file };
}

export default function Share() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const parse = useQuickAddParser();
  const [shared, setShared] = useState(null); // { text, file }
  const [scan, setScan] = useState(null); // { progress } | { result } | { error }
  const [defaults, setDefaults] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (params.get('received') ? takeShared() : Promise.resolve({ text: params.get('text') ?? '', file: null }))
      .then((s) => { if (!cancelled) setShared(s); })
      .catch(() => { if (!cancelled) setShared({ text: '', file: null }); });
    return () => { cancelled = true; };
  }, [params]);

  useEffect(() => {
    if (!shared?.file) return;
    let cancelled = false;
    setScan({ progress: 0 });
    readReceipt(shared.file, (progress) => { if (!cancelled) setScan({ progress }); })
      .then((result) => { if (!cancelled) setScan({ result }); })
      .catch(() => { if (!cancelled) setScan({ error: true }); });
    return () => { cancelled = true; };
  }, [shared]);

  const fromText = shared?.text.trim() ? parse(shared.text) : null;
  const done = () => { setDefaults(null); navigate('/transactions', { replace: true }); };

  return (
    <>
      <PageHeader title={t('Shared to Spendwise')} subtitle={t('Check what was read, then save it as an entry.')} />
      {!shared ? <Skeleton className="h-32 w-full" /> : !shared.text.trim() && !shared.file ? (
        <Card><EmptyState icon={Share2} title={t('Nothing was shared')}>{t('Install Spendwise on your phone, then share a payment message or a receipt photo to it from any app.')}</EmptyState></Card>
      ) : (
        <div className="space-y-4">
          {shared.file && (
            <Card>
              <div className="flex flex-col gap-4 sm:flex-row">
                <img src={URL.createObjectURL(shared.file)} alt={t('Shared receipt')} className="max-h-64 w-auto self-start rounded-lg object-contain ring-1 ring-slate-900/[0.06] dark:ring-white/[0.06]" />
                <div className="min-w-0 flex-1">
                  {scan?.progress !== undefined && <p className="text-sm">{t('Reading the receipt… {pct}%', { pct: scan.progress })}</p>}
                  {scan?.error && <p className="text-sm text-rose-600 dark:text-rose-400">{t('Couldn’t read the photo. You can still add it by hand with the photo attached.')}</p>}
                  {scan?.result && (
                    <ScanPreview result={scan.result} onDiscard={() => setDefaults({ type: 'expense', receiptFile: shared.file })}
                      onUse={() => setDefaults({ type: 'expense', receiptFile: shared.file, ...Object.fromEntries(Object.entries({ amount: scan.result.amount, date: scan.result.date, merchant: scan.result.merchant, note: scan.result.merchant }).filter(([, v]) => v)) })} />
                  )}
                  {scan?.error && <Button className="mt-2" onClick={() => setDefaults({ type: 'expense', receiptFile: shared.file })}>{t('Add by hand')}</Button>}
                </div>
              </div>
            </Card>
          )}
          {fromText && (
            <Card>
              <p className="whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-400">{shared.text.trim()}</p>
              <Button className="mt-3" onClick={() => setDefaults({ ...fromText, ...(shared.file && { receiptFile: shared.file }) })}>{t('Fill in the add form')}</Button>
            </Card>
          )}
        </div>
      )}
      <TransactionForm open={defaults !== null} defaults={defaults ?? undefined} onClose={done} />
    </>
  );
}

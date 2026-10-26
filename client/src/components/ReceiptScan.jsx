// Batch 12Q: read a receipt photo in the browser (Tesseract OCR) and suggest the amount, date and shop. The photo
// never leaves the phone for this; the OCR engine and its English model download once (from jsDelivr) and are cached.
import { useRef, useState } from 'react';
import { ScanLine } from 'lucide-react';
import { parseReceipt } from '../lib/receiptText.js';
import { today } from '../lib/dates.js';
import { formatDay, formatINR } from '../lib/format.js';
import { t } from '../lib/i18n.js';
import { Button } from './ui.jsx';

export async function readReceipt(file, onProgress) {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng', 1, {
    logger: (m) => { if (m.status === 'recognizing text') onProgress?.(Math.round(m.progress * 100)); },
  });
  try {
    const { data } = await worker.recognize(file);
    return { text: data.text, ...parseReceipt(data.text, { today: today() }) };
  } finally {
    await worker.terminate();
  }
}

// What was found, to check before it goes into the form.
export function ScanPreview({ result, onUse, onDiscard }) {
  const found = result.amount || result.date || result.merchant;
  return (
    <div className="space-y-2 rounded-lg bg-indigo-50 p-3 text-sm dark:bg-indigo-500/10">
      {found ? (
        <dl className="grid grid-cols-3 gap-2">
          <div><dt className="text-xs text-slate-500 dark:text-slate-400">{t('Amount')}</dt><dd className="tabular font-semibold">{result.amount ? formatINR(Math.round(Number(result.amount) * 100)) : '—'}</dd></div>
          <div><dt className="text-xs text-slate-500 dark:text-slate-400">{t('Date')}</dt><dd>{result.date ? formatDay(result.date) : '—'}</dd></div>
          <div className="min-w-0"><dt className="text-xs text-slate-500 dark:text-slate-400">{t('Shop')}</dt><dd className="truncate">{result.merchant ?? '—'}</dd></div>
        </dl>
      ) : <p>{t('Couldn’t read an amount from this photo. Try a sharper, straight-on photo, or type it in.')}</p>}
      <details><summary className="cursor-pointer text-xs text-slate-500 dark:text-slate-400">{t('Text found on the receipt')}</summary><pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-xs">{result.text.trim() || '—'}</pre></details>
      <div className="flex gap-2">
        {found && <Button size="sm" onClick={onUse}>{t('Use these')}</Button>}
        <Button size="sm" variant="secondary" onClick={onDiscard}>{t('Discard')}</Button>
      </div>
    </div>
  );
}

// A button that takes a photo (or picks one), reads it and shows the preview. onUse gets { amount, date, merchant, file }.
export function ReceiptScanButton({ onUse }) {
  const input = useRef(null);
  const [state, setState] = useState(null); // null | { progress } | { result, file } | { error }
  async function pick(file) {
    if (!file) return;
    setState({ progress: 0 });
    try {
      const result = await readReceipt(file, (progress) => setState({ progress }));
      setState({ result, file });
    } catch {
      setState({ error: t('Couldn’t read the photo. The scanner needs to download once; check your connection and try again.') });
    }
  }
  return (
    <div className="space-y-2">
      <input ref={input} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden="true"
        onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
      <Button size="sm" variant="secondary" onClick={() => input.current?.click()} loading={state?.progress !== undefined}>
        <ScanLine className="h-4 w-4" aria-hidden="true" /> {state?.progress !== undefined ? t('Reading… {pct}%', { pct: state.progress }) : t('Scan a receipt')}
      </Button>
      {state?.error && <p className="text-sm text-rose-600 dark:text-rose-400">{state.error}</p>}
      {state?.result && <ScanPreview result={state.result} onDiscard={() => setState(null)} onUse={() => { onUse({ ...state.result, file: state.file }); setState(null); }} />}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { fetchBlob, uploadBlob } from '../lib/api.js';
import { Modal } from './Modal.jsx';
import { ErrorNote, Skeleton } from './ui.jsx';
import { t } from '../lib/i18n.js';

// Phone photos are several MB; receipts stay readable at 1600 px and JPEG quality 0.8 (about 150–300 KB).
export async function compressImage(file, maxSide = 1600) {
  if (!file.type.startsWith('image/')) throw new Error(t('Pick a photo or image file'));
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
  if (!blob) throw new Error(t('Couldn’t read that image'));
  if (blob.size > 2 * 1024 * 1024) throw new Error(t('That photo is still too big after compressing (2 MB at most)'));
  return blob;
}

export const uploadReceipt = (txId, blob) => uploadBlob(`/transactions/${txId}/receipt`, blob);

export function ReceiptViewer({ txId, onClose }) {
  const [url, setUrl] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!txId) return undefined;
    let objectUrl;
    let cancelled = false;
    fetchBlob(`/transactions/${txId}/receipt`)
      .then((blob) => { if (!cancelled) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); } })
      .catch((err) => { if (!cancelled) setError(err); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); setUrl(null); setError(null); };
  }, [txId]);
  return (
    <Modal open={Boolean(txId)} onClose={onClose} title={t('Receipt')} size="lg">
      {error ? <ErrorNote error={error} /> : url ? (
        <img src={url} alt={t('Receipt photo')} className="mx-auto max-h-[70vh] rounded-lg" />
      ) : <Skeleton className="h-64 w-full" />}
    </Modal>
  );
}

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { Button } from './ui.jsx';
import { t } from '../lib/i18n.js';

// Built on <dialog>: the browser handles focus trapping, Escape and the backdrop.
// bare: no title bar (the title is still read out) and no padding, for the command palette.
// placement 'top': opens high on larger screens, where a palette belongs; phones keep the bottom sheet.
export function Modal({ open, onClose, title, children, footer, size = 'md', bare = false, placement = 'center' }) {
  const ref = useRef(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // A field's own autoFocus runs before the dialog is shown, so the browser would land on the close button:
      // move focus to the form's first field instead (dialogs without fields keep the browser's choice).
      const field = dialog.querySelector('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([disabled]), textarea:not([disabled])');
      if (field && document.activeElement?.getAttribute('aria-label') === t('Close')) field.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      // A click on the backdrop (the dialog element itself, outside its content) closes it.
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      // Phones: a sheet from the bottom edge. Larger screens: centred, with a layered shadow.
      className={`sw-dialog mx-auto mb-0 mt-auto w-full max-w-none rounded-t-2xl bg-white p-0 text-slate-900 shadow-lg ring-1 ring-slate-900/[0.06] backdrop:bg-slate-950/40 backdrop:backdrop-blur-[3px] sm:w-[calc(100%-2rem)] sm:rounded-2xl ${placement === 'top' ? 'sm:mb-auto sm:mt-[12vh]' : 'sm:m-auto'} ${size === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-lg'} dark:bg-slate-900 dark:text-slate-100 dark:ring-white/10`}
    >
      {open && (
        <div className="flex max-h-[90vh] flex-col pb-[env(safe-area-inset-bottom)] sm:max-h-[85vh] sm:pb-0">
          {bare ? <h2 className="sr-only">{title}</h2> : (
            <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-4 sm:px-6 sm:pt-5">
              <h2 className="text-heading font-semibold">{title}</h2>
              <Button variant="ghost" size="icon" onClick={onClose} aria-label={t('Close')}>
                <X className="h-5 w-5" aria-hidden="true" />
              </Button>
            </div>
          )}
          <div className={bare ? 'flex min-h-0 flex-col' : 'overflow-y-auto px-5 pb-5 pt-2 sm:px-6 sm:pb-6'}>{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-slate-900/[0.06] bg-slate-50/60 px-5 py-3 sm:rounded-b-2xl sm:px-6 dark:border-white/[0.06] dark:bg-slate-950/30">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

export function ConfirmDialog({ open, title, children, confirmLabel = t('Confirm'), danger = false, loading, onConfirm, onClose }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>{t('Cancel')}</Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>{confirmLabel}</Button>
        </>
      )}
    >
      <div className="text-sm text-slate-600 dark:text-slate-300">{children}</div>
    </Modal>
  );
}

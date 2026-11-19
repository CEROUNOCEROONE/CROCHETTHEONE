import React, { useEffect, useId, useRef } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmModalProps {
  readonly isOpen: boolean;
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly cancelLabel?: string;
  readonly variant?: 'default' | 'danger';
  readonly isBusy?: boolean;
  readonly children?: React.ReactNode;
  onConfirm(): void;
  onCancel(): void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancelar',
  variant = 'default',
  isBusy = false,
  children,
  onConfirm,
  onCancel,
}) => {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      if (!dialog.open) {
        try {
          if (typeof dialog.showModal === 'function') {
            dialog.showModal();
          } else {
            dialog.setAttribute('open', '');
          }
        } catch {
          try {
            dialog.show?.();
          } catch {
            // ignore if already open
          }
        }
      }
    } else if (dialog.open) {
      try {
        dialog.close();
      } catch {
        dialog.removeAttribute('open');
      }
    }
  }, [isOpen]);

  const handleNativeCancel = (e: React.SyntheticEvent<HTMLDialogElement>) => {
    e.preventDefault();
    if (!isBusy) {
      onCancel();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={handleNativeCancel}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-xl backdrop:bg-slate-900/50"
    >
      {isOpen && (
        <>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              {variant === 'danger' && (
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-rose-700">
                  <AlertTriangle className="h-5 w-5" aria-hidden="true" />
                </div>
              )}
              <div>
                <h2
                  id={titleId}
                  className="font-display text-lg font-semibold text-slate-900"
                >
                  {title}
                </h2>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                  {description}
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled={isBusy}
              onClick={onCancel}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50"
              aria-label="Cerrar diálogo"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          {children && <div className="mt-4">{children}</div>}

          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              autoFocus={variant === 'danger'}
              disabled={isBusy}
              onClick={onCancel}
              className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={onConfirm}
              className={`inline-flex min-h-[44px] items-center justify-center rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50 ${
                variant === 'danger'
                  ? 'bg-rose-700 hover:bg-rose-800'
                  : 'bg-teal-700 hover:bg-teal-800'
              }`}
            >
              {isBusy ? 'Procesando...' : confirmLabel}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
};

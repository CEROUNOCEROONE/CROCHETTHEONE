import React, { useEffect, useId, useRef } from 'react';
import { Sparkles, X } from 'lucide-react';

export interface FeatureGateProps {
  readonly featureTitle: string;
  readonly description: string;
  readonly freeIncludedNote?: string;
  readonly mode?: 'inline-banner' | 'card' | 'modal';
  readonly isOpen?: boolean;
  readonly onClose?: () => void;
}

export const FeatureGate: React.FC<FeatureGateProps> = ({
  featureTitle,
  description,
  freeIncludedNote,
  mode = 'inline-banner',
  isOpen = true,
  onClose,
}) => {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (mode !== 'modal') return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else if (dialog.open) {
      dialog.close();
    }
  }, [mode, isOpen]);

  // Fallback de light-dismiss para navegadores sin HTMLDialogElement.closedBy (ej. Safari)
  useEffect(() => {
    if (mode !== 'modal' || !isOpen) return;
    const dialog = dialogRef.current;
    if (!dialog || 'closedBy' in HTMLDialogElement.prototype) return;

    const isOutside = (e: PointerEvent) => {
      const r = dialog.getBoundingClientRect();
      return (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      );
    };

    let pressedOutside = false;
    const handlePointerDown = (e: PointerEvent) => {
      pressedOutside = isOutside(e);
    };
    const handlePointerUp = (e: PointerEvent) => {
      if (pressedOutside && isOutside(e)) {
        onClose?.();
      }
      pressedOutside = false;
    };

    dialog.addEventListener('pointerdown', handlePointerDown);
    dialog.addEventListener('pointerup', handlePointerUp);
    return () => {
      dialog.removeEventListener('pointerdown', handlePointerDown);
      dialog.removeEventListener('pointerup', handlePointerUp);
    };
  }, [mode, isOpen, onClose]);

  const TitleTag = mode === 'modal' ? 'h2' : 'h4';

  const content = (
    <div className="space-y-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-800">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
                Capacidad PRO
              </span>
              <TitleTag
                id={mode === 'modal' ? titleId : undefined}
                className="text-xs font-bold text-slate-900 sm:text-sm"
              >
                {featureTitle}
              </TitleTag>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-700">
              {description}
            </p>
            {freeIncludedNote && (
              <p className="mt-1.5 rounded-lg border border-amber-200/70 bg-white/80 px-2.5 py-1.5 text-[11px] leading-relaxed text-slate-600">
                <strong className="font-semibold text-slate-800">En tu plan FREE:</strong>{' '}
                {freeIncludedNote}
              </p>
            )}
          </div>
        </div>

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar aviso informativo"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-amber-100/70 hover:text-slate-800"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {mode === 'modal' && (
        <div className="flex justify-end gap-2 border-t border-amber-200/70 pt-3">
          <button
            type="button"
            autoFocus
            onClick={onClose}
            className="inline-flex min-h-[40px] items-center rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
          >
            Entendido
          </button>
        </div>
      )}
    </div>
  );

  if (mode === 'modal') {
    return (
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        {...({ closedby: 'any' } as Record<string, unknown>)}
        onCancel={(e) => {
          e.preventDefault();
          onClose?.();
        }}
        onClose={() => {
          if (isOpen) {
            onClose?.();
          }
        }}
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-amber-200 bg-amber-50 p-5 text-slate-900 shadow-xl backdrop:bg-slate-900/50"
      >
        {isOpen && content}
      </dialog>
    );
  }

  if (mode === 'card') {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
        {content}
      </div>
    );
  }

  return (
    <div
      role="status"
      className="rounded-xl border border-amber-200 bg-amber-50/85 px-3.5 py-3"
    >
      {content}
    </div>
  );
};

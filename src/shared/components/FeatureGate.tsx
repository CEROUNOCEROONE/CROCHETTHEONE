import React from 'react';
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
  if (mode === 'modal' && !isOpen) {
    return null;
  }

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
              <h4 className="text-xs font-bold text-slate-900 sm:text-sm">
                {featureTitle}
              </h4>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-700">
              {description}
            </p>
            {freeIncludedNote && (
              <p className="mt-1.5 rounded-lg bg-white/80 px-2.5 py-1.5 text-[11px] leading-relaxed text-slate-600 border border-amber-200/70">
                <strong className="font-semibold text-slate-800">En tu plan FREE:</strong>{' '}
                {freeIncludedNote}
              </p>
            )}
          </div>
        </div>

        {onClose && mode !== 'modal' && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar aviso informativo"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-amber-100/70 hover:text-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {mode === 'modal' && (
        <div className="flex justify-end gap-2 border-t border-amber-200/70 pt-3">
          <button
            type="button"
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
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
        role="dialog"
        aria-modal="true"
        aria-label={featureTitle}
      >
        <div className="w-full max-w-md rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-xl">
          {content}
        </div>
      </div>
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

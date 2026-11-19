import React from 'react';
import { AlertCircle, AlertTriangle, X } from 'lucide-react';

export interface FeedbackNotice {
  readonly type: 'error' | 'warning';
  readonly message: string;
}

interface InlineFeedbackAlertProps {
  readonly feedback: FeedbackNotice | null | undefined;
  readonly className?: string;
  readonly closeLabel?: string;
  onDismiss(): void;
}

export const InlineFeedbackAlert: React.FC<InlineFeedbackAlertProps> = ({
  feedback,
  className = '',
  closeLabel = 'Cerrar aviso',
  onDismiss,
}) => {
  if (!feedback) return null;

  const isWarning = feedback.type === 'warning';
  const Icon = isWarning ? AlertTriangle : AlertCircle;

  return (
    <div
      role={isWarning ? 'status' : 'alert'}
      aria-live={isWarning ? 'polite' : 'assertive'}
      className={`flex items-start justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-xs sm:text-sm ${
        isWarning
          ? 'border-amber-200 bg-amber-50 text-amber-900'
          : 'border-rose-200 bg-rose-50 text-rose-900'
      } ${className}`}
    >
      <div className="flex min-w-0 items-start gap-2">
        <Icon
          className={`mt-0.5 h-4 w-4 shrink-0 ${
            isWarning ? 'text-amber-700' : 'text-rose-700'
          }`}
          aria-hidden="true"
        />
        <p className="min-w-0 break-words">{feedback.message}</p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={closeLabel}
        className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors ${
          isWarning
            ? 'text-amber-700 hover:bg-amber-100'
            : 'text-rose-700 hover:bg-rose-100'
        }`}
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
};

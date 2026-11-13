import React from 'react';
import { AlertCircle, CheckCircle2, Clock, PauseCircle } from 'lucide-react';

export type SemanticTone = 'neutral' | 'active' | 'success' | 'warning' | 'danger';

interface StatusLabelProps {
  readonly label: string;
  readonly tone?: SemanticTone;
}

const TONE_CLASSES: Record<SemanticTone, string> = {
  neutral: 'text-slate-600',
  active: 'text-teal-700',
  success: 'text-emerald-700',
  warning: 'text-amber-700',
  danger: 'text-rose-700',
};

/**
 * Indicador semántico limpio sin cápsulas ni píldoras decorativas.
 * Combina color accesible con icono y texto explícito.
 */
export const StatusBadge: React.FC<StatusLabelProps> = ({
  label,
  tone = 'neutral',
}) => {
  const Icon =
    tone === 'success'
      ? CheckCircle2
      : tone === 'warning'
        ? PauseCircle
        : tone === 'danger'
          ? AlertCircle
          : Clock;

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium ${TONE_CLASSES[tone]}`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
};

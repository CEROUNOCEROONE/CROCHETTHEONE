import React from 'react';
import type { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly description: string;
  readonly primaryAction?: {
    readonly label: string;
    readonly onClick: () => void;
  };
  readonly secondaryAction?: {
    readonly label: string;
    readonly onClick: () => void;
  };
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon,
  title,
  description,
  primaryAction,
  secondaryAction,
}) => {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
        <Icon className="h-6 w-6" aria-hidden="true" />
      </div>
      <h3 className="mt-4 font-display text-base font-semibold text-slate-900">
        {title}
      </h3>
      <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-slate-600">
        {description}
      </p>
      {(primaryAction || secondaryAction) && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          {primaryAction && (
            <button
              type="button"
              onClick={primaryAction.onClick}
              className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-teal-700 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-800"
            >
              {primaryAction.label}
            </button>
          )}
          {secondaryAction && (
            <button
              type="button"
              onClick={secondaryAction.onClick}
              className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-slate-300 bg-white px-5 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              {secondaryAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

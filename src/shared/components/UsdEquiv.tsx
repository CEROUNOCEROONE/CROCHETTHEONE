import React from 'react';
import { useWorkshopData } from '@/src/data/DataContext.tsx';
import type { WorkshopCurrencyCode } from '@/src/domain/services/currencyCatalog.ts';
import { formatUsdApprox } from '@/src/domain/services/formatters.ts';

interface UsdEquivProps {
  readonly amount: number;
  readonly currency?: WorkshopCurrencyCode;
  readonly prefix?: string;
  readonly suffix?: string;
  readonly block?: boolean;
  readonly hideWhenZero?: boolean;
  readonly className?: string;
}

export const UsdEquiv: React.FC<UsdEquivProps> = ({
  amount,
  currency,
  prefix = '',
  suffix = '',
  block = false,
  hideWhenZero = false,
  className = '',
}) => {
  const { settings, usdRates } = useWorkshopData();
  if (hideWhenZero && (!Number.isFinite(amount) || amount <= 0)) {
    return null;
  }

  const activeCurrency = currency ?? settings.currency;
  const formatted = formatUsdApprox(amount, activeCurrency, usdRates);

  if (!formatted) return null;

  const baseClass = block
    ? 'block font-mono text-[11px] font-normal text-slate-500 tabular-nums'
    : 'font-mono text-[11px] font-normal text-slate-500 tabular-nums';

  const mergedClass = className ? `${baseClass} ${className}` : baseClass;

  return (
    <span className={mergedClass}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
};

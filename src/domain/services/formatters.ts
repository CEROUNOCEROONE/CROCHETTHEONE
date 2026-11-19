import { BRAND_CONFIG } from '@/src/config/brand.ts';
import type { ISODate, MoneyCOP } from '@/src/domain/models/index.ts';
import {
  getCurrencySpec,
  roundCurrencyAmount,
  roundUnitCostAmount,
  type WorkshopCurrencyCode,
} from './currencyCatalog.ts';
import {
  convertToUsdAmount,
  type UsdRatesSnapshot,
} from './exchangeRateService.ts';

let activeCurrencyCode: WorkshopCurrencyCode = BRAND_CONFIG.currency;
let activeUsdRatesSnapshot: UsdRatesSnapshot | null = null;
const formatterCache = new Map<string, Intl.NumberFormat>();
const usdEquivFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function setActiveCurrency(code: WorkshopCurrencyCode): void {
  activeCurrencyCode = getCurrencySpec(code).code;
}

export function getActiveCurrency(): WorkshopCurrencyCode {
  return activeCurrencyCode;
}

export function setActiveUsdRates(snapshot: UsdRatesSnapshot | null): void {
  activeUsdRatesSnapshot = snapshot;
}

export function getActiveUsdRates(): UsdRatesSnapshot | null {
  return activeUsdRatesSnapshot;
}

function getNumberFormatter(
  code: WorkshopCurrencyCode,
  includeDecimals: boolean,
  maxDecimalsOverride?: number,
): Intl.NumberFormat {
  const spec = getCurrencySpec(code);
  const maxFrac =
    maxDecimalsOverride !== undefined
      ? Math.max(spec.decimals, maxDecimalsOverride)
      : spec.decimals;
  const minFrac = includeDecimals ? maxFrac : 0;
  const key = `${spec.code}_${minFrac}_${maxFrac}`;
  let fmt = formatterCache.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(spec.locale, {
      style: 'currency',
      currency: spec.code,
      minimumFractionDigits: minFrac,
      maximumFractionDigits: maxFrac,
    });
    formatterCache.set(key, fmt);
  }
  return fmt;
}

export function formatMoney(
  amount: number,
  currencyCode: WorkshopCurrencyCode = activeCurrencyCode,
): string {
  const rounded = roundCurrencyAmount(
    Number.isFinite(amount) ? amount : 0,
    currencyCode,
  );
  const hasCents = !Number.isInteger(rounded);
  return getNumberFormatter(currencyCode, hasCents).format(rounded);
}

export function formatUnitCost(
  amount: MoneyCOP,
  currencyCode: WorkshopCurrencyCode = activeCurrencyCode,
): string {
  const rounded = roundUnitCostAmount(
    Number.isFinite(amount) ? amount : 0,
    currencyCode,
  );
  const hasDecimals = !Number.isInteger(rounded);
  return getNumberFormatter(
    currencyCode,
    hasDecimals,
    hasDecimals ? 2 : undefined,
  ).format(rounded);
}

export function formatCOP(
  amount: MoneyCOP,
  currencyCode?: WorkshopCurrencyCode,
): string {
  return formatMoney(amount, currencyCode ?? activeCurrencyCode);
}

export function formatUsdApprox(
  amount: number,
  currencyCode: WorkshopCurrencyCode = activeCurrencyCode,
  snapshot: UsdRatesSnapshot | null = activeUsdRatesSnapshot,
): string | null {
  const usdAmount = convertToUsdAmount(amount, currencyCode, snapshot);
  if (usdAmount === null) return null;
  return `≈ ${usdEquivFormatter.format(usdAmount)} USD`;
}

/**
 * Formatea una fecha ISO en el estándar colombiano DD/MM/YYYY.
 */
export function formatDateCO(isoDate: ISODate | null | undefined): string {
  if (!isoDate) return 'Sin fecha';
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return 'Fecha inválida';
  const day = String(parsed.getDate()).padStart(2, '0');
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const year = parsed.getFullYear();
  return `${day}/${month}/${year}`;
}

export function formatDateTimeCO(isoDate: ISODate | null | undefined): string {
  if (!isoDate) return 'Sin registro';
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return 'Fecha inválida';
  const datePart = formatDateCO(isoDate);
  const hours = String(parsed.getHours()).padStart(2, '0');
  const minutes = String(parsed.getMinutes()).padStart(2, '0');
  return `${datePart} · ${hours}:${minutes}`;
}

export function formatDurationMinutes(totalMinutes: number): string {
  const safeMinutes = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} h`;
  return `${hours} h ${minutes} min`;
}

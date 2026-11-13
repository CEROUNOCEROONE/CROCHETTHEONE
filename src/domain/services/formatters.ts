import { BRAND_CONFIG } from '@/src/config/brand.ts';
import type { ISODate, MoneyCOP } from '@/src/domain/models/index.ts';

const copFormatter = new Intl.NumberFormat(BRAND_CONFIG.locale, {
  style: 'currency',
  currency: BRAND_CONFIG.currency,
  maximumFractionDigits: 0,
});

export function formatCOP(amount: MoneyCOP): string {
  const safeValue = Number.isFinite(amount) ? Math.round(amount) : 0;
  return copFormatter.format(safeValue);
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

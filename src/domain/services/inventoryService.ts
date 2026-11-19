import type {
  InventoryMovementType,
  InventoryReservation,
  Material,
  MaterialCategory,
  MaterialVariant,
  MeasurementUnit,
  MoneyCOP,
  PredefinedMaterialCategory,
  ReservationStatus,
} from '@/src/domain/models/index.ts';
import {
  roundCurrencyAmount,
  roundUnitCostAmount,
  type WorkshopCurrencyCode,
} from './currencyCatalog.ts';
import { getActiveCurrency } from './formatters.ts';

export const MATERIAL_CATEGORY_OPTIONS: Array<{
  readonly value: PredefinedMaterialCategory;
  readonly label: string;
}> = [
  { value: 'yarn_cotton', label: 'Hilo de algodón' },
  { value: 'yarn_acrylic', label: 'Lana acrílica' },
  { value: 'wool', label: 'Lana natural' },
  { value: 'stuffing', label: 'Relleno / Algodón siliconado' },
  { value: 'safety_eyes', label: 'Ojos de seguridad' },
  { value: 'buttons', label: 'Botones y broches' },
  { value: 'needles', label: 'Agujas y ganchillos' },
  { value: 'accessories', label: 'Herrajes y accesorios' },
  { value: 'other', label: 'Otros insumos' },
];

export const MEASUREMENT_UNIT_OPTIONS: Array<{
  readonly value: MeasurementUnit;
  readonly label: string;
  readonly shortLabel: string;
}> = [
  { value: 'g', label: 'Gramos (g)', shortLabel: 'g' },
  { value: 'm', label: 'Metros (m)', shortLabel: 'm' },
  { value: 'unit', label: 'Unidades (u)', shortLabel: 'u' },
  { value: 'pair', label: 'Pares', shortLabel: 'par' },
  { value: 'bag', label: 'Bolsas / Paquetes', shortLabel: 'paq' },
];

export const MOVEMENT_TYPE_META: Record<
  InventoryMovementType,
  { label: string; tone: 'neutral' | 'active' | 'warning' | 'success' | 'danger' }
> = {
  INITIAL_STOCK: { label: 'Stock inicial', tone: 'success' },
  PURCHASE_RECEIPT: { label: 'Recepción compra', tone: 'success' },
  RESERVATION_CREATED: { label: 'Reserva creada', tone: 'active' },
  RESERVATION_MODIFIED: { label: 'Reserva ajustada', tone: 'warning' },
  RESERVATION_RELEASED: { label: 'Reserva liberada', tone: 'neutral' },
  PROJECT_CONSUMPTION: { label: 'Consumo proyecto', tone: 'warning' },
  MANUAL_ADJUSTMENT: { label: 'Ajuste manual', tone: 'neutral' },
};

export const RESERVATION_STATUS_META: Record<
  ReservationStatus,
  { label: string; tone: 'neutral' | 'active' | 'warning' | 'success' | 'danger' }
> = {
  active: { label: 'Activa', tone: 'active' },
  fulfilled: { label: 'Consumida', tone: 'success' },
  released: { label: 'Liberada', tone: 'neutral' },
  cancelled: { label: 'Cancelada', tone: 'danger' },
};

export interface CreateMaterialInput {
  readonly name: string;
  readonly category: MaterialCategory;
  readonly brand: string;
  readonly unit: MeasurementUnit;
  readonly description: string;
  readonly allowSeparateOnSameName?: boolean;
}

export interface UpdateMaterialInput {
  readonly name?: string;
  readonly category?: MaterialCategory;
  readonly brand?: string;
  readonly unit?: MeasurementUnit;
  readonly description?: string;
}

export type VariantMetadataConflictStrategy = 'keep_existing' | 'update_with_new';

export interface CreateVariantInput {
  readonly materialId: string;
  readonly colorName: string;
  readonly colorHex: string | null;
  readonly sizeOrGauge: string | null;
  readonly sku: string | null;
  readonly provider: string;
  readonly unitCostCOP: MoneyCOP;
  readonly initialPhysicalStock: number;
  readonly minStock: number;
  readonly minStockAlertEnabled?: boolean;
  readonly metadataConflictStrategy?: VariantMetadataConflictStrategy;
  readonly notes: string;
}

export interface UpdateVariantMetadataInput {
  readonly colorName?: string;
  readonly colorHex?: string | null;
  readonly sizeOrGauge?: string | null;
  readonly sku?: string | null;
  readonly provider?: string;
  readonly unitCostCOP?: MoneyCOP;
  readonly minStock?: number;
  readonly minStockAlertEnabled?: boolean;
  readonly notes?: string;
}

export interface AdjustStockInput {
  readonly variantId: string;
  readonly quantityDelta: number;
  readonly notes: string;
}

export interface CreateReservationInput {
  readonly projectId: string;
  readonly componentId?: string | null;
  readonly variantId: string;
  readonly quantity: number;
  readonly notes?: string;
}

export interface ConsumeFromReservationInput {
  readonly reservationId: string;
  readonly quantity: number;
  readonly notes?: string;
}

export interface DirectConsumptionInput {
  readonly projectId: string;
  readonly componentId?: string | null;
  readonly variantId: string;
  readonly quantity: number;
  readonly notes?: string;
}

/**
 * Normaliza espacios sobrantes manteniendo mayúsculas/acentos originales para presentación.
 */
export function normalizeInventoryText(value: string | null | undefined): string {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ');
}

/**
 * Clave canónica de comparación insensible a mayúsculas, acentos y espacios redundantes.
 */
export function normalizeComparisonKey(value: string | null | undefined): string {
  const clean = normalizeInventoryText(value);
  if (!clean) return '';
  return clean
    .toLocaleLowerCase('es')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function isSameNormalizedText(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const keyA = normalizeComparisonKey(a);
  const keyB = normalizeComparisonKey(b);
  return keyA.length > 0 && keyA === keyB;
}

export function isPredefinedMaterialCategory(
  category: string,
): category is PredefinedMaterialCategory {
  return MATERIAL_CATEGORY_OPTIONS.some((opt) => opt.value === category);
}

export function getCategoryLabel(category: MaterialCategory): string {
  const predefined = MATERIAL_CATEGORY_OPTIONS.find((c) => c.value === category);
  if (predefined) return predefined.label;
  const clean = normalizeInventoryText(String(category));
  return clean || 'Insumo';
}

export function deduplicateCustomCategories(
  rawCategories: readonly string[] | undefined | null,
): string[] {
  if (!Array.isArray(rawCategories)) return [];
  const predefinedKeys = new Set<string>();
  for (const opt of MATERIAL_CATEGORY_OPTIONS) {
    predefinedKeys.add(normalizeComparisonKey(opt.value));
    predefinedKeys.add(normalizeComparisonKey(opt.label));
  }

  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of rawCategories) {
    const clean = normalizeInventoryText(raw);
    if (!clean) continue;
    const key = normalizeComparisonKey(clean);
    if (!key || predefinedKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
  }
  return result;
}

export interface MaterialCategoryCatalogOption {
  readonly value: MaterialCategory;
  readonly label: string;
  readonly isCustom: boolean;
}

export function buildMaterialCategoryOptions(
  materials: readonly Pick<Material, 'category'>[],
  persistedCustomCategories?: readonly string[] | null,
): MaterialCategoryCatalogOption[] {
  const baseWithoutOther = MATERIAL_CATEGORY_OPTIONS.filter(
    (opt) => opt.value !== 'other',
  ).map((opt) => ({
    value: opt.value as MaterialCategory,
    label: opt.label,
    isCustom: false,
  }));

  const combinedCustom = deduplicateCustomCategories([
    ...(persistedCustomCategories ?? []),
    ...materials.map((m) => String(m.category)),
  ]).sort((a, b) => a.localeCompare(b, 'es'));

  const customOptions: MaterialCategoryCatalogOption[] = combinedCustom.map(
    (cat) => ({
      value: cat,
      label: cat,
      isCustom: true,
    }),
  );

  const otherOption: MaterialCategoryCatalogOption = {
    value: 'other',
    label: 'Otros insumos',
    isCustom: false,
  };

  return [...baseWithoutOther, ...customOptions, otherOption];
}

export function resolveMaterialCategorySelection(params: {
  readonly selectedCategory: MaterialCategory;
  readonly customSpecification?: string;
  readonly existingCatalog?: readonly MaterialCategoryCatalogOption[];
}): {
  readonly category: MaterialCategory;
  readonly displayLabel: string;
  readonly isReusedExisting: boolean;
  readonly isNewCustom: boolean;
} {
  const { selectedCategory, customSpecification, existingCatalog } = params;
  if (selectedCategory !== 'other') {
    const cleanDirect = normalizeInventoryText(String(selectedCategory));
    const predefined = MATERIAL_CATEGORY_OPTIONS.find(
      (opt) =>
        isSameNormalizedText(opt.value, cleanDirect) ||
        isSameNormalizedText(opt.label, cleanDirect),
    );
    if (predefined) {
      return {
        category: predefined.value,
        displayLabel: predefined.label,
        isReusedExisting: true,
        isNewCustom: false,
      };
    }
    const existingOpt = existingCatalog?.find(
      (opt) =>
        isSameNormalizedText(opt.value, cleanDirect) ||
        isSameNormalizedText(opt.label, cleanDirect),
    );
    if (existingOpt) {
      return {
        category: existingOpt.value,
        displayLabel: existingOpt.label,
        isReusedExisting: true,
        isNewCustom: false,
      };
    }
    return {
      category: cleanDirect || 'other',
      displayLabel: getCategoryLabel(cleanDirect || 'other'),
      isReusedExisting: !cleanDirect,
      isNewCustom: Boolean(cleanDirect),
    };
  }

  const cleanSpec = normalizeInventoryText(customSpecification);
  if (!cleanSpec) {
    return {
      category: 'other',
      displayLabel: 'Otros insumos',
      isReusedExisting: true,
      isNewCustom: false,
    };
  }

  const matchedPredefined = MATERIAL_CATEGORY_OPTIONS.find(
    (opt) =>
      isSameNormalizedText(opt.value, cleanSpec) ||
      isSameNormalizedText(opt.label, cleanSpec),
  );
  if (matchedPredefined) {
    return {
      category: matchedPredefined.value,
      displayLabel: matchedPredefined.label,
      isReusedExisting: true,
      isNewCustom: false,
    };
  }

  const matchedExisting = existingCatalog?.find(
    (opt) =>
      isSameNormalizedText(opt.value, cleanSpec) ||
      isSameNormalizedText(opt.label, cleanSpec),
  );
  if (matchedExisting) {
    return {
      category: matchedExisting.value,
      displayLabel: matchedExisting.label,
      isReusedExisting: true,
      isNewCustom: false,
    };
  }

  return {
    category: cleanSpec,
    displayLabel: cleanSpec,
    isReusedExisting: false,
    isNewCustom: true,
  };
}

export function getUnitShortLabel(unit: MeasurementUnit): string {
  return (
    MEASUREMENT_UNIT_OPTIONS.find((u) => u.value === unit)?.shortLabel ?? unit
  );
}

export function getUnitCostDisplayLabel(unit: MeasurementUnit): string {
  if (unit === 'unit') return 'unidad';
  return getUnitShortLabel(unit);
}

/**
 * Calcula el costo promedio ponderado tras una entrada de existencias.
 * Reglas de seguridad:
 * - Evita divisiones por cero.
 * - Si no hay stock previo o el costo anterior no es válido (<= 0 / NaN), adopta el costo de la nueva entrada.
 * - Si la entrada no aporta cantidad positiva o no informa costo (> 0), conserva el costo anterior válido.
 */
export function computeWeightedAverageUnitCost(params: {
  readonly previousPhysicalStock: number;
  readonly previousUnitCost: number;
  readonly entryQuantity: number;
  readonly entryUnitCost: number;
  readonly currency?: WorkshopCurrencyCode;
}): MoneyCOP {
  const currency = params.currency ?? getActiveCurrency();
  const prevStock =
    Number.isFinite(params.previousPhysicalStock) && params.previousPhysicalStock > 0
      ? params.previousPhysicalStock
      : 0;
  const hasValidPrevCost =
    Number.isFinite(params.previousUnitCost) && params.previousUnitCost > 0;
  const prevCost = hasValidPrevCost ? params.previousUnitCost : 0;

  const qtyIn =
    Number.isFinite(params.entryQuantity) && params.entryQuantity > 0
      ? params.entryQuantity
      : 0;
  const hasValidEntryCost =
    Number.isFinite(params.entryUnitCost) && params.entryUnitCost > 0;
  const entryCost = hasValidEntryCost ? params.entryUnitCost : 0;

  if (qtyIn <= 0) {
    return roundUnitCostAmount(prevCost, currency);
  }
  if (prevStock <= 0 || !hasValidPrevCost) {
    return roundUnitCostAmount(hasValidEntryCost ? entryCost : prevCost, currency);
  }
  if (!hasValidEntryCost) {
    return roundUnitCostAmount(prevCost, currency);
  }

  const totalStock = prevStock + qtyIn;
  if (totalStock <= 0) {
    return roundUnitCostAmount(entryCost, currency);
  }

  const weighted = (prevStock * prevCost + qtyIn * entryCost) / totalStock;
  return roundUnitCostAmount(weighted, currency);
}

export function formatUnitQuantity(
  quantity: number,
  unit: MeasurementUnit,
): string {
  const safe = Number.isFinite(quantity)
    ? Math.round(quantity * 100) / 100
    : 0;
  return `${safe} ${getUnitShortLabel(unit)}`;
}

export function getVariantAvailableStock(
  variant: Pick<MaterialVariant, 'physicalStock' | 'reservedStock'>,
): number {
  return Math.max(0, variant.physicalStock - variant.reservedStock);
}

export function isVariantMinStockAlertEnabled(
  variant: Pick<MaterialVariant, 'minStockAlertEnabled'>,
): boolean {
  return variant.minStockAlertEnabled !== false;
}

export function isVariantLowStock(
  variant: Pick<
    MaterialVariant,
    'physicalStock' | 'reservedStock' | 'minStock' | 'minStockAlertEnabled'
  >,
): boolean {
  if (!isVariantMinStockAlertEnabled(variant)) return false;
  return getVariantAvailableStock(variant) <= variant.minStock;
}

export function getReservationRemaining(
  reservation: Pick<
    InventoryReservation,
    'reservedQuantity' | 'consumedQuantity' | 'status'
  >,
): number {
  if (reservation.status !== 'active') return 0;
  return Math.max(0, reservation.reservedQuantity - reservation.consumedQuantity);
}

export function getVariantInventoryValueCOP(
  variant: Pick<MaterialVariant, 'physicalStock' | 'unitCostCOP'>,
): MoneyCOP {
  return roundCurrencyAmount(
    Math.max(0, variant.physicalStock) * Math.max(0, variant.unitCostCOP),
    getActiveCurrency(),
  );
}

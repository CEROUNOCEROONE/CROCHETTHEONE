import type {
  InventoryMovementType,
  InventoryReservation,
  MaterialCategory,
  MaterialVariant,
  MeasurementUnit,
  MoneyCOP,
  ReservationStatus,
} from '@/src/domain/models/index.ts';

export const MATERIAL_CATEGORY_OPTIONS: Array<{
  readonly value: MaterialCategory;
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
}

export interface UpdateMaterialInput {
  readonly name?: string;
  readonly category?: MaterialCategory;
  readonly brand?: string;
  readonly unit?: MeasurementUnit;
  readonly description?: string;
}

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

export function getCategoryLabel(category: MaterialCategory): string {
  return (
    MATERIAL_CATEGORY_OPTIONS.find((c) => c.value === category)?.label ?? 'Insumo'
  );
}

export function getUnitShortLabel(unit: MeasurementUnit): string {
  return (
    MEASUREMENT_UNIT_OPTIONS.find((u) => u.value === unit)?.shortLabel ?? unit
  );
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

export function isVariantLowStock(
  variant: Pick<MaterialVariant, 'physicalStock' | 'reservedStock' | 'minStock'>,
): boolean {
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
  return Math.round(
    Math.max(0, variant.physicalStock) * Math.max(0, variant.unitCostCOP),
  );
}

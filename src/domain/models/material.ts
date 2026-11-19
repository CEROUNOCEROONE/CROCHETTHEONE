import type { BaseEntity, MoneyCOP } from './common.ts';

export type PredefinedMaterialCategory =
  | 'yarn_cotton'
  | 'yarn_acrylic'
  | 'wool'
  | 'stuffing'
  | 'safety_eyes'
  | 'buttons'
  | 'needles'
  | 'accessories'
  | 'other';

export type MaterialCategory = PredefinedMaterialCategory | (string & {});

export type MeasurementUnit = 'g' | 'm' | 'unit' | 'pair' | 'bag';

export interface Material extends BaseEntity {
  readonly name: string;
  readonly category: MaterialCategory;
  readonly brand: string;
  readonly unit: MeasurementUnit;
  readonly description: string;
}

export interface MaterialVariant extends BaseEntity {
  readonly materialId: string;
  /** El color es obligatorio como campo independiente en hilos y lanas */
  readonly colorName: string;
  readonly colorHex: string | null;
  readonly sizeOrGauge: string | null;
  readonly sku: string | null;
  readonly provider: string;
  readonly unitCostCOP: MoneyCOP;
  readonly physicalStock: number;
  readonly reservedStock: number;
  readonly totalConsumed: number;
  readonly minStock: number;
  /** Control individual de alerta de stock mínimo por variante (por defecto true si no está definido) */
  readonly minStockAlertEnabled?: boolean;
  readonly photoUrl: string | null;
  readonly notes: string;
}

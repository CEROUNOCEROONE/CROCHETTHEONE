import type { BaseEntity, ISODate, MoneyCOP } from './common.ts';

export type ReservationStatus = 'active' | 'fulfilled' | 'released' | 'cancelled';

export type InventoryMovementType =
  | 'INITIAL_STOCK'
  | 'PURCHASE_RECEIPT'
  | 'RESERVATION_CREATED'
  | 'RESERVATION_MODIFIED'
  | 'RESERVATION_RELEASED'
  | 'PROJECT_CONSUMPTION'
  | 'MANUAL_ADJUSTMENT';

export interface InventoryReservation extends BaseEntity {
  readonly projectId: string;
  readonly componentId: string | null;
  readonly variantId: string;
  readonly reservedQuantity: number;
  readonly consumedQuantity: number;
  readonly status: ReservationStatus;
  readonly notes: string;
}

/**
 * Registro inmutable del historial (Kardex).
 * Nunca se edita ni elimina para preservar trazabilidad completa de reservas,
 * compras, recepciones, consumos y ajustes.
 */
export interface InventoryMovement extends BaseEntity {
  readonly variantId: string;
  readonly projectId: string | null;
  readonly reservationId: string | null;
  readonly purchaseReceiptId: string | null;
  readonly type: InventoryMovementType;
  readonly quantityDelta: number;
  readonly previousPhysicalStock: number;
  readonly newPhysicalStock: number;
  readonly previousReservedStock: number;
  readonly newReservedStock: number;
  readonly unitCostAtMovementCOP: MoneyCOP;
  readonly idempotencyKey: string;
  readonly notes: string;
  readonly timestamp: ISODate;
}

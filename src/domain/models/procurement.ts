import type { BaseEntity, ISODate, MoneyCOP } from './common.ts';
import type { MeasurementUnit } from './material.ts';

export type PendingMaterialStatus =
  | 'pending_order'
  | 'ordered'
  | 'partially_received'
  | 'received'
  | 'cancelled';

export type NoteOrListType = 'free_note' | 'shopping_list' | 'idea';

export type ShoppingItemStatus =
  | 'pending'
  | 'purchased_waiting_delivery'
  | 'partially_received'
  | 'received_in_stock'
  | 'cancelled';

export interface PendingMaterial extends BaseEntity {
  readonly variantId: string;
  readonly projectId: string;
  readonly componentId: string | null;
  readonly quantityNeeded: number;
  readonly quantityReceived: number;
  readonly provider: string;
  readonly orderedDate: ISODate | null;
  readonly estimatedArrivalDate: ISODate | null;
  readonly status: PendingMaterialStatus;
  readonly notes: string;
}

export interface NoteOrList extends BaseEntity {
  readonly title: string;
  readonly type: NoteOrListType;
  readonly projectId: string | null;
  readonly content: string;
  readonly status: 'active' | 'archived';
}

export interface ShoppingListItem extends BaseEntity {
  readonly listId: string;
  readonly variantId: string | null;
  readonly pendingMaterialId?: string | null;
  readonly customName: string;
  readonly colorName: string;
  readonly unit: MeasurementUnit;
  readonly plannedQuantity: number;
  readonly purchasedQuantity: number;
  readonly receivedQuantity: number;
  readonly estimatedUnitPriceCOP: MoneyCOP;
  readonly provider: string;
  readonly status: ShoppingItemStatus;
  readonly notes: string;
}

export interface PurchaseReceiptItem {
  readonly variantId: string;
  readonly shoppingListItemId: string | null;
  readonly pendingMaterialId?: string | null;
  readonly materialNameSnapshot?: string;
  readonly colorNameSnapshot?: string;
  readonly unitSnapshot?: MeasurementUnit;
  readonly quantityReceived: number;
  readonly unitCostCOP: MoneyCOP;
}

export interface PurchaseReceipt extends BaseEntity {
  readonly provider: string;
  readonly receiptDate: ISODate;
  readonly referenceCode: string | null;
  readonly items: PurchaseReceiptItem[];
  readonly totalCostCOP: MoneyCOP;
  readonly idempotencyKey?: string;
  readonly notes: string;
}

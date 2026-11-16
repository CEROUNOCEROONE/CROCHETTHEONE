import type {
  ISODate,
  MeasurementUnit,
  MoneyCOP,
  NoteOrListType,
  PendingMaterial,
  PendingMaterialStatus,
  ShoppingItemStatus,
  ShoppingListItem,
} from '@/src/domain/models/index.ts';
import { roundCurrencyAmount } from './currencyCatalog.ts';
import { getActiveCurrency } from './formatters.ts';

export const PENDING_MATERIAL_STATUS_META: Record<
  PendingMaterialStatus,
  { label: string; tone: 'neutral' | 'active' | 'warning' | 'success' | 'danger' }
> = {
  pending_order: { label: 'Por comprar', tone: 'warning' },
  ordered: { label: 'Comprado en camino', tone: 'active' },
  partially_received: { label: 'Recibido parcial', tone: 'active' },
  received: { label: 'Recibido en stock', tone: 'success' },
  cancelled: { label: 'Cancelado', tone: 'neutral' },
};

export const NOTE_TYPE_OPTIONS: Array<{
  readonly value: NoteOrListType;
  readonly label: string;
}> = [
  { value: 'shopping_list', label: 'Lista de compras' },
  { value: 'free_note', label: 'Nota rápida' },
  { value: 'idea', label: 'Idea / Inspiración' },
];

export const SHOPPING_ITEM_STATUS_META: Record<
  ShoppingItemStatus,
  { label: string; tone: 'neutral' | 'active' | 'warning' | 'success' | 'danger' }
> = {
  pending: { label: 'Pendiente por comprar', tone: 'warning' },
  purchased_waiting_delivery: { label: 'Comprado en camino', tone: 'active' },
  partially_received: { label: 'Recibido parcial', tone: 'active' },
  received_in_stock: { label: 'Recibido en stock', tone: 'success' },
  cancelled: { label: 'Cancelado', tone: 'neutral' },
};

export interface CreatePendingMaterialInput {
  readonly variantId: string;
  readonly projectId: string;
  readonly componentId: string | null;
  readonly quantityNeeded: number;
  readonly provider: string;
  readonly orderedDate?: ISODate | null;
  readonly estimatedArrivalDate?: ISODate | null;
  readonly status?: 'pending_order' | 'ordered';
  readonly markComponentBlocked?: boolean;
  readonly notes?: string;
}

export interface UpdatePendingMaterialInput {
  readonly quantityNeeded?: number;
  readonly provider?: string;
  readonly orderedDate?: ISODate | null;
  readonly estimatedArrivalDate?: ISODate | null;
  readonly status?: PendingMaterialStatus;
  readonly notes?: string;
}

export interface CreateNoteOrListInput {
  readonly title: string;
  readonly type: NoteOrListType;
  readonly projectId: string | null;
  readonly content: string;
}

export interface UpdateNoteOrListInput {
  readonly title?: string;
  readonly type?: NoteOrListType;
  readonly projectId?: string | null;
  readonly content?: string;
  readonly status?: 'active' | 'archived';
}

export interface CreateShoppingListItemInput {
  readonly listId: string;
  readonly variantId: string | null;
  readonly pendingMaterialId?: string | null;
  readonly customName: string;
  readonly colorName: string;
  readonly unit: MeasurementUnit;
  readonly plannedQuantity: number;
  readonly purchasedQuantity?: number;
  readonly estimatedUnitPriceCOP: MoneyCOP;
  readonly provider: string;
  readonly status?: 'pending' | 'purchased_waiting_delivery';
  readonly notes?: string;
}

export interface UpdateShoppingListItemInput {
  readonly variantId?: string | null;
  readonly customName?: string;
  readonly colorName?: string;
  readonly unit?: MeasurementUnit;
  readonly plannedQuantity?: number;
  readonly purchasedQuantity?: number;
  readonly estimatedUnitPriceCOP?: MoneyCOP;
  readonly provider?: string;
  readonly status?: ShoppingItemStatus;
  readonly notes?: string;
}

export interface ReceivePurchaseItemInput {
  readonly variantId: string;
  readonly shoppingListItemId?: string | null;
  readonly pendingMaterialId?: string | null;
  readonly quantityReceived: number;
  readonly unitCostCOP: MoneyCOP;
  readonly updateVariantUnitCost?: boolean;
}

export interface CreatePurchaseReceiptInput {
  readonly provider: string;
  readonly receiptDate: ISODate;
  readonly referenceCode?: string | null;
  readonly notes?: string;
  readonly idempotencyKey?: string;
  readonly items: ReceivePurchaseItemInput[];
}

export function getPendingMaterialRemaining(
  item: Pick<PendingMaterial, 'quantityNeeded' | 'quantityReceived' | 'status'>,
): number {
  if (item.status === 'received' || item.status === 'cancelled') return 0;
  return Math.max(
    0,
    Math.round((item.quantityNeeded - item.quantityReceived) * 100) / 100,
  );
}

export function getShoppingItemRemainingToReceive(
  item: Pick<ShoppingListItem, 'plannedQuantity' | 'receivedQuantity' | 'status'>,
): number {
  if (item.status === 'received_in_stock' || item.status === 'cancelled') return 0;
  return Math.max(
    0,
    Math.round((item.plannedQuantity - item.receivedQuantity) * 100) / 100,
  );
}

export interface ShoppingListSummary {
  readonly totalItems: number;
  readonly pendingCount: number;
  readonly inTransitCount: number;
  readonly receivedCount: number;
  readonly estimatedTotalCOP: MoneyCOP;
  readonly remainingToBuyCOP: MoneyCOP;
}

export function calculateShoppingListSummary(
  items: ShoppingListItem[],
): ShoppingListSummary {
  const activeItems = items.filter((i) => i.status !== 'cancelled');
  let pendingCount = 0;
  let inTransitCount = 0;
  let receivedCount = 0;
  let estimatedTotalCOP = 0;
  let remainingToBuyCOP = 0;

  const currency = getActiveCurrency();
  for (const item of activeItems) {
    if (item.status === 'pending') pendingCount += 1;
    if (
      item.status === 'purchased_waiting_delivery' ||
      item.status === 'partially_received'
    ) {
      inTransitCount += 1;
    }
    if (item.status === 'received_in_stock') receivedCount += 1;

    const plannedCost = roundCurrencyAmount(
      Math.max(0, item.plannedQuantity) * Math.max(0, item.estimatedUnitPriceCOP),
      currency,
    );
    estimatedTotalCOP = roundCurrencyAmount(
      estimatedTotalCOP + plannedCost,
      currency,
    );

    if (item.status === 'pending') {
      const pendingQty = Math.max(0, item.plannedQuantity - item.purchasedQuantity);
      remainingToBuyCOP = roundCurrencyAmount(
        remainingToBuyCOP +
          roundCurrencyAmount(
            pendingQty * Math.max(0, item.estimatedUnitPriceCOP),
            currency,
          ),
        currency,
      );
    }
  }

  return {
    totalItems: activeItems.length,
    pendingCount,
    inTransitCount,
    receivedCount,
    estimatedTotalCOP,
    remainingToBuyCOP,
  };
}

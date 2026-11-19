import type {
  InventoryMovement,
  InventoryReservation,
  Material,
  MaterialVariant,
  MoneyCOP,
  Project,
  ProjectComponent,
  Quote,
  QuoteMaterialLine,
  QuoteStatus,
  WorkshopSettings,
} from '@/src/domain/models/index.ts';
import {
  roundCurrencyAmount,
  roundUnitCostAmount,
  type WorkshopCurrencyCode,
} from './currencyCatalog.ts';
import {
  formatCOP,
  formatDateCO,
  formatDurationMinutes,
  getActiveCurrency,
} from './formatters.ts';
import { calculateQuoteSummary } from './quoteMath.ts';

export const QUOTE_STATUS_OPTIONS: Array<{
  readonly value: QuoteStatus;
  readonly label: string;
  readonly tone: 'neutral' | 'active' | 'success' | 'warning';
}> = [
  { value: 'draft', label: 'Borrador', tone: 'neutral' },
  { value: 'sent', label: 'Enviada', tone: 'active' },
  { value: 'approved', label: 'Aprobada', tone: 'success' },
  { value: 'rejected', label: 'Rechazada', tone: 'warning' },
];

export const QUOTE_STATUS_META: Record<
  QuoteStatus,
  { readonly label: string; readonly tone: 'neutral' | 'active' | 'success' | 'warning' }
> = {
  draft: { label: 'Borrador', tone: 'neutral' },
  sent: { label: 'Enviada', tone: 'active' },
  approved: { label: 'Aprobada', tone: 'success' },
  rejected: { label: 'Rechazada', tone: 'warning' },
};

export interface CreateQuoteMaterialLineInput {
  readonly variantId: string | null;
  readonly label: string;
  readonly colorName: string;
  readonly unit?: string;
  readonly quantity: number;
  readonly unitCostCOP: MoneyCOP;
}

export interface CreateQuoteInput {
  readonly projectId?: string | null;
  readonly clientId?: string | null;
  readonly title: string;
  readonly materialsSnapshot: CreateQuoteMaterialLineInput[];
  readonly effectiveMinutesUsed: number;
  readonly hourlyRateCOP: MoneyCOP;
  readonly manualIndirectCostsCOP?: MoneyCOP;
  readonly rentPercent?: number;
  readonly electricityPercent?: number;
  readonly internetPercent?: number;
  readonly wasteContingencyPercent?: number;
  readonly packagingCostCOP?: MoneyCOP;
  readonly shippingOrOtherCOP?: MoneyCOP;
  readonly markupPercent: number;
  readonly finalAgreedPriceCOP?: MoneyCOP | null;
  readonly status?: QuoteStatus;
  readonly notes?: string;
  readonly isDemo?: boolean;
}

export interface UpdateQuoteInput {
  readonly projectId?: string | null;
  readonly clientId?: string | null;
  readonly title?: string;
  readonly materialsSnapshot?: CreateQuoteMaterialLineInput[];
  readonly effectiveMinutesUsed?: number;
  readonly hourlyRateCOP?: MoneyCOP;
  readonly manualIndirectCostsCOP?: MoneyCOP;
  readonly rentPercent?: number;
  readonly electricityPercent?: number;
  readonly internetPercent?: number;
  readonly wasteContingencyPercent?: number;
  readonly packagingCostCOP?: MoneyCOP;
  readonly shippingOrOtherCOP?: MoneyCOP;
  readonly markupPercent?: number;
  readonly finalAgreedPriceCOP?: MoneyCOP | null;
  readonly status?: QuoteStatus;
  readonly notes?: string;
}

export interface ProjectQuotePrefill {
  readonly projectId: string;
  readonly clientId: string | null;
  readonly title: string;
  readonly effectiveMinutesLogged: number;
  readonly estimatedMinutesPlanned: number;
  readonly recommendedMinutes: number;
  readonly materialLines: QuoteMaterialLine[];
}

export interface AgreedPriceMetrics {
  readonly effectivePriceCOP: MoneyCOP;
  readonly profitAtAgreedCOP: MoneyCOP;
  readonly grossMarginAtAgreedPercent: number;
  readonly markupAtAgreedPercent: number;
  readonly isBelowCost: boolean;
}

function clampPercent(val: number | undefined): number {
  if (typeof val !== 'number' || !Number.isFinite(val)) return 0;
  return Math.round(Math.max(0, Math.min(500, val)) * 100) / 100;
}

function roundQuantity(val: number): number {
  if (!Number.isFinite(val)) return 0;
  return Math.round(Math.max(0, val) * 100) / 100;
}

function createQuoteId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `quote_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function normalizeQuoteMaterialLines(
  lines: CreateQuoteMaterialLineInput[],
  currency: WorkshopCurrencyCode = getActiveCurrency(),
): QuoteMaterialLine[] {
  return lines.map((line) => {
    const cleanLabel = line.label.trim();
    if (!cleanLabel) {
      throw new Error('Cada línea de material debe tener un nombre o descripción.');
    }
    const quantity = roundQuantity(line.quantity);
    if (quantity <= 0) {
      throw new Error(`La cantidad de "${cleanLabel}" debe ser mayor a 0.`);
    }
    const unitCostCOP = Math.max(
      0,
      roundUnitCostAmount(Number(line.unitCostCOP) || 0, currency),
    );
    return {
      variantId: line.variantId ? line.variantId : null,
      label: cleanLabel,
      colorName: line.colorName.trim() || 'Estándar',
      unit: line.unit?.trim() || 'unit',
      quantity,
      unitCostCOP,
      subtotalCOP: roundCurrencyAmount(quantity * unitCostCOP, currency),
    };
  });
}

export function computeQuoteSnapshotPricing(params: {
  readonly materialsSnapshot: CreateQuoteMaterialLineInput[];
  readonly effectiveMinutesUsed: number;
  readonly hourlyRateCOP: MoneyCOP;
  readonly manualIndirectCostsCOP?: MoneyCOP;
  readonly rentPercent?: number;
  readonly electricityPercent?: number;
  readonly internetPercent?: number;
  readonly wasteContingencyPercent?: number;
  readonly packagingCostCOP?: MoneyCOP;
  readonly shippingOrOtherCOP?: MoneyCOP;
  readonly markupPercent: number;
  readonly finalAgreedPriceCOP?: MoneyCOP | null;
  readonly currency?: WorkshopCurrencyCode;
}) {
  const currency = params.currency ?? getActiveCurrency();
  const normalizedLines = normalizeQuoteMaterialLines(
    params.materialsSnapshot,
    currency,
  );
  const materialsTotalCOP = roundCurrencyAmount(
    normalizedLines.reduce((sum, item) => sum + item.subtotalCOP, 0),
    currency,
  );
  const effectiveMinutesUsed = Math.max(
    0,
    Math.round(Number(params.effectiveMinutesUsed) || 0),
  );
  const hourlyRateCOP = Math.max(
    0,
    roundCurrencyAmount(Number(params.hourlyRateCOP) || 0, currency),
  );
  const manualIndirectCostsCOP = Math.max(
    0,
    roundCurrencyAmount(Number(params.manualIndirectCostsCOP) || 0, currency),
  );
  const packagingCostCOP = Math.max(
    0,
    roundCurrencyAmount(Number(params.packagingCostCOP) || 0, currency),
  );
  const shippingOrOtherCOP = Math.max(
    0,
    roundCurrencyAmount(Number(params.shippingOrOtherCOP) || 0, currency),
  );
  const rentPercent = clampPercent(params.rentPercent);
  const electricityPercent = clampPercent(params.electricityPercent);
  const internetPercent = clampPercent(params.internetPercent);
  const wasteContingencyPercent = clampPercent(params.wasteContingencyPercent);
  const markupPercent = clampPercent(params.markupPercent);

  const summary = calculateQuoteSummary({
    materialsTotalCOP,
    effectiveMinutes: effectiveMinutesUsed,
    hourlyRateCOP,
    indirectCostsCOP: manualIndirectCostsCOP,
    packagingCostCOP,
    shippingOrOtherCOP,
    markupPercent,
    rentPercent,
    electricityPercent,
    internetPercent,
    wasteContingencyPercent,
    currency,
  });

  const indirectCostsCOP = roundCurrencyAmount(
    manualIndirectCostsCOP +
      summary.fixedServicesIndirectCOP +
      summary.wasteContingencyCOP,
    currency,
  );

  const finalAgreedPriceCOP =
    typeof params.finalAgreedPriceCOP === 'number' &&
    Number.isFinite(params.finalAgreedPriceCOP)
      ? Math.max(0, roundCurrencyAmount(params.finalAgreedPriceCOP, currency))
      : null;

  return {
    normalizedLines,
    materialsTotalCOP: summary.materialsTotalCOP,
    effectiveHoursUsed: summary.effectiveHours,
    effectiveMinutesUsed,
    hourlyRateCOP,
    laborTotalCOP: summary.laborTotalCOP,
    manualIndirectCostsCOP,
    rentPercent,
    electricityPercent,
    internetPercent,
    wasteContingencyPercent,
    fixedServicesIndirectCOP: summary.fixedServicesIndirectCOP,
    wasteContingencyCOP: summary.wasteContingencyCOP,
    indirectCostsCOP,
    packagingCostCOP,
    shippingOrOtherCOP,
    totalProductionCostCOP: summary.totalProductionCostCOP,
    markupPercent: summary.markupPercent,
    grossMarginPercent: summary.grossMarginPercent,
    expectedProfitCOP: summary.expectedProfitCOP,
    suggestedPriceCOP: summary.suggestedPriceCOP,
    finalAgreedPriceCOP,
  };
}

export function buildNewQuoteEntity(
  input: CreateQuoteInput,
  nowIso: string = new Date().toISOString(),
  id: string = createQuoteId(),
): Quote {
  const cleanTitle = input.title.trim();
  if (!cleanTitle) {
    throw new Error('El título de la cotización es obligatorio.');
  }

  const pricing = computeQuoteSnapshotPricing({
    materialsSnapshot: input.materialsSnapshot,
    effectiveMinutesUsed: input.effectiveMinutesUsed,
    hourlyRateCOP: input.hourlyRateCOP,
    manualIndirectCostsCOP: input.manualIndirectCostsCOP,
    rentPercent: input.rentPercent,
    electricityPercent: input.electricityPercent,
    internetPercent: input.internetPercent,
    wasteContingencyPercent: input.wasteContingencyPercent,
    packagingCostCOP: input.packagingCostCOP,
    shippingOrOtherCOP: input.shippingOrOtherCOP,
    markupPercent: input.markupPercent,
    finalAgreedPriceCOP: input.finalAgreedPriceCOP,
  });

  return {
    id,
    ownerId: 'local-workshop',
    syncStatus: 'local_only',
    version: 1,
    isDemo: Boolean(input.isDemo),
    createdAt: nowIso,
    updatedAt: nowIso,
    projectId: input.projectId ? input.projectId : null,
    clientId: input.clientId ? input.clientId : null,
    title: cleanTitle,
    currency: getActiveCurrency(),
    materialsSnapshot: pricing.normalizedLines,
    materialsTotalCOP: pricing.materialsTotalCOP,
    effectiveHoursUsed: pricing.effectiveHoursUsed,
    effectiveMinutesUsed: pricing.effectiveMinutesUsed,
    hourlyRateCOP: pricing.hourlyRateCOP,
    laborTotalCOP: pricing.laborTotalCOP,
    manualIndirectCostsCOP: pricing.manualIndirectCostsCOP,
    rentPercent: pricing.rentPercent,
    electricityPercent: pricing.electricityPercent,
    internetPercent: pricing.internetPercent,
    wasteContingencyPercent: pricing.wasteContingencyPercent,
    fixedServicesIndirectCOP: pricing.fixedServicesIndirectCOP,
    wasteContingencyCOP: pricing.wasteContingencyCOP,
    indirectCostsCOP: pricing.indirectCostsCOP,
    packagingCostCOP: pricing.packagingCostCOP,
    shippingOrOtherCOP: pricing.shippingOrOtherCOP,
    totalProductionCostCOP: pricing.totalProductionCostCOP,
    markupPercent: pricing.markupPercent,
    grossMarginPercent: pricing.grossMarginPercent,
    expectedProfitCOP: pricing.expectedProfitCOP,
    suggestedPriceCOP: pricing.suggestedPriceCOP,
    finalAgreedPriceCOP: pricing.finalAgreedPriceCOP,
    status: input.status ?? 'draft',
    notes: (input.notes ?? '').trim(),
  };
}

export function applyQuoteUpdates(
  existing: Quote,
  updates: UpdateQuoteInput,
  nowIso: string = new Date().toISOString(),
): Quote {
  const nextTitle =
    updates.title !== undefined ? updates.title.trim() : existing.title;
  if (!nextTitle) {
    throw new Error('El título de la cotización no puede quedar vacío.');
  }

  const inferredMinutes =
    existing.effectiveMinutesUsed ?? Math.round(existing.effectiveHoursUsed * 60);
  const inferredManualIndirect =
    existing.manualIndirectCostsCOP ??
    Math.max(
      0,
      existing.indirectCostsCOP -
        (existing.fixedServicesIndirectCOP ?? 0) -
        (existing.wasteContingencyCOP ?? 0),
    );

  const pricing = computeQuoteSnapshotPricing({
    materialsSnapshot: updates.materialsSnapshot ?? existing.materialsSnapshot,
    effectiveMinutesUsed: updates.effectiveMinutesUsed ?? inferredMinutes,
    hourlyRateCOP: updates.hourlyRateCOP ?? existing.hourlyRateCOP,
    manualIndirectCostsCOP:
      updates.manualIndirectCostsCOP ?? inferredManualIndirect,
    rentPercent: updates.rentPercent ?? existing.rentPercent ?? 0,
    electricityPercent:
      updates.electricityPercent ?? existing.electricityPercent ?? 0,
    internetPercent: updates.internetPercent ?? existing.internetPercent ?? 0,
    wasteContingencyPercent:
      updates.wasteContingencyPercent ?? existing.wasteContingencyPercent ?? 0,
    packagingCostCOP: updates.packagingCostCOP ?? existing.packagingCostCOP,
    shippingOrOtherCOP: updates.shippingOrOtherCOP ?? existing.shippingOrOtherCOP,
    markupPercent: updates.markupPercent ?? existing.markupPercent,
    finalAgreedPriceCOP:
      updates.finalAgreedPriceCOP !== undefined
        ? updates.finalAgreedPriceCOP
        : existing.finalAgreedPriceCOP,
  });

  return {
    ...existing,
    version: existing.version + 1,
    updatedAt: nowIso,
    projectId:
      updates.projectId !== undefined
        ? updates.projectId || null
        : existing.projectId,
    clientId:
      updates.clientId !== undefined
        ? updates.clientId || null
        : existing.clientId,
    title: nextTitle,
    materialsSnapshot: pricing.normalizedLines,
    materialsTotalCOP: pricing.materialsTotalCOP,
    effectiveHoursUsed: pricing.effectiveHoursUsed,
    effectiveMinutesUsed: pricing.effectiveMinutesUsed,
    hourlyRateCOP: pricing.hourlyRateCOP,
    laborTotalCOP: pricing.laborTotalCOP,
    manualIndirectCostsCOP: pricing.manualIndirectCostsCOP,
    rentPercent: pricing.rentPercent,
    electricityPercent: pricing.electricityPercent,
    internetPercent: pricing.internetPercent,
    wasteContingencyPercent: pricing.wasteContingencyPercent,
    fixedServicesIndirectCOP: pricing.fixedServicesIndirectCOP,
    wasteContingencyCOP: pricing.wasteContingencyCOP,
    indirectCostsCOP: pricing.indirectCostsCOP,
    packagingCostCOP: pricing.packagingCostCOP,
    shippingOrOtherCOP: pricing.shippingOrOtherCOP,
    totalProductionCostCOP: pricing.totalProductionCostCOP,
    markupPercent: pricing.markupPercent,
    grossMarginPercent: pricing.grossMarginPercent,
    expectedProfitCOP: pricing.expectedProfitCOP,
    suggestedPriceCOP: pricing.suggestedPriceCOP,
    finalAgreedPriceCOP: pricing.finalAgreedPriceCOP,
    status: updates.status ?? existing.status,
    notes: updates.notes !== undefined ? updates.notes.trim() : existing.notes,
  };
}

export function calculateAgreedPriceMetrics(
  totalProductionCostCOP: MoneyCOP,
  effectivePriceCOP: MoneyCOP,
  currency: WorkshopCurrencyCode = getActiveCurrency(),
): AgreedPriceMetrics {
  const safeCost = Math.max(0, roundCurrencyAmount(totalProductionCostCOP, currency));
  const safePrice = Math.max(0, roundCurrencyAmount(effectivePriceCOP, currency));
  const profitAtAgreedCOP = roundCurrencyAmount(safePrice - safeCost, currency);
  const grossMarginAtAgreedPercent =
    safePrice > 0
      ? Number(((profitAtAgreedCOP / safePrice) * 100).toFixed(2))
      : 0;
  const markupAtAgreedPercent =
    safeCost > 0
      ? Number(((profitAtAgreedCOP / safeCost) * 100).toFixed(2))
      : 0;

  return {
    effectivePriceCOP: safePrice,
    profitAtAgreedCOP,
    grossMarginAtAgreedPercent,
    markupAtAgreedPercent,
    isBelowCost: safePrice > 0 && safePrice < safeCost,
  };
}

export function extractProjectQuotePrefill(params: {
  readonly project: Project;
  readonly components: ProjectComponent[];
  readonly variants: MaterialVariant[];
  readonly materials: Material[];
  readonly reservations: InventoryReservation[];
  readonly movements: InventoryMovement[];
}): ProjectQuotePrefill {
  const {
    project,
    components,
    variants,
    materials,
    reservations,
    movements,
  } = params;

  const projComponents = components.filter((c) => c.projectId === project.id);
  const effectiveMinutesLogged = projComponents.reduce(
    (sum, c) => sum + Math.max(0, c.effectiveMinutesSpent),
    0,
  );
  const componentEstimatedMinutes = projComponents.reduce(
    (sum, c) => sum + Math.max(0, c.estimatedMinutes),
    0,
  );
  const estimatedMinutesPlanned =
    componentEstimatedMinutes > 0
      ? componentEstimatedMinutes
      : Math.max(0, project.targetTotalMinutes);

  const recommendedMinutes =
    effectiveMinutesLogged > 0
      ? effectiveMinutesLogged
      : estimatedMinutesPlanned;

  const variantById = new Map(variants.map((v) => [v.id, v]));
  const materialById = new Map(materials.map((m) => [m.id, m]));
  const qtyByVariant = new Map<string, number>();

  for (const res of reservations) {
    if (res.projectId !== project.id || res.status === 'released') continue;
    const allocated = Math.max(res.consumedQuantity, res.reservedQuantity);
    if (allocated <= 0) continue;
    qtyByVariant.set(
      res.variantId,
      roundQuantity((qtyByVariant.get(res.variantId) ?? 0) + allocated),
    );
  }

  for (const mov of movements) {
    if (
      mov.projectId !== project.id ||
      mov.type !== 'PROJECT_CONSUMPTION' ||
      mov.reservationId !== null
    ) {
      continue;
    }
    const directQty = Math.abs(mov.quantityDelta);
    if (directQty <= 0) continue;
    qtyByVariant.set(
      mov.variantId,
      roundQuantity((qtyByVariant.get(mov.variantId) ?? 0) + directQty),
    );
  }

  const materialLines: QuoteMaterialLine[] = [];
  for (const [variantId, quantity] of qtyByVariant.entries()) {
    const variant = variantById.get(variantId);
    if (!variant || quantity <= 0) continue;
    const material = materialById.get(variant.materialId);
    const unitCostCOP = Math.max(0, roundUnitCostAmount(variant.unitCostCOP));
    materialLines.push({
      variantId: variant.id,
      label: material?.name ?? 'Material',
      colorName: variant.colorName,
      unit: material?.unit ?? 'unit',
      quantity,
      unitCostCOP,
      subtotalCOP: roundCurrencyAmount(quantity * unitCostCOP),
    });
  }

  return {
    projectId: project.id,
    clientId: project.clientId,
    title: `Cotización — ${project.name}`,
    effectiveMinutesLogged,
    estimatedMinutesPlanned,
    recommendedMinutes,
    materialLines,
  };
}

export function buildWorkshopDefaultPercents(settings: WorkshopSettings) {
  return {
    hourlyRateCOP: settings.hourlyRateCOP,
    markupPercent: settings.defaultMarkupPercent,
    rentPercent: settings.rentCostPercent,
    electricityPercent: settings.electricityCostPercent,
    internetPercent: settings.internetCostPercent,
    wasteContingencyPercent: settings.wasteAndContingencyPercent,
  };
}

/**
 * Genera un resumen limpio y comercial para compartir con el cliente (ej. WhatsApp)
 * sin exponer costos internos, tarifa/hora del taller, indirectos ni márgenes.
 */
export function formatQuoteClientSummaryText(params: {
  readonly title: string;
  readonly workshopName: string;
  readonly clientName?: string | null;
  readonly projectName?: string | null;
  readonly dateIso?: string;
  readonly estimatedMinutes: number;
  readonly materials: Array<{
    readonly label: string;
    readonly colorName: string;
    readonly quantity: number;
    readonly unit?: string;
  }>;
  readonly includesPackaging: boolean;
  readonly includesShipping: boolean;
  readonly finalPriceCOP: MoneyCOP;
  readonly notes?: string;
}): string {
  const lines: string[] = [
    `*${params.workshopName}*`,
    `Cotización: ${params.title.trim() || 'Proyecto tejido a mano'}`,
    `Fecha: ${formatDateCO(params.dateIso ?? new Date().toISOString())}`,
  ];

  if (params.clientName?.trim()) {
    lines.push(`Cliente: ${params.clientName.trim()}`);
  }
  if (params.projectName?.trim()) {
    lines.push(`Referencia: ${params.projectName.trim()}`);
  }

  lines.push('');
  if (params.estimatedMinutes > 0) {
    lines.push(
      `• Tiempo artesanal estimado: ${formatDurationMinutes(params.estimatedMinutes)}`,
    );
  }

  if (params.materials.length > 0) {
    lines.push('• Materiales contemplados:');
    for (const item of params.materials) {
      const unitStr = item.unit ? ` ${item.unit}` : '';
      lines.push(
        `  - ${item.label} (${item.colorName}): ${item.quantity}${unitStr}`,
      );
    }
  }

  if (params.includesPackaging) {
    lines.push('• Incluye presentación / empaque');
  }
  if (params.includesShipping) {
    lines.push('• Incluye envío / entrega coordinada');
  }

  lines.push('');
  lines.push(`*Valor total estimado: ${formatCOP(params.finalPriceCOP)} ${getActiveCurrency()}*`);

  if (params.notes?.trim()) {
    lines.push('');
    lines.push(`Notas: ${params.notes.trim()}`);
  }

  return lines.join('\n');
}

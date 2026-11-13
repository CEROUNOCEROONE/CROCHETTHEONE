import type { MoneyCOP } from '@/src/domain/models/index.ts';

export interface QuoteCalculationInput {
  readonly materialsTotalCOP: MoneyCOP;
  readonly effectiveMinutes: number;
  readonly hourlyRateCOP: MoneyCOP;
  readonly indirectCostsCOP: MoneyCOP;
  readonly packagingCostCOP: MoneyCOP;
  readonly shippingOrOtherCOP: MoneyCOP;
  readonly markupPercent: number;
}

export interface QuoteCalculationResult {
  readonly materialsTotalCOP: MoneyCOP;
  readonly effectiveHours: number;
  readonly laborTotalCOP: MoneyCOP;
  readonly indirectAndPackagingCOP: MoneyCOP;
  readonly totalProductionCostCOP: MoneyCOP;
  readonly markupPercent: number;
  readonly suggestedPriceCOP: MoneyCOP;
  readonly expectedProfitCOP: MoneyCOP;
  readonly grossMarginPercent: number;
}

/**
 * Fórmula principal aprobada: Recargo sobre el costo (Markup).
 * Precio de venta = Costo total * (1 + porcentaje de recargo / 100)
 * También calcula el margen real sobre el precio de venta para transparencia financiera.
 */
export function calculateQuoteSummary(input: QuoteCalculationInput): QuoteCalculationResult {
  const materialsTotalCOP = Math.max(0, Math.round(input.materialsTotalCOP));
  const effectiveHours = Math.max(0, input.effectiveMinutes) / 60;
  const laborTotalCOP = Math.round(effectiveHours * Math.max(0, input.hourlyRateCOP));
  const indirectAndPackagingCOP = Math.max(
    0,
    Math.round(input.indirectCostsCOP + input.packagingCostCOP + input.shippingOrOtherCOP),
  );
  const totalProductionCostCOP = materialsTotalCOP + laborTotalCOP + indirectAndPackagingCOP;

  const safeMarkupPercent = Math.max(0, input.markupPercent);
  const suggestedPriceCOP = Math.round(totalProductionCostCOP * (1 + safeMarkupPercent / 100));
  const expectedProfitCOP = suggestedPriceCOP - totalProductionCostCOP;
  const grossMarginPercent =
    suggestedPriceCOP > 0
      ? Number(((expectedProfitCOP / suggestedPriceCOP) * 100).toFixed(2))
      : 0;

  return {
    materialsTotalCOP,
    effectiveHours: Number(effectiveHours.toFixed(2)),
    laborTotalCOP,
    indirectAndPackagingCOP,
    totalProductionCostCOP,
    markupPercent: Number(safeMarkupPercent.toFixed(2)),
    suggestedPriceCOP,
    expectedProfitCOP,
    grossMarginPercent,
  };
}

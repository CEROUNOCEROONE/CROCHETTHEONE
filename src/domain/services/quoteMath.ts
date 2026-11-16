import type { MoneyCOP } from '@/src/domain/models/index.ts';
import {
  roundCurrencyAmount,
  type WorkshopCurrencyCode,
} from './currencyCatalog.ts';
import { getActiveCurrency } from './formatters.ts';

export interface QuoteCalculationInput {
  readonly materialsTotalCOP: MoneyCOP;
  readonly effectiveMinutes: number;
  readonly hourlyRateCOP: MoneyCOP;
  readonly indirectCostsCOP: MoneyCOP;
  readonly packagingCostCOP: MoneyCOP;
  readonly shippingOrOtherCOP: MoneyCOP;
  readonly markupPercent: number;
  readonly rentPercent?: number;
  readonly electricityPercent?: number;
  readonly internetPercent?: number;
  readonly wasteContingencyPercent?: number;
  readonly currency?: WorkshopCurrencyCode;
}

export interface QuoteCalculationResult {
  readonly materialsTotalCOP: MoneyCOP;
  readonly effectiveHours: number;
  readonly laborTotalCOP: MoneyCOP;
  readonly directBaseCostCOP: MoneyCOP;
  readonly fixedServicesIndirectCOP: MoneyCOP;
  readonly wasteContingencyCOP: MoneyCOP;
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
 * Integra porcentajes de costos fijos (arriendo, electricidad, internet) e
 * imprevistos/desperdicios sobre la base directa (materiales + mano de obra),
 * y calcula el margen real sobre el precio de venta para transparencia financiera.
 */
export function calculateQuoteSummary(input: QuoteCalculationInput): QuoteCalculationResult {
  const currency = input.currency ?? getActiveCurrency();
  const roundMoney = (val: number) =>
    Math.max(0, roundCurrencyAmount(val, currency));

  const materialsTotalCOP = roundMoney(input.materialsTotalCOP);
  const effectiveHours = Math.max(0, input.effectiveMinutes) / 60;
  const laborTotalCOP = roundMoney(effectiveHours * Math.max(0, input.hourlyRateCOP));
  const directBaseCostCOP = roundMoney(materialsTotalCOP + laborTotalCOP);

  const fixedPercentSum =
    Math.max(0, input.rentPercent ?? 0) +
    Math.max(0, input.electricityPercent ?? 0) +
    Math.max(0, input.internetPercent ?? 0);
  const fixedServicesIndirectCOP = roundMoney(
    directBaseCostCOP * (fixedPercentSum / 100),
  );

  const safeWastePercent = Math.max(0, input.wasteContingencyPercent ?? 0);
  const wasteContingencyCOP = roundMoney(
    directBaseCostCOP * (safeWastePercent / 100),
  );

  const indirectAndPackagingCOP = roundMoney(
    Math.max(0, input.indirectCostsCOP) +
      fixedServicesIndirectCOP +
      wasteContingencyCOP +
      Math.max(0, input.packagingCostCOP) +
      Math.max(0, input.shippingOrOtherCOP),
  );
  const totalProductionCostCOP = roundMoney(
    directBaseCostCOP + indirectAndPackagingCOP,
  );

  const safeMarkupPercent = Math.max(0, input.markupPercent);
  const suggestedPriceCOP = roundMoney(
    totalProductionCostCOP * (1 + safeMarkupPercent / 100),
  );
  const expectedProfitCOP = roundCurrencyAmount(
    suggestedPriceCOP - totalProductionCostCOP,
    currency,
  );
  const grossMarginPercent =
    suggestedPriceCOP > 0
      ? Number(((expectedProfitCOP / suggestedPriceCOP) * 100).toFixed(2))
      : 0;

  return {
    materialsTotalCOP,
    effectiveHours: Number(effectiveHours.toFixed(2)),
    laborTotalCOP,
    directBaseCostCOP,
    fixedServicesIndirectCOP,
    wasteContingencyCOP,
    indirectAndPackagingCOP,
    totalProductionCostCOP,
    markupPercent: Number(safeMarkupPercent.toFixed(2)),
    suggestedPriceCOP,
    expectedProfitCOP,
    grossMarginPercent,
  };
}

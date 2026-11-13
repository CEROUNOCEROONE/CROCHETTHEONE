import type { BaseEntity, MoneyCOP } from './common.ts';

export type QuoteStatus = 'draft' | 'sent' | 'approved' | 'rejected';

export interface QuoteMaterialLine {
  readonly variantId: string | null;
  readonly label: string;
  readonly colorName: string;
  readonly quantity: number;
  readonly unitCostCOP: MoneyCOP;
  readonly subtotalCOP: MoneyCOP;
}

export interface Quote extends BaseEntity {
  readonly projectId: string | null;
  readonly clientId: string | null;
  readonly title: string;
  readonly currency: 'COP';
  readonly materialsSnapshot: QuoteMaterialLine[];
  readonly materialsTotalCOP: MoneyCOP;
  readonly effectiveHoursUsed: number;
  readonly hourlyRateCOP: MoneyCOP;
  readonly laborTotalCOP: MoneyCOP;
  readonly indirectCostsCOP: MoneyCOP;
  readonly packagingCostCOP: MoneyCOP;
  readonly shippingOrOtherCOP: MoneyCOP;
  readonly totalProductionCostCOP: MoneyCOP;
  readonly markupPercent: number;
  readonly grossMarginPercent: number;
  readonly expectedProfitCOP: MoneyCOP;
  readonly suggestedPriceCOP: MoneyCOP;
  readonly finalAgreedPriceCOP: MoneyCOP | null;
  readonly status: QuoteStatus;
  readonly notes: string;
}

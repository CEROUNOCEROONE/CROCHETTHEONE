import type {
  BaseEntity,
  ISODate,
  MoneyCOP,
  WorkshopPlanMetadata,
} from './common.ts';
import type { WorkshopCurrencyCode } from '@/src/domain/services/currencyCatalog.ts';

export interface WorkshopSettings extends BaseEntity {
  readonly id: 'default';
  readonly workshopInstanceId: string;
  readonly plan: WorkshopPlanMetadata;
  readonly workshopName: string;
  readonly ownerDisplayName: string;
  readonly hourlyRateCOP: MoneyCOP;
  readonly dailyGoalMinutes: number;
  readonly weeklyGoalMinutes: number;
  readonly defaultMarkupPercent: number;
  readonly rentCostPercent: number;
  readonly electricityCostPercent: number;
  readonly internetCostPercent: number;
  readonly wasteAndContingencyPercent: number;
  readonly currency: WorkshopCurrencyCode;
  readonly demoDataLoaded: boolean;
  readonly lastBackupExportAt: ISODate | null;
  readonly reminderLeadDaysDelivery?: number;
  readonly reminderLeadDaysInstallment?: number;
  readonly reminderLeadDaysPurchase?: number;
  readonly enableDeliveryReminders?: boolean;
  readonly enableInstallmentReminders?: boolean;
  readonly enablePurchaseReminders?: boolean;
  readonly enableLowStockReminders?: boolean;
  readonly customMaterialCategories?: string[];
}

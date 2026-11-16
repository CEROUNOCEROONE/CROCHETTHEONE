import type { BaseEntity, ISODate, MoneyCOP } from './common.ts';

export interface WorkshopSettings extends BaseEntity {
  readonly id: 'default';
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
  readonly currency: 'COP';
  readonly demoDataLoaded: boolean;
  readonly lastBackupExportAt: ISODate | null;
  readonly reminderLeadDaysDelivery?: number;
  readonly reminderLeadDaysInstallment?: number;
  readonly reminderLeadDaysPurchase?: number;
  readonly enableDeliveryReminders?: boolean;
  readonly enableInstallmentReminders?: boolean;
  readonly enablePurchaseReminders?: boolean;
  readonly enableLowStockReminders?: boolean;
}

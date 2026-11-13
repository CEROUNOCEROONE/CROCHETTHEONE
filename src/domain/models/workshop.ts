import type { BaseEntity, ISODate, MoneyCOP } from './common.ts';

export interface WorkshopSettings extends BaseEntity {
  readonly id: 'default';
  readonly workshopName: string;
  readonly ownerDisplayName: string;
  readonly hourlyRateCOP: MoneyCOP;
  readonly dailyGoalMinutes: number;
  readonly weeklyGoalMinutes: number;
  readonly defaultMarkupPercent: number;
  readonly currency: 'COP';
  readonly demoDataLoaded: boolean;
  readonly lastBackupExportAt: ISODate | null;
}

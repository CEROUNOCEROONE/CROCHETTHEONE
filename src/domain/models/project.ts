import type { BaseEntity, ISODate, MoneyCOP } from './common.ts';

export type ProjectStatus =
  | 'pending'
  | 'planning'
  | 'in_progress'
  | 'paused'
  | 'completed'
  | 'delivered'
  | 'cancelled';

export type ComponentStatus =
  | 'pending'
  | 'blocked_by_material'
  | 'in_progress'
  | 'completed';

export type ProjectPaymentSummaryStatus =
  | 'not_applicable'
  | 'unpaid'
  | 'deposit_received'
  | 'partial'
  | 'pending'
  | 'paid'
  | 'overdue';

export interface Project extends BaseEntity {
  readonly name: string;
  readonly description: string;
  readonly referencePhotoUrl: string | null;
  readonly clientId: string | null;
  readonly patternId: string | null;
  readonly startDate: ISODate | null;
  readonly estimatedEndDate: ISODate | null;
  readonly targetTotalMinutes: number;
  readonly dailyGoalMinutes: number;
  readonly weeklyGoalMinutes: number;
  readonly estimatedBudgetCOP: MoneyCOP;
  readonly status: ProjectStatus;
  readonly paymentStatus: ProjectPaymentSummaryStatus;
  readonly notes: string;
}

export interface ProjectComponent extends BaseEntity {
  readonly projectId: string;
  readonly name: string;
  readonly orderIndex: number;
  readonly estimatedMinutes: number;
  readonly effectiveMinutesSpent: number;
  readonly status: ComponentStatus;
  readonly requiredVariantIds: string[];
  readonly notes: string;
}

import type { BaseEntity, ISODate } from './common.ts';

export type TaskStatus = 'scheduled' | 'blocked_by_material' | 'completed' | 'rescheduled';

export type ReminderType =
  | 'work_session'
  | 'component_goal'
  | 'pending_purchase'
  | 'material_arrival'
  | 'low_stock'
  | 'installment_due'
  | 'social_recording'
  | 'delivery_deadline';

export interface ScheduledTask extends BaseEntity {
  readonly projectId: string;
  readonly componentId: string | null;
  readonly title: string;
  readonly scheduledDate: ISODate;
  readonly allocatedMinutes: number;
  readonly completedMinutes: number;
  readonly dependsOnPendingMaterialId: string | null;
  readonly status: TaskStatus;
  readonly notes: string;
}

export interface Reminder extends BaseEntity {
  readonly type: ReminderType;
  readonly title: string;
  readonly message: string;
  readonly triggerAt: ISODate;
  readonly relatedEntityId: string | null;
  readonly isRead: boolean;
  readonly isCompleted: boolean;
}

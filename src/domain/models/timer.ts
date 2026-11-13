import type { BaseEntity, ISODate } from './common.ts';

export type WorkSessionStatus = 'running' | 'paused' | 'completed';
export type WorkSessionEntryType = 'timer' | 'manual' | 'adjusted';

export interface PauseInterval {
  readonly pausedAt: ISODate;
  readonly resumedAt: ISODate | null;
}

export interface WorkSession extends BaseEntity {
  readonly projectId: string;
  readonly componentId: string;
  readonly startTime: ISODate;
  readonly endTime: ISODate | null;
  readonly status: WorkSessionStatus;
  readonly pauseIntervals: PauseInterval[];
  readonly elapsedSeconds: number;
  readonly effectiveSeconds: number;
  readonly entryType: WorkSessionEntryType;
  readonly adjustmentReason: string | null;
  readonly notes: string;
}

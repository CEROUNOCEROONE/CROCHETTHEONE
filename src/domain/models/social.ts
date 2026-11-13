import type { BaseEntity, ISODate } from './common.ts';

export type SocialStage =
  | 'before_start'
  | 'during_component'
  | 'assembly'
  | 'final_result';

export type SocialPlatform =
  | 'tiktok'
  | 'instagram_reels'
  | 'instagram_post'
  | 'youtube_shorts'
  | 'other';

export type SocialContentStatus =
  | 'idea'
  | 'scheduled_to_record'
  | 'recorded'
  | 'edited'
  | 'published';

export interface SocialContentItem extends BaseEntity {
  readonly projectId: string;
  readonly componentId: string | null;
  readonly stage: SocialStage;
  readonly platform: SocialPlatform;
  readonly title: string;
  readonly hookIdea: string;
  readonly status: SocialContentStatus;
  readonly scheduledDate: ISODate | null;
  readonly notes: string;
}

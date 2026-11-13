import type { BaseEntity, ISODate, MoneyCOP } from './common.ts';

export type PatternDifficulty = 'beginner' | 'intermediate' | 'advanced';

export interface Pattern extends BaseEntity {
  readonly name: string;
  readonly coverPhotoUrl: string | null;
  readonly referencePhotos: string[];
  readonly description: string;
  readonly difficulty: PatternDifficulty;
  readonly requiredMaterialsSummary: string;
  readonly estimatedMinutes: number;
  readonly approxSizeCm: string;
  readonly instructionsContent: string;
  readonly isFree: boolean;
  readonly priceCOP: MoneyCOP;
  readonly category: string;
}

export interface PatternPurchase extends BaseEntity {
  readonly patternId: string;
  readonly purchaseDate: ISODate;
  readonly amountPaidCOP: MoneyCOP;
  readonly accessGranted: boolean;
}

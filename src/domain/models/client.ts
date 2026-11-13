import type { BaseEntity } from './common.ts';

export interface Client extends BaseEntity {
  readonly name: string;
  readonly phone: string;
  readonly email: string | null;
  readonly address: string | null;
  readonly notes: string;
}

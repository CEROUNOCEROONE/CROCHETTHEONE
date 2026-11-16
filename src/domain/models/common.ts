/**
 * Tipos base y metadatos compartidos por todas las entidades persistentes.
 * Garantizan unicidad, trazabilidad temporal, aislamiento de ejemplos (isDemo)
 * y compatibilidad futura con sincronización en la nube.
 */
export type ISODate = string;
export type MoneyCOP = number;
export type SyncStatus = 'local_only' | 'pending_sync' | 'synced';

export interface SyncMetadata {
  readonly id: string;
  readonly ownerId: string;
  readonly syncStatus: SyncStatus;
  readonly version: number;
  readonly isDemo: boolean;
  readonly createdAt: ISODate;
  readonly updatedAt: ISODate;
}

export type BaseEntity = SyncMetadata;

export interface SchemaMigrationRecord {
  readonly version: number;
  readonly name: string;
  readonly appliedAt: ISODate;
}

export interface SchemaMeta {
  readonly id: 'schema';
  readonly currentVersion: number;
  readonly appliedMigrations: SchemaMigrationRecord[];
  readonly lastMigratedAt: ISODate;
}

export type WorkshopStoreName =
  | '_meta_schema'
  | 'workshop_settings'
  | 'projects'
  | 'project_components'
  | 'work_sessions'
  | 'materials'
  | 'material_variants'
  | 'inventory_reservations'
  | 'pending_materials'
  | 'notes_and_lists'
  | 'shopping_list_items'
  | 'purchase_receipts'
  | 'inventory_movements'
  | 'clients'
  | 'quotes'
  | 'payment_plans'
  | 'payment_installments'
  | 'financial_transactions'
  | 'planned_tasks'
  | 'reminders';

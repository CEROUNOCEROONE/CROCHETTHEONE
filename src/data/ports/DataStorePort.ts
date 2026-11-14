import type {
  BaseEntity,
  Client,
  FinancialTransaction,
  InventoryMovement,
  InventoryReservation,
  Material,
  MaterialVariant,
  PaymentInstallment,
  PaymentPlan,
  Project,
  ProjectComponent,
  SchemaMeta,
  WorkSession,
  WorkshopSettings,
  WorkshopStoreName,
} from '@/src/domain/models/index.ts';
import type { WorkshopSnapshotInput } from '@/src/domain/services/workshopStats.ts';

export interface DataStorePort<T extends BaseEntity> {
  readonly storeName: WorkshopStoreName;
  getById(id: string): Promise<T | null>;
  getAll(): Promise<T[]>;
  queryByIndex(indexName: string, value: IDBValidKey): Promise<T[]>;
  upsert(entity: T): Promise<T>;
  remove(id: string): Promise<void>;
  count(): Promise<number>;
}

export type BackupImportStrategy = 'append_new' | 'merge_overwrite' | 'replace_all';

export interface BackupEnvelope {
  readonly format: 'app-crochet-backup';
  readonly schemaVersion: number;
  readonly appName: string;
  readonly exportedAt: string;
  readonly includeDemo: boolean;
  readonly recordCounts: Partial<Record<WorkshopStoreName, number>>;
  readonly data: Partial<Record<WorkshopStoreName, BaseEntity[]>>;
}

export interface BackupInspectionResult {
  readonly isValid: boolean;
  readonly errors: string[];
  readonly warnings: string[];
  readonly envelope: BackupEnvelope | null;
  readonly totalRecordsInFile: number;
  readonly newRecordsCount: number;
  readonly duplicateRecordsCount: number;
  readonly existingLocalRecordsCount: number;
  readonly breakdownByStore: Array<{
    readonly storeName: WorkshopStoreName;
    readonly inFile: number;
    readonly newCount: number;
    readonly duplicateCount: number;
  }>;
}

export interface BackupImportOutcome {
  readonly strategy: BackupImportStrategy;
  readonly insertedCount: number;
  readonly updatedCount: number;
  readonly skippedCount: number;
}

export interface DemoPurgeOutcome {
  readonly deletedCount: number;
  readonly preservedRealCount: number;
}

import type {
  CreateComponentInput,
  CreateProjectInput,
  UpdateComponentInput,
  UpdateProjectInput,
} from '@/src/domain/services/projectService.ts';
import type {
  AdjustStockInput,
  ConsumeFromReservationInput,
  CreateMaterialInput,
  CreateReservationInput,
  CreateVariantInput,
  DirectConsumptionInput,
  UpdateMaterialInput,
  UpdateVariantMetadataInput,
} from '@/src/domain/services/inventoryService.ts';

export interface FinishTimerSessionOptions {
  readonly overrideEffectiveMinutes?: number;
  readonly adjustmentReason?: string;
  readonly notes?: string;
}

export interface ManualWorkSessionInput {
  readonly projectId: string;
  readonly componentId: string;
  readonly effectiveMinutes: number;
  readonly workDateIso?: string;
  readonly notes?: string;
}

export interface WorkshopDataEngine {
  readonly settings: DataStorePort<WorkshopSettings>;
  readonly projects: DataStorePort<Project>;
  readonly components: DataStorePort<ProjectComponent>;
  readonly workSessions: DataStorePort<WorkSession>;
  readonly materials: DataStorePort<Material>;
  readonly variants: DataStorePort<MaterialVariant>;
  readonly reservations: DataStorePort<InventoryReservation>;
  readonly movements: DataStorePort<InventoryMovement>;
  readonly clients: DataStorePort<Client>;
  readonly paymentPlans: DataStorePort<PaymentPlan>;
  readonly installments: DataStorePort<PaymentInstallment>;
  readonly transactions: DataStorePort<FinancialTransaction>;

  getSchemaMeta(): Promise<SchemaMeta | null>;
  loadWorkshopSnapshot(): Promise<WorkshopSnapshotInput>;
  saveWorkshopSettings(
    partial: Partial<
      Pick<
        WorkshopSettings,
        | 'workshopName'
        | 'ownerDisplayName'
        | 'hourlyRateCOP'
        | 'dailyGoalMinutes'
        | 'weeklyGoalMinutes'
        | 'defaultMarkupPercent'
      >
    >,
  ): Promise<WorkshopSettings>;
  createProject(input: CreateProjectInput): Promise<Project>;
  updateProject(projectId: string, updates: UpdateProjectInput): Promise<Project>;
  deleteProjectCascade(projectId: string): Promise<void>;
  createComponent(input: CreateComponentInput): Promise<ProjectComponent>;
  updateComponent(
    componentId: string,
    updates: UpdateComponentInput,
  ): Promise<ProjectComponent>;
  reorderComponent(
    componentId: string,
    direction: 'up' | 'down',
  ): Promise<void>;
  deleteComponent(componentId: string): Promise<void>;
  startTimerSession(
    projectId: string,
    componentId: string,
    notes?: string,
  ): Promise<WorkSession>;
  pauseTimerSession(sessionId: string): Promise<WorkSession>;
  resumeTimerSession(sessionId: string): Promise<WorkSession>;
  finishTimerSession(
    sessionId: string,
    options?: FinishTimerSessionOptions,
  ): Promise<WorkSession>;
  logManualWorkSession(input: ManualWorkSessionInput): Promise<WorkSession>;
  adjustCompletedWorkSession(
    sessionId: string,
    newEffectiveMinutes: number,
    adjustmentReason: string,
  ): Promise<WorkSession>;
  createMaterial(input: CreateMaterialInput): Promise<Material>;
  updateMaterial(
    materialId: string,
    updates: UpdateMaterialInput,
  ): Promise<Material>;
  deleteMaterial(materialId: string): Promise<void>;
  createVariant(input: CreateVariantInput): Promise<MaterialVariant>;
  updateVariantMetadata(
    variantId: string,
    updates: UpdateVariantMetadataInput,
  ): Promise<MaterialVariant>;
  deleteVariant(variantId: string): Promise<void>;
  adjustVariantStock(input: AdjustStockInput): Promise<MaterialVariant>;
  createReservation(input: CreateReservationInput): Promise<InventoryReservation>;
  modifyReservationQuantity(
    reservationId: string,
    nextReservedQuantity: number,
    notes?: string,
  ): Promise<InventoryReservation>;
  consumeFromReservation(
    input: ConsumeFromReservationInput,
  ): Promise<InventoryReservation>;
  releaseReservation(
    reservationId: string,
    notes?: string,
  ): Promise<InventoryReservation>;
  recordDirectProjectConsumption(
    input: DirectConsumptionInput,
  ): Promise<InventoryMovement>;
  loadDemoData(): Promise<{ insertedCount: number }>;
  purgeDemoData(): Promise<DemoPurgeOutcome>;
  exportBackup(options: { includeDemo: boolean }): Promise<BackupEnvelope>;
  inspectBackup(rawJson: string): Promise<BackupInspectionResult>;
  importBackup(
    inspection: BackupInspectionResult,
    strategy: BackupImportStrategy,
  ): Promise<BackupImportOutcome>;
}

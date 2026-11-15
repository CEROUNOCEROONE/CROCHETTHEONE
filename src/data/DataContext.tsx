import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type {
  Client,
  InventoryMovement,
  InventoryReservation,
  Material,
  MaterialVariant,
  NoteOrList,
  PendingMaterial,
  Project,
  ProjectComponent,
  PurchaseReceipt,
  SchemaMeta,
  ShoppingListItem,
  WorkSession,
  WorkshopSettings,
} from '@/src/domain/models/index.ts';
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
import type {
  CreateNoteOrListInput,
  CreatePendingMaterialInput,
  CreatePurchaseReceiptInput,
  CreateShoppingListItemInput,
  UpdateNoteOrListInput,
  UpdatePendingMaterialInput,
  UpdateShoppingListItemInput,
} from '@/src/domain/services/procurementService.ts';
import {
  computeWorkshopStats,
  type WorkshopDashboardStats,
} from '@/src/domain/services/workshopStats.ts';
import type {
  BackupEnvelope,
  BackupImportOutcome,
  BackupImportStrategy,
  BackupInspectionResult,
  DemoPurgeOutcome,
  FinishTimerSessionOptions,
  ManualWorkSessionInput,
  WorkshopDataEngine,
} from '@/src/data/ports/DataStorePort.ts';
import { localWorkshopEngine } from './local/LocalRepository.ts';
import { createDefaultWorkshopSettings } from './local/indexedDbClient.ts';

interface DataContextValue {
  readonly engine: WorkshopDataEngine;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly settings: WorkshopSettings;
  readonly projects: Project[];
  readonly components: ProjectComponent[];
  readonly workSessions: WorkSession[];
  readonly activeTimerSession: WorkSession | null;
  readonly materials: Material[];
  readonly variants: MaterialVariant[];
  readonly reservations: InventoryReservation[];
  readonly pendingMaterials: PendingMaterial[];
  readonly notesAndLists: NoteOrList[];
  readonly shoppingListItems: ShoppingListItem[];
  readonly purchaseReceipts: PurchaseReceipt[];
  readonly movements: InventoryMovement[];
  readonly clients: Client[];
  readonly stats: WorkshopDashboardStats;
  readonly schemaMeta: SchemaMeta | null;
  refresh(): Promise<void>;
  updateSettings(
    partial: Partial<
      Pick<
        WorkshopSettings,
        | 'workshopName'
        | 'ownerDisplayName'
        | 'hourlyRateCOP'
        | 'dailyGoalMinutes'
        | 'weeklyGoalMinutes'
        | 'defaultMarkupPercent'
        | 'rentCostPercent'
        | 'electricityCostPercent'
        | 'internetCostPercent'
        | 'wasteAndContingencyPercent'
      >
    >,
  ): Promise<WorkshopSettings>;
  createProject(input: CreateProjectInput): Promise<Project>;
  updateProject(projectId: string, updates: UpdateProjectInput): Promise<Project>;
  deleteProject(projectId: string): Promise<void>;
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
  createPendingMaterial(input: CreatePendingMaterialInput): Promise<PendingMaterial>;
  updatePendingMaterial(
    pendingId: string,
    updates: UpdatePendingMaterialInput,
  ): Promise<PendingMaterial>;
  deletePendingMaterial(pendingId: string): Promise<void>;
  createNoteOrList(input: CreateNoteOrListInput): Promise<NoteOrList>;
  updateNoteOrList(
    noteId: string,
    updates: UpdateNoteOrListInput,
  ): Promise<NoteOrList>;
  deleteNoteOrList(noteId: string): Promise<void>;
  createShoppingListItem(
    input: CreateShoppingListItemInput,
  ): Promise<ShoppingListItem>;
  updateShoppingListItem(
    itemId: string,
    updates: UpdateShoppingListItemInput,
  ): Promise<ShoppingListItem>;
  deleteShoppingListItem(itemId: string): Promise<void>;
  sendPendingMaterialToShoppingList(
    pendingMaterialId: string,
    listId: string,
  ): Promise<ShoppingListItem>;
  receivePurchaseReceipt(
    input: CreatePurchaseReceiptInput,
  ): Promise<PurchaseReceipt>;
  loadDemoData(): Promise<{ insertedCount: number }>;
  purgeDemoData(): Promise<DemoPurgeOutcome>;
  exportBackup(includeDemo: boolean): Promise<BackupEnvelope>;
  inspectBackup(rawJson: string): Promise<BackupInspectionResult>;
  importBackup(
    inspection: BackupInspectionResult,
    strategy: BackupImportStrategy,
  ): Promise<BackupImportOutcome>;
}

const DataContext = createContext<DataContextValue | null>(null);

const EMPTY_SETTINGS = createDefaultWorkshopSettings();
const EMPTY_STATS = computeWorkshopStats({
  settings: EMPTY_SETTINGS,
  projects: [],
  components: [],
  workSessions: [],
  materials: [],
  variants: [],
  reservations: [],
  movements: [],
  clients: [],
  paymentPlans: [],
  installments: [],
});

export const DataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<WorkshopSettings>(EMPTY_SETTINGS);
  const [projects, setProjects] = useState<Project[]>([]);
  const [components, setComponents] = useState<ProjectComponent[]>([]);
  const [workSessions, setWorkSessions] = useState<WorkSession[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [variants, setVariants] = useState<MaterialVariant[]>([]);
  const [reservations, setReservations] = useState<InventoryReservation[]>([]);
  const [pendingMaterials, setPendingMaterials] = useState<PendingMaterial[]>([]);
  const [notesAndLists, setNotesAndLists] = useState<NoteOrList[]>([]);
  const [shoppingListItems, setShoppingListItems] = useState<ShoppingListItem[]>([]);
  const [purchaseReceipts, setPurchaseReceipts] = useState<PurchaseReceipt[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [stats, setStats] = useState<WorkshopDashboardStats>(EMPTY_STATS);
  const [schemaMeta, setSchemaMeta] = useState<SchemaMeta | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const [snapshot, meta] = await Promise.all([
        localWorkshopEngine.loadWorkshopSnapshot(),
        localWorkshopEngine.getSchemaMeta(),
      ]);
      setSettings(snapshot.settings);
      setProjects(snapshot.projects);
      setComponents(snapshot.components);
      setWorkSessions(snapshot.workSessions ?? []);
      setMaterials(snapshot.materials);
      setVariants(snapshot.variants);
      setReservations(snapshot.reservations);
      setPendingMaterials(snapshot.pendingMaterials ?? []);
      setNotesAndLists(snapshot.notesAndLists ?? []);
      setShoppingListItems(snapshot.shoppingItems ?? []);
      setPurchaseReceipts(snapshot.purchaseReceipts ?? []);
      setMovements(snapshot.movements);
      setClients(snapshot.clients);
      setStats(computeWorkshopStats(snapshot));
      setSchemaMeta(meta);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Error al leer la base de datos local.',
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const updateSettings = useCallback(
    async (
      partial: Partial<
        Pick<
          WorkshopSettings,
          | 'workshopName'
          | 'ownerDisplayName'
          | 'hourlyRateCOP'
          | 'dailyGoalMinutes'
          | 'weeklyGoalMinutes'
          | 'defaultMarkupPercent'
          | 'rentCostPercent'
          | 'electricityCostPercent'
          | 'internetCostPercent'
          | 'wasteAndContingencyPercent'
        >
      >,
    ) => {
      const updated = await localWorkshopEngine.saveWorkshopSettings(partial);
      await refresh();
      return updated;
    },
    [refresh],
  );

  const createProject = useCallback(
    async (input: CreateProjectInput) => {
      const created = await localWorkshopEngine.createProject(input);
      await refresh();
      return created;
    },
    [refresh],
  );

  const updateProject = useCallback(
    async (projectId: string, updates: UpdateProjectInput) => {
      const updated = await localWorkshopEngine.updateProject(projectId, updates);
      await refresh();
      return updated;
    },
    [refresh],
  );

  const deleteProject = useCallback(
    async (projectId: string) => {
      await localWorkshopEngine.deleteProjectCascade(projectId);
      await refresh();
    },
    [refresh],
  );

  const createComponent = useCallback(
    async (input: CreateComponentInput) => {
      const created = await localWorkshopEngine.createComponent(input);
      await refresh();
      return created;
    },
    [refresh],
  );

  const updateComponent = useCallback(
    async (componentId: string, updates: UpdateComponentInput) => {
      const updated = await localWorkshopEngine.updateComponent(
        componentId,
        updates,
      );
      await refresh();
      return updated;
    },
    [refresh],
  );

  const reorderComponent = useCallback(
    async (componentId: string, direction: 'up' | 'down') => {
      await localWorkshopEngine.reorderComponent(componentId, direction);
      await refresh();
    },
    [refresh],
  );

  const deleteComponent = useCallback(
    async (componentId: string) => {
      await localWorkshopEngine.deleteComponent(componentId);
      await refresh();
    },
    [refresh],
  );

  const startTimerSession = useCallback(
    async (projectId: string, componentId: string, notes?: string) => {
      const session = await localWorkshopEngine.startTimerSession(
        projectId,
        componentId,
        notes,
      );
      await refresh();
      return session;
    },
    [refresh],
  );

  const pauseTimerSession = useCallback(
    async (sessionId: string) => {
      const session = await localWorkshopEngine.pauseTimerSession(sessionId);
      await refresh();
      return session;
    },
    [refresh],
  );

  const resumeTimerSession = useCallback(
    async (sessionId: string) => {
      const session = await localWorkshopEngine.resumeTimerSession(sessionId);
      await refresh();
      return session;
    },
    [refresh],
  );

  const finishTimerSession = useCallback(
    async (sessionId: string, options?: FinishTimerSessionOptions) => {
      const session = await localWorkshopEngine.finishTimerSession(
        sessionId,
        options,
      );
      await refresh();
      return session;
    },
    [refresh],
  );

  const logManualWorkSession = useCallback(
    async (input: ManualWorkSessionInput) => {
      const session = await localWorkshopEngine.logManualWorkSession(input);
      await refresh();
      return session;
    },
    [refresh],
  );

  const adjustCompletedWorkSession = useCallback(
    async (
      sessionId: string,
      newEffectiveMinutes: number,
      adjustmentReason: string,
    ) => {
      const session = await localWorkshopEngine.adjustCompletedWorkSession(
        sessionId,
        newEffectiveMinutes,
        adjustmentReason,
      );
      await refresh();
      return session;
    },
    [refresh],
  );

  const activeTimerSession = useMemo(() => {
    const running = workSessions.find((s) => s.status === 'running');
    if (running) return running;
    const paused = workSessions
      .filter((s) => s.status === 'paused')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return paused[0] ?? null;
  }, [workSessions]);

  const createMaterial = useCallback(
    async (input: CreateMaterialInput) => {
      const created = await localWorkshopEngine.createMaterial(input);
      await refresh();
      return created;
    },
    [refresh],
  );

  const updateMaterial = useCallback(
    async (materialId: string, updates: UpdateMaterialInput) => {
      const updated = await localWorkshopEngine.updateMaterial(materialId, updates);
      await refresh();
      return updated;
    },
    [refresh],
  );

  const deleteMaterial = useCallback(
    async (materialId: string) => {
      await localWorkshopEngine.deleteMaterial(materialId);
      await refresh();
    },
    [refresh],
  );

  const createVariant = useCallback(
    async (input: CreateVariantInput) => {
      const created = await localWorkshopEngine.createVariant(input);
      await refresh();
      return created;
    },
    [refresh],
  );

  const updateVariantMetadata = useCallback(
    async (variantId: string, updates: UpdateVariantMetadataInput) => {
      const updated = await localWorkshopEngine.updateVariantMetadata(
        variantId,
        updates,
      );
      await refresh();
      return updated;
    },
    [refresh],
  );

  const deleteVariant = useCallback(
    async (variantId: string) => {
      await localWorkshopEngine.deleteVariant(variantId);
      await refresh();
    },
    [refresh],
  );

  const adjustVariantStock = useCallback(
    async (input: AdjustStockInput) => {
      const updated = await localWorkshopEngine.adjustVariantStock(input);
      await refresh();
      return updated;
    },
    [refresh],
  );

  const createReservation = useCallback(
    async (input: CreateReservationInput) => {
      const created = await localWorkshopEngine.createReservation(input);
      await refresh();
      return created;
    },
    [refresh],
  );

  const modifyReservationQuantity = useCallback(
    async (
      reservationId: string,
      nextReservedQuantity: number,
      notes?: string,
    ) => {
      const updated = await localWorkshopEngine.modifyReservationQuantity(
        reservationId,
        nextReservedQuantity,
        notes,
      );
      await refresh();
      return updated;
    },
    [refresh],
  );

  const consumeFromReservation = useCallback(
    async (input: ConsumeFromReservationInput) => {
      const updated = await localWorkshopEngine.consumeFromReservation(input);
      await refresh();
      return updated;
    },
    [refresh],
  );

  const releaseReservation = useCallback(
    async (reservationId: string, notes?: string) => {
      const released = await localWorkshopEngine.releaseReservation(
        reservationId,
        notes,
      );
      await refresh();
      return released;
    },
    [refresh],
  );

  const recordDirectProjectConsumption = useCallback(
    async (input: DirectConsumptionInput) => {
      const movement = await localWorkshopEngine.recordDirectProjectConsumption(
        input,
      );
      await refresh();
      return movement;
    },
    [refresh],
  );

  const createPendingMaterial = useCallback(
    async (input: CreatePendingMaterialInput) => {
      const created = await localWorkshopEngine.createPendingMaterial(input);
      await refresh();
      return created;
    },
    [refresh],
  );

  const updatePendingMaterial = useCallback(
    async (pendingId: string, updates: UpdatePendingMaterialInput) => {
      const updated = await localWorkshopEngine.updatePendingMaterial(
        pendingId,
        updates,
      );
      await refresh();
      return updated;
    },
    [refresh],
  );

  const deletePendingMaterial = useCallback(
    async (pendingId: string) => {
      await localWorkshopEngine.deletePendingMaterial(pendingId);
      await refresh();
    },
    [refresh],
  );

  const createNoteOrList = useCallback(
    async (input: CreateNoteOrListInput) => {
      const created = await localWorkshopEngine.createNoteOrList(input);
      await refresh();
      return created;
    },
    [refresh],
  );

  const updateNoteOrList = useCallback(
    async (noteId: string, updates: UpdateNoteOrListInput) => {
      const updated = await localWorkshopEngine.updateNoteOrList(noteId, updates);
      await refresh();
      return updated;
    },
    [refresh],
  );

  const deleteNoteOrList = useCallback(
    async (noteId: string) => {
      await localWorkshopEngine.deleteNoteOrList(noteId);
      await refresh();
    },
    [refresh],
  );

  const createShoppingListItem = useCallback(
    async (input: CreateShoppingListItemInput) => {
      const created = await localWorkshopEngine.createShoppingListItem(input);
      await refresh();
      return created;
    },
    [refresh],
  );

  const updateShoppingListItem = useCallback(
    async (itemId: string, updates: UpdateShoppingListItemInput) => {
      const updated = await localWorkshopEngine.updateShoppingListItem(
        itemId,
        updates,
      );
      await refresh();
      return updated;
    },
    [refresh],
  );

  const deleteShoppingListItem = useCallback(
    async (itemId: string) => {
      await localWorkshopEngine.deleteShoppingListItem(itemId);
      await refresh();
    },
    [refresh],
  );

  const sendPendingMaterialToShoppingList = useCallback(
    async (pendingMaterialId: string, listId: string) => {
      const created = await localWorkshopEngine.sendPendingMaterialToShoppingList(
        pendingMaterialId,
        listId,
      );
      await refresh();
      return created;
    },
    [refresh],
  );

  const receivePurchaseReceipt = useCallback(
    async (input: CreatePurchaseReceiptInput) => {
      const receipt = await localWorkshopEngine.receivePurchaseReceipt(input);
      await refresh();
      return receipt;
    },
    [refresh],
  );

  const loadDemoData = useCallback(async () => {
    const res = await localWorkshopEngine.loadDemoData();
    await refresh();
    return res;
  }, [refresh]);

  const purgeDemoData = useCallback(async () => {
    const res = await localWorkshopEngine.purgeDemoData();
    await refresh();
    return res;
  }, [refresh]);

  const exportBackup = useCallback(
    async (includeDemo: boolean) => {
      const envelope = await localWorkshopEngine.exportBackup({ includeDemo });
      await refresh();
      return envelope;
    },
    [refresh],
  );

  const inspectBackup = useCallback(async (rawJson: string) => {
    return localWorkshopEngine.inspectBackup(rawJson);
  }, []);

  const importBackup = useCallback(
    async (inspection: BackupInspectionResult, strategy: BackupImportStrategy) => {
      const outcome = await localWorkshopEngine.importBackup(inspection, strategy);
      await refresh();
      return outcome;
    },
    [refresh],
  );

  const value = useMemo<DataContextValue>(
    () => ({
      engine: localWorkshopEngine,
      isLoading,
      error,
      settings,
      projects,
      components,
      workSessions,
      activeTimerSession,
      materials,
      variants,
      reservations,
      pendingMaterials,
      notesAndLists,
      shoppingListItems,
      purchaseReceipts,
      movements,
      clients,
      stats,
      schemaMeta,
      refresh,
      updateSettings,
      createProject,
      updateProject,
      deleteProject,
      createComponent,
      updateComponent,
      reorderComponent,
      deleteComponent,
      startTimerSession,
      pauseTimerSession,
      resumeTimerSession,
      finishTimerSession,
      logManualWorkSession,
      adjustCompletedWorkSession,
      createMaterial,
      updateMaterial,
      deleteMaterial,
      createVariant,
      updateVariantMetadata,
      deleteVariant,
      adjustVariantStock,
      createReservation,
      modifyReservationQuantity,
      consumeFromReservation,
      releaseReservation,
      recordDirectProjectConsumption,
      createPendingMaterial,
      updatePendingMaterial,
      deletePendingMaterial,
      createNoteOrList,
      updateNoteOrList,
      deleteNoteOrList,
      createShoppingListItem,
      updateShoppingListItem,
      deleteShoppingListItem,
      sendPendingMaterialToShoppingList,
      receivePurchaseReceipt,
      loadDemoData,
      purgeDemoData,
      exportBackup,
      inspectBackup,
      importBackup,
    }),
    [
      isLoading,
      error,
      settings,
      projects,
      components,
      workSessions,
      activeTimerSession,
      materials,
      variants,
      reservations,
      pendingMaterials,
      notesAndLists,
      shoppingListItems,
      purchaseReceipts,
      movements,
      clients,
      stats,
      schemaMeta,
      refresh,
      updateSettings,
      createProject,
      updateProject,
      deleteProject,
      createComponent,
      updateComponent,
      reorderComponent,
      deleteComponent,
      startTimerSession,
      pauseTimerSession,
      resumeTimerSession,
      finishTimerSession,
      logManualWorkSession,
      adjustCompletedWorkSession,
      createMaterial,
      updateMaterial,
      deleteMaterial,
      createVariant,
      updateVariantMetadata,
      deleteVariant,
      adjustVariantStock,
      createReservation,
      modifyReservationQuantity,
      consumeFromReservation,
      releaseReservation,
      recordDirectProjectConsumption,
      createPendingMaterial,
      updatePendingMaterial,
      deletePendingMaterial,
      createNoteOrList,
      updateNoteOrList,
      deleteNoteOrList,
      createShoppingListItem,
      updateShoppingListItem,
      deleteShoppingListItem,
      sendPendingMaterialToShoppingList,
      receivePurchaseReceipt,
      loadDemoData,
      purgeDemoData,
      exportBackup,
      inspectBackup,
      importBackup,
    ],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
};

export function useWorkshopData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) {
    throw new Error('useWorkshopData debe usarse dentro de DataProvider.');
  }
  return ctx;
}

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  Client,
  FinancialTransaction,
  InventoryMovement,
  InventoryReservation,
  Material,
  MaterialVariant,
  NoteOrList,
  PaymentInstallment,
  PaymentPlan,
  PendingMaterial,
  Project,
  ProjectComponent,
  PurchaseReceipt,
  Quote,
  Reminder,
  ScheduledTask,
  SchemaMeta,
  ShoppingListItem,
  SubscriptionTier,
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
import type {
  CreateQuoteInput,
  UpdateQuoteInput,
} from '@/src/domain/services/quoteService.ts';
import type {
  CreateReminderInput,
  CreateScheduledTaskInput,
  UpdateReminderInput,
  UpdateScheduledTaskInput,
} from '@/src/domain/services/planningService.ts';
import type {
  CreateClientInput,
  CreatePaymentPlanInput,
  RecordPaymentTransactionInput,
  UpdateClientInput,
  UpdatePaymentPlanInput,
} from '@/src/domain/services/clientPaymentService.ts';
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
import {
  setActiveCurrency,
  setActiveUsdRates,
} from '@/src/domain/services/formatters.ts';
import {
  ensureDailyUsdRates,
  isUsdRatesFreshToday,
  readCachedUsdRates,
  type UsdRatesSnapshot,
  type UsdRatesSyncStatus,
} from '@/src/domain/services/exchangeRateService.ts';
import {
  getPlanCapabilities,
  isPlanSimulatorEnabled,
  resolveEffectiveTier,
  type PlanCapabilities,
} from '@/src/domain/services/planCapabilities.ts';
import { resolveActiveTimerCandidate } from '@/src/domain/services/timerEngine.ts';
import { getOrCreateInstallationId } from '@/src/shared/utils/installationId.ts';
import {
  broadcastWorkshopSync,
  subscribeWorkshopSync,
} from '@/src/shared/utils/workshopSyncBus.ts';

export interface SavePulse {
  readonly seq: number;
  readonly at: string;
  readonly summary: string;
}

interface DataContextValue {
  readonly engine: WorkshopDataEngine;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly lastSaved: SavePulse | null;
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
  readonly quotes: Quote[];
  readonly paymentPlans: PaymentPlan[];
  readonly installments: PaymentInstallment[];
  readonly transactions: FinancialTransaction[];
  readonly plannedTasks: ScheduledTask[];
  readonly reminders: Reminder[];
  readonly stats: WorkshopDashboardStats;
  readonly schemaMeta: SchemaMeta | null;
  readonly installationId: string;
  readonly effectiveTier: SubscriptionTier;
  readonly capabilities: PlanCapabilities;
  readonly devTierOverride: SubscriptionTier | null;
  setDevTierOverride(tier: SubscriptionTier | null): void;
  readonly usdRates: UsdRatesSnapshot | null;
  readonly usdRatesStatus: UsdRatesSyncStatus;
  syncDailyUsdRates(): Promise<void>;
  refresh(): Promise<void>;
  updateSettings(
    partial: Partial<
      Pick<
        WorkshopSettings,
        | 'workshopName'
        | 'ownerDisplayName'
        | 'currency'
        | 'hourlyRateCOP'
        | 'dailyGoalMinutes'
        | 'weeklyGoalMinutes'
        | 'defaultMarkupPercent'
        | 'rentCostPercent'
        | 'electricityCostPercent'
        | 'internetCostPercent'
        | 'wasteAndContingencyPercent'
        | 'reminderLeadDaysDelivery'
        | 'reminderLeadDaysInstallment'
        | 'reminderLeadDaysPurchase'
        | 'enableDeliveryReminders'
        | 'enableInstallmentReminders'
        | 'enablePurchaseReminders'
        | 'enableLowStockReminders'
        | 'enableClientReminders'
        | 'enableBrowserNotifications'
        | 'enableTimerNotifications'
        | 'timerReminderIntervalMinutes'
        | 'forgottenTimerThresholdMinutes'
        | 'enableSoundAlerts'
        | 'enableVibrationAlerts'
        | 'quietHoursEnabled'
        | 'quietHoursStart'
        | 'quietHoursEnd'
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
  createQuote(input: CreateQuoteInput): Promise<Quote>;
  updateQuote(quoteId: string, updates: UpdateQuoteInput): Promise<Quote>;
  deleteQuote(quoteId: string): Promise<void>;
  applyQuotePriceToProject(quoteId: string): Promise<Project>;
  createClient(input: CreateClientInput): Promise<Client>;
  updateClient(clientId: string, updates: UpdateClientInput): Promise<Client>;
  deleteClient(clientId: string): Promise<void>;
  createPaymentPlan(input: CreatePaymentPlanInput): Promise<PaymentPlan>;
  updatePaymentPlan(
    planId: string,
    updates: UpdatePaymentPlanInput,
  ): Promise<PaymentPlan>;
  deletePaymentPlan(planId: string): Promise<void>;
  recordPaymentTransaction(
    input: RecordPaymentTransactionInput,
  ): Promise<FinancialTransaction>;
  createPlannedTask(input: CreateScheduledTaskInput): Promise<ScheduledTask>;
  updatePlannedTask(
    taskId: string,
    updates: UpdateScheduledTaskInput,
  ): Promise<ScheduledTask>;
  deletePlannedTask(taskId: string): Promise<void>;
  createReminder(input: CreateReminderInput): Promise<Reminder>;
  updateReminder(reminderId: string, updates: UpdateReminderInput): Promise<Reminder>;
  deleteReminder(reminderId: string): Promise<void>;
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
  quotes: [],
  paymentPlans: [],
  installments: [],
});

// Diagnostic-only timings: no IDs, record contents or personal information are logged.
async function traceWorkshopOperation<T>(label: string, task: () => Promise<T>): Promise<T> {
  const started = performance.now();
  let finished = false;
  const slowNotice = window.setTimeout(() => {
    if (!finished) console.warn('[CrochetTheOne perf] Pending operation', label, 'over 8s');
  }, 8000);
  try {
    const result = await task();
    const elapsed = Math.round(performance.now() - started);
    if (elapsed > 1500) console.warn('[CrochetTheOne perf] Slow operation', label, elapsed, 'ms');
    return result;
  } catch (err) {
    console.warn('[CrochetTheOne perf] Failed operation', label, Math.round(performance.now() - started), 'ms');
    throw err;
  } finally {
    finished = true;
    window.clearTimeout(slowNotice);
  }
}

export const DataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<SavePulse | null>(null);
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
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [paymentPlans, setPaymentPlans] = useState<PaymentPlan[]>([]);
  const [installments, setInstallments] = useState<PaymentInstallment[]>([]);
  const [transactions, setTransactions] = useState<FinancialTransaction[]>([]);
  const [plannedTasks, setPlannedTasks] = useState<ScheduledTask[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [stats, setStats] = useState<WorkshopDashboardStats>(EMPTY_STATS);
  const [schemaMeta, setSchemaMeta] = useState<SchemaMeta | null>(null);
  const [usdRates, setUsdRates] = useState<UsdRatesSnapshot | null>(() => {
    const cached = readCachedUsdRates();
    setActiveUsdRates(cached);
    return cached;
  });
  const [usdRatesStatus, setUsdRatesStatus] = useState<UsdRatesSyncStatus>(() => {
    const cached = readCachedUsdRates();
    if (!cached) return 'idle';
    return isUsdRatesFreshToday(cached) ? 'ready' : 'offline_cached';
  });
  const [installationId] = useState<string>(() => getOrCreateInstallationId());
  const simulatorEnabled = isPlanSimulatorEnabled();
  const [devTierOverrideState, setDevTierOverrideState] =
    useState<SubscriptionTier | null>(null);

  const setDevTierOverride = useCallback(
    (nextTier: SubscriptionTier | null) => {
      if (!simulatorEnabled) return;
      setDevTierOverrideState(nextTier);
    },
    [simulatorEnabled],
  );

  const devTierOverride = simulatorEnabled ? devTierOverrideState : null;
  const effectiveTier = useMemo(
    () => resolveEffectiveTier(settings, devTierOverride),
    [settings, devTierOverride],
  );
  const capabilities = useMemo(
    () => getPlanCapabilities(effectiveTier),
    [effectiveTier],
  );

  const inFlightRefreshRef = useRef<Promise<void> | null>(null);
  const hiddenSinceRef = useRef<number | null>(null);

  const markSaved = useCallback((summary: string, scope: 'all' | 'timer' = 'all') => {
    setLastSaved((prev) => ({
      seq: (prev?.seq ?? 0) + 1,
      at: new Date().toISOString(),
      summary,
    }));
    broadcastWorkshopSync('WORKSHOP_DB_UPDATED', scope);
  }, []);

  const refreshWorkSessionsOnly = useCallback(async () => {
    try {
      setError(null);
      const nextSessions = await localWorkshopEngine.workSessions.getAll();
      setWorkSessions(nextSessions);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Error al sincronizar las sesiones del cronómetro.',
      );
    }
  }, []);

  const refresh = useCallback(async () => {
    if (inFlightRefreshRef.current) {
      return inFlightRefreshRef.current;
    }

    const run = (async () => {
      try {
        setError(null);
        const [snapshot, meta] = await traceWorkshopOperation('refresh.read', () => Promise.all([
          localWorkshopEngine.loadWorkshopSnapshot(),
          localWorkshopEngine.getSchemaMeta(),
        ]));
        setActiveCurrency(snapshot.settings.currency);
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
        setQuotes(snapshot.quotes ?? []);
        setPaymentPlans(snapshot.paymentPlans ?? []);
        setInstallments(snapshot.installments ?? []);
        setTransactions(snapshot.transactions ?? []);
        setPlannedTasks(snapshot.plannedTasks ?? []);
        setReminders(snapshot.reminders ?? []);
        const statsStart = performance.now();
        const computedStats = computeWorkshopStats(snapshot);
        const statsMs = Math.round(performance.now() - statsStart);
        if (statsMs > 150) console.warn('[CrochetTheOne perf] Slow calculation refresh.stats', statsMs, 'ms');
        setStats(computedStats);
        setSchemaMeta(meta);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'Error al leer la base de datos local.',
        );
      } finally {
        setIsLoading(false);
        inFlightRefreshRef.current = null;
      }
    })();

    inFlightRefreshRef.current = run;
    return run;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Sincronización selectiva entre pestañas, Service Worker y retorno desde segundo plano/BFCache
  useEffect(() => {
    const unsubscribe = subscribeWorkshopSync((msg) => {
      if (msg.type === 'WORKSHOP_DB_UPDATED') {
        if (msg.scope === 'timer') {
          void refreshWorkSessionsOnly();
        } else {
          void refresh();
        }
      }
    });

    const handleVisibilityRefresh = () => {
      if (document.visibilityState === 'hidden') {
        hiddenSinceRef.current = Date.now();
        return;
      }
      if (document.visibilityState === 'visible') {
        const hiddenSince = hiddenSinceRef.current;
        hiddenSinceRef.current = null;
        if (hiddenSince === null) return;
        const hiddenDurationMs = Date.now() - hiddenSince;
        if (hiddenDurationMs >= 15_000) {
          void refresh();
        } else if (hiddenDurationMs >= 2_500) {
          void refreshWorkSessionsOnly();
        }
      }
    };

    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        void refresh();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityRefresh);
    window.addEventListener('pageshow', handlePageShow);

    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', handleVisibilityRefresh);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, [refresh, refreshWorkSessionsOnly]);

  const syncDailyUsdRates = useCallback(async () => {
    const cached = readCachedUsdRates();
    if (isUsdRatesFreshToday(cached)) {
      setActiveUsdRates(cached);
      setUsdRates(cached);
      setUsdRatesStatus('ready');
      return;
    }

    setUsdRatesStatus((prev) => (prev === 'ready' ? prev : 'loading'));
    const result = await ensureDailyUsdRates();
    setActiveUsdRates(result.snapshot);
    setUsdRates(result.snapshot);
    setUsdRatesStatus(result.status);
  }, []);

  useEffect(() => {
    if (isLoading || settings.currency === 'USD') return;
    void syncDailyUsdRates();

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void syncDailyUsdRates();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [isLoading, settings.currency, syncDailyUsdRates]);

  const updateSettings = useCallback(
    async (
      partial: Partial<
        Pick<
          WorkshopSettings,
          | 'workshopName'
          | 'ownerDisplayName'
          | 'currency'
          | 'hourlyRateCOP'
          | 'dailyGoalMinutes'
          | 'weeklyGoalMinutes'
          | 'defaultMarkupPercent'
          | 'rentCostPercent'
          | 'electricityCostPercent'
          | 'internetCostPercent'
          | 'wasteAndContingencyPercent'
          | 'reminderLeadDaysDelivery'
          | 'reminderLeadDaysInstallment'
          | 'reminderLeadDaysPurchase'
          | 'enableDeliveryReminders'
          | 'enableInstallmentReminders'
          | 'enablePurchaseReminders'
          | 'enableLowStockReminders'
          | 'enableClientReminders'
          | 'enableBrowserNotifications'
          | 'enableTimerNotifications'
          | 'timerReminderIntervalMinutes'
          | 'forgottenTimerThresholdMinutes'
          | 'enableSoundAlerts'
          | 'enableVibrationAlerts'
          | 'quietHoursEnabled'
          | 'quietHoursStart'
          | 'quietHoursEnd'
        >
      >,
    ) => {
      const updated = await localWorkshopEngine.saveWorkshopSettings(partial);
      setActiveCurrency(updated.currency);
      await refresh();
      markSaved('Configuración del taller');
      return updated;
    },
    [refresh, markSaved],
  );

  const createProject = useCallback(
    async (input: CreateProjectInput) => {
      const created = await localWorkshopEngine.createProject(input);
      await refresh();
      markSaved(`Proyecto "${created.name}" creado`);
      return created;
    },
    [refresh, markSaved],
  );

  const updateProject = useCallback(
    async (projectId: string, updates: UpdateProjectInput) => {
      const updated = await localWorkshopEngine.updateProject(projectId, updates);
      await refresh();
      markSaved(`Proyecto "${updated.name}" actualizado`);
      return updated;
    },
    [refresh, markSaved],
  );

  const deleteProject = useCallback(
    async (projectId: string) => {
      await localWorkshopEngine.deleteProjectCascade(projectId);
      await refresh();
      markSaved('Proyecto eliminado');
    },
    [refresh, markSaved],
  );

  const createComponent = useCallback(
    async (input: CreateComponentInput) => {
      const created = await localWorkshopEngine.createComponent(input);
      await refresh();
      markSaved(`Pieza "${created.name}" agregada`);
      return created;
    },
    [refresh, markSaved],
  );

  const updateComponent = useCallback(
    async (componentId: string, updates: UpdateComponentInput) => {
      const updated = await localWorkshopEngine.updateComponent(
        componentId,
        updates,
      );
      await refresh();
      markSaved(`Pieza "${updated.name}" actualizada`);
      return updated;
    },
    [refresh, markSaved],
  );

  const reorderComponent = useCallback(
    async (componentId: string, direction: 'up' | 'down') => {
      await localWorkshopEngine.reorderComponent(componentId, direction);
      await refresh();
      markSaved('Orden de piezas actualizado');
    },
    [refresh, markSaved],
  );

  const deleteComponent = useCallback(
    async (componentId: string) => {
      await localWorkshopEngine.deleteComponent(componentId);
      await refresh();
      markSaved('Pieza eliminada');
    },
    [refresh, markSaved],
  );

  const startTimerSession = useCallback(
    async (projectId: string, componentId: string, notes?: string) => {
      const session = await localWorkshopEngine.startTimerSession(
        projectId,
        componentId,
        notes,
      );
      await refresh();
      markSaved('Sesión de cronómetro iniciada', 'timer');
      return session;
    },
    [refresh, markSaved],
  );

  const pauseTimerSession = useCallback(
    async (sessionId: string) => {
      const session = await localWorkshopEngine.pauseTimerSession(sessionId);
      await refreshWorkSessionsOnly();
      markSaved('Cronómetro en pausa', 'timer');
      return session;
    },
    [refreshWorkSessionsOnly, markSaved],
  );

  const resumeTimerSession = useCallback(
    async (sessionId: string) => {
      const session = await localWorkshopEngine.resumeTimerSession(sessionId);
      await refreshWorkSessionsOnly();
      markSaved('Cronómetro reanudado', 'timer');
      return session;
    },
    [refreshWorkSessionsOnly, markSaved],
  );

  const finishTimerSession = useCallback(
    async (sessionId: string, options?: FinishTimerSessionOptions) => {
      const session = await localWorkshopEngine.finishTimerSession(
        sessionId,
        options,
      );
      await refresh();
      markSaved('Sesión de tiempo guardada', 'all');
      return session;
    },
    [refresh, markSaved],
  );

  const logManualWorkSession = useCallback(
    async (input: ManualWorkSessionInput) => {
      const session = await localWorkshopEngine.logManualWorkSession(input);
      await refresh();
      markSaved('Tiempo manual registrado');
      return session;
    },
    [refresh, markSaved],
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
      markSaved('Tiempo de sesión ajustado');
      return session;
    },
    [refresh, markSaved],
  );

  const activeTimerSession = useMemo(
    () => resolveActiveTimerCandidate(workSessions),
    [workSessions],
  );

  const createMaterial = useCallback(
    async (input: CreateMaterialInput) => {
      const created = await localWorkshopEngine.createMaterial(input);
      await refresh();
      markSaved(`Material "${created.name}" guardado`);
      return created;
    },
    [refresh, markSaved],
  );

  const updateMaterial = useCallback(
    async (materialId: string, updates: UpdateMaterialInput) => {
      const updated = await localWorkshopEngine.updateMaterial(materialId, updates);
      await refresh();
      markSaved(`Material "${updated.name}" actualizado`);
      return updated;
    },
    [refresh, markSaved],
  );

  const deleteMaterial = useCallback(
    async (materialId: string) => {
      await localWorkshopEngine.deleteMaterial(materialId);
      await refresh();
      markSaved('Material eliminado');
    },
    [refresh, markSaved],
  );

  const createVariant = useCallback(
    async (input: CreateVariantInput) => {
      const created = await localWorkshopEngine.createVariant(input);
      await refresh();
      markSaved(`Color "${created.colorName}" guardado`);
      return created;
    },
    [refresh, markSaved],
  );

  const updateVariantMetadata = useCallback(
    async (variantId: string, updates: UpdateVariantMetadataInput) => {
      const updated = await localWorkshopEngine.updateVariantMetadata(
        variantId,
        updates,
      );
      await refresh();
      markSaved(`Color "${updated.colorName}" actualizado`);
      return updated;
    },
    [refresh, markSaved],
  );

  const deleteVariant = useCallback(
    async (variantId: string) => {
      await localWorkshopEngine.deleteVariant(variantId);
      await refresh();
      markSaved('Color eliminado');
    },
    [refresh, markSaved],
  );

  const adjustVariantStock = useCallback(
    async (input: AdjustStockInput) => {
      const updated = await localWorkshopEngine.adjustVariantStock(input);
      await refresh();
      markSaved('Ajuste de inventario guardado');
      return updated;
    },
    [refresh, markSaved],
  );

  const createReservation = useCallback(
    async (input: CreateReservationInput) => {
      const created = await localWorkshopEngine.createReservation(input);
      await refresh();
      markSaved('Reserva de material guardada');
      return created;
    },
    [refresh, markSaved],
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
      markSaved('Reserva actualizada');
      return updated;
    },
    [refresh, markSaved],
  );

  const consumeFromReservation = useCallback(
    async (input: ConsumeFromReservationInput) => {
      const updated = await localWorkshopEngine.consumeFromReservation(input);
      await refresh();
      markSaved('Consumo de reserva registrado');
      return updated;
    },
    [refresh, markSaved],
  );

  const releaseReservation = useCallback(
    async (reservationId: string, notes?: string) => {
      const released = await localWorkshopEngine.releaseReservation(
        reservationId,
        notes,
      );
      await refresh();
      markSaved('Reserva liberada');
      return released;
    },
    [refresh, markSaved],
  );

  const recordDirectProjectConsumption = useCallback(
    async (input: DirectConsumptionInput) => {
      const movement = await localWorkshopEngine.recordDirectProjectConsumption(
        input,
      );
      await refresh();
      markSaved('Consumo directo registrado');
      return movement;
    },
    [refresh, markSaved],
  );

  const createPendingMaterial = useCallback(
    async (input: CreatePendingMaterialInput) => {
      const created = await localWorkshopEngine.createPendingMaterial(input);
      await refresh();
      markSaved('Material pendiente guardado');
      return created;
    },
    [refresh, markSaved],
  );

  const updatePendingMaterial = useCallback(
    async (pendingId: string, updates: UpdatePendingMaterialInput) => {
      const updated = await localWorkshopEngine.updatePendingMaterial(
        pendingId,
        updates,
      );
      await refresh();
      markSaved('Material pendiente actualizado');
      return updated;
    },
    [refresh, markSaved],
  );

  const deletePendingMaterial = useCallback(
    async (pendingId: string) => {
      await localWorkshopEngine.deletePendingMaterial(pendingId);
      await refresh();
      markSaved('Material pendiente eliminado');
    },
    [refresh, markSaved],
  );

  const createNoteOrList = useCallback(
    async (input: CreateNoteOrListInput) => {
      const created = await localWorkshopEngine.createNoteOrList(input);
      await refresh();
      markSaved(
        created.type === 'shopping_list' ? 'Lista de compras creada' : 'Nota guardada',
      );
      return created;
    },
    [refresh, markSaved],
  );

  const updateNoteOrList = useCallback(
    async (noteId: string, updates: UpdateNoteOrListInput) => {
      const updated = await localWorkshopEngine.updateNoteOrList(noteId, updates);
      await refresh();
      markSaved(
        updated.type === 'shopping_list' ? 'Lista actualizada' : 'Nota actualizada',
      );
      return updated;
    },
    [refresh, markSaved],
  );

  const deleteNoteOrList = useCallback(
    async (noteId: string) => {
      await localWorkshopEngine.deleteNoteOrList(noteId);
      await refresh();
      markSaved('Registro eliminado');
    },
    [refresh, markSaved],
  );

  const createShoppingListItem = useCallback(
    async (input: CreateShoppingListItemInput) => {
      const created = await localWorkshopEngine.createShoppingListItem(input);
      await refresh();
      markSaved('Ítem agregado a la lista');
      return created;
    },
    [refresh, markSaved],
  );

  const updateShoppingListItem = useCallback(
    async (itemId: string, updates: UpdateShoppingListItemInput) => {
      const updated = await localWorkshopEngine.updateShoppingListItem(
        itemId,
        updates,
      );
      await refresh();
      markSaved('Ítem de lista actualizado');
      return updated;
    },
    [refresh, markSaved],
  );

  const deleteShoppingListItem = useCallback(
    async (itemId: string) => {
      await localWorkshopEngine.deleteShoppingListItem(itemId);
      await refresh();
      markSaved('Ítem eliminado');
    },
    [refresh, markSaved],
  );

  const sendPendingMaterialToShoppingList = useCallback(
    async (pendingMaterialId: string, listId: string) => {
      const created = await localWorkshopEngine.sendPendingMaterialToShoppingList(
        pendingMaterialId,
        listId,
      );
      await refresh();
      markSaved('Material enviado a lista de compras');
      return created;
    },
    [refresh, markSaved],
  );

  const receivePurchaseReceipt = useCallback(
    async (input: CreatePurchaseReceiptInput) => {
      const receipt = await localWorkshopEngine.receivePurchaseReceipt(input);
      await refresh();
      markSaved('Recepción de compra guardada');
      return receipt;
    },
    [refresh, markSaved],
  );

  const createQuote = useCallback(
    async (input: CreateQuoteInput) => {
      const created = await localWorkshopEngine.createQuote(input);
      await refresh();
      markSaved(`Cotización "${created.title}" guardada`);
      return created;
    },
    [refresh, markSaved],
  );

  const updateQuote = useCallback(
    async (quoteId: string, updates: UpdateQuoteInput) => {
      const updated = await localWorkshopEngine.updateQuote(quoteId, updates);
      await refresh();
      markSaved(`Cotización "${updated.title}" actualizada`);
      return updated;
    },
    [refresh, markSaved],
  );

  const deleteQuote = useCallback(
    async (quoteId: string) => {
      await localWorkshopEngine.deleteQuote(quoteId);
      await refresh();
      markSaved('Cotización eliminada');
    },
    [refresh, markSaved],
  );

  const applyQuotePriceToProject = useCallback(
    async (quoteId: string) => {
      const updatedProject =
        await localWorkshopEngine.applyQuotePriceToProject(quoteId);
      await refresh();
      markSaved(`Presupuesto de "${updatedProject.name}" actualizado`);
      return updatedProject;
    },
    [refresh, markSaved],
  );

  const createClient = useCallback(
    async (input: CreateClientInput) => {
      const created = await localWorkshopEngine.createClient(input);
      await refresh();
      markSaved(`Cliente "${created.name}" registrado`);
      return created;
    },
    [refresh, markSaved],
  );

  const updateClient = useCallback(
    async (clientId: string, updates: UpdateClientInput) => {
      const updated = await localWorkshopEngine.updateClient(clientId, updates);
      await refresh();
      markSaved(`Cliente "${updated.name}" actualizado`);
      return updated;
    },
    [refresh, markSaved],
  );

  const deleteClient = useCallback(
    async (clientId: string) => {
      await localWorkshopEngine.deleteClient(clientId);
      await refresh();
      markSaved('Cliente eliminado');
    },
    [refresh, markSaved],
  );

  const createPaymentPlan = useCallback(
    async (input: CreatePaymentPlanInput) => {
      const created = await localWorkshopEngine.createPaymentPlan(input);
      await refresh();
      markSaved('Plan de pagos guardado');
      return created;
    },
    [refresh, markSaved],
  );

  const updatePaymentPlan = useCallback(
    async (planId: string, updates: UpdatePaymentPlanInput) => {
      const updated = await localWorkshopEngine.updatePaymentPlan(planId, updates);
      await refresh();
      markSaved('Plan de pagos actualizado');
      return updated;
    },
    [refresh, markSaved],
  );

  const deletePaymentPlan = useCallback(
    async (planId: string) => {
      await localWorkshopEngine.deletePaymentPlan(planId);
      await refresh();
      markSaved('Plan de pagos eliminado');
    },
    [refresh, markSaved],
  );

  const recordPaymentTransaction = useCallback(
    async (input: RecordPaymentTransactionInput) => {
      const tx = await localWorkshopEngine.recordPaymentTransaction(input);
      await refresh();
      markSaved('Abono registrado en caja de clientes');
      return tx;
    },
    [refresh, markSaved],
  );

  const createPlannedTask = useCallback(
    async (input: CreateScheduledTaskInput) => {
      const created = await localWorkshopEngine.createPlannedTask(input);
      await refresh();
      markSaved('Tarea agendada');
      return created;
    },
    [refresh, markSaved],
  );

  const updatePlannedTask = useCallback(
    async (taskId: string, updates: UpdateScheduledTaskInput) => {
      const updated = await localWorkshopEngine.updatePlannedTask(taskId, updates);
      await refresh();
      markSaved('Tarea actualizada');
      return updated;
    },
    [refresh, markSaved],
  );

  const deletePlannedTask = useCallback(
    async (taskId: string) => {
      await localWorkshopEngine.deletePlannedTask(taskId);
      await refresh();
      markSaved('Tarea eliminada');
    },
    [refresh, markSaved],
  );

  const createReminder = useCallback(
    async (input: CreateReminderInput) => {
      const created = await localWorkshopEngine.createReminder(input);
      await refresh();
      markSaved('Recordatorio guardado');
      return created;
    },
    [refresh, markSaved],
  );

  const updateReminder = useCallback(
    async (reminderId: string, updates: UpdateReminderInput) => {
      const updated = await localWorkshopEngine.updateReminder(reminderId, updates);
      await refresh();
      markSaved('Recordatorio actualizado');
      return updated;
    },
    [refresh, markSaved],
  );

  const deleteReminder = useCallback(
    async (reminderId: string) => {
      await localWorkshopEngine.deleteReminder(reminderId);
      await refresh();
      markSaved('Recordatorio eliminado');
    },
    [refresh, markSaved],
  );

  const loadDemoData = useCallback(async () => {
    const res = await traceWorkshopOperation('demo.write', () => localWorkshopEngine.loadDemoData());
    await traceWorkshopOperation('demo.refresh', refresh);
    markSaved('Ejemplos del taller cargados');
    return res;
  }, [refresh, markSaved]);

  const purgeDemoData = useCallback(async () => {
    const res = await localWorkshopEngine.purgeDemoData();
    await refresh();
    markSaved('Ejemplos eliminados');
    return res;
  }, [refresh, markSaved]);

  const exportBackup = useCallback(
    async (includeDemo: boolean) => {
      const envelope = await localWorkshopEngine.exportBackup({ includeDemo });
      await refresh();
      markSaved('Respaldo JSON exportado');
      return envelope;
    },
    [refresh, markSaved],
  );

  const inspectBackup = useCallback(async (rawJson: string) => {
    return localWorkshopEngine.inspectBackup(rawJson);
  }, []);

  const importBackup = useCallback(
    async (inspection: BackupInspectionResult, strategy: BackupImportStrategy) => {
      const outcome = await traceWorkshopOperation('backup.write', () => localWorkshopEngine.importBackup(inspection, strategy));
      await traceWorkshopOperation('backup.refresh', refresh);
      markSaved('Respaldo restaurado');
      return outcome;
    },
    [refresh, markSaved],
  );

  const value = useMemo<DataContextValue>(
    () => ({
      engine: localWorkshopEngine,
      isLoading,
      error,
      lastSaved,
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
      quotes,
      paymentPlans,
      installments,
      transactions,
      plannedTasks,
      reminders,
      stats,
      schemaMeta,
      installationId,
      effectiveTier,
      capabilities,
      devTierOverride,
      setDevTierOverride,
      usdRates,
      usdRatesStatus,
      syncDailyUsdRates,
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
      createQuote,
      updateQuote,
      deleteQuote,
      applyQuotePriceToProject,
      createClient,
      updateClient,
      deleteClient,
      createPaymentPlan,
      updatePaymentPlan,
      deletePaymentPlan,
      recordPaymentTransaction,
      createPlannedTask,
      updatePlannedTask,
      deletePlannedTask,
      createReminder,
      updateReminder,
      deleteReminder,
      loadDemoData,
      purgeDemoData,
      exportBackup,
      inspectBackup,
      importBackup,
    }),
    [
      isLoading,
      error,
      lastSaved,
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
      quotes,
      paymentPlans,
      installments,
      transactions,
      plannedTasks,
      reminders,
      stats,
      schemaMeta,
      installationId,
      effectiveTier,
      capabilities,
      devTierOverride,
      setDevTierOverride,
      usdRates,
      usdRatesStatus,
      syncDailyUsdRates,
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
      createQuote,
      updateQuote,
      deleteQuote,
      applyQuotePriceToProject,
      createClient,
      updateClient,
      deleteClient,
      createPaymentPlan,
      updatePaymentPlan,
      deletePaymentPlan,
      recordPaymentTransaction,
      createPlannedTask,
      updatePlannedTask,
      deletePlannedTask,
      createReminder,
      updateReminder,
      deleteReminder,
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

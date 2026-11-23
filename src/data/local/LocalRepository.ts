import type {
  BaseEntity,
  Client,
  FinancialTransaction,
  InventoryMovement,
  InventoryMovementType,
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
  PurchaseReceiptItem,
  Quote,
  Reminder,
  ScheduledTask,
  SchemaMeta,
  ShoppingListItem,
  WorkSession,
  WorkshopSettings,
  WorkshopStoreName,
} from '@/src/domain/models/index.ts';
import {
  assertValidEntityShape,
  DATA_STORES_TOPOLOGICAL_ORDER,
  STORE_FOREIGN_KEYS,
} from '@/src/domain/services/integrityRules.ts';
import type { WorkshopSnapshotInput } from '@/src/domain/services/workshopStats.ts';
import type {
  BackupEnvelope,
  BackupImportOutcome,
  BackupImportStrategy,
  BackupInspectionResult,
  DataStorePort,
  DemoPurgeOutcome,
  FinishTimerSessionOptions,
  ManualWorkSessionInput,
  WorkshopDataEngine,
} from '@/src/data/ports/DataStorePort.ts';
import {
  applyComponentUpdates,
  applyProjectUpdates,
  buildNewComponentEntity,
  buildNewProjectEntity,
  type CreateComponentInput,
  type CreateProjectInput,
  type UpdateComponentInput,
  type UpdateProjectInput,
} from '@/src/domain/services/projectService.ts';
import {
  calculateSessionDurations,
  closeOpenPauseIntervals,
  sumComponentEffectiveMinutes,
} from '@/src/domain/services/timerEngine.ts';
import {
  buildMaterialCategoryOptions,
  computeWeightedAverageUnitCost,
  deduplicateCustomCategories,
  getUnitShortLabel,
  isPredefinedMaterialCategory,
  isSameNormalizedText,
  normalizeInventoryText,
  resolveMaterialCategorySelection,
  type AdjustStockInput,
  type ConsumeFromReservationInput,
  type CreateMaterialInput,
  type CreateReservationInput,
  type CreateVariantInput,
  type DirectConsumptionInput,
  type UpdateMaterialInput,
  type UpdateVariantMetadataInput,
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
  applyQuoteUpdates,
  buildNewQuoteEntity,
  type CreateQuoteInput,
  type UpdateQuoteInput,
} from '@/src/domain/services/quoteService.ts';
import {
  dateKeyToMiddayIso,
  evaluateTaskMaterialBlock,
  toLocalDateKey,
  type CreateReminderInput,
  type CreateScheduledTaskInput,
  type UpdateReminderInput,
  type UpdateScheduledTaskInput,
} from '@/src/domain/services/planningService.ts';
import {
  allocatePaymentAcrossInstallments,
  recomputePlanAndInstallments,
  resolveInstallmentStatus,
  validateInstallmentsAgainstTotal,
  type CreateClientInput,
  type CreatePaymentPlanInput,
  type RecordPaymentTransactionInput,
  type UpdateClientInput,
  type UpdatePaymentPlanInput,
} from '@/src/domain/services/clientPaymentService.ts';
import {
  createDefaultWorkshopSettings,
  normalizeWorkshopSettings,
  runAtomicTransaction,
  runReadOnlyRequest,
} from './indexedDbClient.ts';
import { loadDemoDataTransaction, purgeDemoDataTransaction } from './demoSeeder.ts';
import {
  applyBackupImport,
  exportWorkshopBackup,
  inspectBackupFile,
} from './backupService.ts';
import {
  isSupportedCurrency,
  roundCurrencyAmount,
  roundUnitCostAmount,
  toMinorUnits,
} from '@/src/domain/services/currencyCatalog.ts';
import {
  formatCOP,
  getActiveCurrency,
  setActiveCurrency,
} from '@/src/domain/services/formatters.ts';

const IMMUTABLE_LEDGER_STORES = new Set<WorkshopStoreName>([
  'inventory_movements',
  'financial_transactions',
  'purchase_receipts',
]);

class IndexedDbStoreRepository<T extends BaseEntity> implements DataStorePort<T> {
  readonly storeName: WorkshopStoreName;

  constructor(storeName: WorkshopStoreName) {
    this.storeName = storeName;
  }

  async getById(id: string): Promise<T | null> {
    const result = await runReadOnlyRequest<T | undefined>(this.storeName, (store) =>
      store.get(id),
    );
    return result ?? null;
  }

  async getAll(): Promise<T[]> {
    return runReadOnlyRequest<T[]>(this.storeName, (store) => store.getAll());
  }

  async queryByIndex(indexName: string, value: IDBValidKey): Promise<T[]> {
    return runReadOnlyRequest<T[]>(this.storeName, (store) =>
      store.index(indexName).getAll(value),
    );
  }

  async count(): Promise<number> {
    return runReadOnlyRequest<number>(this.storeName, (store) => store.count());
  }

  async upsert(entity: T): Promise<T> {
    const fkConstraints = STORE_FOREIGN_KEYS[this.storeName] ?? [];
    const storeNames = Array.from(
      new Set<WorkshopStoreName>([
        this.storeName,
        ...fkConstraints.map((fk) => fk.targetStore),
      ]),
    );

    return runAtomicTransaction<T>(storeNames, 'readwrite', (tx, done, fail) => {
      const store = tx.objectStore(this.storeName);
      const getReq = store.get(entity.id);

      getReq.onerror = () => fail(getReq.error);
      getReq.onsuccess = () => {
        const existing = getReq.result as T | undefined;
        if (existing && IMMUTABLE_LEDGER_STORES.has(this.storeName)) {
          fail(
            new Error(
              `Los registros históricos de "${this.storeName}" son inmutables y no pueden modificarse.`,
            ),
          );
          return;
        }

        const now = new Date().toISOString();
        const prepared: T = {
          ...entity,
          ownerId: entity.ownerId || existing?.ownerId || 'local-workshop',
          syncStatus: entity.syncStatus || 'local_only',
          version: existing ? existing.version + 1 : Math.max(1, entity.version || 1),
          createdAt: existing?.createdAt || entity.createdAt || now,
          updatedAt: now,
        };

        try {
          assertValidEntityShape(this.storeName, prepared);
        } catch (err) {
          fail(err);
          return;
        }

        if (fkConstraints.length === 0) {
          const putReq = store.put(prepared);
          putReq.onerror = () => fail(putReq.error);
          putReq.onsuccess = () => done(prepared);
          return;
        }

        const obj = prepared as unknown as Record<string, unknown>;
        let pendingChecks = fkConstraints.length;
        let failed = false;

        for (const fk of fkConstraints) {
          const rawFk = obj[fk.field];
          if (rawFk === null || rawFk === undefined || rawFk === '') {
            if (fk.required) {
              failed = true;
              fail(
                new Error(
                  `Falta relación obligatoria "${fk.field}" en "${this.storeName}".`,
                ),
              );
              return;
            }
            pendingChecks -= 1;
            if (pendingChecks === 0 && !failed) {
              const putReq = store.put(prepared);
              putReq.onerror = () => fail(putReq.error);
              putReq.onsuccess = () => done(prepared);
            }
            continue;
          }

          const parentReq = tx.objectStore(fk.targetStore).get(String(rawFk));
          parentReq.onerror = () => {
            if (!failed) {
              failed = true;
              fail(parentReq.error);
            }
          };
          parentReq.onsuccess = () => {
            if (failed) return;
            const parent = parentReq.result as BaseEntity | undefined;
            if (!parent) {
              failed = true;
              fail(
                new Error(
                  `Integridad referencial: "${fk.field}" (${String(rawFk)}) no existe en "${fk.targetStore}".`,
                ),
              );
              return;
            }
            if (!prepared.isDemo && parent.isDemo) {
              failed = true;
              fail(
                new Error(
                  `Aislamiento de ejemplos: un registro real no puede vincularse con un registro de demostración (${String(rawFk)}).`,
                ),
              );
              return;
            }
            pendingChecks -= 1;
            if (pendingChecks === 0) {
              const putReq = store.put(prepared);
              putReq.onerror = () => fail(putReq.error);
              putReq.onsuccess = () => done(prepared);
            }
          };
        }
      };
    });
  }

  async remove(id: string): Promise<void> {
    if (IMMUTABLE_LEDGER_STORES.has(this.storeName)) {
      throw new Error(
        `Los registros históricos de "${this.storeName}" son inmutables y no pueden eliminarse.`,
      );
    }

    const dependentChecks: Array<{ store: WorkshopStoreName; field: string }> = [];
    for (const [childStore, constraints] of Object.entries(STORE_FOREIGN_KEYS)) {
      for (const fk of constraints ?? []) {
        if (fk.targetStore === this.storeName) {
          dependentChecks.push({
            store: childStore as WorkshopStoreName,
            field: fk.field,
          });
        }
      }
    }

    const storeNames = Array.from(
      new Set<WorkshopStoreName>([
        this.storeName,
        ...dependentChecks.map((d) => d.store),
      ]),
    );

    return runAtomicTransaction<void>(storeNames, 'readwrite', (tx, done, fail) => {
      if (dependentChecks.length === 0) {
        const delReq = tx.objectStore(this.storeName).delete(id);
        delReq.onerror = () => fail(delReq.error);
        delReq.onsuccess = () => done(undefined);
        return;
      }

      let pending = dependentChecks.length;
      let aborted = false;

      for (const dep of dependentChecks) {
        const req = tx.objectStore(dep.store).getAll();
        req.onerror = () => {
          if (!aborted) {
            aborted = true;
            fail(req.error);
          }
        };
        req.onsuccess = () => {
          if (aborted) return;
          const rows = (req.result as Array<Record<string, unknown>>) ?? [];
          const hasChild = rows.some((r) => r[dep.field] === id);
          if (hasChild) {
            aborted = true;
            fail(
              new Error(
                `No se puede eliminar "${id}" de "${this.storeName}" porque tiene registros relacionados en "${dep.store}".`,
              ),
            );
            return;
          }
          pending -= 1;
          if (pending === 0) {
            const delReq = tx.objectStore(this.storeName).delete(id);
            delReq.onerror = () => fail(delReq.error);
            delReq.onsuccess = () => done(undefined);
          }
        };
      }
    });
  }
}

export class LocalWorkshopEngine implements WorkshopDataEngine {
  readonly settings = new IndexedDbStoreRepository<WorkshopSettings>('workshop_settings');
  readonly projects = new IndexedDbStoreRepository<Project>('projects');
  readonly components = new IndexedDbStoreRepository<ProjectComponent>('project_components');
  readonly workSessions = new IndexedDbStoreRepository<WorkSession>('work_sessions');
  readonly materials = new IndexedDbStoreRepository<Material>('materials');
  readonly variants = new IndexedDbStoreRepository<MaterialVariant>('material_variants');
  readonly reservations = new IndexedDbStoreRepository<InventoryReservation>(
    'inventory_reservations',
  );
  readonly pendingMaterials = new IndexedDbStoreRepository<PendingMaterial>(
    'pending_materials',
  );
  readonly notesAndLists = new IndexedDbStoreRepository<NoteOrList>(
    'notes_and_lists',
  );
  readonly shoppingListItems = new IndexedDbStoreRepository<ShoppingListItem>(
    'shopping_list_items',
  );
  readonly purchaseReceipts = new IndexedDbStoreRepository<PurchaseReceipt>(
    'purchase_receipts',
  );
  readonly movements = new IndexedDbStoreRepository<InventoryMovement>('inventory_movements');
  readonly clients = new IndexedDbStoreRepository<Client>('clients');
  readonly quotes = new IndexedDbStoreRepository<Quote>('quotes');
  readonly paymentPlans = new IndexedDbStoreRepository<PaymentPlan>('payment_plans');
  readonly installments = new IndexedDbStoreRepository<PaymentInstallment>(
    'payment_installments',
  );
  readonly transactions = new IndexedDbStoreRepository<FinancialTransaction>(
    'financial_transactions',
  );
  readonly plannedTasks = new IndexedDbStoreRepository<ScheduledTask>('planned_tasks');
  readonly reminders = new IndexedDbStoreRepository<Reminder>('reminders');

  async getSchemaMeta(): Promise<SchemaMeta | null> {
    const result = await runReadOnlyRequest<SchemaMeta | undefined>(
      '_meta_schema',
      (store) => store.get('schema'),
    );
    return result ?? null;
  }

  async loadWorkshopSnapshot(): Promise<WorkshopSnapshotInput> {
    return runAtomicTransaction<WorkshopSnapshotInput>(
      DATA_STORES_TOPOLOGICAL_ORDER,
      'readonly',
      (tx, done, fail) => {
        const result: Record<string, unknown[]> = {};
        let pending = DATA_STORES_TOPOLOGICAL_ORDER.length;
        let failed = false;

        for (const storeName of DATA_STORES_TOPOLOGICAL_ORDER) {
          const req = tx.objectStore(storeName).getAll();
          req.onerror = () => {
            if (!failed) {
              failed = true;
              fail(req.error);
            }
          };
          req.onsuccess = () => {
            if (failed) return;
            result[storeName] = req.result ?? [];
            pending -= 1;
            if (pending === 0) {
              const settingsList = result.workshop_settings as WorkshopSettings[];
              const activeSettings = normalizeWorkshopSettings(
                settingsList.find((s) => s.id === 'default'),
              );

              done({
                settings: activeSettings,
                projects: (result.projects as Project[]) ?? [],
                components: (result.project_components as ProjectComponent[]) ?? [],
                workSessions: (result.work_sessions as WorkSession[]) ?? [],
                materials: (result.materials as Material[]) ?? [],
                variants: (result.material_variants as MaterialVariant[]) ?? [],
                reservations: (result.inventory_reservations as InventoryReservation[]) ?? [],
                pendingMaterials: (result.pending_materials as PendingMaterial[]) ?? [],
                plannedTasks: (result.planned_tasks as ScheduledTask[]) ?? [],
                notesAndLists: (result.notes_and_lists as NoteOrList[]) ?? [],
                shoppingItems: (result.shopping_list_items as ShoppingListItem[]) ?? [],
                purchaseReceipts: (result.purchase_receipts as PurchaseReceipt[]) ?? [],
                movements: (result.inventory_movements as InventoryMovement[]) ?? [],
                clients: (result.clients as Client[]) ?? [],
                quotes: (result.quotes as Quote[]) ?? [],
                paymentPlans: (result.payment_plans as PaymentPlan[]) ?? [],
                installments: (result.payment_installments as PaymentInstallment[]) ?? [],
                transactions: (result.financial_transactions as FinancialTransaction[]) ?? [],
                reminders: (result.reminders as Reminder[]) ?? [],
              });
            }
          };
        }
      },
    );
  }

  async saveWorkshopSettings(
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
        | 'customMaterialCategories'
      >
    >,
  ): Promise<WorkshopSettings> {
    const rawCurrent = await this.settings.getById('default');
    const current = normalizeWorkshopSettings(rawCurrent);
    const nextCurrency = isSupportedCurrency(partial.currency)
      ? partial.currency
      : current.currency;
    const clampPercent = (value: number) =>
      Math.round(Math.max(0, Math.min(100, value)) * 100) / 100;
    const clampDays = (value: number | undefined, fallback: number) =>
      Math.max(0, Math.min(60, Math.round(value ?? fallback)));
    const nextCustomCategories =
      partial.customMaterialCategories !== undefined
        ? deduplicateCustomCategories(partial.customMaterialCategories)
        : deduplicateCustomCategories(current.customMaterialCategories);

    const updated: WorkshopSettings = {
      ...current,
      ...partial,
      id: 'default',
      isDemo: false,
      currency: nextCurrency,
      hourlyRateCOP: Math.max(
        0,
        roundCurrencyAmount(
          partial.hourlyRateCOP ?? current.hourlyRateCOP,
          nextCurrency,
        ),
      ),
      dailyGoalMinutes: Math.max(
        15,
        Math.round(partial.dailyGoalMinutes ?? current.dailyGoalMinutes),
      ),
      weeklyGoalMinutes: Math.max(
        30,
        Math.round(partial.weeklyGoalMinutes ?? current.weeklyGoalMinutes),
      ),
      defaultMarkupPercent: Math.max(
        0,
        Math.min(500, partial.defaultMarkupPercent ?? current.defaultMarkupPercent),
      ),
      rentCostPercent: clampPercent(
        partial.rentCostPercent ?? current.rentCostPercent,
      ),
      electricityCostPercent: clampPercent(
        partial.electricityCostPercent ?? current.electricityCostPercent,
      ),
      internetCostPercent: clampPercent(
        partial.internetCostPercent ?? current.internetCostPercent,
      ),
      wasteAndContingencyPercent: clampPercent(
        partial.wasteAndContingencyPercent ?? current.wasteAndContingencyPercent,
      ),
      reminderLeadDaysDelivery: clampDays(
        partial.reminderLeadDaysDelivery,
        current.reminderLeadDaysDelivery ?? 3,
      ),
      reminderLeadDaysInstallment: clampDays(
        partial.reminderLeadDaysInstallment,
        current.reminderLeadDaysInstallment ?? 2,
      ),
      reminderLeadDaysPurchase: clampDays(
        partial.reminderLeadDaysPurchase,
        current.reminderLeadDaysPurchase ?? 1,
      ),
      enableDeliveryReminders:
        partial.enableDeliveryReminders ?? current.enableDeliveryReminders ?? true,
      enableInstallmentReminders:
        partial.enableInstallmentReminders ?? current.enableInstallmentReminders ?? true,
      enablePurchaseReminders:
        partial.enablePurchaseReminders ?? current.enablePurchaseReminders ?? true,
      enableLowStockReminders:
        partial.enableLowStockReminders ?? current.enableLowStockReminders ?? true,
      enableClientReminders:
        partial.enableClientReminders ?? current.enableClientReminders ?? true,
      enableBrowserNotifications:
        partial.enableBrowserNotifications ?? current.enableBrowserNotifications ?? false,
      enableTimerNotifications:
        partial.enableTimerNotifications ?? current.enableTimerNotifications ?? true,
      timerReminderIntervalMinutes:
        partial.timerReminderIntervalMinutes !== undefined
          ? Math.max(0, Math.min(720, Math.round(partial.timerReminderIntervalMinutes)))
          : (current.timerReminderIntervalMinutes ?? 60),
      forgottenTimerThresholdMinutes:
        partial.forgottenTimerThresholdMinutes !== undefined
          ? Math.max(15, Math.min(1440, Math.round(partial.forgottenTimerThresholdMinutes)))
          : (current.forgottenTimerThresholdMinutes ?? 180),
      enableSoundAlerts:
        partial.enableSoundAlerts ?? current.enableSoundAlerts ?? false,
      enableVibrationAlerts:
        partial.enableVibrationAlerts ?? current.enableVibrationAlerts ?? true,
      quietHoursEnabled:
        partial.quietHoursEnabled ?? current.quietHoursEnabled ?? false,
      quietHoursStart:
        partial.quietHoursStart && /^\d{2}:\d{2}$/.test(partial.quietHoursStart)
          ? partial.quietHoursStart
          : (current.quietHoursStart ?? '22:00'),
      quietHoursEnd:
        partial.quietHoursEnd && /^\d{2}:\d{2}$/.test(partial.quietHoursEnd)
          ? partial.quietHoursEnd
          : (current.quietHoursEnd ?? '07:00'),
      customMaterialCategories: nextCustomCategories,
    };
    if (nextCurrency !== current.currency) {
      // Changing the unit of account without converting historical amounts
      // would silently reinterpret prices, inventory valuation and payments.
      // Check and write within one transaction so another tab cannot insert
      // workshop data between the safety check and the currency change.
      const saved = await runAtomicTransaction<WorkshopSettings>(
        DATA_STORES_TOPOLOGICAL_ORDER,
        'readwrite',
        (tx, done, fail) => {
          const settingsStore = tx.objectStore('workshop_settings');
          const settingsReq = settingsStore.get('default');
          settingsReq.onerror = () => fail(settingsReq.error);
          settingsReq.onsuccess = () => {
            const latest = normalizeWorkshopSettings(
              settingsReq.result as WorkshopSettings | undefined,
            );
            if (latest.currency !== current.currency) {
              fail(new Error('La moneda del taller cambió en otra pestaña. Actualiza la pantalla antes de guardar.'));
              return;
            }
            // The hourly rate lives in workshop_settings, outside the store
            // count guard. Require an explicit zero value in the SAME save
            // when changing currency: do not silently relabel an old rate,
            // but allow the user to clear it without a two-step workflow.
            if (Number(updated.hourlyRateCOP) !== 0) {
              fail(new Error(
                'Para cambiar la moneda sin convertir importes, establece la tarifa por hora en 0 y guarda ambos cambios juntos. Después podrás introducir una nueva tarifa en la moneda elegida.',
              ));
              return;
            }
            const storesToCheck = DATA_STORES_TOPOLOGICAL_ORDER.filter(
              (storeName) => storeName !== 'workshop_settings',
            );
            let pending = storesToCheck.length;
            let blocked = false;
            if (pending === 0) {
              settingsStore.put(updated);
              done(updated);
              return;
            }
            for (const storeName of storesToCheck) {
              const req = tx.objectStore(storeName).count();
              req.onerror = () => {
                if (!blocked) {
                  blocked = true;
                  fail(req.error);
                }
              };
              req.onsuccess = () => {
                if (blocked) return;
                if (req.result > 0) {
                  blocked = true;
                  fail(new Error(
                    'No se puede cambiar la moneda de un taller que ya contiene registros. Los importes existentes no se convierten automáticamente. Conserva la moneda actual para proteger inventario, cotizaciones y pagos.',
                  ));
                  return;
                }
                pending -= 1;
                if (pending === 0) {
                  settingsStore.put(updated);
                  done(updated);
                }
              };
            }
          };
        },
      );
      setActiveCurrency(saved.currency);
      return saved;
    }

    const saved = await this.settings.upsert(updated);
    setActiveCurrency(saved.currency);
    return saved;
  }

  async createProject(input: CreateProjectInput): Promise<Project> {
    const nowIso = new Date().toISOString();
    const project = buildNewProjectEntity(input, nowIso);
    const initialComps = (input.initialComponents ?? [])
      .filter((c) => c.name.trim().length > 0)
      .map((c, idx) =>
        buildNewComponentEntity(
          {
            projectId: project.id,
            name: c.name,
            estimatedMinutes: c.estimatedMinutes,
            notes: c.notes,
          },
          idx + 1,
          false,
          nowIso,
        ),
      );

    return runAtomicTransaction<Project>(
      ['projects', 'project_components', 'clients'],
      'readwrite',
      (tx, done, fail) => {
        const writeProjectAndComponents = () => {
          tx.objectStore('projects').put(project);
          const compStore = tx.objectStore('project_components');
          for (const comp of initialComps) {
            compStore.put(comp);
          }
          done(project);
        };

        if (project.clientId) {
          const clientReq = tx.objectStore('clients').get(project.clientId);
          clientReq.onerror = () => fail(clientReq.error);
          clientReq.onsuccess = () => {
            const client = clientReq.result as Client | undefined;
            if (!client) {
              fail(new Error('El cliente seleccionado no existe en el taller.'));
              return;
            }
            if (client.isDemo && !project.isDemo) {
              fail(
                new Error(
                  'Aislamiento de ejemplos: no puedes vincular un proyecto real con un cliente de demostración.',
                ),
              );
              return;
            }
            writeProjectAndComponents();
          };
        } else {
          writeProjectAndComponents();
        }
      },
    );
  }

  async updateProject(
    projectId: string,
    updates: UpdateProjectInput,
  ): Promise<Project> {
    const existing = await this.projects.getById(projectId);
    if (!existing) {
      throw new Error('El proyecto que intentas editar no existe.');
    }
    const updated = applyProjectUpdates(existing, updates);
    return this.projects.upsert(updated);
  }

  async deleteProjectCascade(projectId: string): Promise<void> {
    return runAtomicTransaction<void>(
      [
        'projects',
        'project_components',
        'work_sessions',
        'inventory_reservations',
        'pending_materials',
        'planned_tasks',
        'notes_and_lists',
        'shopping_list_items',
        'inventory_movements',
        'quotes',
        'payment_plans',
        'financial_transactions',
        'reminders',
      ],
      'readwrite',
      (tx, done, fail) => {
        const projReq = tx.objectStore('projects').get(projectId);
        projReq.onerror = () => fail(projReq.error);
        projReq.onsuccess = () => {
          const proj = projReq.result as Project | undefined;
          if (!proj) {
            done(undefined);
            return;
          }

          // Verificar que no tenga movimientos inmutables de Kardex ni pagos reales
          // ni reservas activas antes de permitir eliminar.
          const movReq = tx.objectStore('inventory_movements').getAll();
          const txReq = tx.objectStore('financial_transactions').getAll();
          const resReq = tx.objectStore('inventory_reservations').getAll();
          const planReq = tx.objectStore('payment_plans').getAll();
          const sessReq = tx.objectStore('work_sessions').getAll();
          const compReq = tx.objectStore('project_components').getAll();
          const pendReq = tx.objectStore('pending_materials').getAll();
          const taskReq = tx.objectStore('planned_tasks').getAll();
          const noteReq = tx.objectStore('notes_and_lists').getAll();
          const sliReq = tx.objectStore('shopping_list_items').getAll();
          const quoteReq = tx.objectStore('quotes').getAll();
          const remReq = tx.objectStore('reminders').getAll();

          let completedReads = 0;
          let aborted = false;

          const checkDone = () => {
            completedReads += 1;
            if (completedReads < 12 || aborted) return;

            const movements = (movReq.result as InventoryMovement[]) ?? [];
            const transactions = (txReq.result as FinancialTransaction[]) ?? [];
            const reservations = (resReq.result as InventoryReservation[]) ?? [];
            const plans = (planReq.result as PaymentPlan[]) ?? [];
            const sessions = (sessReq.result as WorkSession[]) ?? [];
            const comps = (compReq.result as ProjectComponent[]) ?? [];
            const pendings = (pendReq.result as PendingMaterial[]) ?? [];
            const tasks = (taskReq.result as ScheduledTask[]) ?? [];
            const notes = (noteReq.result as NoteOrList[]) ?? [];
            const shoppingItems = (sliReq.result as ShoppingListItem[]) ?? [];
            const quotes = (quoteReq.result as Quote[]) ?? [];
            const reminders = (remReq.result as Reminder[]) ?? [];

            const hasMovements = movements.some((m) => m.projectId === projectId);
            const hasTransactions = transactions.some((t) => t.projectId === projectId);
            const hasActiveReservations = reservations.some(
              (r) => r.projectId === projectId && r.status === 'active',
            );
            const hasPlans = plans.some((p) => p.projectId === projectId);
            const projPendings = pendings.filter((p) => p.projectId === projectId);
            const hasReceivedPendings = projPendings.some(
              (p) => p.quantityReceived > 0,
            );

            if (
              hasMovements ||
              hasTransactions ||
              hasActiveReservations ||
              hasPlans ||
              hasReceivedPendings
            ) {
              aborted = true;
              fail(
                new Error(
                  'Este proyecto tiene reservas de material, recepciones de compra, movimientos en Kardex o un plan de pagos asociado. Para conservar la trazabilidad histórica, cámbialo a estado "Cancelado" en lugar de eliminarlo.',
                ),
              );
              return;
            }

            const nowIso = new Date().toISOString();
            const projPendingIds = new Set(projPendings.map((p) => p.id));

            // Desvincular ítems de listas de compra que apuntaban a pendientes del proyecto eliminado
            const sliStore = tx.objectStore('shopping_list_items');
            for (const sli of shoppingItems) {
              if (sli.pendingMaterialId && projPendingIds.has(sli.pendingMaterialId)) {
                sliStore.put({
                  ...sli,
                  pendingMaterialId: null,
                  version: sli.version + 1,
                  updatedAt: nowIso,
                });
              }
            }

            // Eliminar tareas planificadas del proyecto eliminado
            const taskStore = tx.objectStore('planned_tasks');
            for (const t of tasks) {
              if (t.projectId === projectId) {
                taskStore.delete(t.id);
              }
            }

            // Eliminar recordatorios asociados directamente al proyecto o a sus pendientes
            const remStore = tx.objectStore('reminders');
            for (const r of reminders) {
              if (
                r.relatedEntityId === projectId ||
                (r.relatedEntityId && projPendingIds.has(r.relatedEntityId))
              ) {
                remStore.delete(r.id);
              }
            }

            // Eliminar materiales pendientes sin recepciones del proyecto
            const pendStore = tx.objectStore('pending_materials');
            for (const p of projPendings) {
              pendStore.delete(p.id);
            }

            // Desvincular notas/listas que estaban asociadas al proyecto
            const noteStore = tx.objectStore('notes_and_lists');
            for (const n of notes) {
              if (n.projectId === projectId) {
                noteStore.put({
                  ...n,
                  projectId: null,
                  version: n.version + 1,
                  updatedAt: nowIso,
                });
              }
            }

            // Desvincular cotizaciones que referenciaban al proyecto eliminado (conservando el historial)
            const quoteStore = tx.objectStore('quotes');
            for (const q of quotes) {
              if (q.projectId === projectId) {
                quoteStore.put({
                  ...q,
                  projectId: null,
                  version: q.version + 1,
                  updatedAt: nowIso,
                });
              }
            }

            const sessStore = tx.objectStore('work_sessions');
            for (const s of sessions) {
              if (s.projectId === projectId) {
                sessStore.delete(s.id);
              }
            }

            const compStore = tx.objectStore('project_components');
            for (const c of comps) {
              if (c.projectId === projectId) {
                compStore.delete(c.id);
              }
            }

            tx.objectStore('projects').delete(projectId);
            done(undefined);
          };

          for (const req of [
            movReq,
            txReq,
            resReq,
            planReq,
            sessReq,
            compReq,
            pendReq,
            taskReq,
            noteReq,
            sliReq,
            quoteReq,
            remReq,
          ]) {
            req.onerror = () => {
              if (!aborted) {
                aborted = true;
                fail(req.error);
              }
            };
            req.onsuccess = checkDone;
          }
        };
      },
    );
  }

  async createComponent(input: CreateComponentInput): Promise<ProjectComponent> {
    return runAtomicTransaction<ProjectComponent>(
      ['projects', 'project_components'],
      'readwrite',
      (tx, done, fail) => {
        const projReq = tx.objectStore('projects').get(input.projectId);
        projReq.onerror = () => fail(projReq.error);
        projReq.onsuccess = () => {
          const project = projReq.result as Project | undefined;
          if (!project) {
            fail(new Error('El proyecto seleccionado no existe.'));
            return;
          }

          const compStore = tx.objectStore('project_components');
          const indexReq = compStore.index('projectId').getAll(input.projectId);
          indexReq.onerror = () => fail(indexReq.error);
          indexReq.onsuccess = () => {
            const existing = (indexReq.result as ProjectComponent[]) ?? [];
            const maxOrder = existing.reduce(
              (max, c) => Math.max(max, c.orderIndex),
              0,
            );
            try {
              const component = buildNewComponentEntity(
                input,
                maxOrder + 1,
                project.isDemo,
              );
              compStore.put(component);
              done(component);
            } catch (err) {
              fail(err);
            }
          };
        };
      },
    );
  }

  async updateComponent(
    componentId: string,
    updates: UpdateComponentInput,
  ): Promise<ProjectComponent> {
    const existing = await this.components.getById(componentId);
    if (!existing) {
      throw new Error('La pieza o componente no existe.');
    }
    const updated = applyComponentUpdates(existing, updates);
    return this.components.upsert(updated);
  }

  async reorderComponent(
    componentId: string,
    direction: 'up' | 'down',
  ): Promise<void> {
    return runAtomicTransaction<void>(
      ['project_components'],
      'readwrite',
      (tx, done, fail) => {
        const store = tx.objectStore('project_components');
        const getReq = store.get(componentId);
        getReq.onerror = () => fail(getReq.error);
        getReq.onsuccess = () => {
          const target = getReq.result as ProjectComponent | undefined;
          if (!target) {
            done(undefined);
            return;
          }

          const allReq = store.index('projectId').getAll(target.projectId);
          allReq.onerror = () => fail(allReq.error);
          allReq.onsuccess = () => {
            const siblings = ((allReq.result as ProjectComponent[]) ?? []).sort(
              (a, b) => a.orderIndex - b.orderIndex,
            );
            const currentIdx = siblings.findIndex((c) => c.id === componentId);
            if (currentIdx === -1) {
              done(undefined);
              return;
            }
            const swapIdx = direction === 'up' ? currentIdx - 1 : currentIdx + 1;
            if (swapIdx < 0 || swapIdx >= siblings.length) {
              done(undefined);
              return;
            }

            const reordered = [...siblings];
            const [moved] = reordered.splice(currentIdx, 1);
            reordered.splice(swapIdx, 0, moved);

            const nowIso = new Date().toISOString();
            reordered.forEach((comp, idx) => {
              store.put({
                ...comp,
                orderIndex: idx + 1,
                version: comp.version + 1,
                updatedAt: nowIso,
              });
            });

            done(undefined);
          };
        };
      },
    );
  }

  async deleteComponent(componentId: string): Promise<void> {
    return runAtomicTransaction<void>(
      [
        'project_components',
        'work_sessions',
        'inventory_reservations',
        'pending_materials',
        'planned_tasks',
      ],
      'readwrite',
      (tx, done, fail) => {
        const compStore = tx.objectStore('project_components');
        const getReq = compStore.get(componentId);
        getReq.onerror = () => fail(getReq.error);
        getReq.onsuccess = () => {
          const target = getReq.result as ProjectComponent | undefined;
          if (!target) {
            done(undefined);
            return;
          }

          const sessReq = tx
            .objectStore('work_sessions')
            .index('componentId')
            .getAll(componentId);
          const resReq = tx.objectStore('inventory_reservations').getAll();
          const pendReq = tx.objectStore('pending_materials').getAll();
          const taskReq = tx.objectStore('planned_tasks').getAll();

          let reads = 0;
          let aborted = false;

          const finishCheck = () => {
            reads += 1;
            if (reads < 4 || aborted) return;

            const sessions = (sessReq.result as WorkSession[]) ?? [];
            const reservations = (resReq.result as InventoryReservation[]) ?? [];
            const pendings = (pendReq.result as PendingMaterial[]) ?? [];
            const tasks = (taskReq.result as ScheduledTask[]) ?? [];
            const hasReservation = reservations.some(
              (r) => r.componentId === componentId && r.status === 'active',
            );

            if (sessions.length > 0 || hasReservation) {
              aborted = true;
              fail(
                new Error(
                  'Esta pieza ya tiene sesiones de tiempo o reservas de material asociadas y no puede eliminarse.',
                ),
              );
              return;
            }

            const nowIso = new Date().toISOString();
            const resStore = tx.objectStore('inventory_reservations');
            const pieceTraceNote = `Pieza eliminada: ${target.name}`;
            for (const res of reservations) {
              if (res.componentId === componentId) {
                const trimmedNotes = (res.notes ?? '').trim();
                const nextNotes = trimmedNotes.includes(pieceTraceNote)
                  ? trimmedNotes
                  : trimmedNotes
                    ? `${trimmedNotes} · ${pieceTraceNote}`
                    : pieceTraceNote;
                resStore.put({
                  ...res,
                  componentId: null,
                  notes: nextNotes,
                  version: res.version + 1,
                  updatedAt: nowIso,
                });
              }
            }

            const pendStore = tx.objectStore('pending_materials');
            for (const pm of pendings) {
              if (pm.componentId === componentId) {
                pendStore.put({
                  ...pm,
                  componentId: null,
                  version: pm.version + 1,
                  updatedAt: nowIso,
                });
              }
            }

            const taskStore = tx.objectStore('planned_tasks');
            for (const task of tasks) {
              if (task.componentId === componentId) {
                taskStore.put({
                  ...task,
                  componentId: null,
                  version: task.version + 1,
                  updatedAt: nowIso,
                });
              }
            }

            compStore.delete(componentId);

            // Reindexar el orden de los hermanos restantes
            const siblingsReq = compStore
              .index('projectId')
              .getAll(target.projectId);
            siblingsReq.onerror = () => fail(siblingsReq.error);
            siblingsReq.onsuccess = () => {
              const remaining = (
                (siblingsReq.result as ProjectComponent[]) ?? []
              )
                .filter((c) => c.id !== componentId)
                .sort((a, b) => a.orderIndex - b.orderIndex);

              remaining.forEach((comp, idx) => {
                if (comp.orderIndex !== idx + 1) {
                  compStore.put({
                    ...comp,
                    orderIndex: idx + 1,
                    updatedAt: nowIso,
                  });
                }
              });
              done(undefined);
            };
          };

          for (const req of [sessReq, resReq, pendReq, taskReq]) {
            req.onerror = () => {
              if (!aborted) {
                aborted = true;
                fail(req.error);
              }
            };
            req.onsuccess = finishCheck;
          }
        };
      },
    );
  }

  async startTimerSession(
    projectId: string,
    componentId: string,
    notes?: string,
  ): Promise<WorkSession> {
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const newId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `sess_${nowMs}_${Math.random().toString(36).slice(2, 9)}`;

    return runAtomicTransaction<WorkSession>(
      ['projects', 'project_components', 'work_sessions'],
      'readwrite',
      (tx, done, fail) => {
        const projReq = tx.objectStore('projects').get(projectId);
        const compReq = tx.objectStore('project_components').get(componentId);
        const allSessReq = tx.objectStore('work_sessions').getAll();

        let reads = 0;
        let aborted = false;

        const onRead = () => {
          reads += 1;
          if (reads < 3 || aborted) return;

          const project = projReq.result as Project | undefined;
          const component = compReq.result as ProjectComponent | undefined;
          const existingSessions = (allSessReq.result as WorkSession[]) ?? [];

          if (!project) {
            fail(new Error('El proyecto seleccionado no existe.'));
            return;
          }
          if (!component || component.projectId !== projectId) {
            fail(new Error('La pieza seleccionada no pertenece a este proyecto.'));
            return;
          }

          // Si esa misma pieza ya tiene un cronómetro corriendo, retornarlo sin duplicar.
          const alreadyRunningSame = existingSessions.find(
            (s) => s.componentId === componentId && s.status === 'running',
          );
          if (alreadyRunningSame) {
            done(alreadyRunningSame);
            return;
          }

          const sessStore = tx.objectStore('work_sessions');

          // Exclusión mutua: auto-pausar cualquier otra sesión en curso en el mismo instante exacto.
          for (const active of existingSessions) {
            if (active.status === 'running') {
              const nextIntervals = [
                ...active.pauseIntervals,
                { pausedAt: nowIso, resumedAt: null },
              ];
              const breakdown = calculateSessionDurations(
                { ...active, pauseIntervals: nextIntervals },
                nowMs,
              );
              sessStore.put({
                ...active,
                status: 'paused',
                pauseIntervals: nextIntervals,
                elapsedSeconds: breakdown.elapsedSeconds,
                effectiveSeconds: breakdown.effectiveSeconds,
                version: active.version + 1,
                updatedAt: nowIso,
              });
            }
          }

          const createdSession: WorkSession = {
            id: newId,
            ownerId: 'local-workshop',
            syncStatus: 'local_only',
            version: 1,
            isDemo: project.isDemo,
            createdAt: nowIso,
            updatedAt: nowIso,
            projectId,
            componentId,
            startTime: nowIso,
            endTime: null,
            status: 'running',
            pauseIntervals: [],
            elapsedSeconds: 0,
            effectiveSeconds: 0,
            entryType: 'timer',
            adjustmentReason: null,
            notes: (notes ?? '').trim(),
          };
          sessStore.put(createdSession);

          if (component.status === 'pending') {
            tx.objectStore('project_components').put({
              ...component,
              status: 'in_progress',
              version: component.version + 1,
              updatedAt: nowIso,
            });
          }

          if (project.status === 'planning' || project.status === 'pending') {
            tx.objectStore('projects').put({
              ...project,
              status: 'in_progress',
              version: project.version + 1,
              updatedAt: nowIso,
            });
          }

          done(createdSession);
        };

        for (const req of [projReq, compReq, allSessReq]) {
          req.onerror = () => {
            if (!aborted) {
              aborted = true;
              fail(req.error);
            }
          };
          req.onsuccess = onRead;
        }
      },
    );
  }

  async pauseTimerSession(sessionId: string): Promise<WorkSession> {
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    return runAtomicTransaction<WorkSession>(
      ['work_sessions'],
      'readwrite',
      (tx, done, fail) => {
        const store = tx.objectStore('work_sessions');
        const getReq = store.get(sessionId);
        getReq.onerror = () => fail(getReq.error);
        getReq.onsuccess = () => {
          const target = getReq.result as WorkSession | undefined;
          if (!target) {
            fail(new Error('La sesión de cronómetro no existe.'));
            return;
          }
          if (target.status === 'completed') {
            fail(new Error('No puedes pausar una sesión ya finalizada.'));
            return;
          }
          if (target.status === 'paused') {
            done(target);
            return;
          }

          const nextIntervals = [
            ...target.pauseIntervals,
            { pausedAt: nowIso, resumedAt: null },
          ];
          const breakdown = calculateSessionDurations(
            { ...target, pauseIntervals: nextIntervals },
            nowMs,
          );
          const paused: WorkSession = {
            ...target,
            status: 'paused',
            pauseIntervals: nextIntervals,
            elapsedSeconds: breakdown.elapsedSeconds,
            effectiveSeconds: breakdown.effectiveSeconds,
            version: target.version + 1,
            updatedAt: nowIso,
          };
          store.put(paused);
          done(paused);
        };
      },
    );
  }

  async resumeTimerSession(sessionId: string): Promise<WorkSession> {
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    return runAtomicTransaction<WorkSession>(
      ['work_sessions'],
      'readwrite',
      (tx, done, fail) => {
        const store = tx.objectStore('work_sessions');
        const allReq = store.getAll();
        allReq.onerror = () => fail(allReq.error);
        allReq.onsuccess = () => {
          const allSessions = (allReq.result as WorkSession[]) ?? [];
          const target = allSessions.find((s) => s.id === sessionId);
          if (!target) {
            fail(new Error('La sesión que intentas reanudar no existe.'));
            return;
          }
          if (target.status === 'completed') {
            fail(new Error('No puedes reanudar una sesión ya finalizada.'));
            return;
          }
          if (target.status === 'running') {
            done(target);
            return;
          }

          // Auto-pausar cualquier otra sesión activa para evitar doble conteo
          for (const other of allSessions) {
            if (other.id !== sessionId && other.status === 'running') {
              const otherIntervals = [
                ...other.pauseIntervals,
                { pausedAt: nowIso, resumedAt: null },
              ];
              const otherBreakdown = calculateSessionDurations(
                { ...other, pauseIntervals: otherIntervals },
                nowMs,
              );
              store.put({
                ...other,
                status: 'paused',
                pauseIntervals: otherIntervals,
                elapsedSeconds: otherBreakdown.elapsedSeconds,
                effectiveSeconds: otherBreakdown.effectiveSeconds,
                version: other.version + 1,
                updatedAt: nowIso,
              });
            }
          }

          const closedIntervals = closeOpenPauseIntervals(
            target.pauseIntervals,
            nowIso,
          );
          const breakdown = calculateSessionDurations(
            { ...target, pauseIntervals: closedIntervals },
            nowMs,
          );
          const resumed: WorkSession = {
            ...target,
            status: 'running',
            pauseIntervals: closedIntervals,
            elapsedSeconds: breakdown.elapsedSeconds,
            effectiveSeconds: breakdown.effectiveSeconds,
            version: target.version + 1,
            updatedAt: nowIso,
          };
          store.put(resumed);
          done(resumed);
        };
      },
    );
  }

  async finishTimerSession(
    sessionId: string,
    options?: FinishTimerSessionOptions,
  ): Promise<WorkSession> {
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    return runAtomicTransaction<WorkSession>(
      ['work_sessions', 'project_components'],
      'readwrite',
      (tx, done, fail) => {
        const sessStore = tx.objectStore('work_sessions');
        const compStore = tx.objectStore('project_components');
        const targetReq = sessStore.get(sessionId);

        targetReq.onerror = () => fail(targetReq.error);
        targetReq.onsuccess = () => {
          const target = targetReq.result as WorkSession | undefined;
          if (!target) {
            fail(new Error('La sesión que intentas finalizar no existe.'));
            return;
          }
          if (target.status === 'completed') {
            done(target);
            return;
          }

          const compReq = compStore.get(target.componentId);
          const compSessionsReq = sessStore
            .index('componentId')
            .getAll(target.componentId);

          let reads = 0;
          let aborted = false;

          const finishTx = () => {
            reads += 1;
            if (reads < 2 || aborted) return;

            const component = compReq.result as ProjectComponent | undefined;
            const compSessions = (compSessionsReq.result as WorkSession[]) ?? [];

            const closedIntervals = closeOpenPauseIntervals(
              target.pauseIntervals,
              nowIso,
            );
            const breakdown = calculateSessionDurations(
              {
                ...target,
                endTime: nowIso,
                status: 'completed',
                pauseIntervals: closedIntervals,
              },
              nowMs,
            );

            const hasOverride =
              typeof options?.overrideEffectiveMinutes === 'number' &&
              Number.isFinite(options.overrideEffectiveMinutes);

            const finalEffectiveSeconds = hasOverride
              ? Math.max(0, Math.round((options?.overrideEffectiveMinutes ?? 0) * 60))
              : breakdown.effectiveSeconds;

            const finishedSession: WorkSession = {
              ...target,
              endTime: nowIso,
              status: 'completed',
              pauseIntervals: closedIntervals,
              elapsedSeconds: breakdown.elapsedSeconds,
              effectiveSeconds: finalEffectiveSeconds,
              entryType: hasOverride ? 'adjusted' : target.entryType,
              adjustmentReason: hasOverride
                ? options?.adjustmentReason?.trim() ||
                  'Ajuste de tiempo al finalizar sesión'
                : target.adjustmentReason,
              notes:
                options?.notes !== undefined
                  ? options.notes.trim()
                  : target.notes,
              version: target.version + 1,
              updatedAt: nowIso,
            };

            sessStore.put(finishedSession);

            if (component) {
              const mergedSessions = [
                ...compSessions.filter((s) => s.id !== sessionId),
                finishedSession,
              ];
              const totalEffectiveMinutes = sumComponentEffectiveMinutes(
                component.id,
                mergedSessions,
              );
              compStore.put({
                ...component,
                effectiveMinutesSpent: totalEffectiveMinutes,
                version: component.version + 1,
                updatedAt: nowIso,
              });
            }

            done(finishedSession);
          };

          compReq.onerror = () => {
            if (!aborted) {
              aborted = true;
              fail(compReq.error);
            }
          };
          compSessionsReq.onerror = () => {
            if (!aborted) {
              aborted = true;
              fail(compSessionsReq.error);
            }
          };
          compReq.onsuccess = finishTx;
          compSessionsReq.onsuccess = finishTx;
        };
      },
    );
  }

  async logManualWorkSession(input: ManualWorkSessionInput): Promise<WorkSession> {
    if (!Number.isFinite(input.effectiveMinutes) || input.effectiveMinutes <= 0) {
      throw new Error('Debes ingresar una duración mayor a 0 minutos.');
    }

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const parsedEnd = input.workDateIso ? Date.parse(input.workDateIso) : nowMs;
    const endMs = Number.isNaN(parsedEnd) ? nowMs : parsedEnd;
    const effectiveSeconds = Math.round(input.effectiveMinutes * 60);
    const startMs = Math.max(0, endMs - effectiveSeconds * 1000);

    const newId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `sess_${nowMs}_${Math.random().toString(36).slice(2, 9)}`;

    return runAtomicTransaction<WorkSession>(
      ['projects', 'project_components', 'work_sessions'],
      'readwrite',
      (tx, done, fail) => {
        const projReq = tx.objectStore('projects').get(input.projectId);
        const compReq = tx.objectStore('project_components').get(input.componentId);
        const compSessionsReq = tx
          .objectStore('work_sessions')
          .index('componentId')
          .getAll(input.componentId);

        let reads = 0;
        let aborted = false;

        const onRead = () => {
          reads += 1;
          if (reads < 3 || aborted) return;

          const project = projReq.result as Project | undefined;
          const component = compReq.result as ProjectComponent | undefined;
          const existingCompSessions =
            (compSessionsReq.result as WorkSession[]) ?? [];

          if (!project) {
            fail(new Error('El proyecto seleccionado no existe.'));
            return;
          }
          if (!component || component.projectId !== input.projectId) {
            fail(new Error('La pieza seleccionada no pertenece a este proyecto.'));
            return;
          }

          const manualSession: WorkSession = {
            id: newId,
            ownerId: 'local-workshop',
            syncStatus: 'local_only',
            version: 1,
            isDemo: project.isDemo,
            createdAt: nowIso,
            updatedAt: nowIso,
            projectId: input.projectId,
            componentId: input.componentId,
            startTime: new Date(startMs).toISOString(),
            endTime: new Date(endMs).toISOString(),
            status: 'completed',
            pauseIntervals: [],
            elapsedSeconds: effectiveSeconds,
            effectiveSeconds,
            entryType: 'manual',
            adjustmentReason: 'Registro manual de tiempo',
            notes: (input.notes ?? '').trim(),
          };

          tx.objectStore('work_sessions').put(manualSession);

          const totalEffectiveMinutes = sumComponentEffectiveMinutes(
            component.id,
            [...existingCompSessions, manualSession],
          );

          tx.objectStore('project_components').put({
            ...component,
            effectiveMinutesSpent: totalEffectiveMinutes,
            status:
              component.status === 'pending' ? 'in_progress' : component.status,
            version: component.version + 1,
            updatedAt: nowIso,
          });

          if (project.status === 'planning' || project.status === 'pending') {
            tx.objectStore('projects').put({
              ...project,
              status: 'in_progress',
              version: project.version + 1,
              updatedAt: nowIso,
            });
          }

          done(manualSession);
        };

        for (const req of [projReq, compReq, compSessionsReq]) {
          req.onerror = () => {
            if (!aborted) {
              aborted = true;
              fail(req.error);
            }
          };
          req.onsuccess = onRead;
        }
      },
    );
  }

  async adjustCompletedWorkSession(
    sessionId: string,
    newEffectiveMinutes: number,
    adjustmentReason: string,
  ): Promise<WorkSession> {
    if (!Number.isFinite(newEffectiveMinutes) || newEffectiveMinutes < 0) {
      throw new Error('El nuevo tiempo efectivo debe ser mayor o igual a 0 minutos.');
    }
    const cleanReason = adjustmentReason.trim();
    if (cleanReason.length < 3) {
      throw new Error('Debes indicar el motivo del ajuste (mínimo 3 caracteres).');
    }

    const nowIso = new Date().toISOString();

    return runAtomicTransaction<WorkSession>(
      ['work_sessions', 'project_components'],
      'readwrite',
      (tx, done, fail) => {
        const sessStore = tx.objectStore('work_sessions');
        const compStore = tx.objectStore('project_components');
        const getReq = sessStore.get(sessionId);

        getReq.onerror = () => fail(getReq.error);
        getReq.onsuccess = () => {
          const target = getReq.result as WorkSession | undefined;
          if (!target) {
            fail(new Error('La sesión que intentas ajustar no existe.'));
            return;
          }
          if (target.status !== 'completed') {
            fail(
              new Error(
                'Solo puedes ajustar sesiones finalizadas; finaliza la sesión actual primero.',
              ),
            );
            return;
          }

          const compReq = compStore.get(target.componentId);
          const compSessionsReq = sessStore
            .index('componentId')
            .getAll(target.componentId);

          let reads = 0;
          let aborted = false;

          const finishAdjust = () => {
            reads += 1;
            if (reads < 2 || aborted) return;

            const component = compReq.result as ProjectComponent | undefined;
            const compSessions = (compSessionsReq.result as WorkSession[]) ?? [];

            const adjustedSession: WorkSession = {
              ...target,
              effectiveSeconds: Math.round(newEffectiveMinutes * 60),
              entryType: 'adjusted',
              adjustmentReason: cleanReason,
              version: target.version + 1,
              updatedAt: nowIso,
            };
            sessStore.put(adjustedSession);

            if (component) {
              const merged = [
                ...compSessions.filter((s) => s.id !== sessionId),
                adjustedSession,
              ];
              const totalEffectiveMinutes = sumComponentEffectiveMinutes(
                component.id,
                merged,
              );
              compStore.put({
                ...component,
                effectiveMinutesSpent: totalEffectiveMinutes,
                version: component.version + 1,
                updatedAt: nowIso,
              });
            }

            done(adjustedSession);
          };

          compReq.onerror = () => {
            if (!aborted) {
              aborted = true;
              fail(compReq.error);
            }
          };
          compSessionsReq.onerror = () => {
            if (!aborted) {
              aborted = true;
              fail(compSessionsReq.error);
            }
          };
          compReq.onsuccess = finishAdjust;
          compSessionsReq.onsuccess = finishAdjust;
        };
      },
    );
  }

  private createLocalId(prefix: string): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  private roundQuantity(val: number): number {
    return Math.round(val * 100) / 100;
  }

  private buildImmutableMovement(params: {
    variantId: string;
    projectId: string | null;
    reservationId: string | null;
    purchaseReceiptId?: string | null;
    type: InventoryMovementType;
    quantityDelta: number;
    previousPhysicalStock: number;
    newPhysicalStock: number;
    previousReservedStock: number;
    newReservedStock: number;
    unitCostAtMovementCOP: number;
    notes: string;
    isDemo: boolean;
    nowIso: string;
  }): InventoryMovement {
    const id = this.createLocalId('mov');
    return {
      id,
      ownerId: 'local-workshop',
      syncStatus: 'local_only',
      version: 1,
      isDemo: params.isDemo,
      createdAt: params.nowIso,
      updatedAt: params.nowIso,
      variantId: params.variantId,
      projectId: params.projectId,
      reservationId: params.reservationId,
      purchaseReceiptId: params.purchaseReceiptId ?? null,
      type: params.type,
      quantityDelta: this.roundQuantity(params.quantityDelta),
      previousPhysicalStock: this.roundQuantity(params.previousPhysicalStock),
      newPhysicalStock: this.roundQuantity(params.newPhysicalStock),
      previousReservedStock: this.roundQuantity(params.previousReservedStock),
      newReservedStock: this.roundQuantity(params.newReservedStock),
      unitCostAtMovementCOP: Math.max(
        0,
        roundUnitCostAmount(params.unitCostAtMovementCOP, getActiveCurrency()),
      ),
      idempotencyKey: `mov_${params.type}_${id}`,
      notes: params.notes.trim(),
      timestamp: params.nowIso,
    };
  }

  async createMaterial(input: CreateMaterialInput): Promise<Material> {
    const cleanName = normalizeInventoryText(input.name);
    if (!cleanName) {
      throw new Error('El nombre del material es obligatorio.');
    }
    const cleanBrand = normalizeInventoryText(input.brand);
    const cleanDesc = input.description.trim();
    const nowIso = new Date().toISOString();

    return runAtomicTransaction<Material>(
      ['materials', 'workshop_settings'],
      'readwrite',
      (tx, done, fail) => {
        const matStore = tx.objectStore('materials');
        const settingsStore = tx.objectStore('workshop_settings');
        const allMatsReq = matStore.getAll();
        const settingsReq = settingsStore.get('default');

        let reads = 0;
        let aborted = false;

        const onRead = () => {
          reads += 1;
          if (reads < 2 || aborted) return;

          const allMaterials = (allMatsReq.result as Material[]) ?? [];
          const currentSettings = normalizeWorkshopSettings(
            (settingsReq.result as WorkshopSettings | undefined) ?? null,
          );

          const catalogOptions = buildMaterialCategoryOptions(
            allMaterials,
            currentSettings.customMaterialCategories,
          );
          const resolvedCategory = resolveMaterialCategorySelection({
            selectedCategory: input.category,
            existingCatalog: catalogOptions,
          }).category;

          if (!isPredefinedMaterialCategory(String(resolvedCategory))) {
            const nextCategories = deduplicateCustomCategories([
              ...(currentSettings.customMaterialCategories ?? []),
              String(resolvedCategory),
            ]);
            if (
              nextCategories.length !==
              (currentSettings.customMaterialCategories ?? []).length
            ) {
              settingsStore.put({
                ...currentSettings,
                customMaterialCategories: nextCategories,
                version: currentSettings.version + 1,
                updatedAt: nowIso,
              });
            }
          }

          // Protección estricta de unidades: nunca mezclar materiales con el mismo nombre pero distinta unidad de medida,
          // salvo que el usuario confirme explícitamente crear un material independiente.
          const sameNameReal = allMaterials.filter(
            (m) => !m.isDemo && isSameNormalizedText(m.name, cleanName),
          );

          if (!input.allowSeparateOnSameName) {
            const existingDuplicate = sameNameReal.find(
              (m) =>
                m.unit === input.unit &&
                (!cleanBrand ||
                  !m.brand ||
                  isSameNormalizedText(m.brand, cleanBrand)),
            );

            if (existingDuplicate) {
              const shouldEnrich =
                (!existingDuplicate.brand && Boolean(cleanBrand)) ||
                (!existingDuplicate.description && Boolean(cleanDesc));
              if (shouldEnrich) {
                const enriched: Material = {
                  ...existingDuplicate,
                  brand: existingDuplicate.brand || cleanBrand,
                  description: existingDuplicate.description || cleanDesc,
                  version: existingDuplicate.version + 1,
                  updatedAt: nowIso,
                };
                matStore.put(enriched);
                done(enriched);
                return;
              }
              done(existingDuplicate);
              return;
            }

            const unitConflict = sameNameReal.find((m) => m.unit !== input.unit);
            if (unitConflict) {
              fail(
                new Error(
                  `El material «${unitConflict.name}» ya está registrado en ${getUnitShortLabel(unitConflict.unit)}. No se pueden mezclar existencias en ${getUnitShortLabel(input.unit)} dentro del mismo material; cambia la unidad o confírmalo explícitamente como material separado.`,
                ),
              );
              return;
            }
          }

          const material: Material = {
            id: this.createLocalId('mat'),
            ownerId: 'local-workshop',
            syncStatus: 'local_only',
            version: 1,
            isDemo: false,
            createdAt: nowIso,
            updatedAt: nowIso,
            name: cleanName,
            category: resolvedCategory,
            brand: cleanBrand,
            unit: input.unit,
            description: cleanDesc,
          };
          matStore.put(material);
          done(material);
        };

        for (const req of [allMatsReq, settingsReq]) {
          req.onerror = () => {
            if (!aborted) {
              aborted = true;
              fail(req.error);
            }
          };
          req.onsuccess = onRead;
        }
      },
    );
  }

  async updateMaterial(
    materialId: string,
    updates: UpdateMaterialInput,
  ): Promise<Material> {
    const existing = await this.materials.getById(materialId);
    if (!existing) {
      throw new Error('El material que intentas editar no existe.');
    }
    const nextName =
      updates.name !== undefined
        ? normalizeInventoryText(updates.name)
        : existing.name;
    if (!nextName) {
      throw new Error('El nombre del material no puede quedar vacío.');
    }

    let nextCategory = updates.category ?? existing.category;
    if (updates.category !== undefined) {
      const [allMaterials, rawSettings] = await Promise.all([
        this.materials.getAll(),
        this.settings.getById('default'),
      ]);
      const currentSettings = normalizeWorkshopSettings(rawSettings);
      const catalogOptions = buildMaterialCategoryOptions(
        allMaterials,
        currentSettings.customMaterialCategories,
      );
      nextCategory = resolveMaterialCategorySelection({
        selectedCategory: updates.category,
        existingCatalog: catalogOptions,
      }).category;

      if (!isPredefinedMaterialCategory(String(nextCategory))) {
        const nextCustom = deduplicateCustomCategories([
          ...(currentSettings.customMaterialCategories ?? []),
          String(nextCategory),
        ]);
        if (
          nextCustom.length !==
          (currentSettings.customMaterialCategories ?? []).length
        ) {
          await this.saveWorkshopSettings({
            customMaterialCategories: nextCustom,
          });
        }
      }
    }

    return this.materials.upsert({
      ...existing,
      name: nextName,
      category: nextCategory,
      brand:
        updates.brand !== undefined
          ? normalizeInventoryText(updates.brand)
          : existing.brand,
      unit: updates.unit ?? existing.unit,
      description:
        updates.description !== undefined
          ? updates.description.trim()
          : existing.description,
    });
  }

  async deleteMaterial(materialId: string): Promise<void> {
    return runAtomicTransaction<void>(
      ['materials', 'material_variants'],
      'readwrite',
      (tx, done, fail) => {
        const varReq = tx
          .objectStore('material_variants')
          .index('materialId')
          .getAll(materialId);
        varReq.onerror = () => fail(varReq.error);
        varReq.onsuccess = () => {
          const variants = (varReq.result as MaterialVariant[]) ?? [];
          if (variants.length > 0) {
            fail(
              new Error(
                'No puedes eliminar este material porque tiene colores/variantes registrados. Elimina primero las variantes sin historial si deseas retirarlo.',
              ),
            );
            return;
          }
          const delReq = tx.objectStore('materials').delete(materialId);
          delReq.onerror = () => fail(delReq.error);
          delReq.onsuccess = () => done(undefined);
        };
      },
    );
  }

  async createVariant(input: CreateVariantInput): Promise<MaterialVariant> {
    const cleanColor = normalizeInventoryText(input.colorName);
    if (!cleanColor) {
      throw new Error(
        'El nombre del color es obligatorio para diferenciar cada variante de material.',
      );
    }
    if (!Number.isFinite(input.initialPhysicalStock) || input.initialPhysicalStock < 0) {
      throw new Error('El stock físico inicial debe ser mayor o igual a 0.');
    }
    const minStockAlertEnabled = input.minStockAlertEnabled !== false;
    const safeMinStock = input.minStock ?? 0;
    if (!Number.isFinite(safeMinStock) || safeMinStock < 0) {
      throw new Error('El stock mínimo debe ser mayor o igual a 0.');
    }
    if (!Number.isFinite(input.unitCostCOP) || input.unitCostCOP < 0) {
      throw new Error('El costo unitario debe ser mayor o igual a 0.');
    }

    const currency = getActiveCurrency();
    const nowIso = new Date().toISOString();
    const initialQty = this.roundQuantity(input.initialPhysicalStock);
    const cleanProvider = normalizeInventoryText(input.provider);
    const cleanSize = normalizeInventoryText(input.sizeOrGauge) || null;
    const cleanSku = normalizeInventoryText(input.sku) || null;

    return runAtomicTransaction<MaterialVariant>(
      ['materials', 'material_variants', 'inventory_movements'],
      'readwrite',
      (tx, done, fail) => {
        const matReq = tx.objectStore('materials').get(input.materialId);
        const siblingVarsReq = tx
          .objectStore('material_variants')
          .index('materialId')
          .getAll(input.materialId);

        let reads = 0;
        let aborted = false;

        const onRead = () => {
          reads += 1;
          if (reads < 2 || aborted) return;

          const material = matReq.result as Material | undefined;
          if (!material) {
            fail(new Error('El material padre no existe.'));
            return;
          }

          const siblings = (siblingVarsReq.result as MaterialVariant[]) ?? [];
          const existingSameColor = siblings.find((v) =>
            isSameNormalizedText(v.colorName, cleanColor),
          );

          // Si el color ya existe para este material, reutilizamos su variante sumando la nueva entrada,
          // recalculando el costo promedio ponderado y respetando la política de metadatos elegida por el usuario.
          if (existingSameColor) {
            const nextPhysical = this.roundQuantity(
              existingSameColor.physicalStock + initialQty,
            );
            const roundedInputCost = roundUnitCostAmount(input.unitCostCOP, currency);
            const entryCost =
              roundedInputCost > 0
                ? roundedInputCost
                : existingSameColor.unitCostCOP;

            const nextUnitCost =
              initialQty > 0
                ? computeWeightedAverageUnitCost({
                    previousPhysicalStock: existingSameColor.physicalStock,
                    previousUnitCost: existingSameColor.unitCostCOP,
                    entryQuantity: initialQty,
                    entryUnitCost: entryCost,
                    currency,
                  })
                : existingSameColor.unitCostCOP > 0
                  ? existingSameColor.unitCostCOP
                  : roundedInputCost;

            const strategy = input.metadataConflictStrategy ?? 'keep_existing';
            const incomingHex = input.colorHex?.trim() || null;
            const incomingNotes = input.notes.trim();

            const nextAlertEnabled =
              input.minStockAlertEnabled !== undefined
                ? minStockAlertEnabled
                : existingSameColor.minStockAlertEnabled ?? true;
            const nextMinStock =
              input.minStockAlertEnabled !== undefined
                ? safeMinStock > 0 ||
                  existingSameColor.minStock === 0 ||
                  minStockAlertEnabled
                  ? this.roundQuantity(safeMinStock)
                  : existingSameColor.minStock
                : existingSameColor.minStock;

            const updatedExisting: MaterialVariant = {
              ...existingSameColor,
              physicalStock: nextPhysical,
              colorHex:
                strategy === 'update_with_new' && incomingHex
                  ? incomingHex
                  : existingSameColor.colorHex || incomingHex,
              sizeOrGauge:
                strategy === 'update_with_new' && cleanSize
                  ? cleanSize
                  : existingSameColor.sizeOrGauge || cleanSize,
              sku:
                strategy === 'update_with_new' && cleanSku
                  ? cleanSku
                  : existingSameColor.sku || cleanSku,
              provider:
                strategy === 'update_with_new' && cleanProvider
                  ? cleanProvider
                  : existingSameColor.provider || cleanProvider,
              unitCostCOP: nextUnitCost,
              minStock: nextMinStock,
              minStockAlertEnabled: nextAlertEnabled,
              notes:
                strategy === 'update_with_new' && incomingNotes
                  ? incomingNotes
                  : existingSameColor.notes || incomingNotes,
              version: existingSameColor.version + 1,
              updatedAt: nowIso,
            };

            tx.objectStore('material_variants').put(updatedExisting);

            if (initialQty > 0) {
              const entryMov = this.buildImmutableMovement({
                variantId: updatedExisting.id,
                projectId: null,
                reservationId: null,
                type: 'MANUAL_ADJUSTMENT',
                quantityDelta: initialQty,
                previousPhysicalStock: existingSameColor.physicalStock,
                newPhysicalStock: nextPhysical,
                previousReservedStock: existingSameColor.reservedStock,
                newReservedStock: existingSameColor.reservedStock,
                unitCostAtMovementCOP: entryCost,
                notes:
                  incomingNotes ||
                  `Nueva entrada de existencias en ${material.name} · ${existingSameColor.colorName} (+${initialQty}).`,
                isDemo: updatedExisting.isDemo,
                nowIso,
              });
              tx.objectStore('inventory_movements').put(entryMov);
            }

            done(updatedExisting);
            return;
          }

          const variant: MaterialVariant = {
            id: this.createLocalId('var'),
            ownerId: 'local-workshop',
            syncStatus: 'local_only',
            version: 1,
            isDemo: material.isDemo,
            createdAt: nowIso,
            updatedAt: nowIso,
            materialId: material.id,
            colorName: cleanColor,
            colorHex: input.colorHex?.trim() || null,
            sizeOrGauge: cleanSize,
            sku: cleanSku,
            provider: cleanProvider,
            unitCostCOP: roundUnitCostAmount(input.unitCostCOP, currency),
            physicalStock: initialQty,
            reservedStock: 0,
            totalConsumed: 0,
            minStock: this.roundQuantity(safeMinStock),
            minStockAlertEnabled,
            photoUrl: null,
            notes: input.notes.trim(),
          };

          tx.objectStore('material_variants').put(variant);

          if (initialQty > 0) {
            const initMov = this.buildImmutableMovement({
              variantId: variant.id,
              projectId: null,
              reservationId: null,
              type: 'INITIAL_STOCK',
              quantityDelta: initialQty,
              previousPhysicalStock: 0,
              newPhysicalStock: initialQty,
              previousReservedStock: 0,
              newReservedStock: 0,
              unitCostAtMovementCOP: variant.unitCostCOP,
              notes: `Registro inicial de ${material.name} · ${variant.colorName}.`,
              isDemo: variant.isDemo,
              nowIso,
            });
            tx.objectStore('inventory_movements').put(initMov);
          }

          done(variant);
        };

        for (const req of [matReq, siblingVarsReq]) {
          req.onerror = () => {
            if (!aborted) {
              aborted = true;
              fail(req.error);
            }
          };
          req.onsuccess = onRead;
        }
      },
    );
  }

  async updateVariantMetadata(
    variantId: string,
    updates: UpdateVariantMetadataInput,
  ): Promise<MaterialVariant> {
    const existing = await this.variants.getById(variantId);
    if (!existing) {
      throw new Error('La variante de color que intentas editar no existe.');
    }
    const nextColor =
      updates.colorName !== undefined
        ? normalizeInventoryText(updates.colorName)
        : existing.colorName;
    if (!nextColor) {
      throw new Error('El nombre del color es obligatorio.');
    }
    const nextAlertEnabled =
      updates.minStockAlertEnabled !== undefined
        ? updates.minStockAlertEnabled
        : existing.minStockAlertEnabled ?? true;

    return this.variants.upsert({
      ...existing,
      colorName: nextColor,
      colorHex:
        updates.colorHex !== undefined
          ? updates.colorHex?.trim() || null
          : existing.colorHex,
      sizeOrGauge:
        updates.sizeOrGauge !== undefined
          ? normalizeInventoryText(updates.sizeOrGauge) || null
          : existing.sizeOrGauge,
      sku:
        updates.sku !== undefined
          ? normalizeInventoryText(updates.sku) || null
          : existing.sku,
      provider:
        updates.provider !== undefined
          ? normalizeInventoryText(updates.provider)
          : existing.provider,
      unitCostCOP:
        updates.unitCostCOP !== undefined
          ? Math.max(0, roundUnitCostAmount(updates.unitCostCOP, getActiveCurrency()))
          : existing.unitCostCOP,
      minStock:
        updates.minStock !== undefined
          ? Math.max(0, this.roundQuantity(updates.minStock))
          : existing.minStock,
      minStockAlertEnabled: nextAlertEnabled,
      notes: updates.notes !== undefined ? updates.notes.trim() : existing.notes,
    });
  }

  async deleteVariant(variantId: string): Promise<void> {
    return runAtomicTransaction<void>(
      [
        'material_variants',
        'inventory_reservations',
        'inventory_movements',
        'pending_materials',
        'shopping_list_items',
        'purchase_receipts',
        'quotes',
      ],
      'readwrite',
      (tx, done, fail) => {
        const resReq = tx
          .objectStore('inventory_reservations')
          .index('variantId')
          .getAll(variantId);
        const movReq = tx
          .objectStore('inventory_movements')
          .index('variantId')
          .getAll(variantId);
        const pendReq = tx
          .objectStore('pending_materials')
          .index('variantId')
          .getAll(variantId);
        const sliReq = tx
          .objectStore('shopping_list_items')
          .index('variantId')
          .getAll(variantId);
        const recReq = tx.objectStore('purchase_receipts').getAll();
        const quoteReq = tx.objectStore('quotes').getAll();

        let reads = 0;
        let aborted = false;

        const onRead = () => {
          reads += 1;
          if (reads < 6 || aborted) return;
          const reservations = (resReq.result as InventoryReservation[]) ?? [];
          const movements = (movReq.result as InventoryMovement[]) ?? [];
          const pendings = (pendReq.result as PendingMaterial[]) ?? [];
          const shoppingItems = (sliReq.result as ShoppingListItem[]) ?? [];
          const receipts = (recReq.result as PurchaseReceipt[]) ?? [];
          const quotes = (quoteReq.result as Quote[]) ?? [];
          const hasReceiptRef = receipts.some((r) =>
            r.items.some((item) => item.variantId === variantId),
          );

          if (
            reservations.length > 0 ||
            movements.length > 0 ||
            pendings.length > 0 ||
            shoppingItems.length > 0 ||
            hasReceiptRef
          ) {
            aborted = true;
            fail(
              new Error(
                'Este color ya tiene reservas, compras pendientes, listas o movimientos históricos y no puede eliminarse para preservar la trazabilidad.',
              ),
            );
            return;
          }

          // Desvincular snapshot de cotizaciones que usaban esta variante sin borrar el histórico cotizado
          const nowIso = new Date().toISOString();
          const quoteStore = tx.objectStore('quotes');
          for (const q of quotes) {
            if (q.materialsSnapshot.some((line) => line.variantId === variantId)) {
              quoteStore.put({
                ...q,
                materialsSnapshot: q.materialsSnapshot.map((line) =>
                  line.variantId === variantId ? { ...line, variantId: null } : line,
                ),
                version: q.version + 1,
                updatedAt: nowIso,
              });
            }
          }

          const delReq = tx.objectStore('material_variants').delete(variantId);
          delReq.onerror = () => fail(delReq.error);
          delReq.onsuccess = () => done(undefined);
        };

        for (const req of [resReq, movReq, pendReq, sliReq, recReq, quoteReq]) {
          req.onerror = () => {
            if (!aborted) {
              aborted = true;
              fail(req.error);
            }
          };
          req.onsuccess = onRead;
        }
      },
    );
  }

  async adjustVariantStock(input: AdjustStockInput): Promise<MaterialVariant> {
    if (!Number.isFinite(input.quantityDelta) || input.quantityDelta === 0) {
      throw new Error('La cantidad del ajuste debe ser distinta de 0.');
    }
    const cleanNotes = input.notes.trim();
    if (cleanNotes.length < 3) {
      throw new Error(
        'Debes indicar el motivo del ajuste en el Kardex (mínimo 3 caracteres).',
      );
    }

    const nowIso = new Date().toISOString();
    const delta = this.roundQuantity(input.quantityDelta);

    return runAtomicTransaction<MaterialVariant>(
      ['material_variants', 'inventory_movements'],
      'readwrite',
      (tx, done, fail) => {
        const varStore = tx.objectStore('material_variants');
        const getReq = varStore.get(input.variantId);
        getReq.onerror = () => fail(getReq.error);
        getReq.onsuccess = () => {
          const variant = getReq.result as MaterialVariant | undefined;
          if (!variant) {
            fail(new Error('La variante de color no existe.'));
            return;
          }

          const nextPhysical = this.roundQuantity(variant.physicalStock + delta);
          if (nextPhysical < 0) {
            fail(
              new Error(
                `El stock físico no puede quedar negativo (actual: ${variant.physicalStock}).`,
              ),
            );
            return;
          }
          if (nextPhysical < variant.reservedStock) {
            fail(
              new Error(
                `No puedes reducir el stock físico por debajo de lo ya reservado (${variant.reservedStock}). Libera o ajusta primero las reservas activas.`,
              ),
            );
            return;
          }

          const updated: MaterialVariant = {
            ...variant,
            physicalStock: nextPhysical,
            version: variant.version + 1,
            updatedAt: nowIso,
          };
          varStore.put(updated);

          const mov = this.buildImmutableMovement({
            variantId: variant.id,
            projectId: null,
            reservationId: null,
            type: 'MANUAL_ADJUSTMENT',
            quantityDelta: delta,
            previousPhysicalStock: variant.physicalStock,
            newPhysicalStock: nextPhysical,
            previousReservedStock: variant.reservedStock,
            newReservedStock: variant.reservedStock,
            unitCostAtMovementCOP: variant.unitCostCOP,
            notes: cleanNotes,
            isDemo: variant.isDemo,
            nowIso,
          });
          tx.objectStore('inventory_movements').put(mov);

          done(updated);
        };
      },
    );
  }

  async createReservation(
    input: CreateReservationInput,
  ): Promise<InventoryReservation> {
    if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
      throw new Error('La cantidad a reservar debe ser mayor a 0.');
    }

    const qty = this.roundQuantity(input.quantity);
    const nowIso = new Date().toISOString();
    const resId = this.createLocalId('res');

    return runAtomicTransaction<InventoryReservation>(
      [
        'projects',
        'project_components',
        'material_variants',
        'inventory_reservations',
        'inventory_movements',
      ],
      'readwrite',
      (tx, done, fail) => {
        const projReq = tx.objectStore('projects').get(input.projectId);
        const varReq = tx.objectStore('material_variants').get(input.variantId);
        const compReq = input.componentId
          ? tx.objectStore('project_components').get(input.componentId)
          : null;

        const needed = compReq ? 3 : 2;
        let reads = 0;
        let aborted = false;

        const onRead = () => {
          reads += 1;
          if (reads < needed || aborted) return;

          const project = projReq.result as Project | undefined;
          const variant = varReq.result as MaterialVariant | undefined;
          const component = compReq
            ? (compReq.result as ProjectComponent | undefined)
            : undefined;

          if (!project) {
            fail(new Error('El proyecto seleccionado no existe.'));
            return;
          }
          if (!variant) {
            fail(new Error('El material o color seleccionado no existe.'));
            return;
          }
          if (!project.isDemo && variant.isDemo) {
            fail(
              new Error(
                'Aislamiento de ejemplos: un proyecto real no puede reservar un material de demostración.',
              ),
            );
            return;
          }
          if (input.componentId && (!component || component.projectId !== project.id)) {
            fail(new Error('La pieza seleccionada no pertenece a este proyecto.'));
            return;
          }

          const available = this.roundQuantity(
            Math.max(0, variant.physicalStock - variant.reservedStock),
          );
          if (qty > available) {
            fail(
              new Error(
                `Stock disponible insuficiente en "${variant.colorName}": disponible ${available}, solicitado ${qty}.`,
              ),
            );
            return;
          }

          const nextReserved = this.roundQuantity(variant.reservedStock + qty);
          const updatedVariant: MaterialVariant = {
            ...variant,
            reservedStock: nextReserved,
            version: variant.version + 1,
            updatedAt: nowIso,
          };
          tx.objectStore('material_variants').put(updatedVariant);

          const reservation: InventoryReservation = {
            id: resId,
            ownerId: 'local-workshop',
            syncStatus: 'local_only',
            version: 1,
            isDemo: project.isDemo,
            createdAt: nowIso,
            updatedAt: nowIso,
            projectId: project.id,
            componentId: component?.id ?? null,
            variantId: variant.id,
            reservedQuantity: qty,
            consumedQuantity: 0,
            status: 'active',
            notes: (input.notes ?? '').trim(),
          };
          tx.objectStore('inventory_reservations').put(reservation);

          if (component && !component.requiredVariantIds.includes(variant.id)) {
            tx.objectStore('project_components').put({
              ...component,
              requiredVariantIds: [...component.requiredVariantIds, variant.id],
              version: component.version + 1,
              updatedAt: nowIso,
            });
          }

          const mov = this.buildImmutableMovement({
            variantId: variant.id,
            projectId: project.id,
            reservationId: reservation.id,
            type: 'RESERVATION_CREATED',
            quantityDelta: qty,
            previousPhysicalStock: variant.physicalStock,
            newPhysicalStock: variant.physicalStock,
            previousReservedStock: variant.reservedStock,
            newReservedStock: nextReserved,
            unitCostAtMovementCOP: variant.unitCostCOP,
            notes:
              input.notes?.trim() ||
              `Reserva de ${qty} para proyecto "${project.name}"${component ? ` (${component.name})` : ''}.`,
            isDemo: reservation.isDemo,
            nowIso,
          });
          tx.objectStore('inventory_movements').put(mov);

          done(reservation);
        };

        for (const req of [projReq, varReq, ...(compReq ? [compReq] : [])]) {
          req.onerror = () => {
            if (!aborted) {
              aborted = true;
              fail(req.error);
            }
          };
          req.onsuccess = onRead;
        }
      },
    );
  }

  async modifyReservationQuantity(
    reservationId: string,
    nextReservedQuantity: number,
    notes?: string,
  ): Promise<InventoryReservation> {
    if (!Number.isFinite(nextReservedQuantity) || nextReservedQuantity <= 0) {
      throw new Error('La cantidad reservada total debe ser mayor a 0.');
    }
    const nextTotal = this.roundQuantity(nextReservedQuantity);
    const nowIso = new Date().toISOString();

    return runAtomicTransaction<InventoryReservation>(
      ['material_variants', 'inventory_reservations', 'inventory_movements'],
      'readwrite',
      (tx, done, fail) => {
        const resStore = tx.objectStore('inventory_reservations');
        const getReq = resStore.get(reservationId);
        getReq.onerror = () => fail(getReq.error);
        getReq.onsuccess = () => {
          const reservation = getReq.result as InventoryReservation | undefined;
          if (!reservation) {
            fail(new Error('La reserva seleccionada no existe.'));
            return;
          }
          if (reservation.status !== 'active') {
            fail(new Error('Solo puedes modificar reservas activas.'));
            return;
          }
          if (nextTotal < reservation.consumedQuantity) {
            fail(
              new Error(
                `La reserva no puede ser menor a lo ya consumido (${reservation.consumedQuantity}).`,
              ),
            );
            return;
          }

          const varStore = tx.objectStore('material_variants');
          const varReq = varStore.get(reservation.variantId);
          varReq.onerror = () => fail(varReq.error);
          varReq.onsuccess = () => {
            const variant = varReq.result as MaterialVariant | undefined;
            if (!variant) {
              fail(new Error('La variante asociada a la reserva no existe.'));
              return;
            }

            const oldRemaining = this.roundQuantity(
              reservation.reservedQuantity - reservation.consumedQuantity,
            );
            const nextRemaining = this.roundQuantity(
              nextTotal - reservation.consumedQuantity,
            );
            const delta = this.roundQuantity(nextRemaining - oldRemaining);
            const available = this.roundQuantity(
              Math.max(0, variant.physicalStock - variant.reservedStock),
            );

            if (delta > available) {
              fail(
                new Error(
                  `No hay stock disponible suficiente para ampliar la reserva (+${delta} solicitado, ${available} disponible).`,
                ),
              );
              return;
            }

            const nextVariantReserved = this.roundQuantity(
              Math.max(0, variant.reservedStock + delta),
            );
            varStore.put({
              ...variant,
              reservedStock: nextVariantReserved,
              version: variant.version + 1,
              updatedAt: nowIso,
            });

            const updatedRes: InventoryReservation = {
              ...reservation,
              reservedQuantity: nextTotal,
              status:
                nextRemaining === 0 && reservation.consumedQuantity > 0
                  ? 'fulfilled'
                  : 'active',
              notes: notes !== undefined ? notes.trim() : reservation.notes,
              version: reservation.version + 1,
              updatedAt: nowIso,
            };
            resStore.put(updatedRes);

            const mov = this.buildImmutableMovement({
              variantId: variant.id,
              projectId: reservation.projectId,
              reservationId: reservation.id,
              type: 'RESERVATION_MODIFIED',
              quantityDelta: delta,
              previousPhysicalStock: variant.physicalStock,
              newPhysicalStock: variant.physicalStock,
              previousReservedStock: variant.reservedStock,
              newReservedStock: nextVariantReserved,
              unitCostAtMovementCOP: variant.unitCostCOP,
              notes:
                notes?.trim() ||
                `Ajuste de reserva de ${reservation.reservedQuantity} a ${nextTotal}.`,
              isDemo: reservation.isDemo,
              nowIso,
            });
            tx.objectStore('inventory_movements').put(mov);

            done(updatedRes);
          };
        };
      },
    );
  }

  async consumeFromReservation(
    input: ConsumeFromReservationInput,
  ): Promise<InventoryReservation> {
    if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
      throw new Error('La cantidad consumida debe ser mayor a 0.');
    }
    const qty = this.roundQuantity(input.quantity);
    const nowIso = new Date().toISOString();

    return runAtomicTransaction<InventoryReservation>(
      ['material_variants', 'inventory_reservations', 'inventory_movements'],
      'readwrite',
      (tx, done, fail) => {
        const resStore = tx.objectStore('inventory_reservations');
        const resReq = resStore.get(input.reservationId);
        resReq.onerror = () => fail(resReq.error);
        resReq.onsuccess = () => {
          const reservation = resReq.result as InventoryReservation | undefined;
          if (!reservation) {
            fail(new Error('La reserva seleccionada no existe.'));
            return;
          }
          if (reservation.status !== 'active') {
            fail(new Error('Solo puedes consumir material de una reserva activa.'));
            return;
          }
          const remaining = this.roundQuantity(
            reservation.reservedQuantity - reservation.consumedQuantity,
          );
          if (qty > remaining) {
            fail(
              new Error(
                `No puedes consumir más de lo pendiente en la reserva (pendiente: ${remaining}, intentado: ${qty}).`,
              ),
            );
            return;
          }

          const varStore = tx.objectStore('material_variants');
          const varReq = varStore.get(reservation.variantId);
          varReq.onerror = () => fail(varReq.error);
          varReq.onsuccess = () => {
            const variant = varReq.result as MaterialVariant | undefined;
            if (!variant) {
              fail(new Error('La variante asociada no existe.'));
              return;
            }
            if (variant.physicalStock < qty || variant.reservedStock < qty) {
              fail(
                new Error(
                  `Inconsistencia detectada: stock físico (${variant.physicalStock}) o reservado (${variant.reservedStock}) insuficiente para consumir ${qty}.`,
                ),
              );
              return;
            }

            const nextPhysical = this.roundQuantity(variant.physicalStock - qty);
            const nextReserved = this.roundQuantity(variant.reservedStock - qty);
            const nextConsumedTotal = this.roundQuantity(variant.totalConsumed + qty);

            varStore.put({
              ...variant,
              physicalStock: nextPhysical,
              reservedStock: nextReserved,
              totalConsumed: nextConsumedTotal,
              version: variant.version + 1,
              updatedAt: nowIso,
            });

            const nextResConsumed = this.roundQuantity(
              reservation.consumedQuantity + qty,
            );
            const updatedRes: InventoryReservation = {
              ...reservation,
              consumedQuantity: nextResConsumed,
              status:
                nextResConsumed >= reservation.reservedQuantity
                  ? 'fulfilled'
                  : 'active',
              version: reservation.version + 1,
              updatedAt: nowIso,
            };
            resStore.put(updatedRes);

            const mov = this.buildImmutableMovement({
              variantId: variant.id,
              projectId: reservation.projectId,
              reservationId: reservation.id,
              type: 'PROJECT_CONSUMPTION',
              quantityDelta: -qty,
              previousPhysicalStock: variant.physicalStock,
              newPhysicalStock: nextPhysical,
              previousReservedStock: variant.reservedStock,
              newReservedStock: nextReserved,
              unitCostAtMovementCOP: variant.unitCostCOP,
              notes:
                input.notes?.trim() ||
                `Consumo registrado desde reserva (${qty}).`,
              isDemo: reservation.isDemo,
              nowIso,
            });
            tx.objectStore('inventory_movements').put(mov);

            done(updatedRes);
          };
        };
      },
    );
  }

  async releaseReservation(
    reservationId: string,
    notes?: string,
  ): Promise<InventoryReservation> {
    const nowIso = new Date().toISOString();

    return runAtomicTransaction<InventoryReservation>(
      ['material_variants', 'inventory_reservations', 'inventory_movements'],
      'readwrite',
      (tx, done, fail) => {
        const resStore = tx.objectStore('inventory_reservations');
        const resReq = resStore.get(reservationId);
        resReq.onerror = () => fail(resReq.error);
        resReq.onsuccess = () => {
          const reservation = resReq.result as InventoryReservation | undefined;
          if (!reservation) {
            fail(new Error('La reserva seleccionada no existe.'));
            return;
          }
          if (reservation.status !== 'active') {
            fail(new Error('Esta reserva ya fue cerrada o liberada previamente.'));
            return;
          }

          const remaining = this.roundQuantity(
            Math.max(0, reservation.reservedQuantity - reservation.consumedQuantity),
          );

          const varStore = tx.objectStore('material_variants');
          const varReq = varStore.get(reservation.variantId);
          varReq.onerror = () => fail(varReq.error);
          varReq.onsuccess = () => {
            const variant = varReq.result as MaterialVariant | undefined;
            if (!variant) {
              fail(new Error('La variante asociada no existe.'));
              return;
            }

            const nextReserved = this.roundQuantity(
              Math.max(0, variant.reservedStock - remaining),
            );
            varStore.put({
              ...variant,
              reservedStock: nextReserved,
              version: variant.version + 1,
              updatedAt: nowIso,
            });

            const released: InventoryReservation = {
              ...reservation,
              status: 'released',
              notes: notes?.trim() || reservation.notes,
              version: reservation.version + 1,
              updatedAt: nowIso,
            };
            resStore.put(released);

            const mov = this.buildImmutableMovement({
              variantId: variant.id,
              projectId: reservation.projectId,
              reservationId: reservation.id,
              type: 'RESERVATION_RELEASED',
              quantityDelta: -remaining,
              previousPhysicalStock: variant.physicalStock,
              newPhysicalStock: variant.physicalStock,
              previousReservedStock: variant.reservedStock,
              newReservedStock: nextReserved,
              unitCostAtMovementCOP: variant.unitCostCOP,
              notes:
                notes?.trim() ||
                `Liberación de ${remaining} sin consumir hacia stock disponible.`,
              isDemo: reservation.isDemo,
              nowIso,
            });
            tx.objectStore('inventory_movements').put(mov);

            done(released);
          };
        };
      },
    );
  }

  async recordDirectProjectConsumption(
    input: DirectConsumptionInput,
  ): Promise<InventoryMovement> {
    if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
      throw new Error('La cantidad consumida debe ser mayor a 0.');
    }
    const qty = this.roundQuantity(input.quantity);
    const nowIso = new Date().toISOString();

    return runAtomicTransaction<InventoryMovement>(
      ['projects', 'material_variants', 'inventory_movements'],
      'readwrite',
      (tx, done, fail) => {
        const projReq = tx.objectStore('projects').get(input.projectId);
        const varReq = tx.objectStore('material_variants').get(input.variantId);

        let reads = 0;
        let aborted = false;

        const onRead = () => {
          reads += 1;
          if (reads < 2 || aborted) return;

          const project = projReq.result as Project | undefined;
          const variant = varReq.result as MaterialVariant | undefined;

          if (!project) {
            fail(new Error('El proyecto seleccionado no existe.'));
            return;
          }
          if (!variant) {
            fail(new Error('El material o color seleccionado no existe.'));
            return;
          }
          if (!project.isDemo && variant.isDemo) {
            fail(
              new Error(
                'Aislamiento de ejemplos: un proyecto real no puede consumir un material de demostración.',
              ),
            );
            return;
          }

          const available = this.roundQuantity(
            Math.max(0, variant.physicalStock - variant.reservedStock),
          );
          if (qty > available) {
            fail(
              new Error(
                `Stock disponible insuficiente para consumo directo en "${variant.colorName}": disponible sin reserva ${available}, solicitado ${qty}. Si este material ya estaba reservado para el proyecto, registra el consumo desde la reserva.`,
              ),
            );
            return;
          }

          const nextPhysical = this.roundQuantity(variant.physicalStock - qty);
          const nextTotalConsumed = this.roundQuantity(variant.totalConsumed + qty);

          tx.objectStore('material_variants').put({
            ...variant,
            physicalStock: nextPhysical,
            totalConsumed: nextTotalConsumed,
            version: variant.version + 1,
            updatedAt: nowIso,
          });

          const mov = this.buildImmutableMovement({
            variantId: variant.id,
            projectId: project.id,
            reservationId: null,
            type: 'PROJECT_CONSUMPTION',
            quantityDelta: -qty,
            previousPhysicalStock: variant.physicalStock,
            newPhysicalStock: nextPhysical,
            previousReservedStock: variant.reservedStock,
            newReservedStock: variant.reservedStock,
            unitCostAtMovementCOP: variant.unitCostCOP,
            notes:
              input.notes?.trim() ||
              `Consumo directo en proyecto "${project.name}".`,
            isDemo: project.isDemo,
            nowIso,
          });
          tx.objectStore('inventory_movements').put(mov);

          done(mov);
        };

        for (const req of [projReq, varReq]) {
          req.onerror = () => {
            if (!aborted) {
              aborted = true;
              fail(req.error);
            }
          };
          req.onsuccess = onRead;
        }
      },
    );
  }

  async createPendingMaterial(
    input: CreatePendingMaterialInput,
  ): Promise<PendingMaterial> {
    if (!Number.isFinite(input.quantityNeeded) || input.quantityNeeded <= 0) {
      throw new Error('La cantidad necesaria debe ser mayor a 0.');
    }
    const qtyNeeded = this.roundQuantity(input.quantityNeeded);
    const nowIso = new Date().toISOString();

    return runAtomicTransaction<PendingMaterial>(
      ['projects', 'project_components', 'material_variants', 'pending_materials'],
      'readwrite',
      (tx, done, fail) => {
        const projReq = tx.objectStore('projects').get(input.projectId);
        const varReq = tx.objectStore('material_variants').get(input.variantId);
        const compReq = input.componentId
          ? tx.objectStore('project_components').get(input.componentId)
          : null;

        const neededReads = compReq ? 3 : 2;
        let reads = 0;
        let aborted = false;

        const onRead = () => {
          reads += 1;
          if (reads < neededReads || aborted) return;

          const project = projReq.result as Project | undefined;
          const variant = varReq.result as MaterialVariant | undefined;
          const component = compReq
            ? (compReq.result as ProjectComponent | undefined)
            : undefined;

          if (!project) {
            fail(new Error('El proyecto seleccionado no existe.'));
            return;
          }
          if (!variant) {
            fail(new Error('El material o color seleccionado no existe.'));
            return;
          }
          if (!project.isDemo && variant.isDemo) {
            fail(
              new Error(
                'Aislamiento de ejemplos: un proyecto real no puede asociar un material de demostración.',
              ),
            );
            return;
          }
          if (input.componentId && (!component || component.projectId !== project.id)) {
            fail(new Error('La pieza seleccionada no pertenece al proyecto elegido.'));
            return;
          }

          const initialStatus = input.status ?? 'pending_order';
          const pending: PendingMaterial = {
            id: this.createLocalId('pend'),
            ownerId: 'local-workshop',
            syncStatus: 'local_only',
            version: 1,
            isDemo: project.isDemo,
            createdAt: nowIso,
            updatedAt: nowIso,
            variantId: variant.id,
            projectId: project.id,
            componentId: component?.id ?? null,
            quantityNeeded: qtyNeeded,
            quantityReceived: 0,
            provider: input.provider.trim() || variant.provider,
            orderedDate:
              initialStatus === 'ordered' ? input.orderedDate ?? nowIso : null,
            estimatedArrivalDate: input.estimatedArrivalDate ?? null,
            status: initialStatus,
            notes: (input.notes ?? '').trim(),
          };
          tx.objectStore('pending_materials').put(pending);

          if (
            component &&
            input.markComponentBlocked &&
            component.status !== 'completed' &&
            component.status !== 'blocked_by_material'
          ) {
            tx.objectStore('project_components').put({
              ...component,
              status: 'blocked_by_material',
              version: component.version + 1,
              updatedAt: nowIso,
            });
          }

          done(pending);
        };

        for (const req of [projReq, varReq, ...(compReq ? [compReq] : [])]) {
          req.onerror = () => {
            if (!aborted) {
              aborted = true;
              fail(req.error);
            }
          };
          req.onsuccess = onRead;
        }
      },
    );
  }

  async updatePendingMaterial(
    pendingId: string,
    updates: UpdatePendingMaterialInput,
  ): Promise<PendingMaterial> {
    const nowIso = new Date().toISOString();

    return runAtomicTransaction<PendingMaterial>(
      [
        'pending_materials',
        'project_components',
        'materials',
        'material_variants',
        'planned_tasks',
      ],
      'readwrite',
      (tx, done, fail) => {
        const pendReq = tx.objectStore('pending_materials').getAll();
        const compReq = tx.objectStore('project_components').getAll();
        const matReq = tx.objectStore('materials').getAll();
        const varReq = tx.objectStore('material_variants').getAll();
        const taskReq = tx.objectStore('planned_tasks').getAll();

        let reads = 0;
        let aborted = false;

        const onRead = () => {
          reads += 1;
          if (reads < 5 || aborted) return;

          const allPendings = (pendReq.result as PendingMaterial[]) ?? [];
          const existing = allPendings.find((p) => p.id === pendingId);
          if (!existing) {
            aborted = true;
            fail(new Error('El material pendiente no existe.'));
            return;
          }

          const nextQty =
            updates.quantityNeeded !== undefined
              ? this.roundQuantity(updates.quantityNeeded)
              : existing.quantityNeeded;
          if (!Number.isFinite(nextQty) || nextQty <= 0) {
            aborted = true;
            fail(new Error('La cantidad necesaria debe ser mayor a 0.'));
            return;
          }
          if (nextQty < existing.quantityReceived) {
            aborted = true;
            fail(
              new Error(
                `La cantidad necesaria no puede ser menor a lo ya recibido (${existing.quantityReceived}).`,
              ),
            );
            return;
          }

          const nextStatus = updates.status ?? existing.status;
          const nextOrderedDate =
            updates.orderedDate !== undefined
              ? updates.orderedDate
              : nextStatus === 'ordered' && !existing.orderedDate
                ? nowIso
                : existing.orderedDate;

          const updated: PendingMaterial = {
            ...existing,
            quantityNeeded: nextQty,
            provider:
              updates.provider !== undefined
                ? updates.provider.trim()
                : existing.provider,
            orderedDate: nextOrderedDate,
            estimatedArrivalDate:
              updates.estimatedArrivalDate !== undefined
                ? updates.estimatedArrivalDate
                : existing.estimatedArrivalDate,
            status: nextStatus,
            notes:
              updates.notes !== undefined ? updates.notes.trim() : existing.notes,
            version: existing.version + 1,
            updatedAt: nowIso,
          };

          tx.objectStore('pending_materials').put(updated);

          const nextPendingList = allPendings.map((p) =>
            p.id === updated.id ? updated : p,
          );
          const allComponents = (compReq.result as ProjectComponent[]) ?? [];
          const allMaterials = (matReq.result as Material[]) ?? [];
          const allVariants = (varReq.result as MaterialVariant[]) ?? [];
          const allTasks = (taskReq.result as ScheduledTask[]) ?? [];

          const taskStore = tx.objectStore('planned_tasks');
          for (const task of allTasks) {
            if (task.status === 'completed' || task.status === 'rescheduled') continue;
            const evalRes = evaluateTaskMaterialBlock({
              projectId: task.projectId,
              componentId: task.componentId,
              dependsOnPendingMaterialId: task.dependsOnPendingMaterialId,
              components: allComponents,
              pendingMaterials: nextPendingList,
              materials: allMaterials,
              variants: allVariants,
            });
            const desiredStatus = evalRes.isBlocked
              ? 'blocked_by_material'
              : 'scheduled';
            if (task.status !== desiredStatus) {
              taskStore.put({
                ...task,
                status: desiredStatus,
                version: task.version + 1,
                updatedAt: nowIso,
              });
            }
          }

          done(updated);
        };

        for (const req of [pendReq, compReq, matReq, varReq, taskReq]) {
          req.onerror = () => {
            if (!aborted) {
              aborted = true;
              fail(req.error);
            }
          };
          req.onsuccess = onRead;
        }
      },
    );
  }

  async deletePendingMaterial(pendingId: string): Promise<void> {
    return runAtomicTransaction<void>(
      [
        'pending_materials',
        'shopping_list_items',
        'purchase_receipts',
        'planned_tasks',
        'project_components',
        'materials',
        'material_variants',
      ],
      'readwrite',
      (tx, done, fail) => {
        const getReq = tx.objectStore('pending_materials').get(pendingId);
        const allPendReq = tx.objectStore('pending_materials').getAll();
        const sliReq = tx
          .objectStore('shopping_list_items')
          .index('pendingMaterialId')
          .getAll(pendingId);
        const recReq = tx.objectStore('purchase_receipts').getAll();
        const taskReq = tx.objectStore('planned_tasks').getAll();
        const compReq = tx.objectStore('project_components').getAll();
        const matReq = tx.objectStore('materials').getAll();
        const varReq = tx.objectStore('material_variants').getAll();

        let reads = 0;
        let aborted = false;

        const onRead = () => {
          reads += 1;
          if (reads < 8 || aborted) return;
          const existing = getReq.result as PendingMaterial | undefined;
          if (!existing) {
            done(undefined);
            return;
          }
          const linkedItems = (sliReq.result as ShoppingListItem[]) ?? [];
          const receipts = (recReq.result as PurchaseReceipt[]) ?? [];
          const tasks = (taskReq.result as ScheduledTask[]) ?? [];
          const remainingPendings = ((allPendReq.result as PendingMaterial[]) ?? []).filter(
            (p) => p.id !== pendingId,
          );
          const allComponents = (compReq.result as ProjectComponent[]) ?? [];
          const allMaterials = (matReq.result as Material[]) ?? [];
          const allVariants = (varReq.result as MaterialVariant[]) ?? [];

          const hasReceipt =
            existing.quantityReceived > 0 ||
            receipts.some((r) =>
              r.items.some((it) => it.pendingMaterialId === pendingId),
            );

          if (hasReceipt) {
            aborted = true;
            fail(
              new Error(
                'Este material pendiente ya registra recepciones en inventario y no puede eliminarse. Puedes cancelarlo o dejarlo en el historial.',
              ),
            );
            return;
          }

          const nowIso = new Date().toISOString();
          const sliStore = tx.objectStore('shopping_list_items');
          for (const item of linkedItems) {
            sliStore.put({
              ...item,
              pendingMaterialId: null,
              version: item.version + 1,
              updatedAt: nowIso,
            });
          }

          const taskStore = tx.objectStore('planned_tasks');
          for (const task of tasks) {
            const unlinkedDep =
              task.dependsOnPendingMaterialId === pendingId
                ? null
                : task.dependsOnPendingMaterialId;
            const evalRes = evaluateTaskMaterialBlock({
              projectId: task.projectId,
              componentId: task.componentId,
              dependsOnPendingMaterialId: unlinkedDep,
              components: allComponents,
              pendingMaterials: remainingPendings,
              materials: allMaterials,
              variants: allVariants,
            });
            const nextStatus =
              task.status === 'completed' || task.status === 'rescheduled'
                ? task.status
                : evalRes.isBlocked
                  ? 'blocked_by_material'
                  : 'scheduled';

            if (
              task.dependsOnPendingMaterialId === pendingId ||
              nextStatus !== task.status
            ) {
              taskStore.put({
                ...task,
                dependsOnPendingMaterialId: unlinkedDep,
                status: nextStatus,
                version: task.version + 1,
                updatedAt: nowIso,
              });
            }
          }

          tx.objectStore('pending_materials').delete(pendingId);
          done(undefined);
        };

        for (const req of [
          getReq,
          allPendReq,
          sliReq,
          recReq,
          taskReq,
          compReq,
          matReq,
          varReq,
        ]) {
          req.onerror = () => {
            if (!aborted) {
              aborted = true;
              fail(req.error);
            }
          };
          req.onsuccess = onRead;
        }
      },
    );
  }

  async createNoteOrList(input: CreateNoteOrListInput): Promise<NoteOrList> {
    const cleanTitle = input.title.trim();
    if (!cleanTitle) {
      throw new Error('El título de la nota o lista es obligatorio.');
    }
    const nowIso = new Date().toISOString();
    let isDemo = false;
    if (input.projectId) {
      const proj = await this.projects.getById(input.projectId);
      if (!proj) {
        throw new Error('El proyecto seleccionado no existe.');
      }
      isDemo = proj.isDemo;
    }

    const note: NoteOrList = {
      id: this.createLocalId(input.type === 'shopping_list' ? 'list' : 'note'),
      ownerId: 'local-workshop',
      syncStatus: 'local_only',
      version: 1,
      isDemo,
      createdAt: nowIso,
      updatedAt: nowIso,
      title: cleanTitle,
      type: input.type,
      projectId: input.projectId || null,
      content: input.content.trim(),
      status: 'active',
    };
    return this.notesAndLists.upsert(note);
  }

  async updateNoteOrList(
    noteId: string,
    updates: UpdateNoteOrListInput,
  ): Promise<NoteOrList> {
    const existing = await this.notesAndLists.getById(noteId);
    if (!existing) {
      throw new Error('La nota o lista no existe.');
    }
    const nextTitle =
      updates.title !== undefined ? updates.title.trim() : existing.title;
    if (!nextTitle) {
      throw new Error('El título no puede quedar vacío.');
    }
    return this.notesAndLists.upsert({
      ...existing,
      title: nextTitle,
      type: updates.type ?? existing.type,
      projectId:
        updates.projectId !== undefined
          ? updates.projectId || null
          : existing.projectId,
      content:
        updates.content !== undefined ? updates.content.trim() : existing.content,
      status: updates.status ?? existing.status,
    });
  }

  async deleteNoteOrList(noteId: string): Promise<void> {
    return runAtomicTransaction<void>(
      ['notes_and_lists', 'shopping_list_items', 'purchase_receipts'],
      'readwrite',
      (tx, done, fail) => {
        const listReq = tx.objectStore('notes_and_lists').get(noteId);
        const itemsReq = tx
          .objectStore('shopping_list_items')
          .index('listId')
          .getAll(noteId);
        const recReq = tx.objectStore('purchase_receipts').getAll();

        let reads = 0;
        let aborted = false;

        const onRead = () => {
          reads += 1;
          if (reads < 3 || aborted) return;
          const note = listReq.result as NoteOrList | undefined;
          if (!note) {
            done(undefined);
            return;
          }
          const items = (itemsReq.result as ShoppingListItem[]) ?? [];
          const receipts = (recReq.result as PurchaseReceipt[]) ?? [];
          const itemIds = new Set(items.map((i) => i.id));
          const hasReceived =
            items.some((i) => i.receivedQuantity > 0) ||
            receipts.some((r) =>
              r.items.some(
                (it) => it.shoppingListItemId && itemIds.has(it.shoppingListItemId),
              ),
            );

          if (hasReceived) {
            aborted = true;
            fail(
              new Error(
                'Esta lista tiene recepciones de compra registradas en el historial y no puede eliminarse. Puedes archivarla en su lugar.',
              ),
            );
            return;
          }

          const itemStore = tx.objectStore('shopping_list_items');
          for (const item of items) {
            itemStore.delete(item.id);
          }
          tx.objectStore('notes_and_lists').delete(noteId);
          done(undefined);
        };

        for (const req of [listReq, itemsReq, recReq]) {
          req.onerror = () => {
            if (!aborted) {
              aborted = true;
              fail(req.error);
            }
          };
          req.onsuccess = onRead;
        }
      },
    );
  }

  async createShoppingListItem(
    input: CreateShoppingListItemInput,
  ): Promise<ShoppingListItem> {
    if (!Number.isFinite(input.plannedQuantity) || input.plannedQuantity <= 0) {
      throw new Error('La cantidad planificada debe ser mayor a 0.');
    }
    if (
      !Number.isFinite(input.estimatedUnitPriceCOP) ||
      input.estimatedUnitPriceCOP < 0
    ) {
      throw new Error('El precio unitario estimado debe ser mayor o igual a 0.');
    }

    const list = await this.notesAndLists.getById(input.listId);
    if (!list) {
      throw new Error('La lista de compras seleccionada no existe.');
    }

    let cleanName = input.customName.trim();
    let cleanColor = input.colorName.trim();
    let unit = input.unit;
    let provider = input.provider.trim();
    let isDemo = list.isDemo;

    if (input.variantId) {
      const variant = await this.variants.getById(input.variantId);
      if (!variant) {
        throw new Error('La variante de material seleccionada no existe.');
      }
      if (!list.isDemo && variant.isDemo) {
        throw new Error(
          'Aislamiento de ejemplos: una lista real no puede incluir un material de demostración.',
        );
      }
      const material = await this.materials.getById(variant.materialId);
      if (!cleanName) cleanName = material?.name ?? 'Material';
      if (!cleanColor) cleanColor = variant.colorName;
      unit = material?.unit ?? unit;
      if (!provider) provider = variant.provider;
      isDemo = list.isDemo || variant.isDemo;
    }

    if (!cleanName) {
      throw new Error('El nombre del material o ítem de compra es obligatorio.');
    }

    const planned = this.roundQuantity(input.plannedQuantity);
    const status = input.status ?? 'pending';
    const purchased =
      input.purchasedQuantity !== undefined
        ? this.roundQuantity(Math.max(0, input.purchasedQuantity))
        : status === 'purchased_waiting_delivery'
          ? planned
          : 0;

    const nowIso = new Date().toISOString();
    const item: ShoppingListItem = {
      id: this.createLocalId('sli'),
      ownerId: 'local-workshop',
      syncStatus: 'local_only',
      version: 1,
      isDemo,
      createdAt: nowIso,
      updatedAt: nowIso,
      listId: list.id,
      variantId: input.variantId || null,
      pendingMaterialId: input.pendingMaterialId ?? null,
      customName: cleanName,
      colorName: cleanColor || 'Estándar',
      unit,
      plannedQuantity: planned,
      purchasedQuantity: purchased,
      receivedQuantity: 0,
      estimatedUnitPriceCOP: roundCurrencyAmount(
        input.estimatedUnitPriceCOP,
        getActiveCurrency(),
      ),
      provider,
      status,
      notes: (input.notes ?? '').trim(),
    };
    return this.shoppingListItems.upsert(item);
  }

  async updateShoppingListItem(
    itemId: string,
    updates: UpdateShoppingListItemInput,
  ): Promise<ShoppingListItem> {
    const existing = await this.shoppingListItems.getById(itemId);
    if (!existing) {
      throw new Error('El ítem de la lista de compras no existe.');
    }
    const nextPlanned =
      updates.plannedQuantity !== undefined
        ? this.roundQuantity(updates.plannedQuantity)
        : existing.plannedQuantity;
    if (!Number.isFinite(nextPlanned) || nextPlanned <= 0) {
      throw new Error('La cantidad planificada debe ser mayor a 0.');
    }
    if (nextPlanned < existing.receivedQuantity) {
      throw new Error(
        `No puedes reducir la cantidad planificada por debajo de lo ya recibido (${existing.receivedQuantity}).`,
      );
    }

    const nextStatus = updates.status ?? existing.status;
    let nextPurchased =
      updates.purchasedQuantity !== undefined
        ? this.roundQuantity(Math.max(0, updates.purchasedQuantity))
        : existing.purchasedQuantity;

    if (
      updates.status === 'purchased_waiting_delivery' &&
      updates.purchasedQuantity === undefined &&
      nextPurchased < nextPlanned
    ) {
      nextPurchased = nextPlanned;
    }

    return this.shoppingListItems.upsert({
      ...existing,
      variantId:
        updates.variantId !== undefined ? updates.variantId : existing.variantId,
      customName:
        updates.customName !== undefined
          ? updates.customName.trim() || existing.customName
          : existing.customName,
      colorName:
        updates.colorName !== undefined
          ? updates.colorName.trim() || existing.colorName
          : existing.colorName,
      unit: updates.unit ?? existing.unit,
      plannedQuantity: nextPlanned,
      purchasedQuantity: nextPurchased,
      estimatedUnitPriceCOP:
        updates.estimatedUnitPriceCOP !== undefined
          ? Math.max(
              0,
              roundCurrencyAmount(
                updates.estimatedUnitPriceCOP,
                getActiveCurrency(),
              ),
            )
          : existing.estimatedUnitPriceCOP,
      provider:
        updates.provider !== undefined ? updates.provider.trim() : existing.provider,
      status: nextStatus,
      notes: updates.notes !== undefined ? updates.notes.trim() : existing.notes,
    });
  }

  async deleteShoppingListItem(itemId: string): Promise<void> {
    return runAtomicTransaction<void>(
      ['shopping_list_items', 'purchase_receipts'],
      'readwrite',
      (tx, done, fail) => {
        const itemReq = tx.objectStore('shopping_list_items').get(itemId);
        const recReq = tx.objectStore('purchase_receipts').getAll();

        let reads = 0;
        let aborted = false;

        const onRead = () => {
          reads += 1;
          if (reads < 2 || aborted) return;
          const existing = itemReq.result as ShoppingListItem | undefined;
          if (!existing) {
            done(undefined);
            return;
          }
          const receipts = (recReq.result as PurchaseReceipt[]) ?? [];
          const hasReceipt =
            existing.receivedQuantity > 0 ||
            receipts.some((r) =>
              r.items.some((it) => it.shoppingListItemId === itemId),
            );
          if (hasReceipt) {
            aborted = true;
            fail(
              new Error(
                'Este ítem ya tiene recepciones registradas en inventario y no puede eliminarse.',
              ),
            );
            return;
          }
          tx.objectStore('shopping_list_items').delete(itemId);
          done(undefined);
        };

        for (const req of [itemReq, recReq]) {
          req.onerror = () => {
            if (!aborted) {
              aborted = true;
              fail(req.error);
            }
          };
          req.onsuccess = onRead;
        }
      },
    );
  }

  async sendPendingMaterialToShoppingList(
    pendingMaterialId: string,
    listId: string,
  ): Promise<ShoppingListItem> {
    const pending = await this.pendingMaterials.getById(pendingMaterialId);
    if (!pending) {
      throw new Error('El material pendiente no existe.');
    }
    const remaining = this.roundQuantity(
      Math.max(0, pending.quantityNeeded - pending.quantityReceived),
    );
    if (remaining <= 0 || pending.status === 'received' || pending.status === 'cancelled') {
      throw new Error('Este material pendiente ya fue recibido o cancelado.');
    }

    const existingItems = await this.shoppingListItems.queryByIndex(
      'pendingMaterialId',
      pendingMaterialId,
    );
    const openDuplicate = existingItems.find(
      (i) =>
        i.listId === listId &&
        i.status !== 'received_in_stock' &&
        i.status !== 'cancelled',
    );
    if (openDuplicate) {
      throw new Error('Este material pendiente ya está en esa lista de compras.');
    }

    const variant = await this.variants.getById(pending.variantId);
    if (!variant) {
      throw new Error('La variante asociada ya no existe.');
    }
    const material = await this.materials.getById(variant.materialId);

    return this.createShoppingListItem({
      listId,
      variantId: variant.id,
      pendingMaterialId: pending.id,
      customName: material?.name ?? 'Material',
      colorName: variant.colorName,
      unit: material?.unit ?? 'g',
      plannedQuantity: remaining,
      estimatedUnitPriceCOP: variant.unitCostCOP,
      provider: pending.provider || variant.provider,
      status:
        pending.status === 'ordered' ? 'purchased_waiting_delivery' : 'pending',
      notes: pending.notes,
    });
  }

  async receivePurchaseReceipt(
    input: CreatePurchaseReceiptInput,
  ): Promise<PurchaseReceipt> {
    const cleanProvider = input.provider.trim();
    if (!cleanProvider) {
      throw new Error('El nombre del proveedor o tienda es obligatorio.');
    }
    if (!input.items || input.items.length === 0) {
      throw new Error('Debes incluir al menos un material recibido.');
    }
    for (const line of input.items) {
      if (!line.variantId) {
        throw new Error(
          'Cada ítem recibido debe vincularse a un material/color del inventario para actualizar el stock.',
        );
      }
      if (!Number.isFinite(line.quantityReceived) || line.quantityReceived <= 0) {
        throw new Error('La cantidad recibida debe ser mayor a 0.');
      }
      if (!Number.isFinite(line.unitCostCOP) || line.unitCostCOP < 0) {
        throw new Error('El costo unitario debe ser mayor o igual a 0.');
      }
    }
    const currency = getActiveCurrency();

    const nowIso = new Date().toISOString();
    const receiptId = this.createLocalId('rec');

    return runAtomicTransaction<PurchaseReceipt>(
      [
        'materials',
        'material_variants',
        'shopping_list_items',
        'pending_materials',
        'project_components',
        'planned_tasks',
        'purchase_receipts',
        'inventory_movements',
      ],
      'readwrite',
      (tx, done, fail) => {
        const matReq = tx.objectStore('materials').getAll();
        const varReq = tx.objectStore('material_variants').getAll();
        const sliReq = tx.objectStore('shopping_list_items').getAll();
        const pendReq = tx.objectStore('pending_materials').getAll();
        const compReq = tx.objectStore('project_components').getAll();
        const taskReq = tx.objectStore('planned_tasks').getAll();
        const recReq = tx.objectStore('purchase_receipts').getAll();

        let reads = 0;
        let aborted = false;

        const onRead = () => {
          reads += 1;
          if (reads < 7 || aborted) return;

          const allReceipts = (recReq.result as PurchaseReceipt[]) ?? [];
          if (input.idempotencyKey) {
            const existingDup = allReceipts.find(
              (r) => r.idempotencyKey === input.idempotencyKey,
            );
            if (existingDup) {
              done(existingDup);
              return;
            }
          }

          const materialMap = new Map(
            ((matReq.result as Material[]) ?? []).map((m) => [m.id, m]),
          );
          const variantMap = new Map(
            ((varReq.result as MaterialVariant[]) ?? []).map((v) => [v.id, v]),
          );
          const sliMap = new Map(
            ((sliReq.result as ShoppingListItem[]) ?? []).map((i) => [i.id, i]),
          );
          const pendingMap = new Map(
            ((pendReq.result as PendingMaterial[]) ?? []).map((p) => [p.id, p]),
          );
          const componentMap = new Map(
            ((compReq.result as ProjectComponent[]) ?? []).map((c) => [c.id, c]),
          );

          const touchedVariants = new Set<string>();
          const touchedSli = new Set<string>();
          const touchedPending = new Set<string>();
          const touchedComponents = new Set<string>();
          const newMovements: InventoryMovement[] = [];
          const receiptItems: PurchaseReceiptItem[] = [];

          let isDemoReceipt: boolean | null = null;
          let totalCostCOP = 0;

          for (const line of input.items) {
            const variant = variantMap.get(line.variantId);
            if (!variant) {
              aborted = true;
              fail(
                new Error(
                  `La variante de material "${line.variantId}" no existe en el inventario.`,
                ),
              );
              return;
            }
            const material = materialMap.get(variant.materialId);

            if (isDemoReceipt === null) {
              isDemoReceipt = variant.isDemo;
            } else if (isDemoReceipt !== variant.isDemo) {
              aborted = true;
              fail(
                new Error(
                  'Aislamiento de ejemplos: no puedes mezclar materiales reales y de demostración en una misma recepción.',
                ),
              );
              return;
            }

            let resolvedPendingId = line.pendingMaterialId ?? null;
            let projectForMovement: string | null = null;

            if (line.shoppingListItemId) {
              const sli = sliMap.get(line.shoppingListItemId);
              if (!sli) {
                aborted = true;
                fail(
                  new Error(
                    'El ítem de lista de compras indicado no existe.',
                  ),
                );
                return;
              }
              if (sli.isDemo !== variant.isDemo) {
                aborted = true;
                fail(
                  new Error(
                    'Aislamiento de ejemplos: el ítem de lista y el color seleccionado no pertenecen al mismo entorno.',
                  ),
                );
                return;
              }
              if (!resolvedPendingId && sli.pendingMaterialId) {
                resolvedPendingId = sli.pendingMaterialId;
              }

              const qtyRec = this.roundQuantity(line.quantityReceived);
              const nextReceived = this.roundQuantity(sli.receivedQuantity + qtyRec);
              const nextPurchased = this.roundQuantity(
                Math.max(sli.purchasedQuantity, nextReceived),
              );
              const nextStatus =
                nextReceived >= sli.plannedQuantity
                  ? 'received_in_stock'
                  : 'partially_received';

              sliMap.set(sli.id, {
                ...sli,
                variantId: variant.id,
                purchasedQuantity: nextPurchased,
                receivedQuantity: nextReceived,
                estimatedUnitPriceCOP:
                  line.unitCostCOP > 0
                    ? roundUnitCostAmount(line.unitCostCOP, currency)
                    : sli.estimatedUnitPriceCOP,
                provider: cleanProvider || sli.provider,
                status: nextStatus,
                version: sli.version + 1,
                updatedAt: nowIso,
              });
              touchedSli.add(sli.id);
            }

            if (resolvedPendingId) {
              const pending = pendingMap.get(resolvedPendingId);
              if (!pending) {
                aborted = true;
                fail(
                  new Error(
                    'El material pendiente vinculado ya no existe.',
                  ),
                );
                return;
              }
              if (pending.isDemo !== variant.isDemo) {
                aborted = true;
                fail(
                  new Error(
                    'Aislamiento de ejemplos: el material pendiente y el color no pertenecen al mismo entorno.',
                  ),
                );
                return;
              }
              projectForMovement = pending.projectId;
              const qtyRec = this.roundQuantity(line.quantityReceived);
              const nextReceived = this.roundQuantity(pending.quantityReceived + qtyRec);
              const nextStatus =
                nextReceived >= pending.quantityNeeded
                  ? 'received'
                  : 'partially_received';

              pendingMap.set(pending.id, {
                ...pending,
                quantityReceived: nextReceived,
                provider: cleanProvider || pending.provider,
                status: nextStatus,
                version: pending.version + 1,
                updatedAt: nowIso,
              });
              touchedPending.add(pending.id);
            }

            const qtyRec = this.roundQuantity(line.quantityReceived);
            const unitCost = Math.max(0, roundUnitCostAmount(line.unitCostCOP, currency));
            const prevPhysical = variant.physicalStock;
            const nextPhysical = this.roundQuantity(prevPhysical + qtyRec);
            const nextVariantCost =
              line.updateVariantUnitCost !== false && unitCost > 0
                ? computeWeightedAverageUnitCost({
                    previousPhysicalStock: prevPhysical,
                    previousUnitCost: variant.unitCostCOP,
                    entryQuantity: qtyRec,
                    entryUnitCost: unitCost,
                    currency,
                  })
                : variant.unitCostCOP;

            variantMap.set(variant.id, {
              ...variant,
              physicalStock: nextPhysical,
              unitCostCOP: nextVariantCost,
              provider: cleanProvider || variant.provider,
              version: variant.version + 1,
              updatedAt: nowIso,
            });
            touchedVariants.add(variant.id);

            totalCostCOP = roundCurrencyAmount(
              totalCostCOP + roundCurrencyAmount(qtyRec * unitCost, currency),
              currency,
            );

            receiptItems.push({
              variantId: variant.id,
              shoppingListItemId: line.shoppingListItemId ?? null,
              pendingMaterialId: resolvedPendingId,
              materialNameSnapshot: material?.name ?? 'Material',
              colorNameSnapshot: variant.colorName,
              unitSnapshot: material?.unit ?? 'unit',
              quantityReceived: qtyRec,
              unitCostCOP: unitCost,
            });

            newMovements.push(
              this.buildImmutableMovement({
                variantId: variant.id,
                projectId: projectForMovement,
                reservationId: null,
                purchaseReceiptId: receiptId,
                type: 'PURCHASE_RECEIPT',
                quantityDelta: qtyRec,
                previousPhysicalStock: prevPhysical,
                newPhysicalStock: nextPhysical,
                previousReservedStock: variant.reservedStock,
                newReservedStock: variant.reservedStock,
                unitCostAtMovementCOP: unitCost || variant.unitCostCOP,
                notes: `Recepción de compra (${cleanProvider}${input.referenceCode?.trim() ? ` · Ref: ${input.referenceCode.trim()}` : ''}): +${qtyRec} ${material?.unit ?? ''}.`,
                isDemo: variant.isDemo,
                nowIso,
              }),
            );
          }

          // Desbloquear automáticamente componentes que estaban en 'blocked_by_material'
          // si ya no tienen materiales pendientes sin recibir.
          for (const pendingId of touchedPending) {
            const updatedPending = pendingMap.get(pendingId);
            if (
              !updatedPending ||
              updatedPending.status !== 'received' ||
              !updatedPending.componentId
            ) {
              continue;
            }
            const comp = componentMap.get(updatedPending.componentId);
            if (!comp || comp.status !== 'blocked_by_material') continue;

            const hasOtherOpenPending = Array.from(pendingMap.values()).some(
              (other) =>
                other.componentId === comp.id &&
                (other.status === 'pending_order' ||
                  other.status === 'ordered' ||
                  other.status === 'partially_received'),
            );
            if (!hasOtherOpenPending) {
              componentMap.set(comp.id, {
                ...comp,
                status: 'pending',
                version: comp.version + 1,
                updatedAt: nowIso,
              });
              touchedComponents.add(comp.id);
            }
          }

          const receipt: PurchaseReceipt = {
            id: receiptId,
            ownerId: 'local-workshop',
            syncStatus: 'local_only',
            version: 1,
            isDemo: Boolean(isDemoReceipt),
            createdAt: nowIso,
            updatedAt: nowIso,
            provider: cleanProvider,
            receiptDate: input.receiptDate || nowIso,
            referenceCode: input.referenceCode?.trim() || null,
            items: receiptItems,
            totalCostCOP: Math.max(0, roundCurrencyAmount(totalCostCOP, currency)),
            idempotencyKey: input.idempotencyKey || `rec_${receiptId}`,
            notes: (input.notes ?? '').trim(),
          };

          const varStore = tx.objectStore('material_variants');
          for (const vId of touchedVariants) {
            const v = variantMap.get(vId);
            if (v) varStore.put(v);
          }

          const sliStore = tx.objectStore('shopping_list_items');
          for (const sId of touchedSli) {
            const s = sliMap.get(sId);
            if (s) sliStore.put(s);
          }

          const pendStore = tx.objectStore('pending_materials');
          for (const pId of touchedPending) {
            const p = pendingMap.get(pId);
            if (p) pendStore.put(p);
          }

          const compStore = tx.objectStore('project_components');
          for (const cId of touchedComponents) {
            const c = componentMap.get(cId);
            if (c) compStore.put(c);
          }

          // Re-evaluar tareas planificadas bloqueadas tras la recepción de materiales
          const updatedComponentsList = Array.from(componentMap.values());
          const updatedPendingsList = Array.from(pendingMap.values());
          const updatedMaterialsList = Array.from(materialMap.values());
          const updatedVariantsList = Array.from(variantMap.values());
          const allTasks = (taskReq.result as ScheduledTask[]) ?? [];
          const taskStore = tx.objectStore('planned_tasks');
          for (const task of allTasks) {
            if (task.status === 'completed' || task.status === 'rescheduled') continue;
            const evalRes = evaluateTaskMaterialBlock({
              projectId: task.projectId,
              componentId: task.componentId,
              dependsOnPendingMaterialId: task.dependsOnPendingMaterialId,
              components: updatedComponentsList,
              pendingMaterials: updatedPendingsList,
              materials: updatedMaterialsList,
              variants: updatedVariantsList,
            });
            const desiredStatus = evalRes.isBlocked
              ? 'blocked_by_material'
              : 'scheduled';
            if (task.status !== desiredStatus) {
              taskStore.put({
                ...task,
                status: desiredStatus,
                version: task.version + 1,
                updatedAt: nowIso,
              });
            }
          }

          tx.objectStore('purchase_receipts').put(receipt);

          const movStore = tx.objectStore('inventory_movements');
          for (const mov of newMovements) {
            movStore.put(mov);
          }

          done(receipt);
        };

        for (const req of [matReq, varReq, sliReq, pendReq, compReq, taskReq, recReq]) {
          req.onerror = () => {
            if (!aborted) {
              aborted = true;
              fail(req.error);
            }
          };
          req.onsuccess = onRead;
        }
      },
    );
  }

  async createQuote(input: CreateQuoteInput): Promise<Quote> {
    const nowIso = new Date().toISOString();
    const quoteId = this.createLocalId('quote');

    return runAtomicTransaction<Quote>(
      ['quotes', 'projects', 'clients', 'material_variants'],
      'readwrite',
      (tx, done, fail) => {
        const projReq = input.projectId
          ? tx.objectStore('projects').get(input.projectId)
          : null;
        const clientReq = input.clientId
          ? tx.objectStore('clients').get(input.clientId)
          : null;
        const varReq = tx.objectStore('material_variants').getAll();

        const neededReads = 1 + (projReq ? 1 : 0) + (clientReq ? 1 : 0);
        let reads = 0;
        let aborted = false;

        const onRead = () => {
          reads += 1;
          if (reads < neededReads || aborted) return;

          const project = projReq
            ? (projReq.result as Project | undefined)
            : undefined;
          const client = clientReq
            ? (clientReq.result as Client | undefined)
            : undefined;
          const variantMap = new Map(
            ((varReq.result as MaterialVariant[]) ?? []).map((v) => [v.id, v]),
          );

          if (input.projectId && !project) {
            aborted = true;
            fail(new Error('El proyecto seleccionado no existe en el taller.'));
            return;
          }
          if (input.clientId && !client) {
            aborted = true;
            fail(new Error('El cliente seleccionado no existe en el taller.'));
            return;
          }

          let anyDemoVariant = false;
          for (const line of input.materialsSnapshot) {
            if (!line.variantId) continue;
            const variant = variantMap.get(line.variantId);
            if (!variant) {
              aborted = true;
              fail(
                new Error(
                  `La variante de material "${line.label}" ya no existe en el inventario.`,
                ),
              );
              return;
            }
            if (variant.isDemo) anyDemoVariant = true;
          }

          const derivedIsDemo =
            input.isDemo ??
            Boolean(project?.isDemo || client?.isDemo || anyDemoVariant);

          if (
            !derivedIsDemo &&
            (project?.isDemo || client?.isDemo || anyDemoVariant)
          ) {
            aborted = true;
            fail(
              new Error(
                'Aislamiento de ejemplos: una cotización real no puede vincular proyectos, clientes o materiales de demostración.',
              ),
            );
            return;
          }
          if (project && !project.isDemo && (client?.isDemo || anyDemoVariant)) {
            aborted = true;
            fail(
              new Error(
                'Aislamiento de ejemplos: no puedes mezclar un proyecto real con clientes o materiales de ejemplo.',
              ),
            );
            return;
          }

          try {
            const quote = buildNewQuoteEntity(
              { ...input, isDemo: derivedIsDemo },
              nowIso,
              quoteId,
            );
            tx.objectStore('quotes').put(quote);
            done(quote);
          } catch (err) {
            aborted = true;
            fail(err);
          }
        };

        for (const req of [varReq, ...(projReq ? [projReq] : []), ...(clientReq ? [clientReq] : [])]) {
          req.onerror = () => {
            if (!aborted) {
              aborted = true;
              fail(req.error);
            }
          };
          req.onsuccess = onRead;
        }
      },
    );
  }

  async updateQuote(quoteId: string, updates: UpdateQuoteInput): Promise<Quote> {
    const nowIso = new Date().toISOString();

    return runAtomicTransaction<Quote>(
      ['quotes', 'projects', 'clients', 'material_variants'],
      'readwrite',
      (tx, done, fail) => {
        const quoteStore = tx.objectStore('quotes');
        const quoteReq = quoteStore.get(quoteId);
        const varReq = tx.objectStore('material_variants').getAll();
        const projReq = tx.objectStore('projects').getAll();
        const clientReq = tx.objectStore('clients').getAll();

        let reads = 0;
        let aborted = false;

        const onRead = () => {
          reads += 1;
          if (reads < 4 || aborted) return;

          const existing = quoteReq.result as Quote | undefined;
          if (!existing) {
            aborted = true;
            fail(new Error('La cotización que intentas editar no existe.'));
            return;
          }

          const projectMap = new Map(
            ((projReq.result as Project[]) ?? []).map((p) => [p.id, p]),
          );
          const clientMap = new Map(
            ((clientReq.result as Client[]) ?? []).map((c) => [c.id, c]),
          );
          const variantMap = new Map(
            ((varReq.result as MaterialVariant[]) ?? []).map((v) => [v.id, v]),
          );

          const targetProjectId =
            updates.projectId !== undefined ? updates.projectId : existing.projectId;
          const targetClientId =
            updates.clientId !== undefined ? updates.clientId : existing.clientId;
          const targetLines = updates.materialsSnapshot ?? existing.materialsSnapshot;

          if (targetProjectId) {
            const p = projectMap.get(targetProjectId);
            if (!p) {
              aborted = true;
              fail(new Error('El proyecto vinculado no existe.'));
              return;
            }
            if (!existing.isDemo && p.isDemo) {
              aborted = true;
              fail(
                new Error(
                  'Aislamiento de ejemplos: una cotización real no puede vincularse con un proyecto de demostración.',
                ),
              );
              return;
            }
          }

          if (targetClientId) {
            const c = clientMap.get(targetClientId);
            if (!c) {
              aborted = true;
              fail(new Error('El cliente vinculado no existe.'));
              return;
            }
            if (!existing.isDemo && c.isDemo) {
              aborted = true;
              fail(
                new Error(
                  'Aislamiento de ejemplos: una cotización real no puede vincularse con un cliente de demostración.',
                ),
              );
              return;
            }
          }

          for (const line of targetLines) {
            if (!line.variantId) continue;
            const v = variantMap.get(line.variantId);
            if (!v) {
              aborted = true;
              fail(
                new Error(
                  `La variante de material "${line.label}" no existe en el inventario.`,
                ),
              );
              return;
            }
            if (!existing.isDemo && v.isDemo) {
              aborted = true;
              fail(
                new Error(
                  'Aislamiento de ejemplos: una cotización real no puede usar un material de demostración.',
                ),
              );
              return;
            }
          }

          try {
            const updated = applyQuoteUpdates(existing, updates, nowIso);
            quoteStore.put(updated);
            done(updated);
          } catch (err) {
            aborted = true;
            fail(err);
          }
        };

        for (const req of [quoteReq, varReq, projReq, clientReq]) {
          req.onerror = () => {
            if (!aborted) {
              aborted = true;
              fail(req.error);
            }
          };
          req.onsuccess = onRead;
        }
      },
    );
  }

  deleteQuote(quoteId: string): Promise<void> {
    return this.quotes.remove(quoteId);
  }

  async applyQuotePriceToProject(quoteId: string): Promise<Project> {
    const nowIso = new Date().toISOString();

    return runAtomicTransaction<Project>(
      ['quotes', 'projects'],
      'readwrite',
      (tx, done, fail) => {
        const quoteReq = tx.objectStore('quotes').get(quoteId);
        quoteReq.onerror = () => fail(quoteReq.error);
        quoteReq.onsuccess = () => {
          const quote = quoteReq.result as Quote | undefined;
          if (!quote) {
            fail(new Error('La cotización seleccionada no existe.'));
            return;
          }
          if (!quote.projectId) {
            fail(
              new Error(
                'Vincula esta cotización a un proyecto antes de aplicar su valor estimado.',
              ),
            );
            return;
          }

          const projStore = tx.objectStore('projects');
          const projReq = projStore.get(quote.projectId);
          projReq.onerror = () => fail(projReq.error);
          projReq.onsuccess = () => {
            const project = projReq.result as Project | undefined;
            if (!project) {
              fail(new Error('El proyecto vinculado ya no existe.'));
              return;
            }
            const nextBudget = Math.max(
              0,
              roundCurrencyAmount(
                quote.finalAgreedPriceCOP ?? quote.suggestedPriceCOP,
                getActiveCurrency(),
              ),
            );
            const updatedProject: Project = {
              ...project,
              estimatedBudgetCOP: nextBudget,
              version: project.version + 1,
              updatedAt: nowIso,
            };
            projStore.put(updatedProject);
            done(updatedProject);
          };
        };
      },
    );
  }

  async createClient(input: CreateClientInput): Promise<Client> {
    const cleanName = input.name.trim();
    if (!cleanName) {
      throw new Error('El nombre del cliente es obligatorio.');
    }
    const cleanPhone = input.phone.trim();
    const nowIso = new Date().toISOString();
    const client: Client = {
      id: this.createLocalId('client'),
      ownerId: 'local-workshop',
      syncStatus: 'local_only',
      version: 1,
      isDemo: false,
      createdAt: nowIso,
      updatedAt: nowIso,
      name: cleanName,
      phone: cleanPhone,
      email: input.email?.trim() ? input.email.trim() : null,
      address: input.address?.trim() ? input.address.trim() : null,
      notes: (input.notes ?? '').trim(),
    };
    return this.clients.upsert(client);
  }

  async updateClient(
    clientId: string,
    updates: UpdateClientInput,
  ): Promise<Client> {
    const existing = await this.clients.getById(clientId);
    if (!existing) {
      throw new Error('El cliente seleccionado no existe.');
    }
    const nextName =
      updates.name !== undefined ? updates.name.trim() : existing.name;
    if (!nextName) {
      throw new Error('El nombre del cliente no puede quedar vacío.');
    }
    return this.clients.upsert({
      ...existing,
      name: nextName,
      phone: updates.phone !== undefined ? updates.phone.trim() : existing.phone,
      email:
        updates.email !== undefined
          ? updates.email?.trim()
            ? updates.email.trim()
            : null
          : existing.email,
      address:
        updates.address !== undefined
          ? updates.address?.trim()
            ? updates.address.trim()
            : null
          : existing.address,
      notes: updates.notes !== undefined ? updates.notes.trim() : existing.notes,
    });
  }

  async deleteClient(clientId: string): Promise<void> {
    return runAtomicTransaction<void>(
      [
        'clients',
        'projects',
        'quotes',
        'payment_plans',
        'financial_transactions',
      ],
      'readwrite',
      (tx, done, fail) => {
        const projReq = tx.objectStore('projects').getAll();
        const quoteReq = tx.objectStore('quotes').getAll();
        const planReq = tx.objectStore('payment_plans').getAll();
        const txReq = tx.objectStore('financial_transactions').getAll();

        let reads = 0;
        let aborted = false;

        const check = () => {
          reads += 1;
          if (reads < 4 || aborted) return;

          const hasProject = ((projReq.result as Project[]) ?? []).some(
            (p) => p.clientId === clientId,
          );
          const hasQuote = ((quoteReq.result as Quote[]) ?? []).some(
            (q) => q.clientId === clientId,
          );
          const hasPlan = ((planReq.result as PaymentPlan[]) ?? []).some(
            (pl) => pl.clientId === clientId,
          );
          const hasTransaction = (
            (txReq.result as FinancialTransaction[]) ?? []
          ).some((t) => t.clientId === clientId);

          if (hasProject || hasQuote || hasPlan || hasTransaction) {
            aborted = true;
            fail(
              new Error(
                'No puedes eliminar este cliente porque tiene proyectos, cotizaciones, planes de pago o abonos asociados.',
              ),
            );
            return;
          }

          const delReq = tx.objectStore('clients').delete(clientId);
          delReq.onerror = () => fail(delReq.error);
          delReq.onsuccess = () => done(undefined);
        };

        for (const req of [projReq, quoteReq, planReq, txReq]) {
          req.onerror = () => {
            if (!aborted) {
              aborted = true;
              fail(req.error);
            }
          };
          req.onsuccess = check;
        }
      },
    );
  }

  async createPaymentPlan(input: CreatePaymentPlanInput): Promise<PaymentPlan> {
    const currency = getActiveCurrency();
    const totalAgreedCOP = roundCurrencyAmount(input.totalAgreedCOP, currency);
    validateInstallmentsAgainstTotal(totalAgreedCOP, input.installments, currency);

    if (input.initialPayment) {
      const initAmt = roundCurrencyAmount(input.initialPayment.amountCOP, currency);
      if (!Number.isFinite(initAmt) || toMinorUnits(initAmt, currency) <= 0) {
        throw new Error(`El abono inicial debe ser mayor a ${formatCOP(0, currency)}.`);
      }
      if (toMinorUnits(initAmt, currency) > toMinorUnits(totalAgreedCOP, currency)) {
        throw new Error(
          'El abono inicial no puede superar el valor total acordado.',
        );
      }
    }

    const nowIso = new Date().toISOString();
    const todayKey = toLocalDateKey(new Date());
    const planId = this.createLocalId('plan');
    const agreementDateIso = dateKeyToMiddayIso(
      input.agreementDateKey || todayKey,
    );

    return runAtomicTransaction<PaymentPlan>(
      [
        'payment_plans',
        'payment_installments',
        'financial_transactions',
        'projects',
        'clients',
      ],
      'readwrite',
      (tx, done, fail) => {
        const projReq = tx.objectStore('projects').get(input.projectId);
        const clientReq = tx.objectStore('clients').get(input.clientId);
        const allPlansReq = tx.objectStore('payment_plans').getAll();

        let reads = 0;
        let aborted = false;

        const onRead = () => {
          reads += 1;
          if (reads < 3 || aborted) return;

          const project = projReq.result as Project | undefined;
          const client = clientReq.result as Client | undefined;
          const existingPlans = (allPlansReq.result as PaymentPlan[]) ?? [];

          if (!project) {
            aborted = true;
            fail(new Error('El proyecto seleccionado no existe.'));
            return;
          }
          if (!client) {
            aborted = true;
            fail(new Error('El cliente seleccionado no existe.'));
            return;
          }
          if (!project.isDemo && client.isDemo) {
            aborted = true;
            fail(
              new Error(
                'Aislamiento de ejemplos: un proyecto real no puede vincularse con un cliente de demostración.',
              ),
            );
            return;
          }
          if (project.isDemo && !client.isDemo) {
            aborted = true;
            fail(
              new Error(
                'Aislamiento de ejemplos: usa un cliente de ejemplo para proyectos de demostración.',
              ),
            );
            return;
          }

          if (existingPlans.some((p) => p.projectId === project.id)) {
            aborted = true;
            fail(
              new Error(
                'Este proyecto ya tiene un plan de pagos registrado. Edítalo o registra abonos sobre el plan existente.',
              ),
            );
            return;
          }

          const isDemo = project.isDemo;
          const basePlan: PaymentPlan = {
            id: planId,
            ownerId: 'local-workshop',
            syncStatus: 'local_only',
            version: 1,
            isDemo,
            createdAt: nowIso,
            updatedAt: nowIso,
            projectId: project.id,
            clientId: client.id,
            totalAgreedCOP,
            agreementDate: agreementDateIso,
            modality: input.modality,
            totalPaidCOP: 0,
            balancePendingCOP: totalAgreedCOP,
            status: 'unpaid',
            notes: (input.notes ?? '').trim(),
          };

          let createdInstallments: PaymentInstallment[] = input.installments.map(
            (draft, idx) => {
              const dueIso = dateKeyToMiddayIso(draft.dueDateKey);
              const amt = roundCurrencyAmount(draft.scheduledAmountCOP, currency);
              return {
                id: this.createLocalId('inst'),
                ownerId: 'local-workshop',
                syncStatus: 'local_only',
                version: 1,
                isDemo,
                createdAt: nowIso,
                updatedAt: nowIso,
                planId,
                installmentNumber: idx + 1,
                concept: draft.concept.trim(),
                scheduledAmountCOP: amt,
                paidAmountCOP: 0,
                dueDate: dueIso,
                status: resolveInstallmentStatus(amt, 0, dueIso, todayKey, currency),
              };
            },
          );

          if (input.initialPayment && input.initialPayment.amountCOP > 0) {
            const initAmt = roundCurrencyAmount(input.initialPayment.amountCOP, currency);
            const firstInst = createdInstallments[0];
            try {
              createdInstallments = allocatePaymentAcrossInstallments(
                createdInstallments,
                firstInst?.id ?? null,
                initAmt,
                todayKey,
                currency,
              );
            } catch (err) {
              aborted = true;
              fail(err);
              return;
            }

            const paymentTx: FinancialTransaction = {
              id: this.createLocalId('tx'),
              ownerId: 'local-workshop',
              syncStatus: 'local_only',
              version: 1,
              isDemo,
              createdAt: nowIso,
              updatedAt: nowIso,
              planId,
              projectId: project.id,
              clientId: client.id,
              installmentId: firstInst?.id ?? null,
              amountCOP: initAmt,
              paymentDate: dateKeyToMiddayIso(
                input.initialPayment.paymentDateKey || todayKey,
              ),
              paymentMethod: input.initialPayment.paymentMethod,
              referenceNumber: input.initialPayment.referenceNumber?.trim()
                ? input.initialPayment.referenceNumber.trim()
                : null,
              notes: (
                input.initialPayment.notes ??
                `Pago inicial del plan (${firstInst?.concept ?? 'Cuota 1'})`
              ).trim(),
            };
            tx.objectStore('financial_transactions').put(paymentTx);
          }

          const recomputed = recomputePlanAndInstallments(
            basePlan,
            createdInstallments,
            todayKey,
          );

          const finalPlan: PaymentPlan = {
            ...basePlan,
            totalPaidCOP: recomputed.totalPaidCOP,
            balancePendingCOP: recomputed.balancePendingCOP,
            status: recomputed.status,
          };

          tx.objectStore('payment_plans').put(finalPlan);
          const instStore = tx.objectStore('payment_installments');
          for (const inst of recomputed.effectiveInstallments) {
            instStore.put(inst);
          }

          tx.objectStore('projects').put({
            ...project,
            clientId: project.clientId ?? client.id,
            paymentStatus: recomputed.projectPaymentStatus,
            version: project.version + 1,
            updatedAt: nowIso,
          });

          done(finalPlan);
        };

        for (const req of [projReq, clientReq, allPlansReq]) {
          req.onerror = () => {
            if (!aborted) {
              aborted = true;
              fail(req.error);
            }
          };
          req.onsuccess = onRead;
        }
      },
    );
  }

  async updatePaymentPlan(
    planId: string,
    updates: UpdatePaymentPlanInput,
  ): Promise<PaymentPlan> {
    const currency = getActiveCurrency();
    const totalAgreedCOP = roundCurrencyAmount(updates.totalAgreedCOP, currency);
    validateInstallmentsAgainstTotal(totalAgreedCOP, updates.installments, currency);

    const nowIso = new Date().toISOString();
    const todayKey = toLocalDateKey(new Date());

    return runAtomicTransaction<PaymentPlan>(
      [
        'payment_plans',
        'payment_installments',
        'financial_transactions',
        'projects',
      ],
      'readwrite',
      (tx, done, fail) => {
        const planReq = tx.objectStore('payment_plans').get(planId);
        const instReq = tx
          .objectStore('payment_installments')
          .index('planId')
          .getAll(planId);
        const txReq = tx
          .objectStore('financial_transactions')
          .index('planId')
          .getAll(planId);

        let reads = 0;
        let aborted = false;

        const onRead = () => {
          reads += 1;
          if (reads < 3 || aborted) return;

          const existingPlan = planReq.result as PaymentPlan | undefined;
          if (!existingPlan) {
            aborted = true;
            fail(new Error('El plan de pagos seleccionado no existe.'));
            return;
          }

          const existingInstallments =
            (instReq.result as PaymentInstallment[]) ?? [];
          const existingTransactions =
            (txReq.result as FinancialTransaction[]) ?? [];

          const ledgerPaidMinor = existingTransactions.reduce(
            (sum, t) => sum + Math.max(0, toMinorUnits(t.amountCOP, currency)),
            0,
          );

          if (toMinorUnits(totalAgreedCOP, currency) < ledgerPaidMinor) {
            const ledgerPaidTotal = existingTransactions.reduce(
              (sum, t) => sum + Math.max(0, roundCurrencyAmount(t.amountCOP, currency)),
              0,
            );
            aborted = true;
            fail(
              new Error(
                `El valor total acordado no puede ser menor al monto ya pagado (${formatCOP(ledgerPaidTotal, currency)} ${currency}).`,
              ),
            );
            return;
          }

          const existingInstById = new Map(
            existingInstallments.map((i) => [i.id, i]),
          );
          const keptIds = new Set(
            updates.installments
              .map((d) => d.id)
              .filter((id): id is string => Boolean(id)),
          );

          for (const oldInst of existingInstallments) {
            if (!keptIds.has(oldInst.id) && oldInst.paidAmountCOP > 0) {
              aborted = true;
              fail(
                new Error(
                  `La cuota "${oldInst.concept}" ya tiene abonos registrados y no puede eliminarse.`,
                ),
              );
              return;
            }
          }

          const nextInstallments: PaymentInstallment[] = [];
          for (let idx = 0; idx < updates.installments.length; idx += 1) {
            const draft = updates.installments[idx];
            const prev = draft.id ? existingInstById.get(draft.id) : undefined;
            const scheduledAmt = roundCurrencyAmount(draft.scheduledAmountCOP, currency);
            const paidAmt = prev ? prev.paidAmountCOP : 0;

            if (toMinorUnits(scheduledAmt, currency) < toMinorUnits(paidAmt, currency)) {
              aborted = true;
              fail(
                new Error(
                  `La cuota "${draft.concept}" ya recibió ${formatCOP(paidAmt, currency)} ${currency} y no puede reducirse por debajo de lo pagado.`,
                ),
              );
              return;
            }

            const dueIso = dateKeyToMiddayIso(draft.dueDateKey);
            nextInstallments.push({
              id: prev?.id ?? this.createLocalId('inst'),
              ownerId: prev?.ownerId ?? 'local-workshop',
              syncStatus: prev?.syncStatus ?? 'local_only',
              version: prev ? prev.version + 1 : 1,
              isDemo: existingPlan.isDemo,
              createdAt: prev?.createdAt ?? nowIso,
              updatedAt: nowIso,
              planId: existingPlan.id,
              installmentNumber: idx + 1,
              concept: draft.concept.trim(),
              scheduledAmountCOP: scheduledAmt,
              paidAmountCOP: paidAmt,
              dueDate: dueIso,
              status: resolveInstallmentStatus(
                scheduledAmt,
                paidAmt,
                dueIso,
                todayKey,
              ),
            });
          }

          const instStore = tx.objectStore('payment_installments');
          for (const oldInst of existingInstallments) {
            if (!keptIds.has(oldInst.id)) {
              instStore.delete(oldInst.id);
            }
          }

          const candidatePlan: PaymentPlan = {
            ...existingPlan,
            totalAgreedCOP,
            agreementDate: updates.agreementDateKey
              ? dateKeyToMiddayIso(updates.agreementDateKey)
              : existingPlan.agreementDate,
            modality: updates.modality,
            notes:
              updates.notes !== undefined
                ? updates.notes.trim()
                : existingPlan.notes,
            version: existingPlan.version + 1,
            updatedAt: nowIso,
          };

          const recomputed = recomputePlanAndInstallments(
            candidatePlan,
            nextInstallments,
            todayKey,
          );
          const finalPlan: PaymentPlan = {
            ...candidatePlan,
            totalPaidCOP: recomputed.totalPaidCOP,
            balancePendingCOP: recomputed.balancePendingCOP,
            status: recomputed.status,
          };

          for (const inst of recomputed.effectiveInstallments) {
            instStore.put(inst);
          }
          tx.objectStore('payment_plans').put(finalPlan);

          const projReq = tx.objectStore('projects').get(existingPlan.projectId);
          projReq.onerror = () => fail(projReq.error);
          projReq.onsuccess = () => {
            const project = projReq.result as Project | undefined;
            if (project) {
              tx.objectStore('projects').put({
                ...project,
                paymentStatus: recomputed.projectPaymentStatus,
                version: project.version + 1,
                updatedAt: nowIso,
              });
            }
            done(finalPlan);
          };
        };

        for (const req of [planReq, instReq, txReq]) {
          req.onerror = () => {
            if (!aborted) {
              aborted = true;
              fail(req.error);
            }
          };
          req.onsuccess = onRead;
        }
      },
    );
  }

  async deletePaymentPlan(planId: string): Promise<void> {
    const nowIso = new Date().toISOString();

    return runAtomicTransaction<void>(
      [
        'payment_plans',
        'payment_installments',
        'financial_transactions',
        'projects',
        'reminders',
      ],
      'readwrite',
      (tx, done, fail) => {
        const planReq = tx.objectStore('payment_plans').get(planId);
        const instReq = tx
          .objectStore('payment_installments')
          .index('planId')
          .getAll(planId);
        const txReq = tx
          .objectStore('financial_transactions')
          .index('planId')
          .getAll(planId);
        const remReq = tx.objectStore('reminders').getAll();

        let reads = 0;
        let aborted = false;

        const onRead = () => {
          reads += 1;
          if (reads < 4 || aborted) return;

          const plan = planReq.result as PaymentPlan | undefined;
          if (!plan) {
            done(undefined);
            return;
          }

          const planTxs = (txReq.result as FinancialTransaction[]) ?? [];
          if (planTxs.length > 0) {
            aborted = true;
            fail(
              new Error(
                'No puedes eliminar este plan de pagos porque ya tiene abonos registrados en caja. El historial financiero es inmutable.',
              ),
            );
            return;
          }

          const planInsts = (instReq.result as PaymentInstallment[]) ?? [];
          const instIds = new Set(planInsts.map((i) => i.id));
          const reminders = (remReq.result as Reminder[]) ?? [];

          const remStore = tx.objectStore('reminders');
          for (const rem of reminders) {
            if (
              rem.relatedEntityType === 'installment' &&
              rem.relatedEntityId &&
              instIds.has(rem.relatedEntityId)
            ) {
              remStore.delete(rem.id);
            }
          }

          const instStore = tx.objectStore('payment_installments');
          for (const inst of planInsts) {
            instStore.delete(inst.id);
          }

          tx.objectStore('payment_plans').delete(planId);

          const projReq = tx.objectStore('projects').get(plan.projectId);
          projReq.onerror = () => fail(projReq.error);
          projReq.onsuccess = () => {
            const project = projReq.result as Project | undefined;
            if (project) {
              tx.objectStore('projects').put({
                ...project,
                paymentStatus: project.clientId ? 'unpaid' : 'not_applicable',
                version: project.version + 1,
                updatedAt: nowIso,
              });
            }
            done(undefined);
          };
        };

        for (const req of [planReq, instReq, txReq, remReq]) {
          req.onerror = () => {
            if (!aborted) {
              aborted = true;
              fail(req.error);
            }
          };
          req.onsuccess = onRead;
        }
      },
    );
  }

  async recordPaymentTransaction(
    input: RecordPaymentTransactionInput,
  ): Promise<FinancialTransaction> {
    const currency = getActiveCurrency();
    const amountCOP = roundCurrencyAmount(input.amountCOP, currency);
    if (!Number.isFinite(amountCOP) || toMinorUnits(amountCOP, currency) <= 0) {
      throw new Error(`El monto del abono debe ser mayor a ${formatCOP(0, currency)}.`);
    }

    const nowIso = new Date().toISOString();
    const todayKey = toLocalDateKey(new Date());
    const txId = this.createLocalId('tx');

    return runAtomicTransaction<FinancialTransaction>(
      [
        'payment_plans',
        'payment_installments',
        'financial_transactions',
        'projects',
      ],
      'readwrite',
      (tx, done, fail) => {
        const planReq = tx.objectStore('payment_plans').get(input.planId);
        const instReq = tx
          .objectStore('payment_installments')
          .index('planId')
          .getAll(input.planId);

        let reads = 0;
        let aborted = false;

        const onRead = () => {
          reads += 1;
          if (reads < 2 || aborted) return;

          const plan = planReq.result as PaymentPlan | undefined;
          if (!plan) {
            aborted = true;
            fail(new Error('El plan de pagos seleccionado no existe.'));
            return;
          }

          const installments = (instReq.result as PaymentInstallment[]) ?? [];
          if (installments.length === 0) {
            aborted = true;
            fail(new Error('El plan de pagos no tiene cuotas configuradas.'));
            return;
          }

          if (input.installmentId) {
            const target = installments.find((i) => i.id === input.installmentId);
            if (!target) {
              aborted = true;
              fail(new Error('La cuota seleccionada no pertenece a este plan.'));
              return;
            }
          }

          let allocatedInstallments: PaymentInstallment[];
          try {
            allocatedInstallments = allocatePaymentAcrossInstallments(
              installments,
              input.installmentId,
              amountCOP,
              todayKey,
            );
          } catch (err) {
            aborted = true;
            fail(err);
            return;
          }

          const stampedInstallments = allocatedInstallments.map((inst) => ({
            ...inst,
            version: inst.version + 1,
            updatedAt: nowIso,
          }));

          const recomputed = recomputePlanAndInstallments(
            plan,
            stampedInstallments,
            todayKey,
          );

          const updatedPlan: PaymentPlan = {
            ...plan,
            totalPaidCOP: recomputed.totalPaidCOP,
            balancePendingCOP: recomputed.balancePendingCOP,
            status: recomputed.status,
            version: plan.version + 1,
            updatedAt: nowIso,
          };

          const createdTx: FinancialTransaction = {
            id: txId,
            ownerId: 'local-workshop',
            syncStatus: 'local_only',
            version: 1,
            isDemo: plan.isDemo,
            createdAt: nowIso,
            updatedAt: nowIso,
            planId: plan.id,
            projectId: plan.projectId,
            clientId: plan.clientId,
            installmentId: input.installmentId,
            amountCOP,
            paymentDate: dateKeyToMiddayIso(input.paymentDateKey || todayKey),
            paymentMethod: input.paymentMethod,
            referenceNumber: input.referenceNumber?.trim()
              ? input.referenceNumber.trim()
              : null,
            notes: (input.notes ?? '').trim(),
          };

          tx.objectStore('financial_transactions').put(createdTx);
          const instStore = tx.objectStore('payment_installments');
          for (const inst of recomputed.effectiveInstallments) {
            instStore.put(inst);
          }
          tx.objectStore('payment_plans').put(updatedPlan);

          const projReq = tx.objectStore('projects').get(plan.projectId);
          projReq.onerror = () => fail(projReq.error);
          projReq.onsuccess = () => {
            const project = projReq.result as Project | undefined;
            if (project) {
              tx.objectStore('projects').put({
                ...project,
                paymentStatus: recomputed.projectPaymentStatus,
                version: project.version + 1,
                updatedAt: nowIso,
              });
            }
            done(createdTx);
          };
        };

        for (const req of [planReq, instReq]) {
          req.onerror = () => {
            if (!aborted) {
              aborted = true;
              fail(req.error);
            }
          };
          req.onsuccess = onRead;
        }
      },
    );
  }

  async createPlannedTask(input: CreateScheduledTaskInput): Promise<ScheduledTask> {
    const cleanTitle = input.title.trim();
    if (!cleanTitle) {
      throw new Error('El título de la tarea planificada es obligatorio.');
    }
    const allocatedMinutes = Math.max(5, Math.round(input.allocatedMinutes || 30));
    const nowIso = new Date().toISOString();
    const taskId = this.createLocalId('task');

    return runAtomicTransaction<ScheduledTask>(
      [
        'planned_tasks',
        'projects',
        'project_components',
        'pending_materials',
        'materials',
        'material_variants',
      ],
      'readwrite',
      (tx, done, fail) => {
        const projReq = tx.objectStore('projects').get(input.projectId);
        const compReq = tx.objectStore('project_components').getAll();
        const pendReq = tx.objectStore('pending_materials').getAll();
        const matReq = tx.objectStore('materials').getAll();
        const varReq = tx.objectStore('material_variants').getAll();

        let reads = 0;
        let aborted = false;

        const onRead = () => {
          reads += 1;
          if (reads < 5 || aborted) return;

          const project = projReq.result as Project | undefined;
          if (!project) {
            aborted = true;
            fail(new Error('El proyecto seleccionado no existe.'));
            return;
          }

          const allComponents = (compReq.result as ProjectComponent[]) ?? [];
          const allPendings = (pendReq.result as PendingMaterial[]) ?? [];
          const allMaterials = (matReq.result as Material[]) ?? [];
          const allVariants = (varReq.result as MaterialVariant[]) ?? [];

          let targetComp: ProjectComponent | null = null;
          if (input.componentId) {
            targetComp = allComponents.find((c) => c.id === input.componentId) ?? null;
            if (!targetComp || targetComp.projectId !== project.id) {
              aborted = true;
              fail(new Error('La pieza seleccionada no pertenece a este proyecto.'));
              return;
            }
          }

          let targetPending: PendingMaterial | null = null;
          if (input.dependsOnPendingMaterialId) {
            targetPending =
              allPendings.find((p) => p.id === input.dependsOnPendingMaterialId) ??
              null;
            if (!targetPending) {
              aborted = true;
              fail(new Error('El material pendiente seleccionado no existe.'));
              return;
            }
            if (!project.isDemo && targetPending.isDemo) {
              aborted = true;
              fail(
                new Error(
                  'Aislamiento de ejemplos: una tarea real no puede depender de un material de demostración.',
                ),
              );
              return;
            }
          }

          const evaluation = evaluateTaskMaterialBlock({
            projectId: project.id,
            componentId: targetComp?.id ?? null,
            dependsOnPendingMaterialId: targetPending?.id ?? null,
            components: allComponents,
            pendingMaterials: allPendings,
            materials: allMaterials,
            variants: allVariants,
          });

          const task: ScheduledTask = {
            id: taskId,
            ownerId: 'local-workshop',
            syncStatus: 'local_only',
            version: 1,
            isDemo: project.isDemo,
            createdAt: nowIso,
            updatedAt: nowIso,
            projectId: project.id,
            componentId: targetComp?.id ?? null,
            title: cleanTitle,
            scheduledDate: dateKeyToMiddayIso(input.scheduledDate),
            allocatedMinutes,
            completedMinutes: 0,
            dependsOnPendingMaterialId: targetPending?.id ?? null,
            status: evaluation.isBlocked ? 'blocked_by_material' : 'scheduled',
            notes: (input.notes ?? '').trim(),
          };

          tx.objectStore('planned_tasks').put(task);
          done(task);
        };

        for (const req of [projReq, compReq, pendReq, matReq, varReq]) {
          req.onerror = () => {
            if (!aborted) {
              aborted = true;
              fail(req.error);
            }
          };
          req.onsuccess = onRead;
        }
      },
    );
  }

  async updatePlannedTask(
    taskId: string,
    updates: UpdateScheduledTaskInput,
  ): Promise<ScheduledTask> {
    const nowIso = new Date().toISOString();

    return runAtomicTransaction<ScheduledTask>(
      [
        'planned_tasks',
        'projects',
        'project_components',
        'pending_materials',
        'materials',
        'material_variants',
      ],
      'readwrite',
      (tx, done, fail) => {
        const taskStore = tx.objectStore('planned_tasks');
        const taskReq = taskStore.get(taskId);
        const projReq = tx.objectStore('projects').getAll();
        const compReq = tx.objectStore('project_components').getAll();
        const pendReq = tx.objectStore('pending_materials').getAll();
        const matReq = tx.objectStore('materials').getAll();
        const varReq = tx.objectStore('material_variants').getAll();

        let reads = 0;
        let aborted = false;

        const onRead = () => {
          reads += 1;
          if (reads < 6 || aborted) return;

          const existing = taskReq.result as ScheduledTask | undefined;
          if (!existing) {
            aborted = true;
            fail(new Error('La tarea planificada no existe.'));
            return;
          }

          const allProjects = (projReq.result as Project[]) ?? [];
          const allComponents = (compReq.result as ProjectComponent[]) ?? [];
          const allPendings = (pendReq.result as PendingMaterial[]) ?? [];
          const allMaterials = (matReq.result as Material[]) ?? [];
          const allVariants = (varReq.result as MaterialVariant[]) ?? [];

          const nextProjectId = updates.projectId ?? existing.projectId;
          const nextProject = allProjects.find((p) => p.id === nextProjectId);
          if (!nextProject) {
            aborted = true;
            fail(new Error('El proyecto vinculado no existe.'));
            return;
          }
          if (!existing.isDemo && nextProject.isDemo) {
            aborted = true;
            fail(
              new Error(
                'Aislamiento de ejemplos: una tarea real no puede vincularse con un proyecto de demostración.',
              ),
            );
            return;
          }

          const nextComponentId =
            updates.componentId !== undefined
              ? updates.componentId
              : existing.componentId;
          if (nextComponentId) {
            const comp = allComponents.find((c) => c.id === nextComponentId);
            if (!comp || comp.projectId !== nextProject.id) {
              aborted = true;
              fail(new Error('La pieza seleccionada no pertenece al proyecto elegido.'));
              return;
            }
          }

          const nextPendingId =
            updates.dependsOnPendingMaterialId !== undefined
              ? updates.dependsOnPendingMaterialId
              : existing.dependsOnPendingMaterialId;
          if (nextPendingId) {
            const pend = allPendings.find((p) => p.id === nextPendingId);
            if (!pend) {
              aborted = true;
              fail(new Error('El material pendiente vinculado no existe.'));
              return;
            }
            if (!existing.isDemo && pend.isDemo) {
              aborted = true;
              fail(
                new Error(
                  'Aislamiento de ejemplos: una tarea real no puede depender de un material pendiente de ejemplo.',
                ),
              );
              return;
            }
          }

          const nextTitle =
            updates.title !== undefined ? updates.title.trim() : existing.title;
          if (!nextTitle) {
            aborted = true;
            fail(new Error('El título de la tarea es obligatorio.'));
            return;
          }

          const evaluation = evaluateTaskMaterialBlock({
            projectId: nextProject.id,
            componentId: nextComponentId,
            dependsOnPendingMaterialId: nextPendingId,
            components: allComponents,
            pendingMaterials: allPendings,
            materials: allMaterials,
            variants: allVariants,
          });

          if (updates.status === 'completed' && evaluation.isBlocked) {
            aborted = true;
            fail(
              new Error(
                `Bloqueo preventivo: esta tarea aún no puede completarse porque faltan insumos. ${evaluation.reasons.join(' ')}`,
              ),
            );
            return;
          }

          const requestedStatus = updates.status ?? existing.status;
          const resolvedStatus =
            requestedStatus === 'completed'
              ? 'completed'
              : evaluation.isBlocked
                ? 'blocked_by_material'
                : requestedStatus === 'blocked_by_material'
                  ? 'scheduled'
                  : requestedStatus;

          const allocatedMinutes = Math.max(
            5,
            Math.round(updates.allocatedMinutes ?? existing.allocatedMinutes),
          );
          const completedMinutes =
            updates.completedMinutes !== undefined
              ? Math.max(0, Math.round(updates.completedMinutes))
              : resolvedStatus === 'completed' && existing.completedMinutes === 0
                ? allocatedMinutes
                : existing.completedMinutes;

          const updated: ScheduledTask = {
            ...existing,
            projectId: nextProject.id,
            componentId: nextComponentId,
            title: nextTitle,
            scheduledDate: updates.scheduledDate
              ? dateKeyToMiddayIso(updates.scheduledDate)
              : existing.scheduledDate,
            allocatedMinutes,
            completedMinutes,
            dependsOnPendingMaterialId: nextPendingId,
            status: resolvedStatus,
            notes: updates.notes !== undefined ? updates.notes.trim() : existing.notes,
            version: existing.version + 1,
            updatedAt: nowIso,
          };

          taskStore.put(updated);
          done(updated);
        };

        for (const req of [taskReq, projReq, compReq, pendReq, matReq, varReq]) {
          req.onerror = () => {
            if (!aborted) {
              aborted = true;
              fail(req.error);
            }
          };
          req.onsuccess = onRead;
        }
      },
    );
  }

  deletePlannedTask(taskId: string): Promise<void> {
    return this.plannedTasks.remove(taskId);
  }

  async createReminder(input: CreateReminderInput): Promise<Reminder> {
    const cleanTitle = input.title.trim();
    if (!cleanTitle) {
      throw new Error('El título del recordatorio es obligatorio.');
    }
    const nowIso = new Date().toISOString();
    const reminder: Reminder = {
      id: this.createLocalId('rem'),
      ownerId: 'local-workshop',
      syncStatus: 'local_only',
      version: 1,
      isDemo: Boolean(input.isDemo),
      createdAt: nowIso,
      updatedAt: nowIso,
      type: input.type,
      title: cleanTitle,
      message: input.message.trim(),
      triggerAt: dateKeyToMiddayIso(input.triggerAt),
      relatedEntityId: input.relatedEntityId ?? null,
      relatedEntityType: input.relatedEntityType ?? null,
      leadDays:
        typeof input.leadDays === 'number' && Number.isFinite(input.leadDays)
          ? Math.max(0, Math.round(input.leadDays))
          : 0,
      snoozedUntil: null,
      isRead: false,
      isCompleted: false,
    };
    return this.reminders.upsert(reminder);
  }

  async updateReminder(
    reminderId: string,
    updates: UpdateReminderInput,
  ): Promise<Reminder> {
    const existing = await this.reminders.getById(reminderId);
    if (!existing) {
      throw new Error('El recordatorio seleccionado no existe.');
    }
    const nextTitle =
      updates.title !== undefined ? updates.title.trim() : existing.title;
    if (!nextTitle) {
      throw new Error('El título del recordatorio es obligatorio.');
    }
    return this.reminders.upsert({
      ...existing,
      type: updates.type ?? existing.type,
      title: nextTitle,
      message:
        updates.message !== undefined ? updates.message.trim() : existing.message,
      triggerAt: updates.triggerAt
        ? dateKeyToMiddayIso(updates.triggerAt)
        : existing.triggerAt,
      leadDays:
        updates.leadDays !== undefined
          ? Math.max(0, Math.round(updates.leadDays))
          : existing.leadDays,
      snoozedUntil:
        updates.snoozedUntil !== undefined
          ? updates.snoozedUntil
            ? dateKeyToMiddayIso(updates.snoozedUntil)
            : null
          : existing.snoozedUntil ?? null,
      isRead: updates.isRead ?? existing.isRead,
      isCompleted: updates.isCompleted ?? existing.isCompleted,
    });
  }

  deleteReminder(reminderId: string): Promise<void> {
    return this.reminders.remove(reminderId);
  }

  loadDemoData(): Promise<{ insertedCount: number }> {
    return loadDemoDataTransaction();
  }

  purgeDemoData(): Promise<DemoPurgeOutcome> {
    return purgeDemoDataTransaction();
  }

  exportBackup(options: { includeDemo: boolean }): Promise<BackupEnvelope> {
    return exportWorkshopBackup(options);
  }

  inspectBackup(rawJson: string): Promise<BackupInspectionResult> {
    return inspectBackupFile(rawJson);
  }

  importBackup(
    inspection: BackupInspectionResult,
    strategy: BackupImportStrategy,
  ): Promise<BackupImportOutcome> {
    return applyBackupImport(inspection, strategy);
  }
}

export const localWorkshopEngine = new LocalWorkshopEngine();

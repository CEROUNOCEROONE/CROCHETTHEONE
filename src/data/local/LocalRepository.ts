import type {
  BaseEntity,
  Client,
  FinancialTransaction,
  InventoryMovement,
  InventoryMovementType,
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
import {
  createDefaultWorkshopSettings,
  getIndexedDb,
  idbRequestToPromise,
  runAtomicTransaction,
} from './indexedDbClient.ts';
import { loadDemoDataTransaction, purgeDemoDataTransaction } from './demoSeeder.ts';
import {
  applyBackupImport,
  exportWorkshopBackup,
  inspectBackupFile,
} from './backupService.ts';

const IMMUTABLE_LEDGER_STORES = new Set<WorkshopStoreName>([
  'inventory_movements',
  'financial_transactions',
]);

class IndexedDbStoreRepository<T extends BaseEntity> implements DataStorePort<T> {
  readonly storeName: WorkshopStoreName;

  constructor(storeName: WorkshopStoreName) {
    this.storeName = storeName;
  }

  async getById(id: string): Promise<T | null> {
    const db = await getIndexedDb();
    const tx = db.transaction(this.storeName, 'readonly');
    const result = await idbRequestToPromise<T | undefined>(
      tx.objectStore(this.storeName).get(id),
    );
    return result ?? null;
  }

  async getAll(): Promise<T[]> {
    const db = await getIndexedDb();
    const tx = db.transaction(this.storeName, 'readonly');
    return idbRequestToPromise<T[]>(tx.objectStore(this.storeName).getAll());
  }

  async queryByIndex(indexName: string, value: IDBValidKey): Promise<T[]> {
    const db = await getIndexedDb();
    const tx = db.transaction(this.storeName, 'readonly');
    const index = tx.objectStore(this.storeName).index(indexName);
    return idbRequestToPromise<T[]>(index.getAll(value));
  }

  async count(): Promise<number> {
    const db = await getIndexedDb();
    const tx = db.transaction(this.storeName, 'readonly');
    return idbRequestToPromise<number>(tx.objectStore(this.storeName).count());
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
  readonly movements = new IndexedDbStoreRepository<InventoryMovement>('inventory_movements');
  readonly clients = new IndexedDbStoreRepository<Client>('clients');
  readonly paymentPlans = new IndexedDbStoreRepository<PaymentPlan>('payment_plans');
  readonly installments = new IndexedDbStoreRepository<PaymentInstallment>(
    'payment_installments',
  );
  readonly transactions = new IndexedDbStoreRepository<FinancialTransaction>(
    'financial_transactions',
  );

  async getSchemaMeta(): Promise<SchemaMeta | null> {
    const db = await getIndexedDb();
    const tx = db.transaction('_meta_schema', 'readonly');
    const result = await idbRequestToPromise<SchemaMeta | undefined>(
      tx.objectStore('_meta_schema').get('schema'),
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
              const activeSettings =
                settingsList.find((s) => s.id === 'default') ??
                createDefaultWorkshopSettings();

              done({
                settings: activeSettings,
                projects: (result.projects as Project[]) ?? [],
                components: (result.project_components as ProjectComponent[]) ?? [],
                workSessions: (result.work_sessions as WorkSession[]) ?? [],
                materials: (result.materials as Material[]) ?? [],
                variants: (result.material_variants as MaterialVariant[]) ?? [],
                reservations: (result.inventory_reservations as InventoryReservation[]) ?? [],
                movements: (result.inventory_movements as InventoryMovement[]) ?? [],
                clients: (result.clients as Client[]) ?? [],
                paymentPlans: (result.payment_plans as PaymentPlan[]) ?? [],
                installments: (result.payment_installments as PaymentInstallment[]) ?? [],
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
        | 'hourlyRateCOP'
        | 'dailyGoalMinutes'
        | 'weeklyGoalMinutes'
        | 'defaultMarkupPercent'
      >
    >,
  ): Promise<WorkshopSettings> {
    const current = (await this.settings.getById('default')) ?? createDefaultWorkshopSettings();
    const updated: WorkshopSettings = {
      ...current,
      ...partial,
      id: 'default',
      isDemo: false,
      hourlyRateCOP: Math.max(
        0,
        Math.round(partial.hourlyRateCOP ?? current.hourlyRateCOP),
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
    };
    return this.settings.upsert(updated);
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
        'inventory_movements',
        'payment_plans',
        'financial_transactions',
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

          let completedReads = 0;
          let aborted = false;

          const checkDone = () => {
            completedReads += 1;
            if (completedReads < 6 || aborted) return;

            const movements = (movReq.result as InventoryMovement[]) ?? [];
            const transactions = (txReq.result as FinancialTransaction[]) ?? [];
            const reservations = (resReq.result as InventoryReservation[]) ?? [];
            const plans = (planReq.result as PaymentPlan[]) ?? [];
            const sessions = (sessReq.result as WorkSession[]) ?? [];
            const comps = (compReq.result as ProjectComponent[]) ?? [];

            const hasMovements = movements.some((m) => m.projectId === projectId);
            const hasTransactions = transactions.some((t) => t.projectId === projectId);
            const hasActiveReservations = reservations.some(
              (r) => r.projectId === projectId && r.status === 'active',
            );
            const hasPlans = plans.some((p) => p.projectId === projectId);

            if (hasMovements || hasTransactions || hasActiveReservations || hasPlans) {
              aborted = true;
              fail(
                new Error(
                  'Este proyecto tiene reservas de material, movimientos en Kardex o un plan de pagos asociado. Para conservar la trazabilidad histórica, cámbialo a estado "Cancelado" en lugar de eliminarlo.',
                ),
              );
              return;
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

          for (const req of [movReq, txReq, resReq, planReq, sessReq, compReq]) {
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
      ['project_components', 'work_sessions', 'inventory_reservations'],
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

          let reads = 0;
          let aborted = false;

          const finishCheck = () => {
            reads += 1;
            if (reads < 2 || aborted) return;

            const sessions = (sessReq.result as WorkSession[]) ?? [];
            const reservations = (resReq.result as InventoryReservation[]) ?? [];
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

              const nowIso = new Date().toISOString();
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

          sessReq.onerror = () => {
            if (!aborted) {
              aborted = true;
              fail(sessReq.error);
            }
          };
          resReq.onerror = () => {
            if (!aborted) {
              aborted = true;
              fail(resReq.error);
            }
          };
          sessReq.onsuccess = finishCheck;
          resReq.onsuccess = finishCheck;
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
      purchaseReceiptId: null,
      type: params.type,
      quantityDelta: this.roundQuantity(params.quantityDelta),
      previousPhysicalStock: this.roundQuantity(params.previousPhysicalStock),
      newPhysicalStock: this.roundQuantity(params.newPhysicalStock),
      previousReservedStock: this.roundQuantity(params.previousReservedStock),
      newReservedStock: this.roundQuantity(params.newReservedStock),
      unitCostAtMovementCOP: Math.max(0, Math.round(params.unitCostAtMovementCOP)),
      idempotencyKey: `mov_${params.type}_${id}`,
      notes: params.notes.trim(),
      timestamp: params.nowIso,
    };
  }

  async createMaterial(input: CreateMaterialInput): Promise<Material> {
    const cleanName = input.name.trim();
    if (!cleanName) {
      throw new Error('El nombre del material es obligatorio.');
    }
    const nowIso = new Date().toISOString();
    const material: Material = {
      id: this.createLocalId('mat'),
      ownerId: 'local-workshop',
      syncStatus: 'local_only',
      version: 1,
      isDemo: false,
      createdAt: nowIso,
      updatedAt: nowIso,
      name: cleanName,
      category: input.category,
      brand: input.brand.trim(),
      unit: input.unit,
      description: input.description.trim(),
    };
    return this.materials.upsert(material);
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
      updates.name !== undefined ? updates.name.trim() : existing.name;
    if (!nextName) {
      throw new Error('El nombre del material no puede quedar vacío.');
    }
    return this.materials.upsert({
      ...existing,
      name: nextName,
      category: updates.category ?? existing.category,
      brand: updates.brand !== undefined ? updates.brand.trim() : existing.brand,
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
    const cleanColor = input.colorName.trim();
    if (!cleanColor) {
      throw new Error(
        'El nombre del color es obligatorio para diferenciar cada variante de material.',
      );
    }
    if (!Number.isFinite(input.initialPhysicalStock) || input.initialPhysicalStock < 0) {
      throw new Error('El stock físico inicial debe ser mayor o igual a 0.');
    }
    if (!Number.isFinite(input.minStock) || input.minStock < 0) {
      throw new Error('El stock mínimo debe ser mayor o igual a 0.');
    }
    if (!Number.isFinite(input.unitCostCOP) || input.unitCostCOP < 0) {
      throw new Error('El costo unitario en COP debe ser mayor o igual a 0.');
    }

    const nowIso = new Date().toISOString();
    const initialQty = this.roundQuantity(input.initialPhysicalStock);

    return runAtomicTransaction<MaterialVariant>(
      ['materials', 'material_variants', 'inventory_movements'],
      'readwrite',
      (tx, done, fail) => {
        const matReq = tx.objectStore('materials').get(input.materialId);
        matReq.onerror = () => fail(matReq.error);
        matReq.onsuccess = () => {
          const material = matReq.result as Material | undefined;
          if (!material) {
            fail(new Error('El material padre no existe.'));
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
            sizeOrGauge: input.sizeOrGauge?.trim() || null,
            sku: input.sku?.trim() || null,
            provider: input.provider.trim(),
            unitCostCOP: Math.round(input.unitCostCOP),
            physicalStock: initialQty,
            reservedStock: 0,
            totalConsumed: 0,
            minStock: this.roundQuantity(input.minStock),
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
        ? updates.colorName.trim()
        : existing.colorName;
    if (!nextColor) {
      throw new Error('El nombre del color es obligatorio.');
    }
    return this.variants.upsert({
      ...existing,
      colorName: nextColor,
      colorHex:
        updates.colorHex !== undefined
          ? updates.colorHex?.trim() || null
          : existing.colorHex,
      sizeOrGauge:
        updates.sizeOrGauge !== undefined
          ? updates.sizeOrGauge?.trim() || null
          : existing.sizeOrGauge,
      sku: updates.sku !== undefined ? updates.sku?.trim() || null : existing.sku,
      provider:
        updates.provider !== undefined ? updates.provider.trim() : existing.provider,
      unitCostCOP:
        updates.unitCostCOP !== undefined
          ? Math.max(0, Math.round(updates.unitCostCOP))
          : existing.unitCostCOP,
      minStock:
        updates.minStock !== undefined
          ? Math.max(0, this.roundQuantity(updates.minStock))
          : existing.minStock,
      notes: updates.notes !== undefined ? updates.notes.trim() : existing.notes,
    });
  }

  async deleteVariant(variantId: string): Promise<void> {
    return runAtomicTransaction<void>(
      ['material_variants', 'inventory_reservations', 'inventory_movements'],
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

        let reads = 0;
        let aborted = false;

        const onRead = () => {
          reads += 1;
          if (reads < 2 || aborted) return;
          const reservations = (resReq.result as InventoryReservation[]) ?? [];
          const movements = (movReq.result as InventoryMovement[]) ?? [];
          if (reservations.length > 0 || movements.length > 0) {
            aborted = true;
            fail(
              new Error(
                'Este color ya tiene reservas o movimientos históricos en el Kardex y no puede eliminarse para preservar la trazabilidad.',
              ),
            );
            return;
          }
          const delReq = tx.objectStore('material_variants').delete(variantId);
          delReq.onerror = () => fail(delReq.error);
          delReq.onsuccess = () => done(undefined);
        };

        resReq.onerror = () => {
          if (!aborted) {
            aborted = true;
            fail(resReq.error);
          }
        };
        movReq.onerror = () => {
          if (!aborted) {
            aborted = true;
            fail(movReq.error);
          }
        };
        resReq.onsuccess = onRead;
        movReq.onsuccess = onRead;
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

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

import { BRAND_CONFIG } from '@/src/config/brand.ts';
import type {
  BaseEntity,
  WorkshopSettings,
  WorkshopStoreName,
} from '@/src/domain/models/index.ts';
import {
  assertValidEntityShape,
  DATA_STORES_TOPOLOGICAL_ORDER,
  validateCrossRecordIntegrity,
} from '@/src/domain/services/integrityRules.ts';
import type {
  BackupEnvelope,
  BackupImportOutcome,
  BackupImportStrategy,
  BackupInspectionResult,
} from '@/src/data/ports/DataStorePort.ts';
import { DB_VERSION } from './dbSchema.ts';
import {
  createDefaultPlanMetadata,
  createDefaultWorkshopSettings,
  createWorkshopInstanceUuid,
  normalizeWorkshopPlanMetadata,
  normalizeWorkshopSettings,
  runAtomicTransaction,
} from './indexedDbClient.ts';

const BACKUP_FORMAT = 'app-crochet-backup' as const;

function getValidTrimmedId(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

function sanitizeIncomingWorkshopSettingsList(
  rawList: BaseEntity[],
  nowIso: string,
): BaseEntity[] {
  if (rawList.length === 0) return [];
  const preferred =
    rawList.find((item) => item.id === 'default') ?? rawList[0];
  const rawObj = preferred as unknown as Record<string, unknown>;
  const rawInstanceId = getValidTrimmedId(rawObj.workshopInstanceId);

  const sanitized: Record<string, unknown> = {
    ...rawObj,
    id: 'default',
    isDemo: false,
    // Jamás aceptar autorización comercial desde un archivo JSON externo
    plan: createDefaultPlanMetadata(nowIso),
  };

  if (rawInstanceId) {
    sanitized.workshopInstanceId = rawInstanceId;
  } else {
    delete sanitized.workshopInstanceId;
  }

  return [sanitized as unknown as BaseEntity];
}

export async function exportWorkshopBackup(options: {
  includeDemo: boolean;
}): Promise<BackupEnvelope> {
  const nowIso = new Date().toISOString();

  const envelope = await runAtomicTransaction<BackupEnvelope>(
    DATA_STORES_TOPOLOGICAL_ORDER,
    'readonly',
    (tx, done, fail) => {
      const data: Partial<Record<WorkshopStoreName, BaseEntity[]>> = {};
      const recordCounts: Partial<Record<WorkshopStoreName, number>> = {};
      let pending = DATA_STORES_TOPOLOGICAL_ORDER.length;
      let aborted = false;

      for (const storeName of DATA_STORES_TOPOLOGICAL_ORDER) {
        const req = tx.objectStore(storeName).getAll();
        req.onerror = () => {
          if (!aborted) {
            aborted = true;
            fail(req.error);
          }
        };
        req.onsuccess = () => {
          if (aborted) return;
          let rows = (req.result as BaseEntity[]) ?? [];
          if (!options.includeDemo) {
            rows = rows.filter((r) => !r.isDemo);
            if (storeName === 'workshop_settings') {
              rows = rows.map((r) => ({
                ...(r as WorkshopSettings),
                demoDataLoaded: false,
              }));
            }
          }
          data[storeName] = rows;
          recordCounts[storeName] = rows.length;
          pending -= 1;
          if (pending === 0) {
            done({
              format: BACKUP_FORMAT,
              schemaVersion: DB_VERSION,
              appName: BRAND_CONFIG.appName,
              exportedAt: nowIso,
              includeDemo: options.includeDemo,
              recordCounts,
              data,
            });
          }
        };
      }
    },
  );

  // Registrar marca de último respaldo en configuración local
  await runAtomicTransaction<void>(
    ['workshop_settings'],
    'readwrite',
    (tx, done, fail) => {
      const store = tx.objectStore('workshop_settings');
      const req = store.get('default');
      req.onerror = () => fail(req.error);
      req.onsuccess = () => {
        const current =
          (req.result as WorkshopSettings | undefined) ?? createDefaultWorkshopSettings();
        store.put({
          ...current,
          lastBackupExportAt: nowIso,
          updatedAt: nowIso,
        });
        done(undefined);
      };
    },
  );

  return envelope;
}

export async function inspectBackupFile(
  rawJson: string,
): Promise<BackupInspectionResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return {
      isValid: false,
      errors: ['El archivo seleccionado no es un JSON válido.'],
      warnings: [],
      envelope: null,
      totalRecordsInFile: 0,
      newRecordsCount: 0,
      duplicateRecordsCount: 0,
      existingLocalRecordsCount: 0,
      breakdownByStore: [],
    };
  }

  if (!parsed || typeof parsed !== 'object') {
    return {
      isValid: false,
      errors: ['La estructura raíz del respaldo es inválida.'],
      warnings: [],
      envelope: null,
      totalRecordsInFile: 0,
      newRecordsCount: 0,
      duplicateRecordsCount: 0,
      existingLocalRecordsCount: 0,
      breakdownByStore: [],
    };
  }

  const candidate = parsed as Record<string, unknown>;
  if (candidate.format !== BACKUP_FORMAT) {
    errors.push('El archivo no corresponde a un respaldo oficial de App Crochet.');
  }

  if (
    typeof candidate.schemaVersion !== 'number' ||
    !Number.isInteger(candidate.schemaVersion) ||
    candidate.schemaVersion < 1
  ) {
    errors.push('El archivo no contiene una versión de esquema válida.');
  } else if (candidate.schemaVersion > DB_VERSION) {
    errors.push(
      `El respaldo pertenece a una versión más reciente (v${candidate.schemaVersion}). Actualiza la aplicación antes de restaurarlo (versión actual: v${DB_VERSION}).`,
    );
  }

  if (!candidate.data || typeof candidate.data !== 'object') {
    errors.push('El respaldo no contiene la sección de datos.');
  }

  if (errors.length > 0) {
    return {
      isValid: false,
      errors,
      warnings,
      envelope: null,
      totalRecordsInFile: 0,
      newRecordsCount: 0,
      duplicateRecordsCount: 0,
      existingLocalRecordsCount: 0,
      breakdownByStore: [],
    };
  }

  const rawData = candidate.data as Record<string, unknown>;
  const rawCounts =
    candidate.recordCounts && typeof candidate.recordCounts === 'object'
      ? (candidate.recordCounts as Record<string, unknown>)
      : {};

  const normalizedData: Partial<Record<WorkshopStoreName, BaseEntity[]>> = {};
  const normalizedCounts: Partial<Record<WorkshopStoreName, number>> = {};

  for (const storeName of DATA_STORES_TOPOLOGICAL_ORDER) {
    const rawList = rawData[storeName];
    if (rawList === undefined) {
      normalizedData[storeName] = [];
      normalizedCounts[storeName] = 0;
      continue;
    }
    if (!Array.isArray(rawList)) {
      errors.push(`La tabla "${storeName}" en el respaldo debe ser una lista.`);
      continue;
    }

    const declaredCount = rawCounts[storeName];
    if (typeof declaredCount === 'number' && declaredCount !== rawList.length) {
      errors.push(
        `Conteo inconsistente en "${storeName}": declarado ${declaredCount}, encontrado ${rawList.length}. El archivo podría estar truncado.`,
      );
    }

    for (const item of rawList) {
      try {
        assertValidEntityShape(storeName, item);
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }

    if (storeName === 'workshop_settings') {
      normalizedData[storeName] = sanitizeIncomingWorkshopSettingsList(
        rawList as BaseEntity[],
        new Date().toISOString(),
      );
      normalizedCounts[storeName] = normalizedData[storeName]?.length ?? 0;
    } else {
      normalizedData[storeName] = rawList as BaseEntity[];
      normalizedCounts[storeName] = rawList.length;
    }
  }

  // Validación estricta de integridad referencial interna del archivo
  const integrityErrors = validateCrossRecordIntegrity(normalizedData);
  errors.push(...integrityErrors);

  if (errors.length > 0) {
    return {
      isValid: false,
      errors: errors.slice(0, 12),
      warnings,
      envelope: null,
      totalRecordsInFile: 0,
      newRecordsCount: 0,
      duplicateRecordsCount: 0,
      existingLocalRecordsCount: 0,
      breakdownByStore: [],
    };
  }

  // Comparación contra registros actuales en IndexedDB para detectar duplicados
  const existingIdsByStore = await runAtomicTransaction<
    Record<WorkshopStoreName, Set<string>>
  >(DATA_STORES_TOPOLOGICAL_ORDER, 'readonly', (tx, done, fail) => {
    const map = {} as Record<WorkshopStoreName, Set<string>>;
    let pending = DATA_STORES_TOPOLOGICAL_ORDER.length;
    let aborted = false;

    for (const storeName of DATA_STORES_TOPOLOGICAL_ORDER) {
      const req = tx.objectStore(storeName).getAllKeys();
      req.onerror = () => {
        if (!aborted) {
          aborted = true;
          fail(req.error);
        }
      };
      req.onsuccess = () => {
        if (aborted) return;
        const keys = (req.result as IDBValidKey[]) ?? [];
        map[storeName] = new Set(keys.map((k) => String(k)));
        pending -= 1;
        if (pending === 0) {
          done(map);
        }
      };
    }
  });

  let totalRecordsInFile = 0;
  let newRecordsCount = 0;
  let duplicateRecordsCount = 0;
  let existingLocalRecordsCount = 0;
  const breakdownByStore: BackupInspectionResult['breakdownByStore'] = [];

  for (const storeName of DATA_STORES_TOPOLOGICAL_ORDER) {
    const existingSet = existingIdsByStore[storeName] ?? new Set<string>();
    if (storeName !== 'workshop_settings') {
      existingLocalRecordsCount += existingSet.size;
    }

    const incoming = normalizedData[storeName] ?? [];
    let newCount = 0;
    let dupCount = 0;
    for (const record of incoming) {
      totalRecordsInFile += 1;
      if (existingSet.has(record.id)) {
        dupCount += 1;
        duplicateRecordsCount += 1;
      } else {
        newCount += 1;
        newRecordsCount += 1;
      }
    }

    if (incoming.length > 0) {
      breakdownByStore.push({
        storeName,
        inFile: incoming.length,
        newCount,
        duplicateCount: dupCount,
      });
    }
  }

  if (duplicateRecordsCount > 0) {
    warnings.push(
      `Se detectaron ${duplicateRecordsCount} registros con identificador ya existente en este dispositivo.`,
    );
  }

  if (existingLocalRecordsCount > 0) {
    warnings.push(
      `Actualmente tienes ${existingLocalRecordsCount} registros guardados localmente. Revisa el modo de importación antes de confirmar.`,
    );
  }

  const envelope: BackupEnvelope = {
    format: BACKUP_FORMAT,
    schemaVersion: Number(candidate.schemaVersion),
    appName:
      typeof candidate.appName === 'string'
        ? candidate.appName
        : BRAND_CONFIG.appName,
    exportedAt:
      typeof candidate.exportedAt === 'string'
        ? candidate.exportedAt
        : new Date().toISOString(),
    includeDemo: Boolean(candidate.includeDemo),
    recordCounts: normalizedCounts,
    data: normalizedData,
  };

  return {
    isValid: true,
    errors: [],
    warnings,
    envelope,
    totalRecordsInFile,
    newRecordsCount,
    duplicateRecordsCount,
    existingLocalRecordsCount,
    breakdownByStore,
  };
}

export async function applyBackupImport(
  inspection: BackupInspectionResult,
  strategy: BackupImportStrategy,
): Promise<BackupImportOutcome> {
  if (!inspection.isValid || !inspection.envelope) {
    throw new Error('No se puede restaurar un respaldo que no ha pasado validación.');
  }

  const { envelope } = inspection;

  // Sensitive ledgers can only be carried through a merge unchanged.
  // Any addition or modification needs a separate domain-aware reconciliation.
  const sensitiveStores: WorkshopStoreName[] = [
    'material_variants',
    'inventory_reservations',
    'inventory_movements',
    'purchase_receipts',
    'pending_materials',
    'shopping_list_items',
    'payment_plans',
    'payment_installments',
    'financial_transactions',
  ];
  const sensitiveSet = new Set<WorkshopStoreName>(sensitiveStores);

  return runAtomicTransaction<BackupImportOutcome>(
    DATA_STORES_TOPOLOGICAL_ORDER,
    'readwrite',
    (tx, done, fail) => {
      const existingByStore = new Map<WorkshopStoreName, Set<string>>();
      const localRecordsByStore = new Map<WorkshopStoreName, BaseEntity[]>();
      let existingLocalSettings: WorkshopSettings | null = null;
      let pending = DATA_STORES_TOPOLOGICAL_ORDER.length + 1;
      let aborted = false;

      const settingsReadReq = tx.objectStore('workshop_settings').get('default');
      settingsReadReq.onerror = () => {
        if (!aborted) {
          aborted = true;
          fail(settingsReadReq.error);
        }
      };
      settingsReadReq.onsuccess = () => {
        if (aborted) return;
        existingLocalSettings =
          (settingsReadReq.result as WorkshopSettings | undefined) ?? null;
        pending -= 1;
        if (pending === 0) {
          executeWrite();
        }
      };

      for (const storeName of DATA_STORES_TOPOLOGICAL_ORDER) {
        const req = tx.objectStore(storeName).getAll();
        req.onerror = () => {
          if (!aborted) {
            aborted = true;
            fail(req.error);
          }
        };
        req.onsuccess = () => {
          if (aborted) return;
          const rows = (req.result as BaseEntity[]) ?? [];
          localRecordsByStore.set(storeName, rows);
          existingByStore.set(storeName, new Set(rows.map((row) => row.id)));
          pending -= 1;
          if (pending === 0) {
            executeWrite();
          }
        };
      }

      function executeWrite() {
        if (strategy === 'merge_overwrite') {
          // Validate against the actual transactional snapshot, not the earlier inspection.
          const proposed: Partial<Record<WorkshopStoreName, BaseEntity[]>> = {};
          for (const storeName of DATA_STORES_TOPOLOGICAL_ORDER) {
            const local = localRecordsByStore.get(storeName) ?? [];
            const incoming = envelope.data[storeName] ?? [];
            const merged = new Map(local.map((row) => [row.id, row]));
            for (const record of incoming) {
              const current = merged.get(record.id);
              // Settings have separate merge rules and are changed by backup export itself.
              if (storeName === 'workshop_settings') continue;
              if (sensitiveSet.has(storeName)) {
                if (!current || JSON.stringify(current) !== JSON.stringify(record)) {
                  fail(new Error(
                    `Fusión detenida: el inventario o los pagos contienen cambios en "${storeName}" (${record.id}). No se modificó ningún dato.`,
                  ));
                  return;
                }
                continue;
              }
              if (current) {
                // Identical records are harmless and should not block other updates.
                if (JSON.stringify(current) === JSON.stringify(record)) continue;
                const currentTime = Date.parse(current.updatedAt);
                const incomingTime = Date.parse(record.updatedAt);
                if (!Number.isFinite(currentTime) || !Number.isFinite(incomingTime) ||
                    incomingTime <= currentTime) {
                  fail(new Error(
                    `Fusión detenida: el registro "${record.id}" de "${storeName}" no es más reciente que el dato local. No se modificó ningún dato.`,
                  ));
                  return;
                }
              }
              merged.set(record.id, record);
            }
            proposed[storeName] = [...merged.values()];
          }
          const errors = validateCrossRecordIntegrity(proposed);
          if (errors.length > 0) {
            fail(new Error(`Fusión detenida por integridad: ${errors[0]}. No se modificó ningún dato.`));
            return;
          }
        }

        let insertedCount = 0;
        let updatedCount = 0;
        let skippedCount = 0;
        const nowIso = new Date().toISOString();

        const localId = getValidTrimmedId(
          existingLocalSettings?.workshopInstanceId,
        );
        const preservedLocalPlan = normalizeWorkshopPlanMetadata(
          existingLocalSettings?.plan,
          nowIso,
        );

        const settingsIncomingList = envelope.data.workshop_settings ?? [];
        const incomingRawSettings = (settingsIncomingList.find(
          (s) => s.id === 'default',
        ) ?? settingsIncomingList[0]) as Partial<WorkshopSettings> | undefined;
        const incomingId = getValidTrimmedId(
          incomingRawSettings?.workshopInstanceId,
        );

        if (strategy === 'replace_all') {
          for (const storeName of DATA_STORES_TOPOLOGICAL_ORDER.toReversed()) {
            tx.objectStore(storeName).clear();
          }
        }

        for (const storeName of DATA_STORES_TOPOLOGICAL_ORDER) {
          if (storeName === 'workshop_settings') continue;

          const store = tx.objectStore(storeName);
          const records = envelope.data[storeName] ?? [];
          const existingKeys =
            strategy === 'replace_all'
              ? new Set<string>()
              : existingByStore.get(storeName) ?? new Set<string>();

          for (const record of records) {
            const exists = existingKeys.has(record.id);

            if (strategy === 'append_new' && exists) {
              skippedCount += 1;
              continue;
            }
            if (strategy === 'merge_overwrite' && exists &&
                JSON.stringify(localRecordsByStore.get(storeName)?.find((row) => row.id === record.id)) === JSON.stringify(record)) {
              skippedCount += 1;
              continue;
            }

            if (exists) {
              updatedCount += 1;
            } else {
              insertedCount += 1;
            }

            store.put(record);
          }
        }

        // Manejo transaccional protegido del registro único 'default' en workshop_settings
        const settingsStore = tx.objectStore('workshop_settings');

        if (strategy === 'replace_all') {
          const resolvedInstanceId =
            incomingId ?? localId ?? createWorkshopInstanceUuid();
          const baseSettings = incomingRawSettings
            ? normalizeWorkshopSettings({
                ...incomingRawSettings,
                id: 'default',
                isDemo: false,
                workshopInstanceId: resolvedInstanceId,
                plan: preservedLocalPlan,
              })
            : {
                ...createDefaultWorkshopSettings(),
                workshopInstanceId: resolvedInstanceId,
                plan: preservedLocalPlan,
              };

          settingsStore.put(baseSettings);
          if (settingsIncomingList.length > 0) {
            insertedCount += 1;
          }
        } else if (strategy === 'merge_overwrite') {
          const resolvedInstanceId =
            incomingId ?? localId ?? createWorkshopInstanceUuid();

          if (incomingRawSettings) {
            if (existingLocalSettings &&
                JSON.stringify(existingLocalSettings) === JSON.stringify(incomingRawSettings)) {
              skippedCount += 1;
            } else if (existingLocalSettings &&
                (!Number.isFinite(Date.parse(existingLocalSettings.updatedAt)) ||
                 !Number.isFinite(Date.parse(incomingRawSettings.updatedAt ?? '')) ||
                 Date.parse(incomingRawSettings.updatedAt ?? '') <= Date.parse(existingLocalSettings.updatedAt))) {
              // Preserve newer local settings instead of rejecting an otherwise safe merge.
              skippedCount += 1;
            } else {
            const mergedSettings = normalizeWorkshopSettings({
              ...incomingRawSettings,
              id: 'default',
              isDemo: false,
              workshopInstanceId: resolvedInstanceId,
              plan: preservedLocalPlan,
            });
            settingsStore.put(mergedSettings);
            if (existingLocalSettings) {
              updatedCount += 1;
            } else {
              insertedCount += 1;
            }
            }
          } else if (
            !existingLocalSettings ||
            !localId ||
            !existingLocalSettings.plan
          ) {
            const ensuredSettings = normalizeWorkshopSettings({
              ...(existingLocalSettings ?? {}),
              id: 'default',
              isDemo: false,
              workshopInstanceId: resolvedInstanceId,
              plan: preservedLocalPlan,
            });
            settingsStore.put(ensuredSettings);
          }
        } else {
          // strategy === 'append_new': jamás sobrescribe preferencias locales existentes
          if (existingLocalSettings) {
            if (settingsIncomingList.length > 0) {
              skippedCount += 1;
            }
            if (!localId) {
              const patchedLocal = normalizeWorkshopSettings({
                ...existingLocalSettings,
                id: 'default',
                isDemo: false,
                workshopInstanceId: incomingId ?? createWorkshopInstanceUuid(),
                plan: preservedLocalPlan,
              });
              settingsStore.put(patchedLocal);
            }
          } else {
            const resolvedInstanceId =
              incomingId ?? createWorkshopInstanceUuid();
            const createdSettings = incomingRawSettings
              ? normalizeWorkshopSettings({
                  ...incomingRawSettings,
                  id: 'default',
                  isDemo: false,
                  workshopInstanceId: resolvedInstanceId,
                  plan: createDefaultPlanMetadata(nowIso),
                })
              : {
                  ...createDefaultWorkshopSettings(),
                  workshopInstanceId: resolvedInstanceId,
                  plan: createDefaultPlanMetadata(nowIso),
                };
            settingsStore.put(createdSettings);
            if (settingsIncomingList.length > 0) {
              insertedCount += 1;
            }
          }
        }

        done({
          strategy,
          insertedCount,
          updatedCount,
          skippedCount,
        });
      }
    },
  );
}

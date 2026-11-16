import { BRAND_CONFIG } from '@/src/config/brand.ts';
import type {
  PlanMetadataSource,
  SchemaMeta,
  SchemaMigrationRecord,
  SubscriptionStatus,
  SubscriptionTier,
  WorkshopPlanMetadata,
  WorkshopSettings,
  WorkshopStoreName,
} from '@/src/domain/models/index.ts';
import {
  isSupportedCurrency,
  roundCurrencyAmount,
} from '@/src/domain/services/currencyCatalog.ts';
import { DB_NAME, DB_VERSION } from './dbSchema.ts';
import { buildUpdatedSchemaMeta, runIdbMigrations } from './migrations.ts';

const VALID_TIERS: ReadonlySet<SubscriptionTier> = new Set([
  'free',
  'pro_monthly',
  'pro_annual',
]);

const VALID_STATUSES: ReadonlySet<SubscriptionStatus> = new Set([
  'active',
  'trialing',
  'past_due',
  'canceled',
  'expired',
]);

const VALID_PLAN_SOURCES: ReadonlySet<PlanMetadataSource> = new Set([
  'local_default',
  'server_cached',
]);

export function createWorkshopInstanceUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const rand = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).slice(1);
  return `${rand()}${rand()}-${rand()}-4${rand().slice(1)}-a${rand().slice(1)}-${rand()}${rand()}${rand()}`;
}

export function createDefaultPlanMetadata(
  nowIso = new Date().toISOString(),
): WorkshopPlanMetadata {
  return {
    tier: 'free',
    status: 'active',
    source: 'local_default',
    updatedAt: nowIso,
    lastVerifiedAt: null,
  };
}

function isValidIsoDateString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !Number.isNaN(Date.parse(value));
}

export function isValidWorkshopPlanMetadata(
  raw: unknown,
): raw is WorkshopPlanMetadata {
  if (!raw || typeof raw !== 'object') return false;
  const obj = raw as Record<string, unknown>;
  if (!VALID_TIERS.has(obj.tier as SubscriptionTier)) return false;
  if (!VALID_STATUSES.has(obj.status as SubscriptionStatus)) return false;
  if (!VALID_PLAN_SOURCES.has(obj.source as PlanMetadataSource)) return false;
  if (!isValidIsoDateString(obj.updatedAt)) return false;

  if (obj.lastVerifiedAt !== undefined && obj.lastVerifiedAt !== null) {
    if (!isValidIsoDateString(obj.lastVerifiedAt)) return false;
  } else if (obj.source === 'server_cached') {
    return false;
  }

  return true;
}

export function normalizeWorkshopPlanMetadata(
  rawPlan: unknown,
  fallbackNowIso = new Date().toISOString(),
): WorkshopPlanMetadata {
  if (isValidWorkshopPlanMetadata(rawPlan)) {
    return {
      tier: rawPlan.tier,
      status: rawPlan.status,
      source: rawPlan.source,
      updatedAt: rawPlan.updatedAt,
      lastVerifiedAt: rawPlan.lastVerifiedAt ?? null,
    };
  }
  return createDefaultPlanMetadata(fallbackNowIso);
}

let dbInstancePromise: Promise<IDBDatabase> | null = null;
let pendingMigrationsFromUpgrade: SchemaMigrationRecord[] = [];

export function idbRequestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('Error en operación de IndexedDB.'));
  });
}

export function createDefaultWorkshopSettings(): WorkshopSettings {
  const now = new Date().toISOString();
  return {
    id: 'default',
    ownerId: 'local-workshop',
    syncStatus: 'local_only',
    version: 1,
    isDemo: false,
    createdAt: now,
    updatedAt: now,
    workshopInstanceId: createWorkshopInstanceUuid(),
    plan: createDefaultPlanMetadata(now),
    workshopName: BRAND_CONFIG.defaultWorkshopName,
    ownerDisplayName: 'Artesana',
    hourlyRateCOP: BRAND_CONFIG.defaults.hourlyRateCOP,
    dailyGoalMinutes: BRAND_CONFIG.defaults.dailyGoalMinutes,
    weeklyGoalMinutes: BRAND_CONFIG.defaults.weeklyGoalMinutes,
    defaultMarkupPercent: BRAND_CONFIG.defaults.defaultMarkupPercent,
    rentCostPercent: BRAND_CONFIG.defaults.rentCostPercent,
    electricityCostPercent: BRAND_CONFIG.defaults.electricityCostPercent,
    internetCostPercent: BRAND_CONFIG.defaults.internetCostPercent,
    wasteAndContingencyPercent: BRAND_CONFIG.defaults.wasteAndContingencyPercent,
    currency: BRAND_CONFIG.currency,
    demoDataLoaded: false,
    lastBackupExportAt: null,
    reminderLeadDaysDelivery: 3,
    reminderLeadDaysInstallment: 2,
    reminderLeadDaysPurchase: 1,
    enableDeliveryReminders: true,
    enableInstallmentReminders: true,
    enablePurchaseReminders: true,
    enableLowStockReminders: true,
  };
}

export function normalizeWorkshopSettings(
  raw?: Partial<WorkshopSettings> | null,
): WorkshopSettings {
  const defaults = createDefaultWorkshopSettings();
  if (!raw) return defaults;
  const currency = isSupportedCurrency(raw.currency)
    ? raw.currency
    : defaults.currency;
  const workshopInstanceId =
    typeof raw.workshopInstanceId === 'string' &&
    raw.workshopInstanceId.trim().length > 0
      ? raw.workshopInstanceId.trim()
      : defaults.workshopInstanceId;
  const plan = normalizeWorkshopPlanMetadata(raw.plan, defaults.updatedAt);

  return {
    ...defaults,
    ...raw,
    id: 'default',
    isDemo: false,
    workshopInstanceId,
    plan,
    currency,
    hourlyRateCOP:
      typeof raw.hourlyRateCOP === 'number' && Number.isFinite(raw.hourlyRateCOP)
        ? Math.max(0, roundCurrencyAmount(raw.hourlyRateCOP, currency))
        : defaults.hourlyRateCOP,
    rentCostPercent:
      typeof raw.rentCostPercent === 'number' && Number.isFinite(raw.rentCostPercent)
        ? raw.rentCostPercent
        : defaults.rentCostPercent,
    electricityCostPercent:
      typeof raw.electricityCostPercent === 'number' &&
      Number.isFinite(raw.electricityCostPercent)
        ? raw.electricityCostPercent
        : defaults.electricityCostPercent,
    internetCostPercent:
      typeof raw.internetCostPercent === 'number' &&
      Number.isFinite(raw.internetCostPercent)
        ? raw.internetCostPercent
        : defaults.internetCostPercent,
    wasteAndContingencyPercent:
      typeof raw.wasteAndContingencyPercent === 'number' &&
      Number.isFinite(raw.wasteAndContingencyPercent)
        ? raw.wasteAndContingencyPercent
        : defaults.wasteAndContingencyPercent,
    reminderLeadDaysDelivery:
      typeof raw.reminderLeadDaysDelivery === 'number' &&
      Number.isFinite(raw.reminderLeadDaysDelivery)
        ? Math.max(0, Math.round(raw.reminderLeadDaysDelivery))
        : defaults.reminderLeadDaysDelivery,
    reminderLeadDaysInstallment:
      typeof raw.reminderLeadDaysInstallment === 'number' &&
      Number.isFinite(raw.reminderLeadDaysInstallment)
        ? Math.max(0, Math.round(raw.reminderLeadDaysInstallment))
        : defaults.reminderLeadDaysInstallment,
    reminderLeadDaysPurchase:
      typeof raw.reminderLeadDaysPurchase === 'number' &&
      Number.isFinite(raw.reminderLeadDaysPurchase)
        ? Math.max(0, Math.round(raw.reminderLeadDaysPurchase))
        : defaults.reminderLeadDaysPurchase,
    enableDeliveryReminders:
      typeof raw.enableDeliveryReminders === 'boolean'
        ? raw.enableDeliveryReminders
        : defaults.enableDeliveryReminders,
    enableInstallmentReminders:
      typeof raw.enableInstallmentReminders === 'boolean'
        ? raw.enableInstallmentReminders
        : defaults.enableInstallmentReminders,
    enablePurchaseReminders:
      typeof raw.enablePurchaseReminders === 'boolean'
        ? raw.enablePurchaseReminders
        : defaults.enablePurchaseReminders,
    enableLowStockReminders:
      typeof raw.enableLowStockReminders === 'boolean'
        ? raw.enableLowStockReminders
        : defaults.enableLowStockReminders,
  };
}

async function ensureBootstrapRecords(db: IDBDatabase): Promise<void> {
  const tx = db.transaction(['_meta_schema', 'workshop_settings'], 'readwrite');
  const metaStore = tx.objectStore('_meta_schema');
  const settingsStore = tx.objectStore('workshop_settings');

  const [existingMeta, existingSettings] = await Promise.all([
    idbRequestToPromise<SchemaMeta | undefined>(metaStore.get('schema')),
    idbRequestToPromise<WorkshopSettings | undefined>(settingsStore.get('default')),
  ]);

  if (!existingMeta || pendingMigrationsFromUpgrade.length > 0 || existingMeta.currentVersion < DB_VERSION) {
    const fallbackRecord: SchemaMigrationRecord[] =
      pendingMigrationsFromUpgrade.length > 0
        ? pendingMigrationsFromUpgrade
        : [{ version: DB_VERSION, name: 'initial_foundation_v1', appliedAt: new Date().toISOString() }];
    const updatedMeta = buildUpdatedSchemaMeta(existingMeta ?? null, fallbackRecord);
    metaStore.put(updatedMeta);
    pendingMigrationsFromUpgrade = [];
  }

  if (!existingSettings) {
    settingsStore.put(createDefaultWorkshopSettings());
  } else {
    const missingInstanceId =
      typeof existingSettings.workshopInstanceId !== 'string' ||
      existingSettings.workshopInstanceId.trim().length === 0;
    const invalidPlan = !isValidWorkshopPlanMetadata(existingSettings.plan);
    if (missingInstanceId || invalidPlan) {
      settingsStore.put(normalizeWorkshopSettings(existingSettings));
    }
  }

  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Error inicializando configuración base.'));
    tx.onabort = () => reject(tx.error ?? new Error('Transacción inicial abortada.'));
  });
}

export async function getIndexedDb(): Promise<IDBDatabase> {
  if (dbInstancePromise) return dbInstancePromise;

  dbInstancePromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof window === 'undefined' || !('indexedDB' in window)) {
      reject(new Error('IndexedDB no está disponible en este navegador.'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const tx = request.transaction;
      if (!tx) return;
      const applied = runIdbMigrations(
        db,
        tx,
        event.oldVersion,
        event.newVersion ?? DB_VERSION,
      );
      pendingMigrationsFromUpgrade = [...pendingMigrationsFromUpgrade, ...applied];
    };

    request.onsuccess = async () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbInstancePromise = null;
      };
      try {
        await ensureBootstrapRecords(db);
        resolve(db);
      } catch (err) {
        reject(err);
      }
    };

    request.onerror = () => {
      dbInstancePromise = null;
      reject(request.error ?? new Error('No fue posible abrir IndexedDB.'));
    };

    request.onblocked = () => {
      reject(
        new Error(
          'La actualización de base de datos está bloqueada por otra pestaña abierta.',
        ),
      );
    };
  });

  return dbInstancePromise;
}

/**
 * Ejecuta una transacción atómica multi-store.
 * IMPORTANTE: Dentro de `executor`, encadenar únicamente IDBRequests síncronos
 * sobre `tx` para que el navegador mantenga la transacción activa y garantice rollback ante fallos.
 */
export async function runAtomicTransaction<T>(
  storeNames: WorkshopStoreName[],
  mode: IDBTransactionMode,
  executor: (tx: IDBTransaction, done: (value: T) => void, fail: (err: unknown) => void) => void,
): Promise<T> {
  const db = await getIndexedDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    let resultValue: T;
    let hasResult = false;
    let settled = false;

    const done = (val: T) => {
      resultValue = val;
      hasResult = true;
    };

    const fail = (err: unknown) => {
      if (!settled) {
        settled = true;
        try {
          tx.abort();
        } catch {
          // ignore if already finished
        }
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    };

    tx.oncomplete = () => {
      if (!settled) {
        settled = true;
        resolve(hasResult ? resultValue : (undefined as T));
      }
    };

    tx.onerror = () => {
      if (!settled) {
        settled = true;
        reject(tx.error ?? new Error('Error ejecutando transacción en IndexedDB.'));
      }
    };

    tx.onabort = () => {
      if (!settled) {
        settled = true;
        reject(tx.error ?? new Error('Transacción abortada (rollback ejecutado).'));
      }
    };

    try {
      executor(tx, done, fail);
    } catch (err) {
      fail(err);
    }
  });
}

export function resetCachedDbConnection(): void {
  dbInstancePromise = null;
}

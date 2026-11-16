import { DB_VERSION, STORE_DEFINITIONS } from './dbSchema.ts';
import type { SchemaMeta, SchemaMigrationRecord } from '@/src/domain/models/index.ts';

export interface MigrationStep {
  readonly version: number;
  readonly name: string;
  apply(db: IDBDatabase, tx: IDBTransaction): void;
}

/**
 * Registro secuencial e idempotente de migraciones de IndexedDB.
 * Cada nueva fase que agregue almacenes o índices añadirá aquí la versión v2, v3, etc.
 */
export const MIGRATION_STEPS: MigrationStep[] = [
  {
    version: 1,
    name: 'initial_foundation_v1',
    apply(db, tx) {
      for (const def of STORE_DEFINITIONS) {
        let store: IDBObjectStore;
        if (!db.objectStoreNames.contains(def.name)) {
          store = db.createObjectStore(def.name, { keyPath: def.keyPath });
        } else {
          store = tx.objectStore(def.name);
        }
        for (const indexDef of def.indexes) {
          if (!store.indexNames.contains(indexDef.name)) {
            store.createIndex(indexDef.name, indexDef.keyPath, {
              unique: Boolean(indexDef.unique),
            });
          }
        }
      }
    },
  },
  {
    version: 2,
    name: 'phase5_procurement_and_notes_v2',
    apply(db, tx) {
      for (const def of STORE_DEFINITIONS) {
        let store: IDBObjectStore;
        if (!db.objectStoreNames.contains(def.name)) {
          store = db.createObjectStore(def.name, { keyPath: def.keyPath });
        } else {
          store = tx.objectStore(def.name);
        }
        for (const indexDef of def.indexes) {
          if (!store.indexNames.contains(indexDef.name)) {
            store.createIndex(indexDef.name, indexDef.keyPath, {
              unique: Boolean(indexDef.unique),
            });
          }
        }
      }
    },
  },
  {
    version: 3,
    name: 'phase6_quoting_v3',
    apply(db, tx) {
      for (const def of STORE_DEFINITIONS) {
        let store: IDBObjectStore;
        if (!db.objectStoreNames.contains(def.name)) {
          store = db.createObjectStore(def.name, { keyPath: def.keyPath });
        } else {
          store = tx.objectStore(def.name);
        }
        for (const indexDef of def.indexes) {
          if (!store.indexNames.contains(indexDef.name)) {
            store.createIndex(indexDef.name, indexDef.keyPath, {
              unique: Boolean(indexDef.unique),
            });
          }
        }
      }
    },
  },
  {
    version: 4,
    name: 'phase8_planner_v4',
    apply(db, tx) {
      for (const def of STORE_DEFINITIONS) {
        let store: IDBObjectStore;
        if (!db.objectStoreNames.contains(def.name)) {
          store = db.createObjectStore(def.name, { keyPath: def.keyPath });
        } else {
          store = tx.objectStore(def.name);
        }
        for (const indexDef of def.indexes) {
          if (!store.indexNames.contains(indexDef.name)) {
            store.createIndex(indexDef.name, indexDef.keyPath, {
              unique: Boolean(indexDef.unique),
            });
          }
        }
      }
    },
  },
];

export function runIdbMigrations(
  db: IDBDatabase,
  tx: IDBTransaction,
  oldVersion: number,
  newVersion: number,
): SchemaMigrationRecord[] {
  const executed: SchemaMigrationRecord[] = [];
  const pending = MIGRATION_STEPS.filter(
    (step) => step.version > oldVersion && step.version <= newVersion,
  ).sort((a, b) => a.version - b.version);

  for (const step of pending) {
    step.apply(db, tx);
    executed.push({
      version: step.version,
      name: step.name,
      appliedAt: new Date().toISOString(),
    });
  }

  return executed;
}

export function buildUpdatedSchemaMeta(
  existing: SchemaMeta | null,
  newlyApplied: SchemaMigrationRecord[],
): SchemaMeta {
  const existingVersions = new Set(
    (existing?.appliedMigrations ?? []).map((m) => m.version),
  );
  const merged = [...(existing?.appliedMigrations ?? [])];
  for (const record of newlyApplied) {
    if (!existingVersions.has(record.version)) {
      merged.push(record);
    }
  }
  merged.sort((a, b) => a.version - b.version);

  return {
    id: 'schema',
    currentVersion: DB_VERSION,
    appliedMigrations: merged,
    lastMigratedAt:
      newlyApplied[newlyApplied.length - 1]?.appliedAt ??
      existing?.lastMigratedAt ??
      new Date().toISOString(),
  };
}

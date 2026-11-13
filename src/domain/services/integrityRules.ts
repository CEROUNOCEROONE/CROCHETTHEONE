import type { BaseEntity, WorkshopStoreName } from '@/src/domain/models/index.ts';

export interface ForeignKeyConstraint {
  readonly field: string;
  readonly targetStore: WorkshopStoreName;
  readonly required: boolean;
}

/**
 * Mapa oficial de integridad referencial entre entidades del taller.
 * Evita registros huérfanos tanto en operaciones normales como en importación de respaldos.
 */
export const STORE_FOREIGN_KEYS: Partial<Record<WorkshopStoreName, ForeignKeyConstraint[]>> = {
  projects: [{ field: 'clientId', targetStore: 'clients', required: false }],
  project_components: [{ field: 'projectId', targetStore: 'projects', required: true }],
  work_sessions: [
    { field: 'projectId', targetStore: 'projects', required: true },
    { field: 'componentId', targetStore: 'project_components', required: true },
  ],
  material_variants: [{ field: 'materialId', targetStore: 'materials', required: true }],
  inventory_reservations: [
    { field: 'projectId', targetStore: 'projects', required: true },
    { field: 'componentId', targetStore: 'project_components', required: false },
    { field: 'variantId', targetStore: 'material_variants', required: true },
  ],
  inventory_movements: [
    { field: 'variantId', targetStore: 'material_variants', required: true },
    { field: 'projectId', targetStore: 'projects', required: false },
    { field: 'reservationId', targetStore: 'inventory_reservations', required: false },
  ],
  payment_plans: [
    { field: 'projectId', targetStore: 'projects', required: true },
    { field: 'clientId', targetStore: 'clients', required: true },
  ],
  payment_installments: [{ field: 'planId', targetStore: 'payment_plans', required: true }],
  financial_transactions: [
    { field: 'planId', targetStore: 'payment_plans', required: true },
    { field: 'projectId', targetStore: 'projects', required: true },
    { field: 'clientId', targetStore: 'clients', required: true },
    { field: 'installmentId', targetStore: 'payment_installments', required: false },
  ],
};

/**
 * Orden topológico para inserciones (padres antes que hijos)
 * y su inverso para borrados transaccionales seguros (hijos antes que padres).
 */
export const DATA_STORES_TOPOLOGICAL_ORDER: WorkshopStoreName[] = [
  'workshop_settings',
  'clients',
  'materials',
  'material_variants',
  'projects',
  'project_components',
  'work_sessions',
  'inventory_reservations',
  'inventory_movements',
  'payment_plans',
  'payment_installments',
  'financial_transactions',
];

export function assertValidEntityShape(
  storeName: WorkshopStoreName,
  record: unknown,
): asserts record is BaseEntity {
  if (!record || typeof record !== 'object') {
    throw new Error(`Registro inválido en "${storeName}": se esperaba un objeto.`);
  }
  const obj = record as Record<string, unknown>;
  if (typeof obj.id !== 'string' || obj.id.trim().length === 0) {
    throw new Error(`Registro en "${storeName}" sin identificador único (id) válido.`);
  }
  if (storeName === '_meta_schema') return;

  if (typeof obj.isDemo !== 'boolean') {
    throw new Error(`Registro "${obj.id}" en "${storeName}" requiere bandera booleana isDemo.`);
  }
  if (typeof obj.createdAt !== 'string' || Number.isNaN(Date.parse(obj.createdAt))) {
    throw new Error(`Registro "${obj.id}" en "${storeName}" requiere fecha createdAt válida.`);
  }
  if (typeof obj.updatedAt !== 'string' || Number.isNaN(Date.parse(obj.updatedAt))) {
    throw new Error(`Registro "${obj.id}" en "${storeName}" requiere fecha updatedAt válida.`);
  }
}

export function validateCrossRecordIntegrity(
  recordsByStore: Partial<Record<WorkshopStoreName, BaseEntity[]>>,
  externalIdLookup?: Partial<Record<WorkshopStoreName, Set<string>>>,
): string[] {
  const errors: string[] = [];
  const idIndex = new Map<WorkshopStoreName, Map<string, BaseEntity>>();

  for (const storeName of DATA_STORES_TOPOLOGICAL_ORDER) {
    const map = new Map<string, BaseEntity>();
    const list = recordsByStore[storeName] ?? [];
    for (const item of list) {
      if (map.has(item.id)) {
        errors.push(`ID duplicado "${item.id}" dentro de "${storeName}".`);
      } else {
        map.set(item.id, item);
      }
    }
    idIndex.set(storeName, map);
  }

  for (const storeName of DATA_STORES_TOPOLOGICAL_ORDER) {
    const constraints = STORE_FOREIGN_KEYS[storeName] ?? [];
    if (constraints.length === 0) continue;

    const list = recordsByStore[storeName] ?? [];
    for (const record of list) {
      const obj = record as unknown as Record<string, unknown>;
      for (const fk of constraints) {
        const rawValue = obj[fk.field];
        if (rawValue === null || rawValue === undefined || rawValue === '') {
          if (fk.required) {
            errors.push(
              `Integridad rota en "${storeName}" (${record.id}): falta "${fk.field}" obligatorio.`,
            );
          }
          continue;
        }
        if (typeof rawValue !== 'string') {
          errors.push(
            `Integridad rota en "${storeName}" (${record.id}): "${fk.field}" debe ser string.`,
          );
          continue;
        }

        const parentMap = idIndex.get(fk.targetStore);
        const parentInBundle = parentMap?.get(rawValue);
        const parentInExternal = externalIdLookup?.[fk.targetStore]?.has(rawValue) ?? false;

        if (!parentInBundle && !parentInExternal) {
          errors.push(
            `Registro huérfano en "${storeName}" (${record.id}): "${fk.field}" apunta a "${rawValue}" inexistente en "${fk.targetStore}".`,
          );
          continue;
        }

        // Regla estricta: un registro real (isDemo: false) no puede depender de un padre demo.
        if (parentInBundle && !record.isDemo && parentInBundle.isDemo) {
          errors.push(
            `Aislamiento violado en "${storeName}" (${record.id}): un registro real no puede depender del registro de ejemplo "${rawValue}".`,
          );
        }
      }
    }
  }

  return errors;
}

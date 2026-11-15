import type {
  BaseEntity,
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
  ShoppingListItem,
  WorkSession,
  WorkshopSettings,
  WorkshopStoreName,
} from '@/src/domain/models/index.ts';
import type { DemoPurgeOutcome } from '@/src/data/ports/DataStorePort.ts';
import {
  DATA_STORES_TOPOLOGICAL_ORDER,
  STORE_FOREIGN_KEYS,
} from '@/src/domain/services/integrityRules.ts';
import { createDefaultWorkshopSettings, runAtomicTransaction } from './indexedDbClient.ts';

interface DemoBundle {
  readonly clients: Client[];
  readonly materials: Material[];
  readonly variants: MaterialVariant[];
  readonly projects: Project[];
  readonly components: ProjectComponent[];
  readonly workSessions: WorkSession[];
  readonly reservations: InventoryReservation[];
  readonly pendingMaterials: PendingMaterial[];
  readonly notesAndLists: NoteOrList[];
  readonly shoppingItems: ShoppingListItem[];
  readonly movements: InventoryMovement[];
  readonly paymentPlans: PaymentPlan[];
  readonly installments: PaymentInstallment[];
  readonly transactions: FinancialTransaction[];
}

function buildDemoMeta(id: string, createdAt: string) {
  return {
    id,
    ownerId: 'local-workshop',
    syncStatus: 'local_only' as const,
    version: 1,
    isDemo: true,
    createdAt,
    updatedAt: createdAt,
  };
}

function createDemoBundle(): DemoBundle {
  const now = new Date();
  const isoNow = now.toISOString();
  const in5Days = new Date(now.getTime() + 5 * 86400000).toISOString();
  const in10Days = new Date(now.getTime() + 10 * 86400000).toISOString();
  const in20Days = new Date(now.getTime() + 20 * 86400000).toISOString();
  const in30Days = new Date(now.getTime() + 30 * 86400000).toISOString();

  // 1. Cliente de ejemplo
  const clients: Client[] = [
    {
      ...buildDemoMeta('demo_client_camila', isoNow),
      name: 'Camila Restrepo',
      phone: '310 458 9210',
      email: null,
      address: 'Medellín, Antioquia',
      notes: 'Cliente de demostración: encargo personalizado con plan de cuotas.',
    },
  ];

  // 2. Materiales y variantes con color independiente obligatorio
  const materials: Material[] = [
    {
      ...buildDemoMeta('demo_mat_algodon', isoNow),
      name: 'Hilo de Algodón Peinado',
      category: 'yarn_cotton',
      brand: 'Abuelita / Artesanal',
      unit: 'g',
      description: 'Hilo suave 100% algodón para amigurumis y detalles.',
    },
    {
      ...buildDemoMeta('demo_mat_ojos', isoNow),
      name: 'Ojos de Seguridad',
      category: 'safety_eyes',
      brand: 'Estándar 12mm',
      unit: 'pair',
      description: 'Ojos plásticos con arandela de seguridad.',
    },
  ];

  // 500g Hilo de algodón Blanco (250g reservados entre proyectos, 250g disponibles)
  const variants: MaterialVariant[] = [
    {
      ...buildDemoMeta('demo_var_algodon_blanco', isoNow),
      materialId: 'demo_mat_algodon',
      colorName: 'Blanco',
      colorHex: '#F8FAFC',
      sizeOrGauge: '2.5mm - 3.0mm',
      sku: 'ALG-BLA-500',
      provider: 'Lanas El Centro',
      unitCostCOP: 50,
      physicalStock: 500,
      reservedStock: 250,
      totalConsumed: 0,
      minStock: 100,
      photoUrl: null,
      notes: '500 g físicos totales: 100 g reservados para Mariposa y 150 g para Amigurumi.',
    },
    {
      ...buildDemoMeta('demo_var_algodon_rosa', isoNow),
      materialId: 'demo_mat_algodon',
      colorName: 'Rosa Pastel',
      colorHex: '#F472B6',
      sizeOrGauge: '2.5mm - 3.0mm',
      sku: 'ALG-ROS-120',
      provider: 'Lanas El Centro',
      unitCostCOP: 52,
      physicalStock: 120,
      reservedStock: 60,
      totalConsumed: 0,
      minStock: 100,
      photoUrl: null,
      notes: 'Quedan 60 g disponibles (por debajo del mínimo de 100 g).',
    },
    {
      ...buildDemoMeta('demo_var_ojos_negro', isoNow),
      materialId: 'demo_mat_ojos',
      colorName: 'Negro Brillante',
      colorHex: '#0F172A',
      sizeOrGauge: '12mm',
      sku: 'OJO-12-NEG',
      provider: 'Mercería Central',
      unitCostCOP: 1500,
      physicalStock: 8,
      reservedStock: 2,
      totalConsumed: 0,
      minStock: 4,
      photoUrl: null,
      notes: 'Pares disponibles para amigurumis.',
    },
  ];

  // 3. Proyectos de ejemplo: Mariposa de crochet + Amigurumi personalizado ($180.000 COP)
  const projects: Project[] = [
    {
      ...buildDemoMeta('demo_proj_mariposa', isoNow),
      name: 'Mariposa de Crochet',
      description: 'Proyecto propio dividido por partes para controlar tiempo efectivo y consumo de hilo.',
      referencePhotoUrl: null,
      clientId: null,
      patternId: null,
      startDate: isoNow,
      estimatedEndDate: in5Days,
      targetTotalMinutes: 180,
      dailyGoalMinutes: 60,
      weeklyGoalMinutes: 180,
      estimatedBudgetCOP: 28000,
      status: 'in_progress',
      paymentStatus: 'not_applicable',
      notes: 'Ejemplo de proyecto dividido en 5 componentes.',
    },
    {
      ...buildDemoMeta('demo_proj_amigurumi', isoNow),
      name: 'Amigurumi Personalizado',
      description: 'Encargo comercial de amigurumi mediano con diseño a medida y empaque de regalo.',
      referencePhotoUrl: null,
      clientId: 'demo_client_camila',
      patternId: null,
      startDate: isoNow,
      estimatedEndDate: in20Days,
      targetTotalMinutes: 420,
      dailyGoalMinutes: 90,
      weeklyGoalMinutes: 300,
      estimatedBudgetCOP: 180000,
      status: 'in_progress',
      paymentStatus: 'deposit_received',
      notes: 'Ejemplo comercial por $180.000 COP con anticipo de $60.000 y 3 cuotas de $40.000.',
    },
  ];

  // 4. Componentes de ambos proyectos
  const components: ProjectComponent[] = [
    {
      ...buildDemoMeta('demo_comp_mar_tronco', isoNow),
      projectId: 'demo_proj_mariposa',
      name: 'Tronco',
      orderIndex: 1,
      estimatedMinutes: 30,
      effectiveMinutesSpent: 28,
      status: 'completed',
      requiredVariantIds: ['demo_var_algodon_blanco'],
      notes: 'Pieza finalizada.',
    },
    {
      ...buildDemoMeta('demo_comp_mar_ala_izq', isoNow),
      projectId: 'demo_proj_mariposa',
      name: 'Ala izquierda',
      orderIndex: 2,
      estimatedMinutes: 40,
      effectiveMinutesSpent: 42,
      status: 'completed',
      requiredVariantIds: ['demo_var_algodon_rosa'],
      notes: 'Pieza finalizada.',
    },
    {
      ...buildDemoMeta('demo_comp_mar_ala_der', isoNow),
      projectId: 'demo_proj_mariposa',
      name: 'Ala derecha',
      orderIndex: 3,
      estimatedMinutes: 40,
      effectiveMinutesSpent: 15,
      status: 'in_progress',
      requiredVariantIds: ['demo_var_algodon_rosa'],
      notes: 'En tejido actual.',
    },
    {
      ...buildDemoMeta('demo_comp_mar_antenas', isoNow),
      projectId: 'demo_proj_mariposa',
      name: 'Antenas',
      orderIndex: 4,
      estimatedMinutes: 20,
      effectiveMinutesSpent: 0,
      status: 'pending',
      requiredVariantIds: ['demo_var_algodon_blanco'],
      notes: '',
    },
    {
      ...buildDemoMeta('demo_comp_mar_ensamble', isoNow),
      projectId: 'demo_proj_mariposa',
      name: 'Ensamblaje',
      orderIndex: 5,
      estimatedMinutes: 30,
      effectiveMinutesSpent: 0,
      status: 'pending',
      requiredVariantIds: ['demo_var_ojos_negro'],
      notes: '',
    },
    {
      ...buildDemoMeta('demo_comp_ami_cabeza', isoNow),
      projectId: 'demo_proj_amigurumi',
      name: 'Cabeza y expresión',
      orderIndex: 1,
      estimatedMinutes: 120,
      effectiveMinutesSpent: 65,
      status: 'in_progress',
      requiredVariantIds: ['demo_var_algodon_blanco', 'demo_var_ojos_negro'],
      notes: '',
    },
    {
      ...buildDemoMeta('demo_comp_ami_cuerpo', isoNow),
      projectId: 'demo_proj_amigurumi',
      name: 'Cuerpo y extremidades',
      orderIndex: 2,
      estimatedMinutes: 180,
      effectiveMinutesSpent: 0,
      status: 'pending',
      requiredVariantIds: ['demo_var_algodon_blanco'],
      notes: '',
    },
  ];

  // 5. Sesiones completadas de ejemplo (coherentes con effectiveMinutesSpent de cada pieza)
  const workSessions: WorkSession[] = [
    {
      ...buildDemoMeta('demo_sess_1', isoNow),
      projectId: 'demo_proj_mariposa',
      componentId: 'demo_comp_mar_tronco',
      startTime: new Date(now.getTime() - 2 * 3600000).toISOString(),
      endTime: new Date(now.getTime() - 92 * 60000).toISOString(),
      status: 'completed',
      pauseIntervals: [],
      elapsedSeconds: 1680,
      effectiveSeconds: 1680,
      entryType: 'timer',
      adjustmentReason: null,
      notes: 'Sesión completada en Tronco.',
    },
    {
      ...buildDemoMeta('demo_sess_2', isoNow),
      projectId: 'demo_proj_mariposa',
      componentId: 'demo_comp_mar_ala_izq',
      startTime: new Date(now.getTime() - 90 * 60000).toISOString(),
      endTime: new Date(now.getTime() - 48 * 60000).toISOString(),
      status: 'completed',
      pauseIntervals: [],
      elapsedSeconds: 2520,
      effectiveSeconds: 2520,
      entryType: 'timer',
      adjustmentReason: null,
      notes: 'Sesión completada en Ala izquierda.',
    },
    {
      ...buildDemoMeta('demo_sess_3', isoNow),
      projectId: 'demo_proj_mariposa',
      componentId: 'demo_comp_mar_ala_der',
      startTime: new Date(now.getTime() - 45 * 60000).toISOString(),
      endTime: new Date(now.getTime() - 30 * 60000).toISOString(),
      status: 'completed',
      pauseIntervals: [],
      elapsedSeconds: 900,
      effectiveSeconds: 900,
      entryType: 'timer',
      adjustmentReason: null,
      notes: 'Avance inicial en Ala derecha.',
    },
    {
      ...buildDemoMeta('demo_sess_4', isoNow),
      projectId: 'demo_proj_amigurumi',
      componentId: 'demo_comp_ami_cabeza',
      startTime: new Date(now.getTime() - 180 * 60000).toISOString(),
      endTime: new Date(now.getTime() - 115 * 60000).toISOString(),
      status: 'completed',
      pauseIntervals: [],
      elapsedSeconds: 3900,
      effectiveSeconds: 3900,
      entryType: 'timer',
      adjustmentReason: null,
      notes: 'Tejido base de cabeza y colocación de ojos.',
    },
  ];

  // 6. Reservas de inventario compartido
  const reservations: InventoryReservation[] = [
    {
      ...buildDemoMeta('demo_res_mariposa_blanco', isoNow),
      projectId: 'demo_proj_mariposa',
      componentId: null,
      variantId: 'demo_var_algodon_blanco',
      reservedQuantity: 100,
      consumedQuantity: 0,
      status: 'active',
      notes: 'Reserva de Algodón Blanco para Mariposa de Crochet.',
    },
    {
      ...buildDemoMeta('demo_res_amigurumi_blanco', isoNow),
      projectId: 'demo_proj_amigurumi',
      componentId: null,
      variantId: 'demo_var_algodon_blanco',
      reservedQuantity: 150,
      consumedQuantity: 0,
      status: 'active',
      notes: 'Reserva de Algodón Blanco para Amigurumi Personalizado.',
    },
    {
      ...buildDemoMeta('demo_res_mariposa_rosa', isoNow),
      projectId: 'demo_proj_mariposa',
      componentId: null,
      variantId: 'demo_var_algodon_rosa',
      reservedQuantity: 60,
      consumedQuantity: 0,
      status: 'active',
      notes: 'Reserva de Rosa Pastel para alas.',
    },
  ];

  // 7. Kardex inmutable inicial de demostración
  const movements: InventoryMovement[] = [
    {
      ...buildDemoMeta('demo_mov_1', isoNow),
      variantId: 'demo_var_algodon_blanco',
      projectId: null,
      reservationId: null,
      purchaseReceiptId: null,
      type: 'INITIAL_STOCK',
      quantityDelta: 500,
      previousPhysicalStock: 0,
      newPhysicalStock: 500,
      previousReservedStock: 0,
      newReservedStock: 0,
      unitCostAtMovementCOP: 50,
      idempotencyKey: 'demo_init_algodon_blanco',
      notes: 'Registro inicial de 500 g de Hilo Algodón Blanco.',
      timestamp: isoNow,
    },
    {
      ...buildDemoMeta('demo_mov_2', isoNow),
      variantId: 'demo_var_algodon_blanco',
      projectId: 'demo_proj_mariposa',
      reservationId: 'demo_res_mariposa_blanco',
      purchaseReceiptId: null,
      type: 'RESERVATION_CREATED',
      quantityDelta: 100,
      previousPhysicalStock: 500,
      newPhysicalStock: 500,
      previousReservedStock: 0,
      newReservedStock: 100,
      unitCostAtMovementCOP: 50,
      idempotencyKey: 'demo_res_1',
      notes: 'Reserva de 100 g para Mariposa de Crochet.',
      timestamp: isoNow,
    },
    {
      ...buildDemoMeta('demo_mov_3', isoNow),
      variantId: 'demo_var_algodon_blanco',
      projectId: 'demo_proj_amigurumi',
      reservationId: 'demo_res_amigurumi_blanco',
      purchaseReceiptId: null,
      type: 'RESERVATION_CREATED',
      quantityDelta: 150,
      previousPhysicalStock: 500,
      newPhysicalStock: 500,
      previousReservedStock: 100,
      newReservedStock: 250,
      unitCostAtMovementCOP: 50,
      idempotencyKey: 'demo_res_2',
      notes: 'Reserva de 150 g para Amigurumi Personalizado.',
      timestamp: isoNow,
    },
  ];

  // 8. Plan de pagos ($180.000 COP: anticipo $60.000 + 3 cuotas de $40.000)
  const paymentPlans: PaymentPlan[] = [
    {
      ...buildDemoMeta('demo_plan_amigurumi', isoNow),
      projectId: 'demo_proj_amigurumi',
      clientId: 'demo_client_camila',
      totalAgreedCOP: 180000,
      agreementDate: isoNow,
      modality: 'three_installments',
      totalPaidCOP: 60000,
      balancePendingCOP: 120000,
      status: 'deposit_received',
      notes: 'Anticipo de $60.000 COP recibido + 3 cuotas de $40.000 COP.',
    },
  ];

  const installments: PaymentInstallment[] = [
    {
      ...buildDemoMeta('demo_inst_1', isoNow),
      planId: 'demo_plan_amigurumi',
      installmentNumber: 1,
      concept: 'Anticipo inicial',
      scheduledAmountCOP: 60000,
      paidAmountCOP: 60000,
      dueDate: isoNow,
      status: 'paid',
    },
    {
      ...buildDemoMeta('demo_inst_2', isoNow),
      planId: 'demo_plan_amigurumi',
      installmentNumber: 2,
      concept: 'Segunda cuota',
      scheduledAmountCOP: 40000,
      paidAmountCOP: 0,
      dueDate: in10Days,
      status: 'pending',
    },
    {
      ...buildDemoMeta('demo_inst_3', isoNow),
      planId: 'demo_plan_amigurumi',
      installmentNumber: 3,
      concept: 'Tercera cuota',
      scheduledAmountCOP: 40000,
      paidAmountCOP: 0,
      dueDate: in20Days,
      status: 'pending',
    },
    {
      ...buildDemoMeta('demo_inst_4', isoNow),
      planId: 'demo_plan_amigurumi',
      installmentNumber: 4,
      concept: 'Saldo contra entrega',
      scheduledAmountCOP: 40000,
      paidAmountCOP: 0,
      dueDate: in30Days,
      status: 'pending',
    },
  ];

  const transactions: FinancialTransaction[] = [
    {
      ...buildDemoMeta('demo_tx_anticipo', isoNow),
      planId: 'demo_plan_amigurumi',
      projectId: 'demo_proj_amigurumi',
      clientId: 'demo_client_camila',
      installmentId: 'demo_inst_1',
      amountCOP: 60000,
      paymentDate: isoNow,
      paymentMethod: 'nequi',
      referenceNumber: 'NQ-010482',
      notes: 'Pago de anticipo por Nequi.',
    },
  ];

  // 9. Compras pendientes, lista de compras y nota rápida de ejemplo (Fase 5)
  const pendingMaterials: PendingMaterial[] = [
    {
      ...buildDemoMeta('demo_pending_rosa', isoNow),
      variantId: 'demo_var_algodon_rosa',
      projectId: 'demo_proj_mariposa',
      componentId: 'demo_comp_mar_ala_der',
      quantityNeeded: 200,
      quantityReceived: 0,
      provider: 'Lanas El Centro',
      orderedDate: isoNow,
      estimatedArrivalDate: in5Days,
      status: 'ordered',
      notes: 'Pedido semanal de reposición para completar alas de Mariposa.',
    },
  ];

  const notesAndLists: NoteOrList[] = [
    {
      ...buildDemoMeta('demo_list_semanal', isoNow),
      title: 'Compra semanal — Lanas El Centro',
      type: 'shopping_list',
      projectId: 'demo_proj_mariposa',
      content: 'Reposición de hilo rosa pastel y relleno antialérgico para entregas de la semana.',
      status: 'active',
    },
    {
      ...buildDemoMeta('demo_note_amigurumi', isoNow),
      title: 'Notas de tensión — Amigurumi Camila',
      type: 'free_note',
      projectId: 'demo_proj_amigurumi',
      content:
        'Usar ganchillo 2.5 mm en cabeza para punto firme sin huecos y 3.0 mm en cuerpo. Confirmar tarjeta de dedicatoria antes del empaque.',
      status: 'active',
    },
  ];

  const shoppingItems: ShoppingListItem[] = [
    {
      ...buildDemoMeta('demo_sli_rosa', isoNow),
      listId: 'demo_list_semanal',
      variantId: 'demo_var_algodon_rosa',
      pendingMaterialId: 'demo_pending_rosa',
      customName: 'Hilo de Algodón Peinado',
      colorName: 'Rosa Pastel',
      unit: 'g',
      plannedQuantity: 200,
      purchasedQuantity: 200,
      receivedQuantity: 0,
      estimatedUnitPriceCOP: 52,
      provider: 'Lanas El Centro',
      status: 'purchased_waiting_delivery',
      notes: 'Ya pagado al proveedor, pendiente recibir en el taller.',
    },
    {
      ...buildDemoMeta('demo_sli_relleno', isoNow),
      listId: 'demo_list_semanal',
      variantId: null,
      pendingMaterialId: null,
      customName: 'Algodón siliconado antialérgico',
      colorName: 'Blanco',
      unit: 'g',
      plannedQuantity: 500,
      purchasedQuantity: 0,
      receivedQuantity: 0,
      estimatedUnitPriceCOP: 22,
      provider: 'Mercería Central',
      status: 'pending',
      notes: 'Por comprar en la próxima salida al centro.',
    },
  ];

  return {
    clients,
    materials,
    variants,
    projects,
    components,
    workSessions,
    reservations,
    pendingMaterials,
    notesAndLists,
    shoppingItems,
    movements,
    paymentPlans,
    installments,
    transactions,
  };
}

export async function loadDemoDataTransaction(): Promise<{ insertedCount: number }> {
  const bundle = createDemoBundle();

  const storeMapping: Array<[WorkshopStoreName, BaseEntity[]]> = [
    ['clients', bundle.clients],
    ['materials', bundle.materials],
    ['material_variants', bundle.variants],
    ['projects', bundle.projects],
    ['project_components', bundle.components],
    ['work_sessions', bundle.workSessions],
    ['inventory_reservations', bundle.reservations],
    ['pending_materials', bundle.pendingMaterials],
    ['notes_and_lists', bundle.notesAndLists],
    ['shopping_list_items', bundle.shoppingItems],
    ['inventory_movements', bundle.movements],
    ['payment_plans', bundle.paymentPlans],
    ['payment_installments', bundle.installments],
    ['financial_transactions', bundle.transactions],
  ];

  return runAtomicTransaction<{ insertedCount: number }>(
    DATA_STORES_TOPOLOGICAL_ORDER,
    'readwrite',
    (tx, done, fail) => {
      const settingsStore = tx.objectStore('workshop_settings');
      const getSettingsReq = settingsStore.get('default');

      getSettingsReq.onerror = () => fail(getSettingsReq.error);
      getSettingsReq.onsuccess = () => {
        const currentSettings =
          (getSettingsReq.result as WorkshopSettings | undefined) ??
          createDefaultWorkshopSettings();

        let insertedCount = 0;
        for (const [storeName, records] of storeMapping) {
          const store = tx.objectStore(storeName);
          for (const record of records) {
            store.put(record);
            insertedCount += 1;
          }
        }

        const updatedSettings: WorkshopSettings = {
          ...currentSettings,
          demoDataLoaded: true,
          updatedAt: new Date().toISOString(),
        };
        settingsStore.put(updatedSettings);
        done({ insertedCount });
      };
    },
  );
}

/**
 * Eliminación transaccional segura de registros isDemo.
 * Verifica integridad cruzada antes de borrar y opera en orden topológico inverso
 * (hijos antes que padres) sin afectar ningún registro real (isDemo: false).
 */
export async function purgeDemoDataTransaction(): Promise<DemoPurgeOutcome> {
  return runAtomicTransaction<DemoPurgeOutcome>(
    DATA_STORES_TOPOLOGICAL_ORDER,
    'readwrite',
    (tx, done, fail) => {
      const allByStore = new Map<WorkshopStoreName, BaseEntity[]>();
      let pendingReads = DATA_STORES_TOPOLOGICAL_ORDER.length;
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
          allByStore.set(storeName, (req.result as BaseEntity[]) ?? []);
          pendingReads -= 1;
          if (pendingReads === 0) {
            executeSafePurge();
          }
        };
      }

      function executeSafePurge() {
        const demoIdsByStore = new Map<WorkshopStoreName, Set<string>>();
        let preservedRealCount = 0;

        for (const [storeName, records] of allByStore.entries()) {
          const demoSet = new Set<string>();
          for (const record of records) {
            if (record.isDemo) {
              demoSet.add(record.id);
            } else if (storeName !== 'workshop_settings') {
              preservedRealCount += 1;
            }
          }
          demoIdsByStore.set(storeName, demoSet);
        }

        // Guardia de integridad: impedir borrado si algún registro real depende de un padre demo
        for (const [storeName, records] of allByStore.entries()) {
          const constraints = STORE_FOREIGN_KEYS[storeName] ?? [];
          if (constraints.length === 0) continue;

          for (const record of records) {
            if (record.isDemo) continue;
            const obj = record as unknown as Record<string, unknown>;
            for (const fk of constraints) {
              const parentId = obj[fk.field];
              if (
                typeof parentId === 'string' &&
                demoIdsByStore.get(fk.targetStore)?.has(parentId)
              ) {
                fail(
                  new Error(
                    `Protección de integridad: el registro real "${record.id}" en "${storeName}" depende del elemento de ejemplo "${parentId}".`,
                  ),
                );
                return;
              }
            }
          }
        }

        // Orden topológico inverso (hijos antes que padres)
        const reverseStores = [...DATA_STORES_TOPOLOGICAL_ORDER]
          .filter((name) => name !== 'workshop_settings')
          .reverse();

        let deletedCount = 0;
        for (const storeName of reverseStores) {
          const store = tx.objectStore(storeName);
          const demoIds = demoIdsByStore.get(storeName);
          if (!demoIds || demoIds.size === 0) continue;
          for (const id of demoIds) {
            store.delete(id);
            deletedCount += 1;
          }
        }

        const settingsList =
          (allByStore.get('workshop_settings') as WorkshopSettings[] | undefined) ?? [];
        const currentSettings =
          settingsList.find((s) => s.id === 'default') ?? createDefaultWorkshopSettings();

        const nextSettings: WorkshopSettings = {
          ...currentSettings,
          demoDataLoaded: false,
          updatedAt: new Date().toISOString(),
        };
        tx.objectStore('workshop_settings').put(nextSettings);

        done({ deletedCount, preservedRealCount });
      }
    },
  );
}

import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import {
  exportWorkshopBackup,
  inspectBackupFile,
} from '../src/data/local/backupService.ts';
import { resetCachedDbConnection } from '../src/data/local/indexedDbClient.ts';
import { localWorkshopEngine } from '../src/data/local/LocalRepository.ts';
import type { BaseEntity, WorkshopStoreName } from '../src/domain/models/index.ts';
import { validateCrossRecordIntegrity } from '../src/domain/services/integrityRules.ts';

function installIsolatedFakeIndexedDb(): void {
  resetCachedDbConnection();
  const isolatedIdb = new IDBFactory();
  const g = globalThis as unknown as Record<string, unknown>;
  g.indexedDB = isolatedIdb;
  g.IDBKeyRange = IDBKeyRange;
  g.window = {
    indexedDB: isolatedIdb,
    IDBKeyRange,
  };
}

async function readAllStoresForIntegrityCheck(): Promise<
  Partial<Record<WorkshopStoreName, BaseEntity[]>>
> {
  const snapshot = await localWorkshopEngine.loadWorkshopSnapshot();
  return {
    workshop_settings: [snapshot.settings],
    clients: snapshot.clients,
    materials: snapshot.materials,
    material_variants: snapshot.variants,
    projects: snapshot.projects,
    project_components: snapshot.components,
    work_sessions: snapshot.workSessions ?? [],
    inventory_reservations: snapshot.reservations,
    pending_materials: snapshot.pendingMaterials ?? [],
    planned_tasks: snapshot.plannedTasks ?? [],
    notes_and_lists: snapshot.notesAndLists ?? [],
    shopping_list_items: snapshot.shoppingItems ?? [],
    purchase_receipts: snapshot.purchaseReceipts ?? [],
    inventory_movements: snapshot.movements,
    quotes: snapshot.quotes ?? [],
    payment_plans: snapshot.paymentPlans ?? [],
    payment_installments: snapshot.installments ?? [],
    financial_transactions: snapshot.transactions ?? [],
    reminders: snapshot.reminders ?? [],
  };
}

async function seedProjectWithMaterialAndComponent(label = 'Prueba') {
  const project = await localWorkshopEngine.createProject({
    name: `Proyecto ${label}`,
    description: 'Proyecto aislado de prueba',
    clientId: null,
    startDate: null,
    estimatedEndDate: null,
    targetTotalMinutes: 120,
    dailyGoalMinutes: 60,
    weeklyGoalMinutes: 300,
    estimatedBudgetCOP: 50000,
    status: 'in_progress',
    paymentStatus: 'not_applicable',
    notes: '',
  });

  const component = await localWorkshopEngine.createComponent({
    projectId: project.id,
    name: `Pieza ${label}`,
    estimatedMinutes: 60,
    notes: '',
  });

  const material = await localWorkshopEngine.createMaterial({
    name: `Algodón ${label}`,
    category: 'yarn_cotton',
    brand: 'Marca Test',
    unit: 'g',
    description: 'Hilo de prueba',
  });

  const variant = await localWorkshopEngine.createVariant({
    materialId: material.id,
    colorName: `Blanco ${label}`,
    colorHex: '#FFFFFF',
    sizeOrGauge: null,
    sku: null,
    provider: 'Proveedor Test',
    initialPhysicalStock: 500,
    minStock: 50,
    unitCostCOP: 20,
    notes: '',
  });

  return { project, component, material, variant };
}

beforeEach(() => {
  installIsolatedFakeIndexedDb();
});

afterEach(() => {
  resetCachedDbConnection();
});

test('Escenario A: eliminar pieza sin sesiones y sin reservas mantiene integridad y respaldo válido', async () => {
  const { component } = await seedProjectWithMaterialAndComponent('A');

  const sessionsBefore = await localWorkshopEngine.workSessions.getAll();
  assert.equal(sessionsBefore.length, 0);

  await localWorkshopEngine.deleteComponent(component.id);

  const deletedComp = await localWorkshopEngine.components.getById(component.id);
  assert.equal(deletedComp, null);

  const integrityErrors = validateCrossRecordIntegrity(
    await readAllStoresForIntegrityCheck(),
  );
  assert.deepEqual(integrityErrors, []);

  const backup = await exportWorkshopBackup({ includeDemo: false });
  const inspection = await inspectBackupFile(JSON.stringify(backup));
  assert.equal(inspection.isValid, true);
  assert.deepEqual(inspection.errors, []);
});

test('Escenario B (+ F, G, H, I, J): eliminar pieza sin sesiones con reserva fulfilled preserva historial sin referencia huérfana ni invalidar respaldo', async () => {
  const { project, component, variant } =
    await seedProjectWithMaterialAndComponent('B-Fulfilled');

  const reservation = await localWorkshopEngine.createReservation({
    projectId: project.id,
    componentId: component.id,
    variantId: variant.id,
    quantity: 100,
    notes: 'Reserva para consumo completo',
  });

  const fulfilled = await localWorkshopEngine.consumeFromReservation({
    reservationId: reservation.id,
    quantity: 100,
    notes: 'Consumo total de la pieza',
  });
  assert.equal(fulfilled.status, 'fulfilled');
  assert.equal(fulfilled.componentId, component.id);

  const movementsBefore = await localWorkshopEngine.movements.getAll();
  const sessionsBefore = await localWorkshopEngine.workSessions.getAll();
  assert.equal(sessionsBefore.length, 0);

  // Ejecutar eliminación real de la pieza
  await localWorkshopEngine.deleteComponent(component.id);

  // La pieza fue eliminada
  assert.equal(await localWorkshopEngine.components.getById(component.id), null);

  // Escenarios F y J: la reserva histórica se conserva íntegra pero desvinculada de la pieza eliminada
  const persistedRes = await localWorkshopEngine.reservations.getById(reservation.id);
  assert.ok(persistedRes, 'La reserva histórica fulfilled NO debe eliminarse');
  assert.equal(persistedRes.status, 'fulfilled');
  assert.equal(persistedRes.projectId, project.id);
  assert.equal(persistedRes.variantId, variant.id);
  assert.equal(persistedRes.reservedQuantity, 100);
  assert.equal(persistedRes.consumedQuantity, 100);
  assert.equal(
    persistedRes.componentId,
    null,
    'componentId debe desvincularse (null) para evitar referencia huérfana',
  );
  assert.ok(
    persistedRes.notes.includes(component.name),
    'Debe conservar trazabilidad textual del nombre de la pieza eliminada en notes',
  );

  // Los movimientos inmutables del Kardex se preservan sin alteraciones
  const movementsAfter = await localWorkshopEngine.movements.getAll();
  assert.equal(movementsAfter.length, movementsBefore.length);

  // Escenario G: validateCrossRecordIntegrity sin errores
  const integrityErrors = validateCrossRecordIntegrity(
    await readAllStoresForIntegrityCheck(),
  );
  assert.deepEqual(integrityErrors, []);

  // Escenarios H e I: respaldo exportado e inspeccionado es válido
  const backup = await exportWorkshopBackup({ includeDemo: false });
  const inspection = await inspectBackupFile(JSON.stringify(backup));
  assert.equal(inspection.isValid, true);
  assert.deepEqual(inspection.errors, []);
});

test('Escenario C (+ F, G, H, I, J): eliminar pieza sin sesiones con reserva released preserva historial sin referencia huérfana ni invalidar respaldo', async () => {
  const { project, component, variant } =
    await seedProjectWithMaterialAndComponent('C-Released');

  const reservation = await localWorkshopEngine.createReservation({
    projectId: project.id,
    componentId: component.id,
    variantId: variant.id,
    quantity: 80,
    notes: 'Reserva temporal',
  });

  const released = await localWorkshopEngine.releaseReservation(
    reservation.id,
    'Ya no se requiere este color',
  );
  assert.equal(released.status, 'released');
  assert.equal(released.componentId, component.id);

  const movementsBefore = await localWorkshopEngine.movements.getAll();
  const sessionsBefore = await localWorkshopEngine.workSessions.getAll();
  assert.equal(sessionsBefore.length, 0);

  await localWorkshopEngine.deleteComponent(component.id);

  assert.equal(await localWorkshopEngine.components.getById(component.id), null);

  // La reserva released histórica sobrevive sin referencia huérfana
  const persistedRes = await localWorkshopEngine.reservations.getById(reservation.id);
  assert.ok(persistedRes, 'La reserva histórica released NO debe eliminarse');
  assert.equal(persistedRes.status, 'released');
  assert.equal(persistedRes.projectId, project.id);
  assert.equal(persistedRes.reservedQuantity, 80);
  assert.equal(persistedRes.consumedQuantity, 0);
  assert.equal(
    persistedRes.componentId,
    null,
    'componentId debe desvincularse (null) para evitar referencia huérfana',
  );
  assert.ok(persistedRes.notes.includes(component.name));

  // Kardex intacto
  const movementsAfter = await localWorkshopEngine.movements.getAll();
  assert.equal(movementsAfter.length, movementsBefore.length);

  // Integridad y respaldo válidos
  const integrityErrors = validateCrossRecordIntegrity(
    await readAllStoresForIntegrityCheck(),
  );
  assert.deepEqual(integrityErrors, []);

  const backup = await exportWorkshopBackup({ includeDemo: false });
  const inspection = await inspectBackupFile(JSON.stringify(backup));
  assert.equal(inspection.isValid, true);
  assert.deepEqual(inspection.errors, []);
});

test('Escenario D: eliminar pieza con sesiones de trabajo sigue bloqueado y preserva todos los registros', async () => {
  const { project, component } = await seedProjectWithMaterialAndComponent('D-Sessions');

  await localWorkshopEngine.logManualWorkSession({
    projectId: project.id,
    componentId: component.id,
    effectiveMinutes: 30,
    notes: 'Avance de tejido',
  });

  await assert.rejects(
    () => localWorkshopEngine.deleteComponent(component.id),
    /sesiones de tiempo o reservas de material asociadas/i,
  );

  // La pieza permanece intacta
  const stillExists = await localWorkshopEngine.components.getById(component.id);
  assert.ok(stillExists);

  const integrityErrors = validateCrossRecordIntegrity(
    await readAllStoresForIntegrityCheck(),
  );
  assert.deepEqual(integrityErrors, []);
});

test('Escenario E: eliminar pieza respeta bloqueo con reserva active y preserva relaciones válidas y otros proyectos', async () => {
  const { project, component, variant } =
    await seedProjectWithMaterialAndComponent('E-Relations');

  // Segunda pieza en el mismo proyecto para verificar reindexación y no afectación
  const siblingComp = await localWorkshopEngine.createComponent({
    projectId: project.id,
    name: 'Pieza Hermana',
    estimatedMinutes: 45,
    notes: '',
  });

  // Otro proyecto independiente con su propia pieza y reserva fulfilled
  const otherProject = await localWorkshopEngine.createProject({
    name: 'Proyecto Externo Intacto',
    description: 'No debe verse afectado',
    clientId: null,
    startDate: null,
    estimatedEndDate: null,
    targetTotalMinutes: 90,
    dailyGoalMinutes: 60,
    weeklyGoalMinutes: 300,
    estimatedBudgetCOP: 40000,
    status: 'in_progress',
    paymentStatus: 'not_applicable',
    notes: '',
  });
  const otherComp = await localWorkshopEngine.createComponent({
    projectId: otherProject.id,
    name: 'Pieza Externa',
    estimatedMinutes: 30,
    notes: '',
  });
  const otherRes = await localWorkshopEngine.createReservation({
    projectId: otherProject.id,
    componentId: otherComp.id,
    variantId: variant.id,
    quantity: 40,
  });
  await localWorkshopEngine.consumeFromReservation({
    reservationId: otherRes.id,
    quantity: 40,
  });

  // Reserva activa en la pieza objetivo -> debe bloquear eliminación
  const activeRes = await localWorkshopEngine.createReservation({
    projectId: project.id,
    componentId: component.id,
    variantId: variant.id,
    quantity: 50,
  });

  await assert.rejects(
    () => localWorkshopEngine.deleteComponent(component.id),
    /sesiones de tiempo o reservas de material asociadas/i,
  );
  assert.ok(await localWorkshopEngine.components.getById(component.id));

  // Agregar material pendiente y tarea planificada vinculados a la pieza objetivo
  const pendingMat = await localWorkshopEngine.createPendingMaterial({
    variantId: variant.id,
    projectId: project.id,
    componentId: component.id,
    quantityNeeded: 25,
    provider: 'Proveedor local',
    notes: 'Hilo adicional',
  });
  const plannedTask = await localWorkshopEngine.createPlannedTask({
    projectId: project.id,
    componentId: component.id,
    title: 'Tejer pieza objetivo',
    scheduledDate: '2026-06-01T12:00:00.000Z',
    allocatedMinutes: 40,
  });

  // Ahora liberamos la reserva activa -> debe permitirse eliminar la pieza
  await localWorkshopEngine.releaseReservation(activeRes.id);
  await localWorkshopEngine.deleteComponent(component.id);

  assert.equal(await localWorkshopEngine.components.getById(component.id), null);

  // Verificar desvinculación limpia de todas las relaciones opcionales de esa pieza
  const updatedRes = await localWorkshopEngine.reservations.getById(activeRes.id);
  const updatedPending = await localWorkshopEngine.pendingMaterials.getById(pendingMat.id);
  const updatedTask = await localWorkshopEngine.plannedTasks.getById(plannedTask.id);
  assert.equal(updatedRes?.componentId, null);
  assert.equal(updatedPending?.componentId, null);
  assert.equal(updatedTask?.componentId, null);

  // Verificar reindexación de hermana
  const updatedSibling = await localWorkshopEngine.components.getById(siblingComp.id);
  assert.equal(updatedSibling?.orderIndex, 1);

  // Verificar que el otro proyecto y su reserva fulfilled NO fueron alterados
  const untouchedOtherRes = await localWorkshopEngine.reservations.getById(otherRes.id);
  assert.equal(untouchedOtherRes?.componentId, otherComp.id);
  assert.equal(untouchedOtherRes?.status, 'fulfilled');

  // Verificar integridad global y validez de respaldo
  const integrityErrors = validateCrossRecordIntegrity(
    await readAllStoresForIntegrityCheck(),
  );
  assert.deepEqual(integrityErrors, []);

  const backup = await exportWorkshopBackup({ includeDemo: false });
  const inspection = await inspectBackupFile(JSON.stringify(backup));
  assert.equal(inspection.isValid, true);
  assert.deepEqual(inspection.errors, []);
});

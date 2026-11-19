import type {
  Client,
  ISODate,
  Material,
  MaterialVariant,
  PaymentInstallment,
  PaymentPlan,
  PendingMaterial,
  Project,
  ProjectComponent,
  Reminder,
  ReminderRelatedEntityType,
  ReminderType,
  ScheduledTask,
  TaskStatus,
  WorkSession,
  WorkshopSettings,
} from '@/src/domain/models/index.ts';
import { formatCOP, formatDateCO, formatDurationMinutes } from './formatters.ts';
import {
  calculateSessionDurations,
  formatClockHHMMSS,
} from './timerEngine.ts';

export interface CreateScheduledTaskInput {
  readonly projectId: string;
  readonly componentId: string | null;
  readonly title: string;
  readonly scheduledDate: ISODate;
  readonly allocatedMinutes: number;
  readonly dependsOnPendingMaterialId?: string | null;
  readonly notes?: string;
}

export interface UpdateScheduledTaskInput {
  readonly projectId?: string;
  readonly componentId?: string | null;
  readonly title?: string;
  readonly scheduledDate?: ISODate;
  readonly allocatedMinutes?: number;
  readonly completedMinutes?: number;
  readonly dependsOnPendingMaterialId?: string | null;
  readonly status?: TaskStatus;
  readonly notes?: string;
}

export interface CreateReminderInput {
  readonly type: ReminderType;
  readonly title: string;
  readonly message: string;
  readonly triggerAt: ISODate;
  readonly relatedEntityId?: string | null;
  readonly relatedEntityType?: ReminderRelatedEntityType | null;
  readonly leadDays?: number;
  readonly isDemo?: boolean;
}

export interface UpdateReminderInput {
  readonly type?: ReminderType;
  readonly title?: string;
  readonly message?: string;
  readonly triggerAt?: ISODate;
  readonly leadDays?: number;
  readonly snoozedUntil?: ISODate | null;
  readonly isRead?: boolean;
  readonly isCompleted?: boolean;
}

export interface BlockingMaterialInfo {
  readonly pendingMaterial: PendingMaterial;
  readonly materialLabel: string;
  readonly colorName: string;
  readonly remainingQuantity: number;
  readonly unit: string;
}

export interface TaskBlockEvaluation {
  readonly isBlocked: boolean;
  readonly reasons: string[];
  readonly blockingPendings: BlockingMaterialInfo[];
  readonly componentIsBlocked: boolean;
}

export interface DayCapacitySummary {
  readonly dateKey: string;
  readonly dailyGoalMinutes: number;
  readonly plannedMinutes: number;
  readonly completedTaskMinutes: number;
  readonly workedMinutes: number;
  readonly totalTasksCount: number;
  readonly pendingTasksCount: number;
  readonly blockedTasksCount: number;
  readonly completedTasksCount: number;
  readonly remainingGoalMinutes: number;
  readonly overloadMinutes: number;
  readonly utilizationPercent: number;
}

export interface SmartAlertItem {
  readonly id: string;
  readonly source: 'persisted' | 'auto_rule';
  readonly reminderId: string | null;
  readonly type: ReminderType;
  readonly title: string;
  readonly message: string;
  readonly dueDate: ISODate;
  readonly triggerAt: ISODate;
  readonly relatedEntityId: string | null;
  readonly relatedEntityType: ReminderRelatedEntityType | null;
  readonly urgency: 'overdue' | 'due_soon' | 'upcoming';
  readonly isRead: boolean;
  readonly isCompleted: boolean;
  readonly isDemo: boolean;
}

const OPEN_PENDING_STATUSES = new Set([
  'pending_order',
  'ordered',
  'partially_received',
]);

export const TASK_STATUS_META: Record<
  TaskStatus,
  { readonly label: string; readonly tone: 'active' | 'warning' | 'success' | 'neutral' }
> = {
  scheduled: { label: 'Programada', tone: 'active' },
  blocked_by_material: { label: 'Bloqueada por insumo', tone: 'warning' },
  completed: { label: 'Completada', tone: 'success' },
  rescheduled: { label: 'Reprogramada', tone: 'neutral' },
};

export const REMINDER_TYPE_META: Record<
  ReminderType,
  { readonly label: string; readonly tone: 'active' | 'warning' | 'success' | 'neutral' }
> = {
  delivery_deadline: { label: 'Entrega', tone: 'warning' },
  installment_due: { label: 'Cuota / cobro', tone: 'active' },
  client_followup: { label: 'Seguimiento cliente', tone: 'active' },
  pending_purchase: { label: 'Compra pendiente', tone: 'warning' },
  material_arrival: { label: 'Llegada de insumo', tone: 'active' },
  low_stock: { label: 'Stock bajo', tone: 'warning' },
  material_shortage: { label: 'Insumo insuficiente', tone: 'warning' },
  component_goal: { label: 'Meta de pieza', tone: 'neutral' },
  work_session: { label: 'Sesión de tejido', tone: 'active' },
  timer_reminder: { label: 'Cronómetro', tone: 'warning' },
  social_recording: { label: 'Contenido / redes', tone: 'neutral' },
};

export function toLocalDateKey(input: string | Date): string {
  if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.trim())) {
    return input.trim();
  }
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function dateKeyToMiddayIso(dateKey: string): ISODate {
  const clean = dateKey.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    const [year, month, day] = clean.split('-').map((n) => Number.parseInt(n, 10));
    const localMidday = new Date(year, month - 1, day, 12, 0, 0, 0);
    return localMidday.toISOString();
  }
  const parsed = new Date(clean);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }
  return parsed.toISOString();
}

export function addDaysToDateKey(dateKey: string, deltaDays: number): string {
  const [y, m, d] = dateKey.split('-').map((n) => Number.parseInt(n, 10));
  if (!y || !m || !d) return toLocalDateKey(new Date());
  const date = new Date(y, m - 1, d, 12, 0, 0, 0);
  date.setDate(date.getDate() + deltaDays);
  return toLocalDateKey(date);
}

export function getWeekDateKeys(anchorDateKey: string): string[] {
  const [y, m, d] = anchorDateKey.split('-').map((n) => Number.parseInt(n, 10));
  const anchor = y && m && d ? new Date(y, m - 1, d, 12, 0, 0, 0) : new Date();
  const dayOfWeek = anchor.getDay(); // 0=Dom .. 6=Sab
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(anchor);
  monday.setDate(anchor.getDate() + mondayOffset);
  const result: string[] = [];
  for (let i = 0; i < 7; i += 1) {
    const current = new Date(monday);
    current.setDate(monday.getDate() + i);
    result.push(toLocalDateKey(current));
  }
  return result;
}

export function isOpenPendingMaterial(pending: PendingMaterial): boolean {
  return (
    OPEN_PENDING_STATUSES.has(pending.status) &&
    pending.quantityNeeded > pending.quantityReceived
  );
}

export function evaluateTaskMaterialBlock(params: {
  readonly projectId: string;
  readonly componentId: string | null;
  readonly dependsOnPendingMaterialId: string | null;
  readonly components: ProjectComponent[];
  readonly pendingMaterials: PendingMaterial[];
  readonly materials: Material[];
  readonly variants: MaterialVariant[];
}): TaskBlockEvaluation {
  const {
    projectId,
    componentId,
    dependsOnPendingMaterialId,
    components,
    pendingMaterials,
    materials,
    variants,
  } = params;

  const variantMap = new Map(variants.map((v) => [v.id, v]));
  const materialMap = new Map(materials.map((m) => [m.id, m]));
  const component = componentId
    ? components.find((c) => c.id === componentId) ?? null
    : null;

  const matchedPendingMap = new Map<string, PendingMaterial>();

  if (dependsOnPendingMaterialId) {
    const explicit = pendingMaterials.find((p) => p.id === dependsOnPendingMaterialId);
    if (explicit && isOpenPendingMaterial(explicit)) {
      matchedPendingMap.set(explicit.id, explicit);
    }
  }

  for (const pm of pendingMaterials) {
    if (!isOpenPendingMaterial(pm)) continue;
    if (componentId && pm.componentId === componentId) {
      matchedPendingMap.set(pm.id, pm);
      continue;
    }
    if (
      component &&
      pm.projectId === projectId &&
      component.requiredVariantIds.includes(pm.variantId)
    ) {
      const variant = variantMap.get(pm.variantId);
      const available = variant
        ? Math.max(0, variant.physicalStock - variant.reservedStock)
        : 0;
      if (available <= 0 || pm.componentId === null || pm.componentId === component.id) {
        matchedPendingMap.set(pm.id, pm);
      }
    }
  }

  const blockingPendings: BlockingMaterialInfo[] = Array.from(
    matchedPendingMap.values(),
  ).map((pm) => {
    const variant = variantMap.get(pm.variantId);
    const material = variant ? materialMap.get(variant.materialId) : undefined;
    return {
      pendingMaterial: pm,
      materialLabel: material?.name ?? 'Material pendiente',
      colorName: variant?.colorName ?? 'Color por definir',
      remainingQuantity: Math.max(
        0,
        Math.round((pm.quantityNeeded - pm.quantityReceived) * 100) / 100,
      ),
      unit: material?.unit ?? 'u',
    };
  });

  const componentIsBlocked = component?.status === 'blocked_by_material';
  const reasons: string[] = [];

  if (componentIsBlocked && component) {
    reasons.push(`La pieza "${component.name}" está marcada como bloqueada por material.`);
  }
  for (const info of blockingPendings) {
    const arrivalNote = info.pendingMaterial.estimatedArrivalDate
      ? ` · llega ${formatDateCO(info.pendingMaterial.estimatedArrivalDate)}`
      : '';
    reasons.push(
      `Falta recibir ${info.materialLabel} (${info.colorName}): ${info.remainingQuantity} ${info.unit}${arrivalNote}.`,
    );
  }

  return {
    isBlocked: componentIsBlocked || blockingPendings.length > 0,
    reasons,
    blockingPendings,
    componentIsBlocked,
  };
}

export function resolveEffectiveTaskStatus(
  task: ScheduledTask,
  evaluation: TaskBlockEvaluation,
): TaskStatus {
  if (task.status === 'completed') return 'completed';
  if (evaluation.isBlocked) return 'blocked_by_material';
  if (task.status === 'blocked_by_material') return 'scheduled';
  return task.status;
}

export function computeDayCapacity(params: {
  readonly dateKey: string;
  readonly dailyGoalMinutes: number;
  readonly tasks: Array<{ readonly task: ScheduledTask; readonly effectiveStatus: TaskStatus }>;
  readonly workSessions: WorkSession[];
}): DayCapacitySummary {
  const { dateKey, dailyGoalMinutes, tasks, workSessions } = params;
  const safeGoal = Math.max(15, Math.round(dailyGoalMinutes));
  const dayTasks = tasks.filter(
    (entry) => toLocalDateKey(entry.task.scheduledDate) === dateKey,
  );

  const plannedMinutes = dayTasks
    .filter((entry) => entry.effectiveStatus !== 'rescheduled')
    .reduce((sum, entry) => sum + Math.max(0, entry.task.allocatedMinutes), 0);

  const completedTaskMinutes = dayTasks
    .filter((entry) => entry.effectiveStatus === 'completed')
    .reduce(
      (sum, entry) =>
        sum +
        Math.max(
          0,
          entry.task.completedMinutes > 0
            ? entry.task.completedMinutes
            : entry.task.allocatedMinutes,
        ),
      0,
    );

  const dayWorkedSeconds = workSessions
    .filter(
      (s) =>
        s.status === 'completed' &&
        toLocalDateKey(s.endTime ?? s.startTime) === dateKey,
    )
    .reduce((sum, s) => sum + Math.max(0, s.effectiveSeconds), 0);
  const workedMinutes = Math.round(dayWorkedSeconds / 60);

  const remainingGoalMinutes = Math.max(0, safeGoal - plannedMinutes);
  const overloadMinutes = Math.max(0, plannedMinutes - safeGoal);
  const utilizationPercent = Math.min(
    999,
    Math.round((plannedMinutes / safeGoal) * 100),
  );

  return {
    dateKey,
    dailyGoalMinutes: safeGoal,
    plannedMinutes,
    completedTaskMinutes,
    workedMinutes,
    totalTasksCount: dayTasks.length,
    pendingTasksCount: dayTasks.filter((e) => e.effectiveStatus === 'scheduled').length,
    blockedTasksCount: dayTasks.filter(
      (e) => e.effectiveStatus === 'blocked_by_material',
    ).length,
    completedTasksCount: dayTasks.filter((e) => e.effectiveStatus === 'completed')
      .length,
    remainingGoalMinutes,
    overloadMinutes,
    utilizationPercent,
  };
}

export function resolveSmartRemindersAndAlerts(params: {
  readonly settings: WorkshopSettings;
  readonly reminders: Reminder[];
  readonly projects: Project[];
  readonly components?: ProjectComponent[];
  readonly workSessions?: WorkSession[];
  readonly pendingMaterials: PendingMaterial[];
  readonly materials: Material[];
  readonly variants: MaterialVariant[];
  readonly paymentPlans: PaymentPlan[];
  readonly installments: PaymentInstallment[];
  readonly clients: Client[];
  readonly nowDate?: Date;
}): SmartAlertItem[] {
  const {
    settings,
    reminders,
    projects,
    components = [],
    workSessions = [],
    pendingMaterials,
    materials,
    variants,
    paymentPlans,
    installments,
    clients,
    nowDate = new Date(),
  } = params;

  const todayKey = toLocalDateKey(nowDate);
  const leadDelivery = Math.max(0, settings.reminderLeadDaysDelivery ?? 3);
  const leadInstallment = Math.max(0, settings.reminderLeadDaysInstallment ?? 2);
  const leadPurchase = Math.max(0, settings.reminderLeadDaysPurchase ?? 1);
  const forgottenTimerMins = Math.max(
    15,
    settings.forgottenTimerThresholdMinutes ?? 180,
  );

  const enableDelivery = settings.enableDeliveryReminders !== false;
  const enableInstallment = settings.enableInstallmentReminders !== false;
  const enablePurchase = settings.enablePurchaseReminders !== false;
  const enableLowStock = settings.enableLowStockReminders !== false;
  const enableClient = settings.enableClientReminders !== false;
  const enableTimerAlerts = settings.enableTimerNotifications !== false;

  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const componentMap = new Map(components.map((c) => [c.id, c]));
  const clientMap = new Map(clients.map((c) => [c.id, c]));
  const planMap = new Map(paymentPlans.map((pl) => [pl.id, pl]));
  const materialMap = new Map(materials.map((m) => [m.id, m]));
  const variantMap = new Map(variants.map((v) => [v.id, v]));

  const computeUrgency = (targetDateKey: string): 'overdue' | 'due_soon' | 'upcoming' => {
    if (!targetDateKey || targetDateKey < todayKey) return 'overdue';
    const soonLimit = addDaysToDateKey(todayKey, 2);
    if (targetDateKey <= soonLimit) return 'due_soon';
    return 'upcoming';
  };

  // Indexar recordatorios persistidos por clave semántica para evitar duplicar alertas automáticas
  const persistedByKey = new Set<string>();
  const items: SmartAlertItem[] = [];

  for (const rem of reminders) {
    if (rem.relatedEntityId) {
      persistedByKey.add(`${rem.type}:${rem.relatedEntityId}`);
    }
    const effectiveTrigger = rem.snoozedUntil ?? rem.triggerAt;
    const triggerKey = toLocalDateKey(effectiveTrigger);
    items.push({
      id: rem.id,
      source: 'persisted',
      reminderId: rem.id,
      type: rem.type,
      title: rem.title,
      message: rem.message,
      dueDate: rem.triggerAt,
      triggerAt: effectiveTrigger,
      relatedEntityId: rem.relatedEntityId,
      relatedEntityType: rem.relatedEntityType ?? null,
      urgency: computeUrgency(triggerKey),
      isRead: rem.isRead,
      isCompleted: rem.isCompleted,
      isDemo: rem.isDemo,
    });
  }

  // 1. Alertas automáticas de entregas próximas / vencidas
  if (enableDelivery) {
    const doneOrCancelled = new Set(['completed', 'delivered', 'cancelled']);
    for (const proj of projects) {
      if (!proj.estimatedEndDate || doneOrCancelled.has(proj.status)) continue;
      if (persistedByKey.has(`delivery_deadline:${proj.id}`)) continue;

      const dueKey = toLocalDateKey(proj.estimatedEndDate);
      const triggerKey = addDaysToDateKey(dueKey, -leadDelivery);
      if (todayKey >= triggerKey || dueKey <= addDaysToDateKey(todayKey, 14)) {
        items.push({
          id: `auto_delivery_${proj.id}`,
          source: 'auto_rule',
          reminderId: null,
          type: 'delivery_deadline',
          title: `Entrega: ${proj.name}`,
          message: `Fecha estimada de entrega el ${formatDateCO(proj.estimatedEndDate)} (aviso ${leadDelivery} d antes).`,
          dueDate: proj.estimatedEndDate,
          triggerAt: dateKeyToMiddayIso(triggerKey),
          relatedEntityId: proj.id,
          relatedEntityType: 'project',
          urgency: computeUrgency(dueKey),
          isRead: false,
          isCompleted: false,
          isDemo: proj.isDemo,
        });
      }
    }
  }

  // 2. Alertas automáticas de cuotas pendientes o vencidas
  if (enableInstallment) {
    for (const inst of installments) {
      if (inst.status === 'paid') continue;
      if (persistedByKey.has(`installment_due:${inst.id}`)) continue;

      const plan = planMap.get(inst.planId);
      const project = plan ? projectMap.get(plan.projectId) : undefined;
      const client = plan ? clientMap.get(plan.clientId) : undefined;
      const pendingCOP = Math.max(0, inst.scheduledAmountCOP - inst.paidAmountCOP);
      const dueKey = toLocalDateKey(inst.dueDate);
      const triggerKey = addDaysToDateKey(dueKey, -leadInstallment);

      if (todayKey >= triggerKey || dueKey <= addDaysToDateKey(todayKey, 15)) {
        items.push({
          id: `auto_installment_${inst.id}`,
          source: 'auto_rule',
          reminderId: null,
          type: 'installment_due',
          title: `${inst.concept} · ${client?.name ?? 'Cliente'}`,
          message: `Cobro de ${formatCOP(pendingCOP)} (${project?.name ?? 'Encargo'}) vence el ${formatDateCO(inst.dueDate)}.`,
          dueDate: inst.dueDate,
          triggerAt: dateKeyToMiddayIso(triggerKey),
          relatedEntityId: inst.id,
          relatedEntityType: 'installment',
          urgency: computeUrgency(dueKey),
          isRead: false,
          isCompleted: false,
          isDemo: inst.isDemo,
        });
      }
    }
  }

  // 3. Alertas automáticas de compras pendientes y llegadas de materiales
  if (enablePurchase) {
    for (const pm of pendingMaterials) {
      if (!isOpenPendingMaterial(pm)) continue;
      const reminderType: ReminderType =
        pm.status === 'pending_order' ? 'pending_purchase' : 'material_arrival';
      if (persistedByKey.has(`${reminderType}:${pm.id}`)) continue;

      const variant = variantMap.get(pm.variantId);
      const material = variant ? materialMap.get(variant.materialId) : undefined;
      const project = projectMap.get(pm.projectId);
      const remainingQty = Math.max(0, pm.quantityNeeded - pm.quantityReceived);

      const targetIso = pm.estimatedArrivalDate ?? pm.createdAt;
      const targetKey = toLocalDateKey(targetIso);
      const triggerKey = addDaysToDateKey(targetKey, -leadPurchase);

      items.push({
        id: `auto_purchase_${pm.id}`,
        source: 'auto_rule',
        reminderId: null,
        type: reminderType,
        title:
          pm.status === 'pending_order'
            ? `Comprar: ${material?.name ?? 'Insumo'} (${variant?.colorName ?? 'Color'})`
            : `Recepción esperada: ${material?.name ?? 'Insumo'} (${variant?.colorName ?? 'Color'})`,
        message: `${remainingQty} ${material?.unit ?? 'u'} para ${project?.name ?? 'proyecto'} · ${pm.provider || 'Sin proveedor'}${
          pm.estimatedArrivalDate
            ? ` · llegada ${formatDateCO(pm.estimatedArrivalDate)}`
            : ''
        }.`,
        dueDate: targetIso,
        triggerAt: dateKeyToMiddayIso(triggerKey),
        relatedEntityId: pm.id,
        relatedEntityType: 'pending_material',
        urgency: pm.estimatedArrivalDate ? computeUrgency(targetKey) : 'due_soon',
        isRead: false,
        isCompleted: false,
        isDemo: pm.isDemo,
      });
    }
  }

  // 4. Alertas automáticas de stock bajo por color
  if (enableLowStock) {
    for (const variant of variants) {
      if (variant.minStockAlertEnabled === false) continue;
      const available = Math.max(0, variant.physicalStock - variant.reservedStock);
      if (available > variant.minStock) continue;
      if (persistedByKey.has(`low_stock:${variant.id}`)) continue;

      const material = materialMap.get(variant.materialId);
      items.push({
        id: `auto_lowstock_${variant.id}`,
        source: 'auto_rule',
        reminderId: null,
        type: 'low_stock',
        title: `Stock bajo: ${material?.name ?? 'Material'} · ${variant.colorName}`,
        message: `Disponible ${available} ${material?.unit ?? 'u'} (mínimo configurado: ${variant.minStock} ${material?.unit ?? 'u'}).`,
        dueDate: nowDate.toISOString(),
        triggerAt: nowDate.toISOString(),
        relatedEntityId: variant.id,
        relatedEntityType: 'variant',
        urgency: available === 0 ? 'overdue' : 'due_soon',
        isRead: false,
        isCompleted: false,
        isDemo: variant.isDemo,
      });
    }
  }

  // 5. Alertas de materiales insuficientes para piezas de proyectos activos
  if (enablePurchase || enableLowStock) {
    const doneOrCancelled = new Set(['completed', 'delivered', 'cancelled']);
    const pendingByComponent = new Set(
      pendingMaterials
        .filter((pm) => isOpenPendingMaterial(pm) && pm.componentId)
        .map((pm) => pm.componentId as string),
    );
    for (const comp of components) {
      if (comp.status !== 'blocked_by_material') continue;
      if (pendingByComponent.has(comp.id)) continue;
      if (persistedByKey.has(`material_shortage:${comp.id}`)) continue;
      const proj = projectMap.get(comp.projectId);
      if (!proj || doneOrCancelled.has(proj.status)) continue;

      items.push({
        id: `auto_shortage_${comp.id}`,
        source: 'auto_rule',
        reminderId: null,
        type: 'material_shortage',
        title: `Insumo faltante: ${proj.name} · ${comp.name}`,
        message: 'Esta pieza está bloqueada por falta de material y aún no tiene una compra pendiente registrada.',
        dueDate: nowDate.toISOString(),
        triggerAt: nowDate.toISOString(),
        relatedEntityId: proj.id,
        relatedEntityType: 'project',
        urgency: 'due_soon',
        isRead: false,
        isCompleted: false,
        isDemo: comp.isDemo,
      });
    }
  }

  // 6. Seguimiento de clientes en encargos activos o pausados sin movimiento reciente (>10 días)
  if (enableClient) {
    const activeClientStatuses = new Set(['planning', 'in_progress', 'paused']);
    const staleThresholdMs = 10 * 24 * 60 * 60 * 1000;
    for (const proj of projects) {
      if (!proj.clientId || !activeClientStatuses.has(proj.status)) continue;
      if (persistedByKey.has(`client_followup:${proj.id}`)) continue;
      const client = clientMap.get(proj.clientId);
      if (!client) continue;
      const updatedMs = Date.parse(proj.updatedAt);
      if (Number.isNaN(updatedMs)) continue;
      if (nowDate.getTime() - updatedMs < staleThresholdMs) continue;

      items.push({
        id: `auto_client_followup_${proj.id}`,
        source: 'auto_rule',
        reminderId: null,
        type: 'client_followup',
        title: `Seguimiento: ${client.name} (${proj.name})`,
        message: `El encargo lleva más de 10 días sin novedades (${proj.status === 'paused' ? 'en pausa' : 'en curso'}).`,
        dueDate: nowDate.toISOString(),
        triggerAt: nowDate.toISOString(),
        relatedEntityId: proj.id,
        relatedEntityType: 'project',
        urgency: proj.status === 'paused' ? 'due_soon' : 'upcoming',
        isRead: false,
        isCompleted: false,
        isDemo: proj.isDemo,
      });
    }
  }

  // 7. Alertas de cronómetro olvidado o sesión abierta prolongada
  if (enableTimerAlerts) {
    const nowMs = nowDate.getTime();
    for (const sess of workSessions) {
      if (sess.status !== 'running' && sess.status !== 'paused') continue;
      if (persistedByKey.has(`timer_reminder:${sess.id}`)) continue;
      const proj = projectMap.get(sess.projectId);
      const comp = componentMap.get(sess.componentId);
      const breakdown = calculateSessionDurations(sess, nowMs);

      if (sess.status === 'running' && breakdown.effectiveSeconds >= forgottenTimerMins * 60) {
        items.push({
          id: `auto_timer_forgotten_${sess.id}`,
          source: 'auto_rule',
          reminderId: null,
          type: 'timer_reminder',
          title: `Cronómetro activo: ${proj?.name ?? 'Proyecto'} · ${comp?.name ?? 'Pieza'}`,
          message: `Lleva ${formatClockHHMMSS(breakdown.effectiveSeconds)} (${formatDurationMinutes(breakdown.effectiveMinutes)}) en marcha. Verifica si sigues tejiendo o si deseas pausarlo.`,
          dueDate: nowDate.toISOString(),
          triggerAt: nowDate.toISOString(),
          relatedEntityId: sess.id,
          relatedEntityType: 'work_session',
          urgency: 'overdue',
          isRead: false,
          isCompleted: false,
          isDemo: sess.isDemo,
        });
      } else if (sess.status === 'paused') {
        const updatedMs = Date.parse(sess.updatedAt);
        const hoursPaused = Number.isNaN(updatedMs) ? 0 : (nowMs - updatedMs) / (1000 * 60 * 60);
        if (hoursPaused >= 12) {
          items.push({
            id: `auto_timer_paused_${sess.id}`,
            source: 'auto_rule',
            reminderId: null,
            type: 'timer_reminder',
            title: `Sesión en pausa pendiente: ${proj?.name ?? 'Proyecto'}`,
            message: `${comp?.name ?? 'Pieza'} acumula ${formatClockHHMMSS(breakdown.effectiveSeconds)} sin finalizar desde hace más de 12 horas.`,
            dueDate: nowDate.toISOString(),
            triggerAt: nowDate.toISOString(),
            relatedEntityId: sess.id,
            relatedEntityType: 'work_session',
            urgency: 'due_soon',
            isRead: false,
            isCompleted: false,
            isDemo: sess.isDemo,
          });
        }
      }
    }
  }

  return items.sort((a, b) => {
    if (a.isCompleted !== b.isCompleted) return a.isCompleted ? 1 : -1;
    const urgencyRank = { overdue: 0, due_soon: 1, upcoming: 2 };
    if (urgencyRank[a.urgency] !== urgencyRank[b.urgency]) {
      return urgencyRank[a.urgency] - urgencyRank[b.urgency];
    }
    return a.dueDate.localeCompare(b.dueDate);
  });
}

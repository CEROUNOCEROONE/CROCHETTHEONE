import type {
  ComponentStatus,
  ISODate,
  MoneyCOP,
  Project,
  ProjectComponent,
  ProjectPaymentSummaryStatus,
  ProjectStatus,
} from '@/src/domain/models/index.ts';

export interface CreateProjectInput {
  readonly name: string;
  readonly description: string;
  readonly clientId: string | null;
  readonly startDate: ISODate | null;
  readonly estimatedEndDate: ISODate | null;
  readonly targetTotalMinutes: number;
  readonly dailyGoalMinutes: number;
  readonly weeklyGoalMinutes: number;
  readonly estimatedBudgetCOP: MoneyCOP;
  readonly status: ProjectStatus;
  readonly paymentStatus: ProjectPaymentSummaryStatus;
  readonly notes: string;
  readonly initialComponents?: Array<{
    readonly name: string;
    readonly estimatedMinutes: number;
    readonly notes?: string;
  }>;
}

export interface UpdateProjectInput {
  readonly name?: string;
  readonly description?: string;
  readonly clientId?: string | null;
  readonly startDate?: ISODate | null;
  readonly estimatedEndDate?: ISODate | null;
  readonly targetTotalMinutes?: number;
  readonly dailyGoalMinutes?: number;
  readonly weeklyGoalMinutes?: number;
  readonly estimatedBudgetCOP?: MoneyCOP;
  readonly status?: ProjectStatus;
  readonly paymentStatus?: ProjectPaymentSummaryStatus;
  readonly notes?: string;
}

export interface CreateComponentInput {
  readonly projectId: string;
  readonly name: string;
  readonly estimatedMinutes: number;
  readonly effectiveMinutesSpent?: number;
  readonly status?: ComponentStatus;
  readonly notes?: string;
}

export interface UpdateComponentInput {
  readonly name?: string;
  readonly estimatedMinutes?: number;
  readonly effectiveMinutesSpent?: number;
  readonly status?: ComponentStatus;
  readonly orderIndex?: number;
  readonly notes?: string;
}

export const PROJECT_STATUS_OPTIONS: Array<{
  readonly value: ProjectStatus;
  readonly label: string;
  readonly tone: 'neutral' | 'active' | 'warning' | 'success' | 'danger';
}> = [
  { value: 'pending', label: 'Pendiente', tone: 'warning' },
  { value: 'planning', label: 'Planificando', tone: 'neutral' },
  { value: 'in_progress', label: 'En progreso', tone: 'active' },
  { value: 'paused', label: 'Pausado', tone: 'warning' },
  { value: 'completed', label: 'Finalizado', tone: 'success' },
  { value: 'delivered', label: 'Entregado', tone: 'success' },
  { value: 'cancelled', label: 'Cancelado', tone: 'danger' },
];

export const COMPONENT_STATUS_OPTIONS: Array<{
  readonly value: ComponentStatus;
  readonly label: string;
  readonly tone: 'neutral' | 'active' | 'warning' | 'success';
}> = [
  { value: 'pending', label: 'Pendiente', tone: 'neutral' },
  { value: 'in_progress', label: 'En tejido', tone: 'active' },
  { value: 'blocked_by_material', label: 'Falta material', tone: 'warning' },
  { value: 'completed', label: 'Terminada', tone: 'success' },
];

export const PAYMENT_SUMMARY_OPTIONS: Array<{
  readonly value: ProjectPaymentSummaryStatus;
  readonly label: string;
}> = [
  { value: 'not_applicable', label: 'Proyecto propio (Sin cobro)' },
  { value: 'unpaid', label: 'Sin pago inicial' },
  { value: 'deposit_received', label: 'Anticipo recibido' },
  { value: 'partial', label: 'Pago parcial / en cuotas' },
  { value: 'pending', label: 'Saldo pendiente contra entrega' },
  { value: 'paid', label: 'Pagado totalmente' },
  { value: 'overdue', label: 'En mora' },
];

function createUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `proj_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function buildNewProjectEntity(
  input: CreateProjectInput,
  nowIso = new Date().toISOString(),
): Project {
  const trimmedName = input.name.trim();
  if (!trimmedName) {
    throw new Error('El nombre del proyecto es obligatorio.');
  }

  return {
    id: createUuid(),
    ownerId: 'local-workshop',
    syncStatus: 'local_only',
    version: 1,
    isDemo: false,
    createdAt: nowIso,
    updatedAt: nowIso,
    name: trimmedName,
    description: input.description.trim(),
    referencePhotoUrl: null,
    clientId: input.clientId || null,
    patternId: null,
    startDate: input.startDate || null,
    estimatedEndDate: input.estimatedEndDate || null,
    targetTotalMinutes: Math.max(0, Math.round(input.targetTotalMinutes || 0)),
    dailyGoalMinutes: Math.max(0, Math.round(input.dailyGoalMinutes || 0)),
    weeklyGoalMinutes: Math.max(0, Math.round(input.weeklyGoalMinutes || 0)),
    estimatedBudgetCOP: Math.max(0, Math.round(input.estimatedBudgetCOP || 0)),
    status: input.status,
    paymentStatus: input.paymentStatus,
    notes: input.notes.trim(),
  };
}

export function applyProjectUpdates(
  existing: Project,
  updates: UpdateProjectInput,
  nowIso = new Date().toISOString(),
): Project {
  const nextName =
    updates.name !== undefined ? updates.name.trim() : existing.name;
  if (!nextName) {
    throw new Error('El nombre del proyecto no puede quedar vacío.');
  }

  return {
    ...existing,
    name: nextName,
    description:
      updates.description !== undefined
        ? updates.description.trim()
        : existing.description,
    clientId:
      updates.clientId !== undefined ? updates.clientId || null : existing.clientId,
    startDate:
      updates.startDate !== undefined ? updates.startDate || null : existing.startDate,
    estimatedEndDate:
      updates.estimatedEndDate !== undefined
        ? updates.estimatedEndDate || null
        : existing.estimatedEndDate,
    targetTotalMinutes:
      updates.targetTotalMinutes !== undefined
        ? Math.max(0, Math.round(updates.targetTotalMinutes))
        : existing.targetTotalMinutes,
    dailyGoalMinutes:
      updates.dailyGoalMinutes !== undefined
        ? Math.max(0, Math.round(updates.dailyGoalMinutes))
        : existing.dailyGoalMinutes,
    weeklyGoalMinutes:
      updates.weeklyGoalMinutes !== undefined
        ? Math.max(0, Math.round(updates.weeklyGoalMinutes))
        : existing.weeklyGoalMinutes,
    estimatedBudgetCOP:
      updates.estimatedBudgetCOP !== undefined
        ? Math.max(0, Math.round(updates.estimatedBudgetCOP))
        : existing.estimatedBudgetCOP,
    status: updates.status ?? existing.status,
    paymentStatus: updates.paymentStatus ?? existing.paymentStatus,
    notes:
      updates.notes !== undefined ? updates.notes.trim() : existing.notes,
    version: existing.version + 1,
    updatedAt: nowIso,
  };
}

export function buildNewComponentEntity(
  input: CreateComponentInput,
  orderIndex: number,
  isDemoProject = false,
  nowIso = new Date().toISOString(),
): ProjectComponent {
  const trimmedName = input.name.trim();
  if (!trimmedName) {
    throw new Error('El nombre del componente o pieza es obligatorio.');
  }
  if (!input.projectId) {
    throw new Error('El componente debe pertenecer a un proyecto válido.');
  }

  return {
    id: createUuid(),
    ownerId: 'local-workshop',
    syncStatus: 'local_only',
    version: 1,
    isDemo: isDemoProject,
    createdAt: nowIso,
    updatedAt: nowIso,
    projectId: input.projectId,
    name: trimmedName,
    orderIndex: Math.max(1, Math.round(orderIndex)),
    estimatedMinutes: Math.max(0, Math.round(input.estimatedMinutes || 0)),
    effectiveMinutesSpent: Math.max(
      0,
      Math.round(input.effectiveMinutesSpent || 0),
    ),
    status: input.status ?? 'pending',
    requiredVariantIds: [],
    notes: (input.notes ?? '').trim(),
  };
}

export function applyComponentUpdates(
  existing: ProjectComponent,
  updates: UpdateComponentInput,
  nowIso = new Date().toISOString(),
): ProjectComponent {
  const nextName =
    updates.name !== undefined ? updates.name.trim() : existing.name;
  if (!nextName) {
    throw new Error('El nombre del componente no puede estar vacío.');
  }

  return {
    ...existing,
    name: nextName,
    estimatedMinutes:
      updates.estimatedMinutes !== undefined
        ? Math.max(0, Math.round(updates.estimatedMinutes))
        : existing.estimatedMinutes,
    effectiveMinutesSpent:
      updates.effectiveMinutesSpent !== undefined
        ? Math.max(0, Math.round(updates.effectiveMinutesSpent))
        : existing.effectiveMinutesSpent,
    status: updates.status ?? existing.status,
    orderIndex:
      updates.orderIndex !== undefined
        ? Math.max(1, Math.round(updates.orderIndex))
        : existing.orderIndex,
    notes:
      updates.notes !== undefined ? updates.notes.trim() : existing.notes,
    version: existing.version + 1,
    updatedAt: nowIso,
  };
}

export interface ProjectProgressMetrics {
  readonly totalComponents: number;
  readonly completedComponents: number;
  readonly inProgressComponents: number;
  readonly blockedComponents: number;
  readonly completionPercent: number;
  readonly totalEstimatedMinutes: number;
  readonly totalEffectiveMinutes: number;
}

export function calculateProjectProgress(
  project: Project,
  components: ProjectComponent[],
): ProjectProgressMetrics {
  const sorted = components
    .filter((c) => c.projectId === project.id)
    .sort((a, b) => a.orderIndex - b.orderIndex);

  const totalComponents = sorted.length;
  const completedComponents = sorted.filter((c) => c.status === 'completed').length;
  const inProgressComponents = sorted.filter((c) => c.status === 'in_progress').length;
  const blockedComponents = sorted.filter(
    (c) => c.status === 'blocked_by_material',
  ).length;

  const completionPercent =
    totalComponents > 0
      ? Math.round((completedComponents / totalComponents) * 100)
      : project.status === 'completed' || project.status === 'delivered'
        ? 100
        : 0;

  const sumComponentEstimated = sorted.reduce(
    (acc, c) => acc + Math.max(0, c.estimatedMinutes),
    0,
  );
  const totalEstimatedMinutes =
    sumComponentEstimated > 0
      ? sumComponentEstimated
      : Math.max(0, project.targetTotalMinutes);

  const totalEffectiveMinutes = sorted.reduce(
    (acc, c) => acc + Math.max(0, c.effectiveMinutesSpent),
    0,
  );

  return {
    totalComponents,
    completedComponents,
    inProgressComponents,
    blockedComponents,
    completionPercent,
    totalEstimatedMinutes,
    totalEffectiveMinutes,
  };
}

import type {
  Client,
  InventoryMovement,
  InventoryReservation,
  Material,
  MaterialVariant,
  MoneyCOP,
  NoteOrList,
  PaymentInstallment,
  PaymentPlan,
  PendingMaterial,
  Project,
  ProjectComponent,
  PurchaseReceipt,
  Quote,
  Reminder,
  ScheduledTask,
  ShoppingListItem,
  WorkSession,
  WorkshopSettings,
} from '@/src/domain/models/index.ts';
import {
  evaluateTaskMaterialBlock,
  resolveEffectiveTaskStatus,
  resolveSmartRemindersAndAlerts,
  toLocalDateKey as toPlanningLocalDateKey,
} from './planningService.ts';

export interface VariantAvailabilitySummary {
  readonly variantId: string;
  readonly materialName: string;
  readonly colorName: string;
  readonly colorHex: string | null;
  readonly unit: string;
  readonly physicalStock: number;
  readonly reservedStock: number;
  readonly availableStock: number;
  readonly minStock: number;
  readonly isLowStock: boolean;
  readonly isDemo: boolean;
}

export interface ProjectSummaryCardData {
  readonly project: Project;
  readonly clientName: string | null;
  readonly totalComponents: number;
  readonly completedComponents: number;
  readonly effectiveMinutesSpent: number;
  readonly paymentPlan: PaymentPlan | null;
}

export interface WorkshopDashboardStats {
  readonly activeProjectsCount: number;
  readonly pendingProjectsCount: number;
  readonly completedProjectsCount: number;
  readonly totalProjectsCount: number;
  readonly todayEffectiveMinutes: number;
  readonly totalEffectiveMinutes: number;
  readonly nextDeliveryProject: Project | null;
  readonly featuredProject: ProjectSummaryCardData | null;
  readonly projectSummaries: ProjectSummaryCardData[];
  readonly lowStockVariants: VariantAvailabilitySummary[];
  readonly inventoryHighlights: VariantAvailabilitySummary[];
  readonly totalAgreedCOP: MoneyCOP;
  readonly totalPaidCOP: MoneyCOP;
  readonly totalPendingBalanceCOP: MoneyCOP;
  readonly upcomingInstallments: Array<{
    readonly installment: PaymentInstallment;
    readonly projectName: string;
    readonly clientName: string;
  }>;
  readonly recentMovementsCount: number;
  readonly pendingMaterialsCount: number;
  readonly inTransitPurchasesCount: number;
  readonly activeNotesCount: number;
  readonly quotesCount: number;
  readonly approvedQuotesCount: number;
  readonly todayPlannedMinutes: number;
  readonly pendingTasksCount: number;
  readonly blockedTasksCount: number;
  readonly activeRemindersCount: number;
  readonly hasDemoData: boolean;
  readonly hasRealData: boolean;
}

export interface WorkshopSnapshotInput {
  readonly settings: WorkshopSettings;
  readonly projects: Project[];
  readonly components: ProjectComponent[];
  readonly workSessions?: WorkSession[];
  readonly materials: Material[];
  readonly variants: MaterialVariant[];
  readonly reservations: InventoryReservation[];
  readonly pendingMaterials?: PendingMaterial[];
  readonly plannedTasks?: ScheduledTask[];
  readonly notesAndLists?: NoteOrList[];
  readonly shoppingItems?: ShoppingListItem[];
  readonly purchaseReceipts?: PurchaseReceipt[];
  readonly movements: InventoryMovement[];
  readonly clients: Client[];
  readonly quotes?: Quote[];
  readonly paymentPlans: PaymentPlan[];
  readonly installments: PaymentInstallment[];
  readonly reminders?: Reminder[];
}

export function computeWorkshopStats(snapshot: WorkshopSnapshotInput): WorkshopDashboardStats {
  const clientById = new Map(snapshot.clients.map((c) => [c.id, c]));
  const materialById = new Map(snapshot.materials.map((m) => [m.id, m]));
  const projectById = new Map(snapshot.projects.map((p) => [p.id, p]));
  const planByProjectId = new Map(snapshot.paymentPlans.map((p) => [p.projectId, p]));
  const planById = new Map(snapshot.paymentPlans.map((p) => [p.id, p]));

  const activeStatuses = new Set(['in_progress', 'planning']);
  const pendingStatuses = new Set(['pending', 'paused']);
  const completedStatuses = new Set(['completed', 'delivered']);

  const activeProjectsCount = snapshot.projects.filter((p) => activeStatuses.has(p.status)).length;
  const pendingProjectsCount = snapshot.projects.filter((p) => pendingStatuses.has(p.status)).length;
  const completedProjectsCount = snapshot.projects.filter((p) =>
    completedStatuses.has(p.status),
  ).length;

  const projectsWithDeadline = snapshot.projects
    .filter((p) => p.estimatedEndDate && !completedStatuses.has(p.status) && p.status !== 'cancelled')
    .sort((a, b) =>
      String(a.estimatedEndDate).localeCompare(String(b.estimatedEndDate)),
    );
  const nextDeliveryProject = projectsWithDeadline[0] ?? null;

  const projectSummaries: ProjectSummaryCardData[] = snapshot.projects
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((project) => {
      const comps = snapshot.components.filter((c) => c.projectId === project.id);
      const completedComponents = comps.filter((c) => c.status === 'completed').length;
      const effectiveMinutesSpent = comps.reduce(
        (sum, c) => sum + Math.max(0, c.effectiveMinutesSpent),
        0,
      );
      const client = project.clientId ? clientById.get(project.clientId) ?? null : null;
      const paymentPlan = planByProjectId.get(project.id) ?? null;

      return {
        project,
        clientName: client?.name ?? null,
        totalComponents: comps.length,
        completedComponents,
        effectiveMinutesSpent,
        paymentPlan,
      };
    });

  const featuredProject =
    projectSummaries.find((s) => s.project.status === 'in_progress') ??
    projectSummaries[0] ??
    null;

  const inventoryHighlights: VariantAvailabilitySummary[] = snapshot.variants.map((variant) => {
    const material = materialById.get(variant.materialId);
    const availableStock = Math.max(0, variant.physicalStock - variant.reservedStock);
    return {
      variantId: variant.id,
      materialName: material?.name ?? 'Material sin categoría',
      colorName: variant.colorName,
      colorHex: variant.colorHex,
      unit: material?.unit ?? 'unit',
      physicalStock: variant.physicalStock,
      reservedStock: variant.reservedStock,
      availableStock,
      minStock: variant.minStock,
      isLowStock: availableStock <= variant.minStock,
      isDemo: variant.isDemo,
    };
  });

  const lowStockVariants = inventoryHighlights.filter((v) => v.isLowStock);

  const totalAgreedCOP = snapshot.paymentPlans.reduce((sum, p) => sum + p.totalAgreedCOP, 0);
  const totalPaidCOP = snapshot.paymentPlans.reduce((sum, p) => sum + p.totalPaidCOP, 0);
  const totalPendingBalanceCOP = snapshot.paymentPlans.reduce(
    (sum, p) => sum + p.balancePendingCOP,
    0,
  );

  const upcomingInstallments = snapshot.installments
    .filter((inst) => inst.status !== 'paid')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 4)
    .map((installment) => {
      const plan = planById.get(installment.planId);
      const project = plan ? projectById.get(plan.projectId) : undefined;
      const client = plan ? clientById.get(plan.clientId) : undefined;
      return {
        installment,
        projectName: project?.name ?? 'Encargo sin proyecto',
        clientName: client?.name ?? 'Cliente',
      };
    });

  const hasDemoData =
    snapshot.settings.demoDataLoaded ||
    snapshot.projects.some((p) => p.isDemo) ||
    snapshot.variants.some((v) => v.isDemo);

  const hasRealData =
    snapshot.projects.some((p) => !p.isDemo) ||
    snapshot.materials.some((m) => !m.isDemo) ||
    snapshot.clients.some((c) => !c.isDemo);

  const nowDate = new Date();
  const todayKey = `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, '0')}-${String(nowDate.getDate()).padStart(2, '0')}`;
  const toLocalDateKey = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const workSessions = snapshot.workSessions ?? [];
  const todayCompletedSeconds = workSessions
    .filter((s) => s.status === 'completed' && toLocalDateKey(s.endTime ?? s.startTime) === todayKey)
    .reduce((sum, s) => sum + Math.max(0, s.effectiveSeconds), 0);
  const todayEffectiveMinutes = Math.round(todayCompletedSeconds / 60);

  const totalEffectiveMinutes = snapshot.components.reduce(
    (sum, c) => sum + Math.max(0, c.effectiveMinutesSpent),
    0,
  );

  const pendingMaterials = snapshot.pendingMaterials ?? [];
  const notesAndLists = snapshot.notesAndLists ?? [];
  const shoppingItems = snapshot.shoppingItems ?? [];

  const pendingMaterialsCount = pendingMaterials.filter(
    (p) =>
      p.status === 'pending_order' ||
      p.status === 'ordered' ||
      p.status === 'partially_received',
  ).length;

  const inTransitPurchasesCount =
    pendingMaterials.filter((p) => p.status === 'ordered').length +
    shoppingItems.filter((i) => i.status === 'purchased_waiting_delivery').length;

  const activeNotesCount = notesAndLists.filter((n) => n.status === 'active').length;
  const quotes = snapshot.quotes ?? [];
  const quotesCount = quotes.length;
  const approvedQuotesCount = quotes.filter((q) => q.status === 'approved').length;

  const plannedTasks = snapshot.plannedTasks ?? [];
  const reminders = snapshot.reminders ?? [];

  let todayPlannedMinutes = 0;
  let pendingTasksCount = 0;
  let blockedTasksCount = 0;

  for (const task of plannedTasks) {
    const evalResult = evaluateTaskMaterialBlock({
      projectId: task.projectId,
      componentId: task.componentId,
      dependsOnPendingMaterialId: task.dependsOnPendingMaterialId,
      components: snapshot.components,
      pendingMaterials,
      materials: snapshot.materials,
      variants: snapshot.variants,
    });
    const effStatus = resolveEffectiveTaskStatus(task, evalResult);
    if (
      toPlanningLocalDateKey(task.scheduledDate) === todayKey &&
      effStatus !== 'rescheduled'
    ) {
      todayPlannedMinutes += Math.max(0, task.allocatedMinutes);
    }
    if (effStatus === 'scheduled') pendingTasksCount += 1;
    if (effStatus === 'blocked_by_material') blockedTasksCount += 1;
  }

  const resolvedAlerts = resolveSmartRemindersAndAlerts({
    settings: snapshot.settings,
    reminders,
    projects: snapshot.projects,
    pendingMaterials,
    materials: snapshot.materials,
    variants: snapshot.variants,
    paymentPlans: snapshot.paymentPlans,
    installments: snapshot.installments,
    clients: snapshot.clients,
    nowDate,
  });
  const activeRemindersCount = resolvedAlerts.filter((a) => !a.isCompleted).length;

  return {
    activeProjectsCount,
    pendingProjectsCount,
    completedProjectsCount,
    totalProjectsCount: snapshot.projects.length,
    todayEffectiveMinutes,
    totalEffectiveMinutes,
    nextDeliveryProject,
    featuredProject,
    projectSummaries,
    lowStockVariants,
    inventoryHighlights,
    totalAgreedCOP,
    totalPaidCOP,
    totalPendingBalanceCOP,
    upcomingInstallments,
    recentMovementsCount: snapshot.movements.length,
    pendingMaterialsCount,
    inTransitPurchasesCount,
    activeNotesCount,
    quotesCount,
    approvedQuotesCount,
    todayPlannedMinutes,
    pendingTasksCount,
    blockedTasksCount,
    activeRemindersCount,
    hasDemoData,
    hasRealData,
  };
}

import type {
  Client,
  InventoryMovement,
  InventoryReservation,
  Material,
  MaterialVariant,
  MoneyCOP,
  PaymentInstallment,
  PaymentPlan,
  Project,
  ProjectComponent,
  WorkshopSettings,
} from '@/src/domain/models/index.ts';

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
  readonly hasDemoData: boolean;
  readonly hasRealData: boolean;
}

export interface WorkshopSnapshotInput {
  readonly settings: WorkshopSettings;
  readonly projects: Project[];
  readonly components: ProjectComponent[];
  readonly materials: Material[];
  readonly variants: MaterialVariant[];
  readonly reservations: InventoryReservation[];
  readonly movements: InventoryMovement[];
  readonly clients: Client[];
  readonly paymentPlans: PaymentPlan[];
  readonly installments: PaymentInstallment[];
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

  return {
    activeProjectsCount,
    pendingProjectsCount,
    completedProjectsCount,
    totalProjectsCount: snapshot.projects.length,
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
    hasDemoData,
    hasRealData,
  };
}

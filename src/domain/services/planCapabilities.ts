import type {
  PaymentPlanModality,
  Project,
  ProjectStatus,
  Quote,
  SubscriptionTier,
  WorkshopSettings,
} from '@/src/domain/models/index.ts';

export const FREE_MAX_ACTIVE_PROJECTS = 5;
export const FREE_MAX_SAVED_QUOTES = 5;
export const FREE_MAX_PAYMENT_INSTALLMENTS = 2;
export const TRIAL_DURATION_DAYS = 7;

export const STANDARD_REMINDER_LEAD_DAYS = {
  delivery: 3,
  installment: 2,
  purchase: 1,
} as const;

export const ACTIVE_PROJECT_STATUSES: ReadonlySet<ProjectStatus> = new Set<ProjectStatus>([
  'pending',
  'planning',
  'in_progress',
  'paused',
]);

export const CLOSED_PROJECT_STATUSES: ReadonlySet<ProjectStatus> = new Set<ProjectStatus>([
  'completed',
  'delivered',
  'cancelled',
]);

export const FREE_ALLOWED_PAYMENT_MODALITIES: ReadonlySet<PaymentPlanModality> =
  new Set<PaymentPlanModality>([
    'full',
    'deposit_and_balance',
    'two_installments',
  ]);

export type PlanFeatureKey =
  | 'unlimited_active_projects'
  | 'unlimited_saved_quotes'
  | 'flexible_multi_installments'
  | 'export_account_statement'
  | 'material_reservations'
  | 'advanced_reminder_rules'
  | 'task_material_dependency'
  | 'advanced_kardex_filters'
  | 'quote_templates_and_duplicate'
  | 'cloud_backup';

export interface PlanCapabilities {
  readonly tier: SubscriptionTier;
  readonly isPro: boolean;
  readonly maxActiveProjects: number;
  readonly maxSavedQuotes: number;
  readonly maxPaymentInstallments: number;
  readonly canCreateMaterialReservations: boolean;
  readonly canExportAccountStatement: boolean;
  readonly canConfigureAdvancedReminders: boolean;
  readonly canUseTaskMaterialDependency: boolean;
  readonly canUseAdvancedKardexFilters: boolean;
  readonly canUseQuoteTemplatesAndDuplicate: boolean;
  readonly canUseCloudBackup: boolean;
}

export function isProTier(tier: SubscriptionTier): boolean {
  return tier === 'pro_monthly' || tier === 'pro_annual';
}

/**
 * Indica si el simulador efímero de planes está habilitado en este entorno.
 * - Siempre activo en desarrollo (import.meta.env.DEV).
 * - En compilaciones de producción/preview, solo se habilita de forma explícita
 *   cuando VITE_ENABLE_PLAN_SIMULATOR === 'true'.
 */
export function isPlanSimulatorEnabled(): boolean {
  return (
    Boolean(import.meta.env.DEV) ||
    import.meta.env.VITE_ENABLE_PLAN_SIMULATOR === 'true'
  );
}

/**
 * Resuelve el plan efectivo para la sesión actual.
 * En Fase A, la autoridad comercial por defecto en producción es FREE:
 * - Si el simulador no está habilitado explícitamente, siempre retorna 'free'.
 * - Modificar manualmente IndexedDB o importar respaldos JSON nunca activa PRO.
 * - Cuando está habilitado (DEV o VITE_ENABLE_PLAN_SIMULATOR === 'true'),
 *   permite alternar en memoria sin persistencia.
 */
export function resolveEffectiveTier(
  _settings: Pick<WorkshopSettings, 'plan'>,
  devTierOverride: SubscriptionTier | null = null,
): SubscriptionTier {
  if (isPlanSimulatorEnabled() && devTierOverride !== null) {
    return devTierOverride;
  }
  return 'free';
}

export function getPlanCapabilities(tier: SubscriptionTier): PlanCapabilities {
  const pro = isProTier(tier);
  return {
    tier,
    isPro: pro,
    maxActiveProjects: pro ? Number.POSITIVE_INFINITY : FREE_MAX_ACTIVE_PROJECTS,
    maxSavedQuotes: pro ? Number.POSITIVE_INFINITY : FREE_MAX_SAVED_QUOTES,
    maxPaymentInstallments: pro
      ? Number.POSITIVE_INFINITY
      : FREE_MAX_PAYMENT_INSTALLMENTS,
    canCreateMaterialReservations: pro,
    canExportAccountStatement: pro,
    canConfigureAdvancedReminders: pro,
    canUseTaskMaterialDependency: pro,
    canUseAdvancedKardexFilters: pro,
    canUseQuoteTemplatesAndDuplicate: pro,
    canUseCloudBackup: pro,
  };
}

export function isProjectCountingTowardActiveLimit(
  project: Pick<Project, 'isDemo' | 'status'>,
): boolean {
  return !project.isDemo && ACTIVE_PROJECT_STATUSES.has(project.status);
}

export function countActiveRealProjects(
  projects: ReadonlyArray<Pick<Project, 'isDemo' | 'status'>>,
): number {
  let count = 0;
  for (const project of projects) {
    if (isProjectCountingTowardActiveLimit(project)) {
      count += 1;
    }
  }
  return count;
}

export interface ProjectQuotaCheckResult {
  readonly allowed: boolean;
  readonly activeCount: number;
  readonly limit: number;
  readonly reason?: string;
}

export function canCreateOrActivateRealProject(
  tier: SubscriptionTier,
  projects: ReadonlyArray<Pick<Project, 'isDemo' | 'status'>>,
  options: {
    readonly isDemoTarget?: boolean;
    readonly nextStatus: ProjectStatus;
    readonly previousStatus?: ProjectStatus | null;
  },
): ProjectQuotaCheckResult {
  const activeCount = countActiveRealProjects(projects);
  const limit = isProTier(tier)
    ? Number.POSITIVE_INFINITY
    : FREE_MAX_ACTIVE_PROJECTS;

  if (isProTier(tier) || options.isDemoTarget) {
    return { allowed: true, activeCount, limit };
  }

  if (!ACTIVE_PROJECT_STATUSES.has(options.nextStatus)) {
    return { allowed: true, activeCount, limit };
  }

  if (options.previousStatus && ACTIVE_PROJECT_STATUSES.has(options.previousStatus)) {
    return { allowed: true, activeCount, limit };
  }

  if (activeCount < FREE_MAX_ACTIVE_PROJECTS) {
    return { allowed: true, activeCount, limit };
  }

  return {
    allowed: false,
    activeCount,
    limit,
    reason: `En el plan FREE puedes tener hasta ${FREE_MAX_ACTIVE_PROJECTS} proyectos reales activos simultáneamente. Finaliza, entrega o cancela uno existente para liberar un cupo, o usa PRO para proyectos activos ilimitados.`,
  };
}

export function countRealSavedQuotes(
  quotes: ReadonlyArray<Pick<Quote, 'isDemo'>>,
): number {
  let count = 0;
  for (const quote of quotes) {
    if (!quote.isDemo) {
      count += 1;
    }
  }
  return count;
}

export interface QuoteQuotaCheckResult {
  readonly allowed: boolean;
  readonly realCount: number;
  readonly limit: number;
  readonly reason?: string;
}

export function canSaveNewQuote(
  tier: SubscriptionTier,
  quotes: ReadonlyArray<Pick<Quote, 'isDemo'>>,
  options: {
    readonly isEditingExisting: boolean;
    readonly isTargetDemo: boolean;
  },
): QuoteQuotaCheckResult {
  const realCount = countRealSavedQuotes(quotes);
  const limit = isProTier(tier) ? Number.POSITIVE_INFINITY : FREE_MAX_SAVED_QUOTES;

  if (isProTier(tier) || options.isEditingExisting || options.isTargetDemo) {
    return { allowed: true, realCount, limit };
  }

  if (realCount < FREE_MAX_SAVED_QUOTES) {
    return { allowed: true, realCount, limit };
  }

  return {
    allowed: false,
    realCount,
    limit,
    reason: `En el plan FREE puedes guardar hasta ${FREE_MAX_SAVED_QUOTES} cotizaciones reales en el historial. Puedes seguir editando cualquiera de tus cotizaciones guardadas o usar la calculadora libremente.`,
  };
}

export interface PaymentInstallmentCheckResult {
  readonly allowed: boolean;
  readonly maxInstallments: number;
  readonly reason?: string;
}

export function canConfigurePaymentInstallments(
  tier: SubscriptionTier,
  modality: PaymentPlanModality,
  installmentCount: number,
  options: {
    readonly isEditingExisting: boolean;
  },
): PaymentInstallmentCheckResult {
  const maxInstallments = isProTier(tier)
    ? Number.POSITIVE_INFINITY
    : FREE_MAX_PAYMENT_INSTALLMENTS;

  if (isProTier(tier) || options.isEditingExisting) {
    return { allowed: true, maxInstallments };
  }

  if (
    FREE_ALLOWED_PAYMENT_MODALITIES.has(modality) &&
    installmentCount <= FREE_MAX_PAYMENT_INSTALLMENTS
  ) {
    return { allowed: true, maxInstallments };
  }

  return {
    allowed: false,
    maxInstallments,
    reason: `En el plan FREE puedes crear planes de 1 pago o hasta ${FREE_MAX_PAYMENT_INSTALLMENTS} cuotas con montos y fechas totalmente libres. Los planes de 3 o más cuotas pertenecen al plan PRO.`,
  };
}

export function canCreateMaterialReservation(tier: SubscriptionTier): boolean {
  return isProTier(tier);
}

export function canExportAccountStatement(tier: SubscriptionTier): boolean {
  return isProTier(tier);
}

export function canConfigureAdvancedReminders(tier: SubscriptionTier): boolean {
  return isProTier(tier);
}

export function canUseTaskMaterialDependency(tier: SubscriptionTier): boolean {
  return isProTier(tier);
}

export function canUseAdvancedKardexFilters(tier: SubscriptionTier): boolean {
  return isProTier(tier);
}

export function canUseQuoteTemplatesAndDuplicate(tier: SubscriptionTier): boolean {
  return isProTier(tier);
}

export function canUseCloudBackup(tier: SubscriptionTier): boolean {
  return isProTier(tier);
}

import React from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  Clock,
  FolderKanban,
  Package,
  Sparkles,
  Wallet,
} from 'lucide-react';
import { useWorkshopData } from '@/src/data/DataContext.tsx';
import {
  formatCOP,
  formatDateCO,
  formatDurationMinutes,
} from '@/src/domain/services/formatters.ts';
import { EmptyState } from '@/src/shared/components/EmptyState.tsx';
import { StatusBadge } from '@/src/shared/components/StatusBadge.tsx';
import type { ModuleRouteId } from '@/src/shared/navigation/routes.ts';

interface DashboardViewProps {
  onNavigate(routeId: ModuleRouteId): void;
  onOpenProject?(projectId: string): void;
}

const PROJECT_STATUS_LABEL: Record<string, { label: string; tone: 'active' | 'warning' | 'success' | 'neutral' }> = {
  in_progress: { label: 'En progreso', tone: 'active' },
  planning: { label: 'Planificando', tone: 'neutral' },
  pending: { label: 'Pendiente', tone: 'warning' },
  paused: { label: 'Pausado', tone: 'warning' },
  completed: { label: 'Finalizado', tone: 'success' },
  delivered: { label: 'Entregado', tone: 'success' },
  cancelled: { label: 'Cancelado', tone: 'neutral' },
};

export const DashboardView: React.FC<DashboardViewProps> = ({
  onNavigate,
  onOpenProject,
}) => {
  const {
    isLoading,
    error,
    settings,
    stats,
    activeTimerSession,
    loadDemoData,
    refresh,
  } = useWorkshopData();
  const [seeding, setSeeding] = React.useState(false);

  const handleLoadDemo = async () => {
    setSeeding(true);
    try {
      await loadDemoData();
    } finally {
      setSeeding(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Cargando panel del taller">
        <div className="h-32 animate-pulse rounded-xl border border-slate-200 bg-white" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[1, 2, 3, 4].map((item) => (
            <div
              key={item}
              className="h-24 animate-pulse rounded-xl border border-slate-200 bg-white"
            />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="No fue posible cargar la base de datos local"
        description={error}
        primaryAction={{
          label: 'Reintentar lectura',
          onClick: () => void refresh(),
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Cabecera operativa del taller */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500">
              {settings.workshopName} · Tarifa hora: {formatCOP(settings.hourlyRateCOP)} · Hoy:{' '}
              {formatDurationMinutes(stats.todayEffectiveMinutes)} / meta{' '}
              {formatDurationMinutes(settings.dailyGoalMinutes)}
            </p>
            <h2 className="mt-1 font-display text-xl font-bold text-slate-900 sm:text-2xl">
              Hola, {settings.ownerDisplayName}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {stats.totalProjectsCount > 0
                ? 'Tienes proyectos activos y registros sincronizados localmente en este dispositivo.'
                : 'Tu espacio está listo. Configura tu taller o carga los ejemplos prácticos para explorar cómo se conectan los módulos.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {stats.totalProjectsCount > 0 && (
              <button
                type="button"
                onClick={() => onNavigate('timer')}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-800 whitespace-nowrap shrink-0"
              >
                <Clock className="h-4 w-4" aria-hidden="true" />
                <span>
                  {activeTimerSession ? 'Ver cronómetro activo' : 'Continuar tejiendo'}
                </span>
              </button>
            )}
            <button
              type="button"
              onClick={() => onNavigate('settings')}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <span>Configurar taller y respaldos</span>
            </button>
          </div>
        </div>
      </section>

      {/* Indicadores clave del taller */}
      <section aria-label="Indicadores generales">
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
            <p className="text-xs font-medium text-slate-500">Proyectos activos</p>
            <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {stats.activeProjectsCount}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
            <p className="text-xs font-medium text-slate-500">En espera / pausados</p>
            <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {stats.pendingProjectsCount}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
            <p className="text-xs font-medium text-slate-500">Finalizados</p>
            <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {stats.completedProjectsCount}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
            <p className="text-xs font-medium text-slate-500">Próxima entrega</p>
            <p className="mt-2 font-mono text-base font-semibold text-slate-900 tabular-nums sm:text-lg">
              {stats.nextDeliveryProject?.estimatedEndDate
                ? formatDateCO(stats.nextDeliveryProject.estimatedEndDate)
                : 'Sin fecha'}
            </p>
            {stats.nextDeliveryProject && (
              <p className="mt-0.5 truncate text-xs text-slate-500">
                {stats.nextDeliveryProject.name}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Estado vacío guiado si aún no hay proyectos ni ejemplos cargados */}
      {stats.totalProjectsCount === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="Aún no hay proyectos ni materiales registrados"
          description="Puedes cargar los ejemplos prácticos del taller (Mariposa de crochet, Amigurumi personalizado por $180.000 COP e Hilo Algodón Blanco de 500 g) para revisar la estructura, y eliminarlos luego sin afectar tus datos reales."
          primaryAction={{
            label: seeding ? 'Cargando ejemplos...' : 'Cargar ejemplos del taller',
            onClick: () => void handleLoadDemo(),
          }}
          secondaryAction={{
            label: 'Ir a Taller y Respaldos',
            onClick: () => onNavigate('settings'),
          }}
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Columna izquierda: Proyectos y avance */}
          <section className="space-y-4 lg:col-span-7">
            <div className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
              <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-4">
                <div className="flex items-center gap-2.5">
                  <FolderKanban className="h-5 w-5 text-teal-700" aria-hidden="true" />
                  <h3 className="font-display text-base font-semibold text-slate-900">
                    Proyectos en el taller
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate('projects')}
                  className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:text-teal-800 whitespace-nowrap"
                >
                  <span>Gestionar proyectos</span>
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>

              <div className="divide-y divide-slate-100">
                {stats.projectSummaries.map((item) => {
                  const statusMeta =
                    PROJECT_STATUS_LABEL[item.project.status] ??
                    PROJECT_STATUS_LABEL.pending;
                  const progressPct =
                    item.totalComponents > 0
                      ? Math.round(
                          (item.completedComponents / item.totalComponents) * 100,
                        )
                      : 0;

                  return (
                    <div key={item.project.id} className="py-4 first:pt-4 last:pb-0">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                if (onOpenProject) {
                                  onOpenProject(item.project.id);
                                } else {
                                  onNavigate('projects');
                                }
                              }}
                              className="font-display text-sm font-semibold text-slate-900 hover:text-teal-700 text-left"
                            >
                              {item.project.name}
                            </button>
                            {item.project.isDemo && (
                              <span className="text-xs font-medium text-slate-400">
                                · Ejemplo
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-xs text-slate-500">
                            {item.clientName
                              ? `Cliente: ${item.clientName}`
                              : 'Proyecto propio'}
                            {' · '}
                            {item.completedComponents} de {item.totalComponents} piezas
                            {' · '}
                            <span className="tabular-nums">
                              {formatDurationMinutes(item.effectiveMinutesSpent)} efectivos
                            </span>
                          </p>
                        </div>

                        <StatusBadge
                          label={statusMeta.label}
                          tone={statusMeta.tone}
                        />
                      </div>

                      <div className="mt-3 flex items-center gap-3">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-teal-700 transition-all"
                            style={{ width: `${progressPct}%` }}
                          />
                        </div>
                        <span className="font-mono text-xs font-medium text-slate-600 tabular-nums">
                          {progressPct}%
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Inventario por color */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
              <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-4">
                <div className="flex items-center gap-2.5">
                  <Package className="h-5 w-5 text-teal-700" aria-hidden="true" />
                  <h3 className="font-display text-base font-semibold text-slate-900">
                    Disponibilidad por color
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate('inventory')}
                  className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:text-teal-800 whitespace-nowrap"
                >
                  <span>Gestionar inventario</span>
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>

              <div className="divide-y divide-slate-100">
                {stats.inventoryHighlights.map((variant) => (
                  <div
                    key={variant.variantId}
                    className="flex flex-col gap-2 py-3.5 first:pt-4 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className="h-5 w-5 shrink-0 rounded-md border border-slate-300"
                        style={{
                          backgroundColor: variant.colorHex ?? '#E2E8F0',
                        }}
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900">
                          {variant.materialName} · {variant.colorName}
                          {variant.isDemo && (
                            <span className="ml-1.5 text-xs font-normal text-slate-400">
                              · Ejemplo
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-slate-500 tabular-nums">
                          Físico: {variant.physicalStock} {variant.unit} · Reservado:{' '}
                          {variant.reservedStock} {variant.unit}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-3 sm:justify-end">
                      <span className="font-mono text-sm font-semibold text-slate-900 tabular-nums">
                        {variant.availableStock} {variant.unit} disp.
                      </span>
                      {variant.isLowStock && (
                        <StatusBadge label="Stock bajo" tone="warning" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Columna derecha: Finanzas y alertas */}
          <section className="space-y-4 lg:col-span-5">
            <div className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
              <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-4">
                <div className="flex items-center gap-2.5">
                  <Wallet className="h-5 w-5 text-teal-700" aria-hidden="true" />
                  <h3 className="font-display text-base font-semibold text-slate-900">
                    Resumen de encargos y cobros
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate('clients')}
                  className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:text-teal-800 whitespace-nowrap"
                >
                  <span>Ver módulo Fase 7</span>
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>

              <dl className="mt-4 space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <dt className="text-slate-600">Total acordado</dt>
                  <dd className="font-mono font-semibold text-slate-900 tabular-nums">
                    {formatCOP(stats.totalAgreedCOP)}
                  </dd>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <dt className="text-slate-600">Anticipos y cuotas recibidas</dt>
                  <dd className="font-mono font-semibold text-emerald-700 tabular-nums">
                    {formatCOP(stats.totalPaidCOP)}
                  </dd>
                </div>
                <div className="flex items-center justify-between border-t border-slate-100 pt-3 text-sm">
                  <dt className="font-medium text-slate-900">Saldo pendiente por cobrar</dt>
                  <dd className="font-mono font-bold text-slate-900 tabular-nums">
                    {formatCOP(stats.totalPendingBalanceCOP)}
                  </dd>
                </div>
              </dl>

              {stats.upcomingInstallments.length > 0 && (
                <div className="mt-5 border-t border-slate-100 pt-4">
                  <p className="text-xs font-semibold text-slate-500">
                    Próximas cuotas programadas
                  </p>
                  <ul className="mt-2.5 space-y-2.5">
                    {stats.upcomingInstallments.map(({ installment, projectName, clientName }) => (
                      <li
                        key={installment.id}
                        className="flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-800">
                            {installment.concept} · {clientName}
                          </p>
                          <p className="truncate text-slate-500">
                            {projectName} · Vence {formatDateCO(installment.dueDate)}
                          </p>
                        </div>
                        <span className="font-mono font-semibold text-slate-900 tabular-nums shrink-0">
                          {formatCOP(
                            Math.max(
                              0,
                              installment.scheduledAmountCOP - installment.paidAmountCOP,
                            ),
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Alertas operativas */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
              <div className="flex items-center gap-2.5 border-b border-slate-100 pb-4">
                <Calendar className="h-5 w-5 text-teal-700" aria-hidden="true" />
                <h3 className="font-display text-base font-semibold text-slate-900">
                  Alertas y trazabilidad
                </h3>
              </div>
              <ul className="mt-4 space-y-3 text-sm text-slate-600">
                <li className="flex items-center justify-between gap-2">
                  <span>Materiales en stock mínimo</span>
                  <span className="font-mono font-semibold text-slate-900 tabular-nums">
                    {stats.lowStockVariants.length}
                  </span>
                </li>
                <li className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onNavigate('shopping')}
                    className="text-left text-slate-600 hover:text-teal-700"
                  >
                    Compras pendientes / en camino
                  </button>
                  <span className="font-mono font-semibold text-slate-900 tabular-nums">
                    {stats.pendingMaterialsCount} ({stats.inTransitPurchasesCount} en camino)
                  </span>
                </li>
                <li className="flex items-center justify-between gap-2">
                  <span>Movimientos en Kardex histórico</span>
                  <span className="font-mono font-semibold text-slate-900 tabular-nums">
                    {stats.recentMovementsCount}
                  </span>
                </li>
                <li className="flex items-center justify-between gap-2">
                  <span>Último respaldo exportado</span>
                  <span className="font-mono text-xs font-medium text-slate-700 tabular-nums">
                    {settings.lastBackupExportAt
                      ? formatDateCO(settings.lastBackupExportAt)
                      : 'Pendiente'}
                  </span>
                </li>
              </ul>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};

import React, { useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CheckCircle2,
  Clock,
  Edit3,
  FolderKanban,
  Layers,
  Package,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useWorkshopData } from '@/src/data/DataContext.tsx';
import type {
  ComponentStatus,
  Project,
  ProjectComponent,
  ProjectPaymentSummaryStatus,
  ProjectStatus,
} from '@/src/domain/models/index.ts';
import {
  formatCOP,
  formatDateCO,
  formatDurationMinutes,
} from '@/src/domain/services/formatters.ts';
import {
  calculateProjectProgress,
  COMPONENT_STATUS_OPTIONS,
  PAYMENT_SUMMARY_OPTIONS,
  PROJECT_STATUS_OPTIONS,
  type CreateProjectInput,
} from '@/src/domain/services/projectService.ts';
import {
  formatUnitQuantity,
  getReservationRemaining,
  RESERVATION_STATUS_META,
} from '@/src/domain/services/inventoryService.ts';
import { ConfirmModal } from '@/src/shared/components/ConfirmModal.tsx';
import { DurationInput } from '@/src/shared/components/DurationInput.tsx';
import { EmptyState } from '@/src/shared/components/EmptyState.tsx';
import { StatusBadge } from '@/src/shared/components/StatusBadge.tsx';

interface ProjectsViewProps {
  readonly initialSelectedProjectId?: string | null;
  onClearInitialSelection?(): void;
  onStartTimerForComponent?(projectId: string, componentId: string): void;
  onNavigateToInventory?(): void;
}

type StatusFilter = 'all' | 'active' | 'pending' | 'completed' | 'cancelled';

function isoToDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  return iso.slice(0, 10);
}

function dateInputToIso(dateStr: string): string | null {
  const trimmed = dateStr.trim();
  if (!trimmed) return null;
  const parsed = new Date(`${trimmed}T12:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export const ProjectsView: React.FC<ProjectsViewProps> = ({
  initialSelectedProjectId = null,
  onClearInitialSelection,
  onStartTimerForComponent,
  onNavigateToInventory,
}) => {
  const {
    settings,
    projects,
    components,
    clients,
    materials,
    variants,
    reservations,
    activeTimerSession,
    createProject,
    updateProject,
    deleteProject,
    createComponent,
    updateComponent,
    reorderComponent,
    deleteComponent,
  } = useWorkshopData();

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    initialSelectedProjectId,
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Modal de Crear / Editar Proyecto
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formClientId, setFormClientId] = useState('');
  const [formStartDate, setFormStartDate] = useState('');
  const [formEndDate, setFormEndDate] = useState('');
  const [formTargetMinutes, setFormTargetMinutes] = useState('180');
  const [formDailyMinutes, setFormDailyMinutes] = useState(
    String(settings.dailyGoalMinutes),
  );
  const [formWeeklyMinutes, setFormWeeklyMinutes] = useState(
    String(settings.weeklyGoalMinutes),
  );
  const [formBudgetCOP, setFormBudgetCOP] = useState('0');
  const [formStatus, setFormStatus] = useState<ProjectStatus>('planning');
  const [formPaymentStatus, setFormPaymentStatus] =
    useState<ProjectPaymentSummaryStatus>('not_applicable');
  const [formNotes, setFormNotes] = useState('');
  const [draftInitialComponents, setDraftInitialComponents] = useState<
    Array<{ name: string; estimatedMinutes: string }>
  >([
    { name: 'Cuerpo principal', estimatedMinutes: '60' },
    { name: 'Detalles y ensamblaje', estimatedMinutes: '30' },
  ]);
  const [projectSaving, setProjectSaving] = useState(false);

  // Modal de confirmación para eliminar proyecto
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [deletingProject, setDeletingProject] = useState(false);

  // Formulario de Agregar / Editar Componente en vista de detalle
  const [compModalOpen, setCompModalOpen] = useState(false);
  const [editingComponent, setEditingComponent] =
    useState<ProjectComponent | null>(null);
  const [compName, setCompName] = useState('');
  const [compEstimatedMinutes, setCompEstimatedMinutes] = useState('30');
  const [compEffectiveMinutes, setCompEffectiveMinutes] = useState('0');
  const [compStatus, setCompStatus] = useState<ComponentStatus>('pending');
  const [compNotes, setCompNotes] = useState('');
  const [compSaving, setCompSaving] = useState(false);

  const [componentToDelete, setComponentToDelete] =
    useState<ProjectComponent | null>(null);
  const [deletingComponent, setDeletingComponent] = useState(false);

  React.useEffect(() => {
    if (initialSelectedProjectId) {
      setSelectedProjectId(initialSelectedProjectId);
      onClearInitialSelection?.();
    }
  }, [initialSelectedProjectId, onClearInitialSelection]);

  const selectedProject =
    projects.find((p) => p.id === selectedProjectId) ?? null;

  const clientById = React.useMemo(
    () => new Map(clients.map((c) => [c.id, c])),
    [clients],
  );

  // Clientes elegibles para proyectos reales vs demo
  const selectableClients = React.useMemo(() => {
    if (editingProject?.isDemo) return clients;
    return clients.filter((c) => !c.isDemo);
  }, [clients, editingProject]);

  const openCreateProjectModal = () => {
    setEditingProject(null);
    setFormName('');
    setFormDescription('');
    setFormClientId('');
    setFormStartDate(new Date().toISOString().slice(0, 10));
    setFormEndDate('');
    setFormTargetMinutes('180');
    setFormDailyMinutes(String(settings.dailyGoalMinutes));
    setFormWeeklyMinutes(String(settings.weeklyGoalMinutes));
    setFormBudgetCOP('0');
    setFormStatus('planning');
    setFormPaymentStatus('not_applicable');
    setFormNotes('');
    setDraftInitialComponents([
      { name: 'Pieza principal', estimatedMinutes: '60' },
      { name: 'Ensamblaje y acabados', estimatedMinutes: '30' },
    ]);
    setProjectModalOpen(true);
  };

  const openEditProjectModal = (project: Project) => {
    setEditingProject(project);
    setFormName(project.name);
    setFormDescription(project.description);
    setFormClientId(project.clientId ?? '');
    setFormStartDate(isoToDateInput(project.startDate));
    setFormEndDate(isoToDateInput(project.estimatedEndDate));
    setFormTargetMinutes(String(project.targetTotalMinutes));
    setFormDailyMinutes(String(project.dailyGoalMinutes));
    setFormWeeklyMinutes(String(project.weeklyGoalMinutes));
    setFormBudgetCOP(String(project.estimatedBudgetCOP));
    setFormStatus(project.status);
    setFormPaymentStatus(project.paymentStatus);
    setFormNotes(project.notes);
    setProjectModalOpen(true);
  };

  const handleSaveProject = async (e: React.FormEvent) => {
    e.preventDefault();
    setProjectSaving(true);
    setFeedback(null);

    try {
      if (editingProject) {
        await updateProject(editingProject.id, {
          name: formName,
          description: formDescription,
          clientId: formClientId || null,
          startDate: dateInputToIso(formStartDate),
          estimatedEndDate: dateInputToIso(formEndDate),
          targetTotalMinutes: Number(formTargetMinutes) || 0,
          dailyGoalMinutes: Number(formDailyMinutes) || 0,
          weeklyGoalMinutes: Number(formWeeklyMinutes) || 0,
          estimatedBudgetCOP: Number(formBudgetCOP) || 0,
          status: formStatus,
          paymentStatus: formPaymentStatus,
          notes: formNotes,
        });
        setFeedback({
          type: 'success',
          message: `Proyecto "${formName.trim()}" actualizado correctamente.`,
        });
      } else {
        const input: CreateProjectInput = {
          name: formName,
          description: formDescription,
          clientId: formClientId || null,
          startDate: dateInputToIso(formStartDate),
          estimatedEndDate: dateInputToIso(formEndDate),
          targetTotalMinutes: Number(formTargetMinutes) || 0,
          dailyGoalMinutes: Number(formDailyMinutes) || 0,
          weeklyGoalMinutes: Number(formWeeklyMinutes) || 0,
          estimatedBudgetCOP: Number(formBudgetCOP) || 0,
          status: formStatus,
          paymentStatus: formPaymentStatus,
          notes: formNotes,
          initialComponents: draftInitialComponents
            .filter((c) => c.name.trim().length > 0)
            .map((c) => ({
              name: c.name.trim(),
              estimatedMinutes: Number(c.estimatedMinutes) || 0,
            })),
        };
        const created = await createProject(input);
        setSelectedProjectId(created.id);
        setFeedback({
          type: 'success',
          message: `Proyecto "${created.name}" creado con sus componentes iniciales.`,
        });
      }
      setProjectModalOpen(false);
    } catch (err) {
      setFeedback({
        type: 'error',
        message:
          err instanceof Error ? err.message : 'No fue posible guardar el proyecto.',
      });
    } finally {
      setProjectSaving(false);
    }
  };

  const handleConfirmDeleteProject = async () => {
    if (!projectToDelete) return;
    setDeletingProject(true);
    setFeedback(null);
    try {
      const deletedName = projectToDelete.name;
      const deletedId = projectToDelete.id;
      await deleteProject(deletedId);
      setProjectToDelete(null);
      if (selectedProjectId === deletedId) {
        setSelectedProjectId(null);
      }
      setFeedback({
        type: 'success',
        message: `Proyecto "${deletedName}" eliminado correctamente.`,
      });
    } catch (err) {
      setProjectToDelete(null);
      setFeedback({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'No fue posible eliminar el proyecto.',
      });
    } finally {
      setDeletingProject(false);
    }
  };

  const openCreateComponentModal = () => {
    setEditingComponent(null);
    setCompName('');
    setCompEstimatedMinutes('30');
    setCompEffectiveMinutes('0');
    setCompStatus('pending');
    setCompNotes('');
    setCompModalOpen(true);
  };

  const openEditComponentModal = (comp: ProjectComponent) => {
    setEditingComponent(comp);
    setCompName(comp.name);
    setCompEstimatedMinutes(String(comp.estimatedMinutes));
    setCompEffectiveMinutes(String(comp.effectiveMinutesSpent));
    setCompStatus(comp.status);
    setCompNotes(comp.notes);
    setCompModalOpen(true);
  };

  const handleSaveComponent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProject) return;
    setCompSaving(true);
    setFeedback(null);

    try {
      if (editingComponent) {
        await updateComponent(editingComponent.id, {
          name: compName,
          estimatedMinutes: Number(compEstimatedMinutes) || 0,
          effectiveMinutesSpent: Number(compEffectiveMinutes) || 0,
          status: compStatus,
          notes: compNotes,
        });
        setFeedback({
          type: 'success',
          message: `Pieza "${compName.trim()}" actualizada.`,
        });
      } else {
        await createComponent({
          projectId: selectedProject.id,
          name: compName,
          estimatedMinutes: Number(compEstimatedMinutes) || 0,
          effectiveMinutesSpent: Number(compEffectiveMinutes) || 0,
          status: compStatus,
          notes: compNotes,
        });
        setFeedback({
          type: 'success',
          message: `Pieza "${compName.trim()}" agregada al proyecto.`,
        });
      }
      setCompModalOpen(false);
    } catch (err) {
      setFeedback({
        type: 'error',
        message:
          err instanceof Error ? err.message : 'No se pudo guardar la pieza.',
      });
    } finally {
      setCompSaving(false);
    }
  };

  const handleQuickComponentStatusChange = async (
    comp: ProjectComponent,
    nextStatus: ComponentStatus,
  ) => {
    setFeedback(null);
    try {
      await updateComponent(comp.id, { status: nextStatus });
    } catch (err) {
      setFeedback({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Error actualizando el estado de la pieza.',
      });
    }
  };

  const handleQuickProjectStatusChange = async (
    project: Project,
    nextStatus: ProjectStatus,
  ) => {
    setFeedback(null);
    try {
      await updateProject(project.id, { status: nextStatus });
    } catch (err) {
      setFeedback({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Error cambiando el estado del proyecto.',
      });
    }
  };

  const handleConfirmDeleteComponent = async () => {
    if (!componentToDelete) return;
    setDeletingComponent(true);
    setFeedback(null);
    try {
      const deletedName = componentToDelete.name;
      await deleteComponent(componentToDelete.id);
      setComponentToDelete(null);
      setFeedback({
        type: 'success',
        message: `Pieza "${deletedName}" eliminada del proyecto.`,
      });
    } catch (err) {
      setComponentToDelete(null);
      setFeedback({
        type: 'error',
        message:
          err instanceof Error ? err.message : 'No se pudo eliminar la pieza.',
      });
    } finally {
      setDeletingComponent(false);
    }
  };

  const filteredProjects = React.useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return projects
      .filter((p) => {
        if (statusFilter === 'active') {
          if (p.status !== 'in_progress' && p.status !== 'planning') return false;
        } else if (statusFilter === 'pending') {
          if (p.status !== 'pending' && p.status !== 'paused') return false;
        } else if (statusFilter === 'completed') {
          if (p.status !== 'completed' && p.status !== 'delivered') return false;
        } else if (statusFilter === 'cancelled') {
          if (p.status !== 'cancelled') return false;
        }

        if (!query) return true;
        const clientName = p.clientId
          ? clientById.get(p.clientId)?.name.toLowerCase() ?? ''
          : '';
        return (
          p.name.toLowerCase().includes(query) ||
          p.description.toLowerCase().includes(query) ||
          clientName.includes(query)
        );
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [projects, searchQuery, statusFilter, clientById]);

  const selectedProjectComponents = React.useMemo(() => {
    if (!selectedProject) return [];
    return components
      .filter((c) => c.projectId === selectedProject.id)
      .sort((a, b) => a.orderIndex - b.orderIndex);
  }, [components, selectedProject]);

  return (
    <div className="space-y-6">
      {feedback && (
        <div
          role="status"
          className={`flex items-start justify-between gap-3 rounded-xl border p-4 text-sm ${
            feedback.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-rose-200 bg-rose-50 text-rose-900'
          }`}
        >
          <div className="flex items-start gap-2.5">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
            ) : (
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-700" />
            )}
            <p>{feedback.message}</p>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-xs font-medium underline"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* VISTA DE DETALLE DE UN PROYECTO Y SUS COMPONENTES */}
      {selectedProject ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setSelectedProjectId(null)}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              <span>Volver a todos los proyectos</span>
            </button>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => openEditProjectModal(selectedProject)}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
              >
                <Edit3 className="h-4 w-4 text-teal-700" aria-hidden="true" />
                <span>Editar proyecto</span>
              </button>
              <button
                type="button"
                onClick={() => setProjectToDelete(selectedProject)}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-rose-200 bg-white px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                <span>Eliminar</span>
              </button>
            </div>
          </div>

          {(() => {
            const metrics = calculateProjectProgress(
              selectedProject,
              selectedProjectComponents,
            );
            const statusOption =
              PROJECT_STATUS_OPTIONS.find(
                (o) => o.value === selectedProject.status,
              ) ?? PROJECT_STATUS_OPTIONS[0];
            const paymentOption = PAYMENT_SUMMARY_OPTIONS.find(
              (o) => o.value === selectedProject.paymentStatus,
            );
            const client = selectedProject.clientId
              ? clientById.get(selectedProject.clientId)
              : null;

            return (
              <>
                <section className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span>
                          {client
                            ? `Cliente: ${client.name}`
                            : 'Proyecto propio del taller'}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          Inicio: {formatDateCO(selectedProject.startDate)}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          Entrega estimada:{' '}
                          {formatDateCO(selectedProject.estimatedEndDate)}
                        </span>
                        {selectedProject.isDemo && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-medium text-slate-400">
                              Ejemplo
                            </span>
                          </>
                        )}
                      </div>

                      <h2 className="mt-1.5 font-display text-xl font-bold text-slate-900 sm:text-2xl">
                        {selectedProject.name}
                      </h2>
                      {selectedProject.description && (
                        <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-slate-600">
                          {selectedProject.description}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center lg:shrink-0">
                      <label
                        htmlFor="detail-project-status"
                        className="text-xs font-medium text-slate-500"
                      >
                        Estado:
                      </label>
                      <select
                        id="detail-project-status"
                        value={selectedProject.status}
                        onChange={(e) =>
                          void handleQuickProjectStatusChange(
                            selectedProject,
                            e.target.value as ProjectStatus,
                          )
                        }
                        className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-900 focus:border-teal-700 focus:outline-none"
                      >
                        {PROJECT_STATUS_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      <StatusBadge
                        label={statusOption.label}
                        tone={statusOption.tone}
                      />
                    </div>
                  </div>

                  {/* Métricas de avance del proyecto */}
                  <div className="mt-6 grid grid-cols-2 gap-3 border-t border-slate-100 pt-5 sm:grid-cols-4">
                    <div>
                      <p className="text-xs text-slate-500">Progreso piezas</p>
                      <p className="mt-1 font-mono text-lg font-semibold text-slate-900 tabular-nums">
                        {metrics.completedComponents} / {metrics.totalComponents} (
                        {metrics.completionPercent}%)
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Tiempo efectivo</p>
                      <p className="mt-1 font-mono text-lg font-semibold text-teal-800 tabular-nums">
                        {formatDurationMinutes(metrics.totalEffectiveMinutes)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Tiempo estimado</p>
                      <p className="mt-1 font-mono text-lg font-semibold text-slate-900 tabular-nums">
                        {formatDurationMinutes(metrics.totalEstimatedMinutes)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">
                        Presupuesto / Valor estimado
                      </p>
                      <p className="mt-1 font-mono text-lg font-semibold text-slate-900 tabular-nums">
                        {formatCOP(selectedProject.estimatedBudgetCOP)}
                      </p>
                      {paymentOption && (
                        <p className="text-[11px] text-slate-500">
                          {paymentOption.label}
                        </p>
                      )}
                    </div>
                  </div>

                  {selectedProject.notes && (
                    <div className="mt-4 rounded-lg bg-slate-50 p-3.5 text-xs text-slate-600">
                      <strong className="font-semibold text-slate-800">
                        Notas del proyecto:{' '}
                      </strong>
                      {selectedProject.notes}
                    </div>
                  )}
                </section>

                {/* Gestión de Componentes / Piezas del Proyecto */}
                <section className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
                  <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2.5">
                      <Layers
                        className="h-5 w-5 text-teal-700"
                        aria-hidden="true"
                      />
                      <div>
                        <h3 className="font-display text-base font-semibold text-slate-900">
                          Componentes y piezas del proyecto
                        </h3>
                        <p className="text-xs text-slate-500">
                          Divide tu creación en partes (ej. tronco, alas, antenas,
                          ensamblaje) para controlar el avance y el tiempo de cada una.
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={openCreateComponentModal}
                      className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-800 whitespace-nowrap shrink-0"
                    >
                      <Plus className="h-4 w-4" aria-hidden="true" />
                      <span>Agregar pieza</span>
                    </button>
                  </div>

                  {selectedProjectComponents.length === 0 ? (
                    <div className="py-8 text-center">
                      <p className="text-sm text-slate-600">
                        Este proyecto aún no tiene piezas registradas.
                      </p>
                      <button
                        type="button"
                        onClick={openCreateComponentModal}
                        className="mt-3 inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50"
                      >
                        <Plus className="h-4 w-4 text-teal-700" />
                        <span>Crear primera pieza</span>
                      </button>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {selectedProjectComponents.map((comp, index) => {
                        const compStatusMeta =
                          COMPONENT_STATUS_OPTIONS.find(
                            (o) => o.value === comp.status,
                          ) ?? COMPONENT_STATUS_OPTIONS[0];

                        return (
                          <div
                            key={comp.id}
                            className="flex flex-col gap-3 py-4 first:pt-4 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div className="flex items-start gap-3 min-w-0">
                              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-100 font-mono text-xs font-semibold text-slate-700 tabular-nums">
                                {index + 1}
                              </span>
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <h4 className="font-display text-sm font-semibold text-slate-900">
                                    {comp.name}
                                  </h4>
                                  <StatusBadge
                                    label={compStatusMeta.label}
                                    tone={compStatusMeta.tone}
                                  />
                                </div>
                                <p className="mt-1 text-xs text-slate-500 tabular-nums">
                                  Estimado:{' '}
                                  {formatDurationMinutes(comp.estimatedMinutes)} ·
                                  Efectivo acumulado:{' '}
                                  {formatDurationMinutes(
                                    comp.effectiveMinutesSpent,
                                  )}
                                  {comp.notes ? ` · ${comp.notes}` : ''}
                                </p>
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                              {onStartTimerForComponent && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    onStartTimerForComponent(
                                      selectedProject.id,
                                      comp.id,
                                    )
                                  }
                                  className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors ${
                                    activeTimerSession?.componentId === comp.id
                                      ? 'border-teal-700 bg-teal-700 text-white hover:bg-teal-800'
                                      : 'border-teal-200 bg-teal-50 text-teal-800 hover:bg-teal-100'
                                  }`}
                                >
                                  <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                                  <span>
                                    {activeTimerSession?.componentId === comp.id
                                      ? activeTimerSession.status === 'running'
                                        ? 'Tejiendo'
                                        : 'En pausa'
                                      : 'Cronómetro'}
                                  </span>
                                </button>
                              )}

                              <select
                                aria-label={`Estado de ${comp.name}`}
                                value={comp.status}
                                onChange={(e) =>
                                  void handleQuickComponentStatusChange(
                                    comp,
                                    e.target.value as ComponentStatus,
                                  )
                                }
                                className="min-h-[38px] rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-800 focus:border-teal-700 focus:outline-none"
                              >
                                {COMPONENT_STATUS_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>

                              <div className="flex items-center rounded-lg border border-slate-200 bg-white">
                                <button
                                  type="button"
                                  disabled={index === 0}
                                  onClick={() =>
                                    void reorderComponent(comp.id, 'up')
                                  }
                                  className="inline-flex h-9 w-9 items-center justify-center text-slate-600 hover:bg-slate-50 disabled:opacity-30"
                                  aria-label={`Subir ${comp.name}`}
                                >
                                  <ArrowUp className="h-4 w-4" />
                                </button>
                                <button
                                  type="button"
                                  disabled={
                                    index === selectedProjectComponents.length - 1
                                  }
                                  onClick={() =>
                                    void reorderComponent(comp.id, 'down')
                                  }
                                  className="inline-flex h-9 w-9 items-center justify-center border-l border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-30"
                                  aria-label={`Bajar ${comp.name}`}
                                >
                                  <ArrowDown className="h-4 w-4" />
                                </button>
                              </div>

                              <button
                                type="button"
                                onClick={() => openEditComponentModal(comp)}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                                aria-label={`Editar ${comp.name}`}
                              >
                                <Edit3 className="h-4 w-4" />
                              </button>

                              <button
                                type="button"
                                onClick={() => setComponentToDelete(comp)}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-rose-600 hover:bg-rose-50"
                                aria-label={`Eliminar ${comp.name}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                {/* Materiales reservados y consumidos para este proyecto */}
                <section className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
                  <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2.5">
                      <Package className="h-5 w-5 text-teal-700" aria-hidden="true" />
                      <div>
                        <h3 className="font-display text-base font-semibold text-slate-900">
                          Materiales asignados al proyecto
                        </h3>
                        <p className="text-xs text-slate-500">
                          Colores reservados y consumos registrados desde tu inventario.
                        </p>
                      </div>
                    </div>

                    {onNavigateToInventory && (
                      <button
                        type="button"
                        onClick={onNavigateToInventory}
                        className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
                      >
                        <Package className="h-4 w-4 text-teal-700" aria-hidden="true" />
                        <span>Gestionar en Inventario</span>
                      </button>
                    )}
                  </div>

                  {(() => {
                    const projectReservations = reservations.filter(
                      (r) => r.projectId === selectedProject.id,
                    );
                    if (projectReservations.length === 0) {
                      return (
                        <p className="py-5 text-center text-xs text-slate-500">
                          Este proyecto aún no tiene reservas de material asociadas. Puedes apartar hilos o lanas desde el módulo Inventario.
                        </p>
                      );
                    }
                    return (
                      <div className="divide-y divide-slate-100">
                        {projectReservations.map((res) => {
                          const variant = variants.find((v) => v.id === res.variantId);
                          const mat = variant
                            ? materials.find((m) => m.id === variant.materialId)
                            : undefined;
                          const unit = mat?.unit ?? 'unit';
                          const statusMeta = RESERVATION_STATUS_META[res.status];
                          const remaining = getReservationRemaining(res);

                          return (
                            <div
                              key={res.id}
                              className="flex flex-col gap-2 py-3.5 first:pt-4 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <span
                                  className="h-6 w-6 shrink-0 rounded-md border border-slate-300"
                                  style={{
                                    backgroundColor: variant?.colorHex ?? '#E2E8F0',
                                  }}
                                  aria-hidden="true"
                                />
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-semibold text-slate-900">
                                    {mat?.name ?? 'Material'} ·{' '}
                                    {variant?.colorName ?? 'Color'}
                                  </p>
                                  <p className="text-xs text-slate-500 tabular-nums">
                                    Reservado: {formatUnitQuantity(res.reservedQuantity, unit)} ·
                                    Consumido: {formatUnitQuantity(res.consumedQuantity, unit)} ·
                                    Pendiente: {formatUnitQuantity(remaining, unit)}
                                  </p>
                                </div>
                              </div>
                              <StatusBadge
                                label={statusMeta.label}
                                tone={statusMeta.tone}
                              />
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </section>
              </>
            );
          })()}
        </div>
      ) : (
        /* VISTA DE LISTADO GENERAL DE PROYECTOS */
        <div className="space-y-6">
          <section className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-display text-lg font-semibold text-slate-900 sm:text-xl">
                  Proyectos del taller
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  Administra tus creaciones de crochet, divídelas por componentes y
                  controla su avance real.
                </p>
              </div>
              <button
                type="button"
                onClick={openCreateProjectModal}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-800 whitespace-nowrap shrink-0"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span>Nuevo proyecto</span>
              </button>
            </div>

            {/* Barra de búsqueda y filtro por estado */}
            <div className="mt-5 flex flex-col gap-3 border-t border-slate-100 pt-4 md:flex-row md:items-center md:justify-between">
              <div className="relative flex-1">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar por nombre de proyecto o cliente..."
                  className="w-full min-h-[42px] rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                />
              </div>

              <div className="grid w-full grid-cols-6 gap-1 rounded-lg bg-slate-100 p-1 sm:flex sm:w-fit sm:flex-nowrap sm:items-center">
                {(
                  [
                    { id: 'all', label: 'Todos' },
                    { id: 'active', label: 'Activos' },
                    { id: 'pending', label: 'En espera' },
                    { id: 'completed', label: 'Finalizados' },
                    { id: 'cancelled', label: 'Cancelados' },
                  ] as Array<{ id: StatusFilter; label: string }>
                ).map((tab, index) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setStatusFilter(tab.id)}
                    className={`inline-flex min-h-[36px] items-center justify-center rounded-md px-2 py-1.5 text-center text-xs font-medium transition-colors whitespace-nowrap sm:min-h-[34px] sm:px-3 sm:shrink-0 ${
                      index === 3
                        ? 'col-span-2 col-start-2'
                        : index === 4
                          ? 'col-span-2 col-start-4'
                          : 'col-span-2'
                    } ${
                      statusFilter === tab.id
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {filteredProjects.length === 0 ? (
            <EmptyState
              icon={FolderKanban}
              title={
                projects.length === 0
                  ? 'Aún no tienes proyectos registrados'
                  : 'Ningún proyecto coincide con tu búsqueda'
              }
              description={
                projects.length === 0
                  ? 'Crea tu primer proyecto de crochet e indica las piezas que lo componen (por ejemplo: cuerpo, cabeza, brazos y ensamblaje).'
                  : 'Prueba cambiando el filtro de estado o el término de búsqueda.'
              }
              primaryAction={{
                label: 'Crear nuevo proyecto',
                onClick: openCreateProjectModal,
              }}
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {filteredProjects.map((project) => {
                const metrics = calculateProjectProgress(project, components);
                const statusMeta =
                  PROJECT_STATUS_OPTIONS.find(
                    (o) => o.value === project.status,
                  ) ?? PROJECT_STATUS_OPTIONS[0];
                const client = project.clientId
                  ? clientById.get(project.clientId)
                  : null;

                return (
                  <article
                    key={project.id}
                    className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 transition-colors hover:border-slate-300"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs text-slate-500">
                            {client
                              ? `Cliente: ${client.name}`
                              : 'Proyecto propio'}
                            {' · '}
                            Entrega: {formatDateCO(project.estimatedEndDate)}
                            {project.isDemo ? ' · Ejemplo' : ''}
                          </p>
                          <h3 className="mt-1 truncate font-display text-base font-semibold text-slate-900">
                            {project.name}
                          </h3>
                        </div>
                        <StatusBadge
                          label={statusMeta.label}
                          tone={statusMeta.tone}
                        />
                      </div>

                      {project.description && (
                        <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-slate-600">
                          {project.description}
                        </p>
                      )}

                      <div className="mt-4 flex items-center justify-between text-xs text-slate-600 tabular-nums">
                        <span>
                          {metrics.completedComponents} de{' '}
                          {metrics.totalComponents} piezas completadas
                        </span>
                        <span className="font-mono font-semibold text-slate-900">
                          {metrics.completionPercent}%
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-teal-700 transition-all"
                          style={{ width: `${metrics.completionPercent}%` }}
                        />
                      </div>
                    </div>

                    <div className="mt-5 flex items-center justify-between gap-3 border-t border-slate-100 pt-4 text-xs">
                      <div className="text-slate-500 tabular-nums">
                        <span>
                          Tiempo:{' '}
                          <strong className="font-mono text-slate-800">
                            {formatDurationMinutes(metrics.totalEffectiveMinutes)}
                          </strong>
                        </span>
                        <span className="mx-1.5" aria-hidden="true">
                          ·
                        </span>
                        <span>
                          Valor:{' '}
                          <strong className="font-mono text-slate-800">
                            {formatCOP(project.estimatedBudgetCOP)}
                          </strong>
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => setSelectedProjectId(project.id)}
                        className="inline-flex min-h-[38px] items-center rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0"
                      >
                        Abrir proyecto
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* MODAL CREAR / EDITAR PROYECTO */}
      {projectModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="project-modal-title"
        >
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <h3
                  id="project-modal-title"
                  className="font-display text-lg font-semibold text-slate-900"
                >
                  {editingProject ? 'Editar proyecto' : 'Nuevo proyecto de crochet'}
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Registra los datos generales, metas de tiempo y estado del encargo.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setProjectModalOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                aria-label="Cerrar formulario"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              onSubmit={(e) => void handleSaveProject(e)}
              className="mt-5 space-y-4"
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label
                    htmlFor="proj-name"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Nombre del proyecto *
                  </label>
                  <input
                    id="proj-name"
                    type="text"
                    required
                    placeholder="Ej. Mariposa de Crochet, Amigurumi Oso Tejido..."
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    className="mt-1.5 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label
                    htmlFor="proj-desc"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Descripción
                  </label>
                  <textarea
                    id="proj-desc"
                    rows={2}
                    placeholder="Detalles de tamaño, colores o personalización..."
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white p-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="proj-status"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Estado del proyecto
                  </label>
                  <select
                    id="proj-status"
                    value={formStatus}
                    onChange={(e) =>
                      setFormStatus(e.target.value as ProjectStatus)
                    }
                    className="mt-1.5 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                  >
                    {PROJECT_STATUS_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="proj-client"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Cliente asociado (Opcional)
                  </label>
                  <select
                    id="proj-client"
                    value={formClientId}
                    onChange={(e) => setFormClientId(e.target.value)}
                    className="mt-1.5 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                  >
                    <option value="">Proyecto propio (Sin cliente)</option>
                    {selectableClients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.isDemo ? '(Ejemplo)' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="proj-start"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Fecha de inicio
                  </label>
                  <input
                    id="proj-start"
                    type="date"
                    value={formStartDate}
                    onChange={(e) => setFormStartDate(e.target.value)}
                    className="mt-1.5 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="proj-end"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Fecha estimada de entrega
                  </label>
                  <input
                    id="proj-end"
                    type="date"
                    value={formEndDate}
                    onChange={(e) => setFormEndDate(e.target.value)}
                    className="mt-1.5 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="proj-target-min"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Tiempo total estimado
                  </label>
                  <DurationInput
                    id="proj-target-min"
                    valueMinutes={Number(formTargetMinutes) || 0}
                    onChangeMinutes={(mins) => setFormTargetMinutes(String(mins))}
                    minMinutes={0}
                    maxMinutes={60000}
                    ariaLabel="Tiempo total estimado"
                    className="mt-1.5"
                  />
                </div>

                <div>
                  <label
                    htmlFor="proj-budget"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Presupuesto o precio estimado (COP)
                  </label>
                  <input
                    id="proj-budget"
                    type="number"
                    min={0}
                    step={1000}
                    value={formBudgetCOP}
                    onChange={(e) => setFormBudgetCOP(e.target.value)}
                    className="mt-1.5 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 tabular-nums focus:border-teal-700 focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="proj-payment-status"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Estado comercial / pago
                  </label>
                  <select
                    id="proj-payment-status"
                    value={formPaymentStatus}
                    onChange={(e) =>
                      setFormPaymentStatus(
                        e.target.value as ProjectPaymentSummaryStatus,
                      )
                    }
                    className="mt-1.5 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                  >
                    {PAYMENT_SUMMARY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="proj-daily-min"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Meta diaria para este proyecto
                  </label>
                  <DurationInput
                    id="proj-daily-min"
                    valueMinutes={Number(formDailyMinutes) || 0}
                    onChangeMinutes={(mins) => setFormDailyMinutes(String(mins))}
                    minMinutes={0}
                    maxMinutes={1440}
                    ariaLabel="Meta diaria para este proyecto"
                    className="mt-1.5"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label
                    htmlFor="proj-notes"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Notas adicionales
                  </label>
                  <input
                    id="proj-notes"
                    type="text"
                    placeholder="Aguja recomendada, observaciones de entrega..."
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                    className="mt-1.5 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                  />
                </div>
              </div>

              {/* Piezas iniciales al crear proyecto */}
              {!editingProject && (
                <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-3.5 sm:p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 text-xs font-semibold text-slate-800">
                      Componentes iniciales del proyecto (Opcional)
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        setDraftInitialComponents((prev) => [
                          ...prev,
                          { name: '', estimatedMinutes: '30' },
                        ])
                      }
                      className="shrink-0 whitespace-nowrap text-xs font-medium text-teal-700 hover:underline"
                    >
                      + Añadir fila
                    </button>
                  </div>
                  <div className="mt-3 space-y-2">
                    {draftInitialComponents.map((row, idx) => (
                      <div
                        key={idx}
                        className="flex min-w-0 flex-col gap-2 rounded-lg border border-slate-200/80 bg-white/70 p-2 sm:flex-row sm:items-center sm:border-0 sm:bg-transparent sm:p-0"
                      >
                        <input
                          type="text"
                          placeholder={`Nombre pieza ${idx + 1} (ej. Tronco, Ala...)`}
                          value={row.name}
                          onChange={(e) => {
                            const val = e.target.value;
                            setDraftInitialComponents((prev) =>
                              prev.map((item, i) =>
                                i === idx ? { ...item, name: val } : item,
                              ),
                            );
                          }}
                          className="min-h-[38px] w-full min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900"
                        />
                        <div className="flex min-w-0 items-center justify-between gap-2 sm:shrink-0">
                          <DurationInput
                            compact
                            valueMinutes={Number(row.estimatedMinutes) || 0}
                            onChangeMinutes={(mins) => {
                              setDraftInitialComponents((prev) =>
                                prev.map((item, i) =>
                                  i === idx
                                    ? { ...item, estimatedMinutes: String(mins) }
                                    : item,
                                ),
                              );
                            }}
                            minMinutes={0}
                            maxMinutes={60000}
                            ariaLabel={`Tiempo estimado pieza ${idx + 1}`}
                            className="min-w-0 flex-1 sm:w-[210px] sm:flex-none"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setDraftInitialComponents((prev) =>
                                prev.filter((_, i) => i !== idx),
                              )
                            }
                            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                            aria-label="Quitar fila"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  disabled={projectSaving}
                  onClick={() => setProjectModalOpen(false)}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={projectSaving}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-teal-700 px-5 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
                >
                  {projectSaving
                    ? 'Guardando...'
                    : editingProject
                      ? 'Guardar cambios'
                      : 'Crear proyecto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL CREAR / EDITAR COMPONENTE */}
      {compModalOpen && selectedProject && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="comp-modal-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3
                  id="comp-modal-title"
                  className="font-display text-lg font-semibold text-slate-900"
                >
                  {editingComponent ? 'Editar pieza' : 'Nueva pieza del proyecto'}
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Proyecto: {selectedProject.name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCompModalOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                aria-label="Cerrar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              onSubmit={(e) => void handleSaveComponent(e)}
              className="mt-4 space-y-4"
            >
              <div>
                <label
                  htmlFor="comp-name"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Nombre de la pieza o etapa *
                </label>
                <input
                  id="comp-name"
                  type="text"
                  required
                  placeholder="Ej. Cabeza, Brazo derecho, Ensamblaje..."
                  value={compName}
                  onChange={(e) => setCompName(e.target.value)}
                  className="mt-1.5 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="comp-est-min"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Tiempo estimado
                  </label>
                  <DurationInput
                    id="comp-est-min"
                    valueMinutes={Number(compEstimatedMinutes) || 0}
                    onChangeMinutes={(mins) => setCompEstimatedMinutes(String(mins))}
                    minMinutes={0}
                    maxMinutes={60000}
                    ariaLabel="Tiempo estimado de la pieza"
                    className="mt-1.5"
                  />
                </div>

                <div>
                  <label
                    htmlFor="comp-eff-min"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Tiempo efectivo actual
                  </label>
                  <DurationInput
                    id="comp-eff-min"
                    valueMinutes={Number(compEffectiveMinutes) || 0}
                    onChangeMinutes={(mins) => setCompEffectiveMinutes(String(mins))}
                    minMinutes={0}
                    maxMinutes={60000}
                    ariaLabel="Tiempo efectivo actual de la pieza"
                    className="mt-1.5"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="comp-status"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Estado de la pieza
                </label>
                <select
                  id="comp-status"
                  value={compStatus}
                  onChange={(e) =>
                    setCompStatus(e.target.value as ComponentStatus)
                  }
                  className="mt-1.5 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                >
                  {COMPONENT_STATUS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="comp-notes"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Notas de tejido
                </label>
                <input
                  id="comp-notes"
                  type="text"
                  placeholder="Puntos, vueltas o recordatorios..."
                  value={compNotes}
                  onChange={(e) => setCompNotes(e.target.value)}
                  className="mt-1.5 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                />
              </div>

              <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  disabled={compSaving}
                  onClick={() => setCompModalOpen(false)}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={compSaving}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-teal-700 px-5 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
                >
                  {compSaving ? 'Guardando...' : 'Guardar pieza'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirmación de eliminación de proyecto */}
      <ConfirmModal
        isOpen={Boolean(projectToDelete)}
        title="Eliminar proyecto"
        description={
          projectToDelete
            ? `¿Deseas eliminar el proyecto "${projectToDelete.name}" y todas sus piezas? Si el proyecto ya tiene movimientos de inventario o cobros registrados, el sistema impedirá borrarlo para proteger el historial.`
            : ''
        }
        confirmLabel="Sí, eliminar proyecto"
        variant="danger"
        isBusy={deletingProject}
        onConfirm={() => void handleConfirmDeleteProject()}
        onCancel={() => setProjectToDelete(null)}
      />

      {/* Confirmación de eliminación de pieza */}
      <ConfirmModal
        isOpen={Boolean(componentToDelete)}
        title="Eliminar pieza del proyecto"
        description={
          componentToDelete
            ? `¿Deseas eliminar la pieza "${componentToDelete.name}"?`
            : ''
        }
        confirmLabel="Sí, eliminar pieza"
        variant="danger"
        isBusy={deletingComponent}
        onConfirm={() => void handleConfirmDeleteComponent()}
        onCancel={() => setComponentToDelete(null)}
      />
    </div>
  );
};

import React, { useMemo, useRef, useState } from 'react';
import {
  Bell,
  Calendar,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Edit3,
  ExternalLink,
  Lock,
  Plus,
  RefreshCw,
  ShoppingBag,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import { useWorkshopData } from '@/src/data/DataContext.tsx';
import type {
  Reminder,
  ReminderRelatedEntityType,
  ReminderType,
  ScheduledTask,
  TaskStatus,
} from '@/src/domain/models/index.ts';
import {
  formatDateCO,
  formatDurationMinutes,
} from '@/src/domain/services/formatters.ts';
import {
  addDaysToDateKey,
  computeDayCapacity,
  evaluateTaskMaterialBlock,
  getWeekDateKeys,
  isOpenPendingMaterial,
  REMINDER_TYPE_META,
  resolveEffectiveTaskStatus,
  resolveSmartRemindersAndAlerts,
  TASK_STATUS_META,
  toLocalDateKey,
  type SmartAlertItem,
  type TaskBlockEvaluation,
} from '@/src/domain/services/planningService.ts';
import {
  canConfigureAdvancedReminders,
  canUseTaskMaterialDependency,
  STANDARD_REMINDER_LEAD_DAYS,
} from '@/src/domain/services/planCapabilities.ts';
import { ConfirmModal } from '@/src/shared/components/ConfirmModal.tsx';
import { DurationInput } from '@/src/shared/components/DurationInput.tsx';
import { EmptyState } from '@/src/shared/components/EmptyState.tsx';
import { FeatureGate } from '@/src/shared/components/FeatureGate.tsx';
import { InlineFeedbackAlert } from '@/src/shared/components/InlineFeedbackAlert.tsx';
import {
  SnapDeck,
  SnapSlide,
  type SnapDeckHandle,
} from '@/src/shared/components/SnapDeck.tsx';
import { StatusBadge } from '@/src/shared/components/StatusBadge.tsx';
import { useEscapeKey } from '@/src/shared/hooks/useEscapeKey.ts';
import {
  chunkIntoPages,
  pickPageSize,
  useViewportProfile,
} from '@/src/shared/hooks/useViewportPageSize.ts';

interface PlannerViewProps {
  onOpenProject?(projectId: string): void;
  onStartTimerForComponent?(projectId: string, componentId: string): void;
  onNavigateToShopping?(): void;
  onNavigateToInventory?(): void;
  onNavigateToClients?(): void;
}

type PlannerTab = 'overview' | 'tasks' | 'reminders';
type TaskScopeFilter = 'selected_day' | 'all_pending' | 'blocked_only';
type AlertFilter = 'active' | 'completed' | 'all';

interface EnrichedTask {
  readonly task: ScheduledTask;
  readonly evaluation: TaskBlockEvaluation;
  readonly effectiveStatus: TaskStatus;
  readonly projectName: string;
  readonly componentName: string | null;
}

const WEEKDAY_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MONTH_NAMES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

function formatDateKeyHeading(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map((n) => Number.parseInt(n, 10));
  if (!y || !m || !d) return dateKey;
  const date = new Date(y, m - 1, d, 12, 0, 0, 0);
  const weekday = WEEKDAY_SHORT[date.getDay()] ?? '';
  const month = MONTH_NAMES[m - 1] ?? '';
  return `${weekday} ${d} de ${month} de ${y}`;
}

function getShortDayNumber(dateKey: string): string {
  const parts = dateKey.split('-');
  return parts[2] ? String(Number.parseInt(parts[2], 10)) : dateKey;
}

function getShortWeekday(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map((n) => Number.parseInt(n, 10));
  if (!y || !m || !d) return '';
  const date = new Date(y, m - 1, d, 12, 0, 0, 0);
  return WEEKDAY_SHORT[date.getDay()] ?? '';
}

export const PlannerView: React.FC<PlannerViewProps> = ({
  onOpenProject,
  onStartTimerForComponent,
  onNavigateToShopping,
  onNavigateToInventory,
  onNavigateToClients,
}) => {
  const {
    settings,
    effectiveTier,
    projects,
    components,
    workSessions,
    materials,
    variants,
    pendingMaterials,
    paymentPlans,
    installments,
    clients,
    plannedTasks,
    reminders,
    stats,
    updateSettings,
    createPlannedTask,
    updatePlannedTask,
    deletePlannedTask,
    createReminder,
    updateReminder,
    deleteReminder,
  } = useWorkshopData();

  const canCustomizeReminders = canConfigureAdvancedReminders(effectiveTier);
  const canLinkNewMaterialDep = canUseTaskMaterialDependency(effectiveTier);

  const snapDeckRef = useRef<SnapDeckHandle | null>(null);
  const viewportProfile = useViewportProfile();

  const todayKey = useMemo(() => toLocalDateKey(new Date()), []);
  const [activeTab, setActiveTab] = useState<PlannerTab>('overview');
  const [selectedDateKey, setSelectedDateKey] = useState<string>(todayKey);
  const [taskScopeFilter, setTaskScopeFilter] =
    useState<TaskScopeFilter>('selected_day');
  const [alertFilter, setAlertFilter] = useState<AlertFilter>('active');

  const [feedback, setFeedback] = useState<{
    type: 'warning' | 'error';
    message: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  // Estado formulario de tareas
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTaskInitialPendingId, setEditingTaskInitialPendingId] = useState<string>('');
  const [taskProjectId, setTaskProjectId] = useState<string>(projects[0]?.id ?? '');
  const [taskComponentId, setTaskComponentId] = useState<string>('');
  const [taskPendingId, setTaskPendingId] = useState<string>('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDateKey, setTaskDateKey] = useState<string>(todayKey);
  const [taskMinutes, setTaskMinutes] = useState<number>(45);
  const [taskNotes, setTaskNotes] = useState('');

  // Estado formulario de recordatorios
  const [reminderFormOpen, setReminderFormOpen] = useState(false);
  const [editingReminderId, setEditingReminderId] = useState<string | null>(null);
  const [remType, setRemType] = useState<ReminderType>('delivery_deadline');
  const [remTitle, setRemTitle] = useState('');
  const [remMessage, setRemMessage] = useState('');
  const [remDateKey, setRemDateKey] = useState<string>(todayKey);
  const [remLeadDays, setRemLeadDays] = useState<string>('2');
  const [remRelatedProjectId, setRemRelatedProjectId] = useState<string>('');

  // Reglas configurables de recordatorios
  const [rulesPanelOpen, setRulesPanelOpen] = useState(false);
  const [leadDelivery, setLeadDelivery] = useState(
    String(settings.reminderLeadDaysDelivery ?? 3),
  );
  const [leadInstallment, setLeadInstallment] = useState(
    String(settings.reminderLeadDaysInstallment ?? 2),
  );
  const [leadPurchase, setLeadPurchase] = useState(
    String(settings.reminderLeadDaysPurchase ?? 1),
  );
  const [enableDelivery, setEnableDelivery] = useState(
    settings.enableDeliveryReminders !== false,
  );
  const [enableInstallment, setEnableInstallment] = useState(
    settings.enableInstallmentReminders !== false,
  );
  const [enablePurchase, setEnablePurchase] = useState(
    settings.enablePurchaseReminders !== false,
  );
  const [enableLowStock, setEnableLowStock] = useState(
    settings.enableLowStockReminders !== false,
  );

  // Confirmaciones de eliminación
  const [taskToDelete, setTaskToDelete] = useState<EnrichedTask | null>(null);
  const [reminderToDelete, setReminderToDelete] = useState<Reminder | null>(null);

  const hasOpenFormModal = Boolean(taskFormOpen || rulesPanelOpen || reminderFormOpen);

  useEscapeKey(
    hasOpenFormModal && !busy && !taskToDelete && !reminderToDelete,
    () => {
      setFeedback(null);
      if (taskFormOpen) {
        setTaskFormOpen(false);
      } else if (rulesPanelOpen) {
        setRulesPanelOpen(false);
      } else if (reminderFormOpen) {
        setReminderFormOpen(false);
      }
    },
  );

  const projectMap = useMemo(
    () => new Map(projects.map((p) => [p.id, p])),
    [projects],
  );
  const componentMap = useMemo(
    () => new Map(components.map((c) => [c.id, c])),
    [components],
  );
  const materialMap = useMemo(
    () => new Map(materials.map((m) => [m.id, m])),
    [materials],
  );
  const variantMap = useMemo(
    () => new Map(variants.map((v) => [v.id, v])),
    [variants],
  );

  // Enriquecer tareas con evaluación dinámica de bloqueo por materiales
  const enrichedTasks = useMemo<EnrichedTask[]>(() => {
    return plannedTasks
      .map((task) => {
        const evaluation = evaluateTaskMaterialBlock({
          projectId: task.projectId,
          componentId: task.componentId,
          dependsOnPendingMaterialId: task.dependsOnPendingMaterialId,
          components,
          pendingMaterials,
          materials,
          variants,
        });
        const effectiveStatus = resolveEffectiveTaskStatus(task, evaluation);
        const project = projectMap.get(task.projectId);
        const component = task.componentId
          ? componentMap.get(task.componentId)
          : undefined;
        return {
          task,
          evaluation,
          effectiveStatus,
          projectName: project?.name ?? 'Proyecto',
          componentName: component?.name ?? null,
        };
      })
      .sort((a, b) => {
        const statusOrder: Record<TaskStatus, number> = {
          blocked_by_material: 0,
          scheduled: 1,
          rescheduled: 2,
          completed: 3,
        };
        if (statusOrder[a.effectiveStatus] !== statusOrder[b.effectiveStatus]) {
          return statusOrder[a.effectiveStatus] - statusOrder[b.effectiveStatus];
        }
        return a.task.scheduledDate.localeCompare(b.task.scheduledDate);
      });
  }, [
    plannedTasks,
    components,
    pendingMaterials,
    materials,
    variants,
    projectMap,
    componentMap,
  ]);

  const weekDateKeys = useMemo(
    () => getWeekDateKeys(selectedDateKey),
    [selectedDateKey],
  );

  const selectedDayCapacity = useMemo(
    () =>
      computeDayCapacity({
        dateKey: selectedDateKey,
        dailyGoalMinutes: settings.dailyGoalMinutes,
        tasks: enrichedTasks.map((e) => ({
          task: e.task,
          effectiveStatus: e.effectiveStatus,
        })),
        workSessions,
      }),
    [selectedDateKey, settings.dailyGoalMinutes, enrichedTasks, workSessions],
  );

  const todayCapacity = useMemo(
    () =>
      computeDayCapacity({
        dateKey: todayKey,
        dailyGoalMinutes: settings.dailyGoalMinutes,
        tasks: enrichedTasks.map((e) => ({
          task: e.task,
          effectiveStatus: e.effectiveStatus,
        })),
        workSessions,
      }),
    [todayKey, settings.dailyGoalMinutes, enrichedTasks, workSessions],
  );

  const effectiveReminderSettings = useMemo(
    () =>
      canCustomizeReminders
        ? settings
        : {
            ...settings,
            reminderLeadDaysDelivery: STANDARD_REMINDER_LEAD_DAYS.delivery,
            reminderLeadDaysInstallment: STANDARD_REMINDER_LEAD_DAYS.installment,
            reminderLeadDaysPurchase: STANDARD_REMINDER_LEAD_DAYS.purchase,
            enableDeliveryReminders: true,
            enableInstallmentReminders: true,
            enablePurchaseReminders: true,
            enableLowStockReminders: true,
          },
    [canCustomizeReminders, settings],
  );

  const smartAlerts = useMemo(
    () =>
      resolveSmartRemindersAndAlerts({
        settings: effectiveReminderSettings,
        reminders,
        projects,
        components,
        workSessions,
        pendingMaterials,
        materials,
        variants,
        paymentPlans,
        installments,
        clients,
      }),
    [
      effectiveReminderSettings,
      reminders,
      projects,
      components,
      workSessions,
      pendingMaterials,
      materials,
      variants,
      paymentPlans,
      installments,
      clients,
    ],
  );

  const filteredTasks = useMemo(() => {
    if (taskScopeFilter === 'selected_day') {
      return enrichedTasks.filter(
        (e) => toLocalDateKey(e.task.scheduledDate) === selectedDateKey,
      );
    }
    if (taskScopeFilter === 'blocked_only') {
      return enrichedTasks.filter(
        (e) => e.effectiveStatus === 'blocked_by_material',
      );
    }
    return enrichedTasks.filter((e) => e.effectiveStatus !== 'completed');
  }, [enrichedTasks, taskScopeFilter, selectedDateKey]);

  const filteredAlerts = useMemo(() => {
    if (alertFilter === 'active') {
      return smartAlerts.filter((a) => !a.isCompleted);
    }
    if (alertFilter === 'completed') {
      return smartAlerts.filter((a) => a.isCompleted);
    }
    return smartAlerts;
  }, [smartAlerts, alertFilter]);

  const taskPageSize = pickPageSize(viewportProfile, {
    mobileCompact: 1,
    mobileRegular: 1,
    tablet: 2,
    desktopCompact: 2,
    desktopRegular: 3,
    desktopTall: 3,
  });

  const alertPageSize = pickPageSize(viewportProfile, {
    mobileCompact: 2,
    mobileRegular: 2,
    tablet: 3,
    desktopCompact: 3,
    desktopRegular: 4,
    desktopTall: 5,
  });

  const taskPages = useMemo(
    () => chunkIntoPages(filteredTasks, taskPageSize),
    [filteredTasks, taskPageSize],
  );

  const alertPages = useMemo(
    () => chunkIntoPages(filteredAlerts, alertPageSize),
    [filteredAlerts, alertPageSize],
  );

  const handleTabJump = (tab: PlannerTab) => {
    setActiveTab(tab);
    if (tab === 'overview') {
      snapDeckRef.current?.goToSlide('plan-overview');
    } else if (tab === 'tasks') {
      snapDeckRef.current?.goToSlide('plan-tasks-0');
    } else {
      snapDeckRef.current?.goToSlide('plan-reminders-0');
    }
  };

  const handleSlideChange = (slideId: string) => {
    if (slideId.startsWith('plan-tasks')) {
      setActiveTab('tasks');
    } else if (slideId.startsWith('plan-reminders')) {
      setActiveTab('reminders');
    } else {
      setActiveTab('overview');
    }
  };

  // Componentes y materiales pendientes disponibles para el formulario de tarea
  const formProjectComponents = useMemo(() => {
    return components
      .filter((c) => c.projectId === taskProjectId)
      .sort((a, b) => a.orderIndex - b.orderIndex);
  }, [components, taskProjectId]);

  const formOpenPendings = useMemo(() => {
    return pendingMaterials.filter(
      (pm) => pm.projectId === taskProjectId && isOpenPendingMaterial(pm),
    );
  }, [pendingMaterials, taskProjectId]);

  const formBlockPreview = useMemo(() => {
    if (!taskProjectId) return null;
    return evaluateTaskMaterialBlock({
      projectId: taskProjectId,
      componentId: taskComponentId || null,
      dependsOnPendingMaterialId: taskPendingId || null,
      components,
      pendingMaterials,
      materials,
      variants,
    });
  }, [
    taskProjectId,
    taskComponentId,
    taskPendingId,
    components,
    pendingMaterials,
    materials,
    variants,
  ]);

  const openNewTaskForm = () => {
    const defaultProjId =
      projects.find((p) => p.status === 'in_progress')?.id ??
      projects[0]?.id ??
      '';
    setEditingTaskId(null);
    setEditingTaskInitialPendingId('');
    setTaskProjectId(defaultProjId);
    setTaskComponentId('');
    setTaskPendingId('');
    setTaskTitle('');
    setTaskDateKey(selectedDateKey);
    setTaskMinutes(45);
    setTaskNotes('');
    setTaskFormOpen(true);
    setFeedback(null);
  };

  const openEditTaskForm = (entry: EnrichedTask) => {
    setEditingTaskId(entry.task.id);
    setEditingTaskInitialPendingId(entry.task.dependsOnPendingMaterialId ?? '');
    setTaskProjectId(entry.task.projectId);
    setTaskComponentId(entry.task.componentId ?? '');
    setTaskPendingId(entry.task.dependsOnPendingMaterialId ?? '');
    setTaskTitle(entry.task.title);
    setTaskDateKey(toLocalDateKey(entry.task.scheduledDate) || selectedDateKey);
    setTaskMinutes(entry.task.allocatedMinutes);
    setTaskNotes(entry.task.notes);
    setTaskFormOpen(true);
    setFeedback(null);
  };

  const handleSaveTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskProjectId) {
      setFeedback({
        type: 'error',
        message: 'Debes seleccionar un proyecto para agendar la tarea.',
      });
      return;
    }

    const canKeepExistingPending =
      Boolean(editingTaskId) &&
      Boolean(editingTaskInitialPendingId) &&
      (taskPendingId === '' || taskPendingId === editingTaskInitialPendingId);
    const resolvedPendingId =
      canLinkNewMaterialDep || canKeepExistingPending
        ? taskPendingId || null
        : null;

    setBusy(true);
    setFeedback(null);
    try {
      if (editingTaskId) {
        const updated = await updatePlannedTask(editingTaskId, {
          projectId: taskProjectId,
          componentId: taskComponentId || null,
          dependsOnPendingMaterialId: resolvedPendingId,
          title: taskTitle,
          scheduledDate: taskDateKey,
          allocatedMinutes: taskMinutes,
          notes: taskNotes,
        });
        if (updated.status === 'blocked_by_material') {
          setFeedback({
            type: 'warning',
            message:
              'La tarea permanece bloqueada preventivamente por material pendiente.',
          });
        }
      } else {
        const created = await createPlannedTask({
          projectId: taskProjectId,
          componentId: taskComponentId || null,
          dependsOnPendingMaterialId: resolvedPendingId,
          title: taskTitle,
          scheduledDate: taskDateKey,
          allocatedMinutes: taskMinutes,
          notes: taskNotes,
        });
        setSelectedDateKey(taskDateKey);
        if (created.status === 'blocked_by_material') {
          setFeedback({
            type: 'warning',
            message:
              'Tarea agendada con bloqueo preventivo: espera llegada de insumos.',
          });
        }
      }
      setTaskFormOpen(false);
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'No se pudo guardar la tarea.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleCompleteTask = async (entry: EnrichedTask) => {
    if (entry.effectiveStatus === 'blocked_by_material') {
      setFeedback({
        type: 'error',
        message: `Bloqueo preventivo activo: ${entry.evaluation.reasons.join(' ')}`,
      });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const nextStatus: TaskStatus =
        entry.effectiveStatus === 'completed' ? 'scheduled' : 'completed';
      await updatePlannedTask(entry.task.id, {
        status: nextStatus,
        completedMinutes:
          nextStatus === 'completed' ? entry.task.allocatedMinutes : 0,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'No se pudo actualizar la tarea.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleRescheduleTask = async (entry: EnrichedTask, deltaDays: number) => {
    const currentKey = toLocalDateKey(entry.task.scheduledDate) || todayKey;
    const nextKey = addDaysToDateKey(currentKey, deltaDays);
    setBusy(true);
    setFeedback(null);
    try {
      await updatePlannedTask(entry.task.id, {
        scheduledDate: nextKey,
        status:
          entry.effectiveStatus === 'blocked_by_material'
            ? 'blocked_by_material'
            : 'scheduled',
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'No se pudo reprogramar la tarea.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmDeleteTask = async () => {
    if (!taskToDelete) return;
    setBusy(true);
    setFeedback(null);
    try {
      await deletePlannedTask(taskToDelete.task.id);
      setTaskToDelete(null);
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'No se pudo eliminar la tarea.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSaveReminderRules = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCustomizeReminders) {
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      await updateSettings({
        reminderLeadDaysDelivery: Math.max(0, Number(leadDelivery) || 0),
        reminderLeadDaysInstallment: Math.max(0, Number(leadInstallment) || 0),
        reminderLeadDaysPurchase: Math.max(0, Number(leadPurchase) || 0),
        enableDeliveryReminders: enableDelivery,
        enableInstallmentReminders: enableInstallment,
        enablePurchaseReminders: enablePurchase,
        enableLowStockReminders: enableLowStock,
      });
      setRulesPanelOpen(false);
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Error guardando preferencias.',
      });
    } finally {
      setBusy(false);
    }
  };

  const openNewReminderForm = () => {
    setEditingReminderId(null);
    setRemType('delivery_deadline');
    setRemTitle('');
    setRemMessage('');
    setRemDateKey(selectedDateKey);
    setRemLeadDays('2');
    setRemRelatedProjectId('');
    setReminderFormOpen(true);
    setFeedback(null);
  };

  const openEditReminderForm = (rem: Reminder) => {
    setEditingReminderId(rem.id);
    setRemType(rem.type);
    setRemTitle(rem.title);
    setRemMessage(rem.message);
    setRemDateKey(toLocalDateKey(rem.triggerAt) || todayKey);
    setRemLeadDays(String(rem.leadDays ?? 0));
    setRemRelatedProjectId(
      rem.relatedEntityType === 'project' && rem.relatedEntityId
        ? rem.relatedEntityId
        : '',
    );
    setReminderFormOpen(true);
    setFeedback(null);
  };

  const handleSaveReminder = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      const selectedProj = remRelatedProjectId
        ? projectMap.get(remRelatedProjectId)
        : undefined;
      if (editingReminderId) {
        await updateReminder(editingReminderId, {
          type: remType,
          title: remTitle,
          message: remMessage,
          triggerAt: remDateKey,
          leadDays: Math.max(0, Number(remLeadDays) || 0),
        });
      } else {
        await createReminder({
          type: remType,
          title: remTitle,
          message: remMessage,
          triggerAt: remDateKey,
          relatedEntityId: selectedProj?.id ?? null,
          relatedEntityType: selectedProj ? 'project' : null,
          leadDays: Math.max(0, Number(remLeadDays) || 0),
          isDemo: Boolean(selectedProj?.isDemo),
        });
      }
      setReminderFormOpen(false);
    } catch (err) {
      setFeedback({
        type: 'error',
        message:
          err instanceof Error ? err.message : 'No se pudo guardar el recordatorio.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleToggleAlertCompleted = async (alert: SmartAlertItem) => {
    setBusy(true);
    setFeedback(null);
    try {
      if (alert.reminderId) {
        await updateReminder(alert.reminderId, {
          isCompleted: !alert.isCompleted,
          isRead: true,
        });
      } else {
        const created = await createReminder({
          type: alert.type,
          title: alert.title,
          message: alert.message,
          triggerAt: alert.dueDate,
          relatedEntityId: alert.relatedEntityId,
          relatedEntityType: alert.relatedEntityType,
          isDemo: alert.isDemo,
        });
        await updateReminder(created.id, { isCompleted: true, isRead: true });
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        message:
          err instanceof Error ? err.message : 'No se pudo actualizar el recordatorio.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSnoozeAlert = async (alert: SmartAlertItem, days: number) => {
    const baseKey = toLocalDateKey(alert.triggerAt) || todayKey;
    const nextDateKey = addDaysToDateKey(
      baseKey < todayKey ? todayKey : baseKey,
      days,
    );
    setBusy(true);
    setFeedback(null);
    try {
      if (alert.reminderId) {
        await updateReminder(alert.reminderId, {
          snoozedUntil: nextDateKey,
          isRead: true,
        });
      } else {
        const created = await createReminder({
          type: alert.type,
          title: alert.title,
          message: alert.message,
          triggerAt: alert.dueDate,
          relatedEntityId: alert.relatedEntityId,
          relatedEntityType: alert.relatedEntityType,
          isDemo: alert.isDemo,
        });
        await updateReminder(created.id, {
          snoozedUntil: nextDateKey,
          isRead: true,
        });
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        message:
          err instanceof Error ? err.message : 'No se pudo posponer el recordatorio.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmDeleteReminder = async () => {
    if (!reminderToDelete) return;
    setBusy(true);
    setFeedback(null);
    try {
      await deleteReminder(reminderToDelete.id);
      setReminderToDelete(null);
    } catch (err) {
      setFeedback({
        type: 'error',
        message:
          err instanceof Error ? err.message : 'No se pudo eliminar el recordatorio.',
      });
    } finally {
      setBusy(false);
    }
  };

  const openRelatedEntity = (
    entityType: ReminderRelatedEntityType | null,
    entityId: string | null,
  ) => {
    if (!entityId) return;
    if (entityType === 'project' && onOpenProject) {
      onOpenProject(entityId);
    } else if (
      (entityType === 'installment' || entityType === 'client') &&
      onNavigateToClients
    ) {
      onNavigateToClients();
    } else if (entityType === 'pending_material' && onNavigateToShopping) {
      onNavigateToShopping();
    } else if (entityType === 'variant' && onNavigateToInventory) {
      onNavigateToInventory();
    }
  };

  const topSlot = (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div
          className="grid w-full grid-cols-3 gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 sm:inline-flex sm:w-auto sm:items-center"
          role="tablist"
          aria-label="Vistas de planificación"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'overview'}
            onClick={() => handleTabJump('overview')}
            className={`inline-flex min-h-[36px] items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors whitespace-nowrap sm:px-3 ${
              activeTab === 'overview'
                ? 'bg-teal-700 text-white'
                : 'text-slate-600 hover:bg-white hover:text-slate-900'
            }`}
          >
            <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>Agenda</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'tasks'}
            onClick={() => handleTabJump('tasks')}
            className={`inline-flex min-h-[36px] items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors whitespace-nowrap sm:px-3 ${
              activeTab === 'tasks'
                ? 'bg-teal-700 text-white'
                : 'text-slate-600 hover:bg-white hover:text-slate-900'
            }`}
          >
            <Calendar className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>Tareas ({filteredTasks.length})</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'reminders'}
            onClick={() => handleTabJump('reminders')}
            className={`inline-flex min-h-[36px] items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors whitespace-nowrap sm:px-3 ${
              activeTab === 'reminders'
                ? 'bg-teal-700 text-white'
                : 'text-slate-600 hover:bg-white hover:text-slate-900'
            }`}
          >
            <Bell className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>Alertas ({stats.activeRemindersCount})</span>
          </button>
        </div>

        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:items-center shrink-0">
          <button
            type="button"
            onClick={openNewTaskForm}
            disabled={projects.length === 0}
            className="inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-teal-800 disabled:opacity-50 whitespace-nowrap"
          >
            <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>Agendar tarea</span>
          </button>
          <button
            type="button"
            onClick={openNewReminderForm}
            className="inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap"
          >
            <Bell className="h-3.5 w-3.5 shrink-0 text-teal-700" aria-hidden="true" />
            <span className="sm:hidden">Nueva alerta</span>
            <span className="hidden sm:inline">Nuevo recordatorio</span>
          </button>
        </div>
      </div>

      <InlineFeedbackAlert
        feedback={!hasOpenFormModal ? feedback : null}
        onDismiss={() => setFeedback(null)}
      />
    </div>
  );

  const renderTaskScopeControls = () => (
    <div className="flex flex-wrap gap-1.5">
      {(
        [
          ['selected_day', 'Día seleccionado'],
          ['all_pending', 'Todas pendientes'],
          ['blocked_only', `Bloqueadas (${stats.blockedTasksCount})`],
        ] as const
      ).map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => setTaskScopeFilter(key)}
          className={`min-h-[36px] rounded-lg px-3 py-1 text-xs font-semibold transition-colors ${
            taskScopeFilter === key
              ? 'bg-teal-700 text-white'
              : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );

  const renderAlertFilterControls = () => (
    <div className="flex flex-wrap items-center gap-1.5">
      {(
        [
          ['active', 'Activos'],
          ['completed', 'Atendidos'],
          ['all', 'Todos'],
        ] as const
      ).map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => setAlertFilter(key)}
          className={`min-h-[36px] rounded-lg px-3 py-1 text-xs font-semibold transition-colors ${
            alertFilter === key
              ? 'bg-teal-700 text-white'
              : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          {label}
        </button>
      ))}
      <button
        type="button"
        onClick={() => {
          setFeedback(null);
          setRulesPanelOpen(true);
        }}
        className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
      >
        <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
        <span>Anticipación</span>
      </button>
    </div>
  );

  return (
    <>
      <SnapDeck
        ref={snapDeckRef}
        onSlideChange={handleSlideChange}
        ariaLabel="Planificación y Agenda"
        topSlot={topSlot}
      >
        {/* VISTA 1: RESUMEN, TIRA SEMANAL Y CAPACIDAD */}
        <SnapSlide id="plan-overview" label="Agenda y semana">
          <div className="space-y-3 sm:space-y-4">
            <section aria-label="Resumen de planificación">
              <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
                <div className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
                  <p className="text-[11px] font-medium text-slate-500 sm:text-xs">
                    Planificado hoy / meta
                  </p>
                  <p className="mt-1 font-mono text-lg font-semibold text-slate-900 tabular-nums sm:text-2xl">
                    {formatDurationMinutes(todayCapacity.plannedMinutes)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-500 tabular-nums sm:text-xs">
                    Meta: {formatDurationMinutes(settings.dailyGoalMinutes)} · Trabajado:{' '}
                    {formatDurationMinutes(stats.todayEffectiveMinutes)}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => handleTabJump('tasks')}
                  className="rounded-xl border border-slate-200 bg-white p-3 text-left transition-colors hover:border-teal-300 hover:bg-teal-50/20 sm:p-4"
                >
                  <p className="text-[11px] font-medium text-slate-500 sm:text-xs">
                    Tareas activas
                  </p>
                  <p className="mt-1 font-mono text-lg font-semibold text-slate-900 tabular-nums sm:text-2xl">
                    {stats.pendingTasksCount}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-500 sm:text-xs">
                    Listas con insumo disponible
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setTaskScopeFilter('blocked_only');
                    handleTabJump('tasks');
                  }}
                  className={`rounded-xl border p-3 text-left transition-colors sm:p-4 ${
                    stats.blockedTasksCount > 0
                      ? 'border-amber-200 bg-amber-50/50 hover:border-amber-300'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <p className="text-[11px] font-medium text-slate-600 sm:text-xs">
                    Bloqueadas por insumo
                  </p>
                  <p
                    className={`mt-1 font-mono text-lg font-semibold tabular-nums sm:text-2xl ${
                      stats.blockedTasksCount > 0 ? 'text-amber-800' : 'text-slate-900'
                    }`}
                  >
                    {stats.blockedTasksCount}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-500 sm:text-xs">
                    Se desbloquean al recibir
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => handleTabJump('reminders')}
                  className="rounded-xl border border-slate-200 bg-white p-3 text-left transition-colors hover:border-teal-300 hover:bg-teal-50/20 sm:p-4"
                >
                  <p className="text-[11px] font-medium text-slate-500 sm:text-xs">
                    Recordatorios activos
                  </p>
                  <p className="mt-1 font-mono text-lg font-semibold text-teal-800 tabular-nums sm:text-2xl">
                    {stats.activeRemindersCount}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-500 sm:text-xs">
                    Entregas, cuotas y stock
                  </p>
                </button>
              </div>
            </section>

            {/* Selector de semana y fecha */}
            <section className="rounded-xl border border-slate-200 bg-white p-3.5 sm:p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedDateKey(addDaysToDateKey(selectedDateKey, -7))}
                    aria-label="Semana anterior"
                    className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedDateKey(todayKey)}
                    className="inline-flex min-h-[40px] items-center rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Hoy
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedDateKey(addDaysToDateKey(selectedDateKey, 7))}
                    aria-label="Semana siguiente"
                    className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                  <span className="ml-1 font-display text-xs font-semibold text-slate-900 sm:text-base">
                    {formatDateKeyHeading(selectedDateKey)}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <label htmlFor="planner-date-jump" className="text-xs font-medium text-slate-500">
                    Fecha:
                  </label>
                  <input
                    id="planner-date-jump"
                    type="date"
                    value={selectedDateKey}
                    onChange={(e) => {
                      if (e.target.value) setSelectedDateKey(e.target.value);
                    }}
                    className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-2 font-mono text-xs text-slate-800 focus:border-teal-700 focus:outline-none"
                  />
                </div>
              </div>

              {/* Tira semanal de 7 días */}
              <div className="grid grid-cols-7 gap-1 sm:gap-2">
                {weekDateKeys.map((dayKey) => {
                  const isSelected = dayKey === selectedDateKey;
                  const isToday = dayKey === todayKey;
                  const dayCap = computeDayCapacity({
                    dateKey: dayKey,
                    dailyGoalMinutes: settings.dailyGoalMinutes,
                    tasks: enrichedTasks.map((e) => ({
                      task: e.task,
                      effectiveStatus: e.effectiveStatus,
                    })),
                    workSessions,
                  });
                  const dayAlertsCount = smartAlerts.filter(
                    (a) => !a.isCompleted && toLocalDateKey(a.dueDate) === dayKey,
                  ).length;

                  return (
                    <button
                      key={dayKey}
                      type="button"
                      onClick={() => {
                        setSelectedDateKey(dayKey);
                        setTaskScopeFilter('selected_day');
                      }}
                      className={`flex min-h-[68px] flex-col items-center justify-between rounded-xl border p-1.5 transition-colors sm:min-h-[76px] sm:p-2 ${
                        isSelected
                          ? 'border-teal-700 bg-teal-700 text-white shadow-xs'
                          : isToday
                            ? 'border-teal-300 bg-teal-50/50 text-slate-900 hover:bg-teal-50'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <span
                        className={`text-[10px] font-medium sm:text-[11px] ${
                          isSelected ? 'text-white/90' : 'text-slate-500'
                        }`}
                      >
                        {getShortWeekday(dayKey)}
                      </span>
                      <span className="font-mono text-sm font-bold tabular-nums sm:text-base">
                        {getShortDayNumber(dayKey)}
                      </span>
                      <div className="flex items-center gap-1">
                        {dayCap.totalTasksCount > 0 && (
                          <span
                            className={`font-mono text-[10px] font-semibold tabular-nums ${
                              isSelected
                                ? 'text-white'
                                : dayCap.blockedTasksCount > 0
                                  ? 'text-amber-700'
                                  : 'text-teal-700'
                            }`}
                          >
                            {dayCap.totalTasksCount}t
                          </span>
                        )}
                        {dayAlertsCount > 0 && (
                          <span
                            title={`${dayAlertsCount} vencimiento(s)`}
                            className={`h-1.5 w-1.5 rounded-full ${
                              isSelected ? 'bg-amber-300' : 'bg-amber-500'
                            }`}
                          />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Barra de capacidad del día */}
              <div className="rounded-lg border border-slate-100 bg-slate-50/80 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-slate-800">
                    Capacidad ({formatDateCO(selectedDateKey)})
                  </span>
                  <span className="font-mono text-slate-700 tabular-nums">
                    Plan: <strong>{formatDurationMinutes(selectedDayCapacity.plannedMinutes)}</strong> /{' '}
                    {formatDurationMinutes(selectedDayCapacity.dailyGoalMinutes)} · Trab:{' '}
                    {formatDurationMinutes(selectedDayCapacity.workedMinutes)}
                  </span>
                </div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200">
                  <div
                    className={`h-full rounded-full transition-all ${
                      selectedDayCapacity.overloadMinutes > 0
                        ? 'bg-amber-500'
                        : 'bg-teal-700'
                    }`}
                    style={{
                      width: `${Math.min(100, selectedDayCapacity.utilizationPercent)}%`,
                    }}
                  />
                </div>
                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                  {selectedDayCapacity.overloadMinutes > 0 ? (
                    <p className="text-xs font-medium text-amber-800">
                      Sobrecarga de {formatDurationMinutes(selectedDayCapacity.overloadMinutes)} sobre tu meta diaria.
                    </p>
                  ) : (
                    <p className="text-xs text-slate-500">
                      Espacio libre: {formatDurationMinutes(selectedDayCapacity.remainingGoalMinutes)}.
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => handleTabJump('tasks')}
                    className="text-xs font-semibold text-teal-800 hover:underline"
                  >
                    Ver tareas ({selectedDayCapacity.totalTasksCount}) →
                  </button>
                </div>
              </div>
            </section>
          </div>
        </SnapSlide>

        {/* VISTAS DE TAREAS PAGINADAS */}
        {taskPages.length === 0 ? (
          <SnapSlide id="plan-tasks-0" label="Tareas">
            <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                <div>
                  <h3 className="font-display text-base font-semibold text-slate-900">
                    {taskScopeFilter === 'selected_day'
                      ? `Tareas del ${formatDateCO(selectedDateKey)}`
                      : taskScopeFilter === 'blocked_only'
                        ? 'Tareas bloqueadas por falta de material'
                        : 'Todas las tareas pendientes'}
                  </h3>
                  <p className="text-xs text-slate-500">
                    El bloqueo preventivo impide trabajar piezas cuyo material aún no ha llegado.
                  </p>
                </div>
                {renderTaskScopeControls()}
              </div>

              {projects.length === 0 ? (
                <EmptyState
                  icon={CalendarDays}
                  title="Crea o carga un proyecto para empezar a planificar"
                  description="Cuando tengas proyectos y piezas activas podrás agendar bloques de trabajo, verificar disponibilidad de materiales y recibir recordatorios automáticos."
                />
              ) : (
                <EmptyState
                  icon={Calendar}
                  title={
                    taskScopeFilter === 'blocked_only'
                      ? 'No tienes tareas bloqueadas por insumos'
                      : 'No hay tareas agendadas en esta vista'
                  }
                  description={
                    taskScopeFilter === 'selected_day'
                      ? `Agenda un bloque de trabajo para ${formatDateCO(selectedDateKey)} vinculado a una pieza del taller.`
                      : 'Todas las tareas de este filtro están al día o aún no se han programado.'
                  }
                  primaryAction={
                    taskScopeFilter !== 'blocked_only'
                      ? {
                          label: 'Agendar tarea',
                          onClick: openNewTaskForm,
                        }
                      : undefined
                  }
                />
              )}
            </section>
          </SnapSlide>
        ) : (
          taskPages.map((pageTasks, pageIdx) => (
            <SnapSlide
              key={`plan-tasks-${pageIdx}`}
              id={`plan-tasks-${pageIdx}`}
              label={
                taskPages.length > 1
                  ? `Tareas (${pageIdx + 1}/${taskPages.length})`
                  : 'Tareas'
              }
            >
              <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                  <div>
                    <h3 className="font-display text-sm font-semibold text-slate-900 sm:text-base">
                      {taskScopeFilter === 'selected_day'
                        ? `Tareas del ${formatDateCO(selectedDateKey)}`
                        : taskScopeFilter === 'blocked_only'
                          ? 'Tareas bloqueadas por material'
                          : 'Todas las tareas pendientes'}
                      {taskPages.length > 1 && (
                        <span className="ml-2 font-mono text-xs font-normal text-slate-500">
                          · Pág. {pageIdx + 1}/{taskPages.length}
                        </span>
                      )}
                    </h3>
                  </div>
                  {renderTaskScopeControls()}
                </div>

                <div className="divide-y divide-slate-100">
                  {pageTasks.map((entry) => {
                    const { task, evaluation, effectiveStatus } = entry;
                    const meta = TASK_STATUS_META[effectiveStatus];
                    const isBlocked = effectiveStatus === 'blocked_by_material';
                    const isCompleted = effectiveStatus === 'completed';

                    return (
                      <article
                        key={task.id}
                        className={`py-3 first:pt-1 last:pb-0 ${
                          isBlocked
                            ? 'my-1.5 rounded-xl border border-amber-200/80 bg-amber-50/35 px-3'
                            : ''
                        }`}
                      >
                        <div className="flex flex-col gap-2.5 md:flex-row md:items-start md:justify-between">
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <StatusBadge label={meta.label} tone={meta.tone} />
                              <span className="font-mono text-xs font-medium text-slate-600 tabular-nums">
                                {formatDateCO(task.scheduledDate)} ·{' '}
                                {formatDurationMinutes(task.allocatedMinutes)}
                              </span>
                              {task.isDemo && (
                                <span className="text-xs font-medium text-slate-400">
                                  · Ejemplo
                                </span>
                              )}
                            </div>

                            <h4
                              className={`font-display text-sm font-semibold sm:text-base ${
                                isCompleted
                                  ? 'text-slate-500 line-through'
                                  : 'text-slate-900'
                              }`}
                            >
                              {task.title}
                            </h4>

                            <p className="text-xs text-slate-600">
                              <button
                                type="button"
                                onClick={() => onOpenProject?.(task.projectId)}
                                className="font-semibold text-teal-800 hover:underline"
                              >
                                {entry.projectName}
                              </button>
                              {entry.componentName && (
                                <span> · Pieza: {entry.componentName}</span>
                              )}
                            </p>

                            {task.notes && (
                              <p className="text-xs leading-relaxed text-slate-600">
                                {task.notes}
                              </p>
                            )}

                            {isBlocked && (
                              <div className="mt-1.5 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-950">
                                <div className="flex items-start gap-2">
                                  <Lock
                                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-800"
                                    aria-hidden="true"
                                  />
                                  <div className="space-y-1">
                                    <p className="font-semibold">
                                      Bloqueo preventivo: falta material
                                    </p>
                                    <ul className="list-disc space-y-0.5 pl-4">
                                      {evaluation.reasons.map((reason, idx) => (
                                        <li key={idx}>{reason}</li>
                                      ))}
                                    </ul>
                                    {onNavigateToShopping && (
                                      <button
                                        type="button"
                                        onClick={onNavigateToShopping}
                                        className="mt-0.5 inline-flex items-center gap-1 font-semibold text-teal-800 hover:underline"
                                      >
                                        <ShoppingBag className="h-3.5 w-3.5" aria-hidden="true" />
                                        <span>Registrar llegada en Compras</span>
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Acciones de tarea */}
                          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                            {task.componentId &&
                              onStartTimerForComponent &&
                              !isCompleted && (
                                <button
                                  type="button"
                                  disabled={isBlocked || busy}
                                  title={
                                    isBlocked
                                      ? 'Bloqueada hasta recibir el material pendiente'
                                      : 'Iniciar cronómetro en esta pieza'
                                  }
                                  onClick={() =>
                                    onStartTimerForComponent(
                                      task.projectId,
                                      task.componentId!,
                                    )
                                  }
                                  className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                                >
                                  {isBlocked ? (
                                    <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                                  ) : (
                                    <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                                  )}
                                  <span>{isBlocked ? 'Bloqueada' : 'Tejer ahora'}</span>
                                </button>
                              )}

                            <button
                              type="button"
                              disabled={busy || (isBlocked && !isCompleted)}
                              title={
                                isBlocked
                                  ? 'No puedes completar una tarea bloqueada por material'
                                  : undefined
                              }
                              onClick={() => void handleCompleteTask(entry)}
                              className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                                isCompleted
                                  ? 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                                  : 'border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100'
                              }`}
                            >
                              <Check className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>{isCompleted ? 'Reabrir' : 'Completar'}</span>
                            </button>

                            {!isCompleted && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void handleRescheduleTask(entry, 1)}
                                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                              >
                                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                                <span>+1 día</span>
                              </button>
                            )}

                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => openEditTaskForm(entry)}
                              aria-label="Editar tarea"
                              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                            >
                              <Edit3 className="h-4 w-4" />
                            </button>

                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => setTaskToDelete(entry)}
                              aria-label="Eliminar tarea"
                              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-rose-700 hover:bg-rose-50"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            </SnapSlide>
          ))
        )}

        {/* VISTAS DE RECORDATORIOS Y ALERTAS PAGINADAS */}
        {alertPages.length === 0 ? (
          <SnapSlide id="plan-reminders-0" label="Recordatorios">
            <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                <div>
                  <h3 className="font-display text-base font-semibold text-slate-900">
                    Centro de recordatorios y alertas
                  </h3>
                  <p className="text-xs text-slate-500">
                    Entregas ({effectiveReminderSettings.reminderLeadDaysDelivery ?? STANDARD_REMINDER_LEAD_DAYS.delivery}d), cuotas ({effectiveReminderSettings.reminderLeadDaysInstallment ?? STANDARD_REMINDER_LEAD_DAYS.installment}d) y compras ({effectiveReminderSettings.reminderLeadDaysPurchase ?? STANDARD_REMINDER_LEAD_DAYS.purchase}d).
                  </p>
                </div>
                {renderAlertFilterControls()}
              </div>

              <EmptyState
                icon={Bell}
                title="No hay recordatorios en esta vista"
                description="Cuando existan entregas próximas, cuotas por vencer, compras en camino, stock mínimo o recordatorios propios aparecerán aquí."
                primaryAction={{
                  label: 'Nuevo recordatorio',
                  onClick: openNewReminderForm,
                }}
              />
            </section>
          </SnapSlide>
        ) : (
          alertPages.map((pageAlerts, pageIdx) => (
            <SnapSlide
              key={`plan-reminders-${pageIdx}`}
              id={`plan-reminders-${pageIdx}`}
              label={
                alertPages.length > 1
                  ? `Alertas (${pageIdx + 1}/${alertPages.length})`
                  : 'Recordatorios'
              }
            >
              <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                  <div>
                    <h3 className="font-display text-sm font-semibold text-slate-900 sm:text-base">
                      Recordatorios y alertas
                      {alertPages.length > 1 && (
                        <span className="ml-2 font-mono text-xs font-normal text-slate-500">
                          · Pág. {pageIdx + 1}/{alertPages.length}
                        </span>
                      )}
                    </h3>
                  </div>
                  {renderAlertFilterControls()}
                </div>

                <div className="divide-y divide-slate-100">
                  {pageAlerts.map((alert) => {
                    const typeMeta = REMINDER_TYPE_META[alert.type];
                    const persistedReminder = alert.reminderId
                      ? reminders.find((r) => r.id === alert.reminderId)
                      : undefined;
                    const urgencyText = alert.isCompleted
                      ? 'Atendido'
                      : alert.urgency === 'overdue'
                        ? 'Requiere atención / vencido'
                        : alert.urgency === 'due_soon'
                          ? 'Próximo (≤ 2 días)'
                          : 'Programado';

                    return (
                      <article
                        key={alert.id}
                        className="flex flex-col gap-2.5 py-3 first:pt-1 last:pb-0 md:flex-row md:items-start md:justify-between"
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge label={typeMeta.label} tone={typeMeta.tone} />
                            <span
                              className={`text-xs font-semibold ${
                                alert.isCompleted
                                  ? 'text-slate-400'
                                  : alert.urgency === 'overdue'
                                    ? 'text-rose-700'
                                    : alert.urgency === 'due_soon'
                                      ? 'text-amber-700'
                                      : 'text-slate-600'
                              }`}
                            >
                              {urgencyText}
                            </span>
                            <span className="font-mono text-xs text-slate-500 tabular-nums">
                              · {formatDateCO(alert.triggerAt)}
                            </span>
                            <span className="text-[11px] text-slate-400">
                              {alert.source === 'auto_rule' ? '· Automático' : '· Guardado'}
                            </span>
                            {alert.isDemo && (
                              <span className="text-[11px] text-slate-400">· Ejemplo</span>
                            )}
                          </div>

                          <h4
                            className={`font-display text-sm font-semibold sm:text-base ${
                              alert.isCompleted
                                ? 'text-slate-500 line-through'
                                : 'text-slate-900'
                            }`}
                          >
                            {alert.title}
                          </h4>

                          {alert.message && (
                            <p className="text-xs leading-relaxed text-slate-600">
                              {alert.message}
                            </p>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                          {(alert.relatedEntityType === 'project' ||
                            alert.relatedEntityType === 'pending_material' ||
                            alert.relatedEntityType === 'variant') && (
                            <button
                              type="button"
                              onClick={() =>
                                openRelatedEntity(
                                  alert.relatedEntityType,
                                  alert.relatedEntityId,
                                )
                              }
                              className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-teal-800 hover:bg-teal-50/40"
                            >
                              <span>Abrir</span>
                              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          )}

                          {!alert.isCompleted && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void handleSnoozeAlert(alert, 2)}
                              className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                            >
                              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>+2d</span>
                            </button>
                          )}

                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleToggleAlertCompleted(alert)}
                            className={`inline-flex min-h-[38px] items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${
                              alert.isCompleted
                                ? 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                                : 'border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100'
                            }`}
                          >
                            <Check className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>{alert.isCompleted ? 'Reactivar' : 'Atendido'}</span>
                          </button>

                          {persistedReminder && (
                            <>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => openEditReminderForm(persistedReminder)}
                                aria-label="Editar recordatorio"
                                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                              >
                                <Edit3 className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => setReminderToDelete(persistedReminder)}
                                aria-label="Eliminar recordatorio"
                                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-rose-700 hover:bg-rose-50"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            </SnapSlide>
          ))
        )}
      </SnapDeck>

      {/* Modal: Formulario de creación/edición de tarea */}
      {taskFormOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-3 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="task-modal-title"
        >
          <form
            onSubmit={(e) => void handleSaveTask(e)}
            className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto overflow-x-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3
                id="task-modal-title"
                className="font-display text-base font-semibold text-slate-900"
              >
                {editingTaskId ? 'Editar tarea planificada' : 'Nueva tarea en la agenda'}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setTaskFormOpen(false);
                  setFeedback(null);
                }}
                aria-label="Cerrar formulario de tarea"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <InlineFeedbackAlert
              feedback={feedback}
              onDismiss={() => setFeedback(null)}
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="task-project" className="block text-xs font-semibold text-slate-700">
                  Proyecto *
                </label>
                <select
                  id="task-project"
                  required
                  value={taskProjectId}
                  onChange={(e) => {
                    setTaskProjectId(e.target.value);
                    setTaskComponentId('');
                    setTaskPendingId('');
                  }}
                  className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                >
                  <option value="">Selecciona un proyecto...</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.isDemo ? ' (Ejemplo)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="task-component" className="block text-xs font-semibold text-slate-700">
                  Pieza / componente (opcional)
                </label>
                <select
                  id="task-component"
                  value={taskComponentId}
                  onChange={(e) => {
                    const nextCompId = e.target.value;
                    setTaskComponentId(nextCompId);
                    if (nextCompId && !taskTitle.trim()) {
                      const comp = componentMap.get(nextCompId);
                      if (comp) {
                        setTaskTitle(`Avanzar en ${comp.name}`);
                      }
                    }
                  }}
                  className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                >
                  <option value="">Todo el proyecto (general)</option>
                  {formProjectComponents.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.orderIndex}. {c.name}
                      {c.status === 'blocked_by_material'
                        ? ' — [Bloqueada por insumo]'
                        : c.status === 'completed'
                          ? ' — [Finalizada]'
                          : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-2">
                <label htmlFor="task-title" className="block text-xs font-semibold text-slate-700">
                  Título de la tarea *
                </label>
                <input
                  id="task-title"
                  type="text"
                  required
                  placeholder="Ej. Tejer segunda ala y esconder hebras"
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                  className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="task-date" className="block text-xs font-semibold text-slate-700">
                  Fecha programada *
                </label>
                <input
                  id="task-date"
                  type="date"
                  required
                  value={taskDateKey}
                  onChange={(e) => setTaskDateKey(e.target.value)}
                  className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="task-duration" className="block text-xs font-semibold text-slate-700">
                  Tiempo estimado asignado
                </label>
                <DurationInput
                  id="task-duration"
                  valueMinutes={taskMinutes}
                  onChangeMinutes={setTaskMinutes}
                  minMinutes={5}
                  maxMinutes={720}
                  ariaLabel="Tiempo asignado a la tarea"
                  className="mt-1.5"
                />
              </div>

              <div className="sm:col-span-2 space-y-2">
                <label htmlFor="task-pending-dep" className="block text-xs font-semibold text-slate-700">
                  Dependencia explícita con compra pendiente (opcional)
                </label>
                {canLinkNewMaterialDep || Boolean(editingTaskId && editingTaskInitialPendingId) ? (
                  <select
                    id="task-pending-dep"
                    value={taskPendingId}
                    onChange={(e) => {
                      const nextVal = e.target.value;
                      if (
                        !canLinkNewMaterialDep &&
                        nextVal !== '' &&
                        nextVal !== editingTaskInitialPendingId
                      ) {
                        return;
                      }
                      setTaskPendingId(nextVal);
                    }}
                    className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                  >
                    <option value="">Detectar automáticamente según pieza</option>
                    {formOpenPendings.map((pm) => {
                      const variant = variantMap.get(pm.variantId);
                      const mat = variant ? materialMap.get(variant.materialId) : undefined;
                      const optionLocked =
                        !canLinkNewMaterialDep && pm.id !== editingTaskInitialPendingId;
                      return (
                        <option key={pm.id} value={pm.id} disabled={optionLocked}>
                          {mat?.name ?? 'Material'} ({variant?.colorName ?? 'Color'}) — Falta{' '}
                          {Math.max(0, pm.quantityNeeded - pm.quantityReceived)}{' '}
                          {mat?.unit ?? 'u'}
                        </option>
                      );
                    })}
                  </select>
                ) : (
                  <FeatureGate
                    mode="inline-banner"
                    featureTitle="Dependencias nuevas por material pendiente (PRO)"
                    description="Vincula tareas de tu agenda directamente a compras de material pendientes para bloquearlas automáticamente hasta que lleguen al taller."
                    freeIncludedNote="Puedes crear, editar y completar tus tareas y su detección automática por pieza normalmente. Las tareas existentes con dependencia previa siguen funcionando sin bloqueo."
                  />
                )}
              </div>

              <div className="sm:col-span-2">
                <label htmlFor="task-notes" className="block text-xs font-semibold text-slate-700">
                  Notas de sesión
                </label>
                <textarea
                  id="task-notes"
                  rows={2}
                  value={taskNotes}
                  onChange={(e) => setTaskNotes(e.target.value)}
                  placeholder="Detalles de ganchillo, punto o verificación..."
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white p-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                />
              </div>
            </div>

            {formBlockPreview?.isBlocked && (
              <div className="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 p-3.5 text-xs text-amber-950">
                <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-800" aria-hidden="true" />
                <div>
                  <p className="font-semibold">
                    Bloqueo preventivo detectado al guardar
                  </p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {formBlockPreview.reasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setTaskFormOpen(false);
                  setFeedback(null);
                }}
                className="inline-flex min-h-[44px] items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex min-h-[44px] items-center rounded-lg bg-slate-900 px-5 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {busy ? 'Guardando...' : editingTaskId ? 'Guardar cambios' : 'Agendar tarea'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Configuración de anticipación */}
      {rulesPanelOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-3 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rules-modal-title"
        >
          <form
            onSubmit={(e) => void handleSaveReminderRules(e)}
            className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto overflow-x-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-xl space-y-4"
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <h3
                  id="rules-modal-title"
                  className="font-display text-base font-semibold text-slate-900"
                >
                  Reglas automáticas de recordatorios
                </h3>
                <p className="mt-0.5 text-xs text-slate-600">
                  Define con cuántos días de anticipación quieres recibir alertas automáticas.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setRulesPanelOpen(false);
                  setFeedback(null);
                }}
                aria-label="Cerrar reglas de anticipación"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <InlineFeedbackAlert
              feedback={feedback}
              onDismiss={() => setFeedback(null)}
            />

            {!canCustomizeReminders && (
              <FeatureGate
                mode="inline-banner"
                featureTitle="Configuración avanzada de recordatorios (PRO)"
                description="Personaliza libremente los días de anticipación para entregas, vencimientos de cuotas y compras pendientes, o activa y desactiva categorías automáticas según tu flujo de trabajo."
                freeIncludedNote={`En tu plan FREE funcionan las alertas automáticas estándar (${STANDARD_REMINDER_LEAD_DAYS.delivery} días para entregas, ${STANDARD_REMINDER_LEAD_DAYS.installment} días para cuotas y ${STANDARD_REMINDER_LEAD_DAYS.purchase} día para compras) junto con recordatorios manuales ilimitados.`}
              />
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-3">
                <label className="flex items-center justify-between gap-2 text-xs font-semibold text-slate-800">
                  <span>Entregas estimadas de proyectos</span>
                  <input
                    type="checkbox"
                    disabled={!canCustomizeReminders}
                    checked={canCustomizeReminders ? enableDelivery : true}
                    onChange={(e) => setEnableDelivery(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-700 disabled:opacity-50"
                  />
                </label>
                <div>
                  <label htmlFor="lead-delivery" className="block text-xs text-slate-600">
                    Días de anticipación
                  </label>
                  <input
                    id="lead-delivery"
                    type="number"
                    min={0}
                    max={60}
                    disabled={!canCustomizeReminders || !enableDelivery}
                    value={
                      canCustomizeReminders
                        ? leadDelivery
                        : String(STANDARD_REMINDER_LEAD_DAYS.delivery)
                    }
                    onChange={(e) => setLeadDelivery(e.target.value)}
                    className="mt-1 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 tabular-nums disabled:opacity-50"
                  />
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-3">
                <label className="flex items-center justify-between gap-2 text-xs font-semibold text-slate-800">
                  <span>Vencimiento de cuotas y cobros</span>
                  <input
                    type="checkbox"
                    disabled={!canCustomizeReminders}
                    checked={canCustomizeReminders ? enableInstallment : true}
                    onChange={(e) => setEnableInstallment(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-700 disabled:opacity-50"
                  />
                </label>
                <div>
                  <label htmlFor="lead-installment" className="block text-xs text-slate-600">
                    Días de anticipación
                  </label>
                  <input
                    id="lead-installment"
                    type="number"
                    min={0}
                    max={60}
                    disabled={!canCustomizeReminders || !enableInstallment}
                    value={
                      canCustomizeReminders
                        ? leadInstallment
                        : String(STANDARD_REMINDER_LEAD_DAYS.installment)
                    }
                    onChange={(e) => setLeadInstallment(e.target.value)}
                    className="mt-1 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 tabular-nums disabled:opacity-50"
                  />
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-3">
                <label className="flex items-center justify-between gap-2 text-xs font-semibold text-slate-800">
                  <span>Compras pendientes y llegadas</span>
                  <input
                    type="checkbox"
                    disabled={!canCustomizeReminders}
                    checked={canCustomizeReminders ? enablePurchase : true}
                    onChange={(e) => setEnablePurchase(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-700 disabled:opacity-50"
                  />
                </label>
                <div>
                  <label htmlFor="lead-purchase" className="block text-xs text-slate-600">
                    Días de anticipación antes de llegada
                  </label>
                  <input
                    id="lead-purchase"
                    type="number"
                    min={0}
                    max={60}
                    disabled={!canCustomizeReminders || !enablePurchase}
                    value={
                      canCustomizeReminders
                        ? leadPurchase
                        : String(STANDARD_REMINDER_LEAD_DAYS.purchase)
                    }
                    onChange={(e) => setLeadPurchase(e.target.value)}
                    className="mt-1 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 tabular-nums disabled:opacity-50"
                  />
                </div>
              </div>

              <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                <label className="flex items-center justify-between gap-2 text-xs font-semibold text-slate-800">
                  <span>Alertas de stock mínimo por color</span>
                  <input
                    type="checkbox"
                    disabled={!canCustomizeReminders}
                    checked={canCustomizeReminders ? enableLowStock : true}
                    onChange={(e) => setEnableLowStock(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-700 disabled:opacity-50"
                  />
                </label>
                <p className="mt-2 text-xs text-slate-500">
                  Notifica en la agenda cuando la disponibilidad libre caiga igual o por debajo de su mínimo.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setRulesPanelOpen(false);
                  setFeedback(null);
                }}
                className="inline-flex min-h-[42px] items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cerrar
              </button>
              {canCustomizeReminders && (
                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex min-h-[42px] items-center rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {busy ? 'Guardando...' : 'Guardar preferencias'}
                </button>
              )}
            </div>
          </form>
        </div>
      )}

      {/* Modal: Formulario de recordatorio manual */}
      {reminderFormOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-3 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rem-modal-title"
        >
          <form
            onSubmit={(e) => void handleSaveReminder(e)}
            className="max-h-[90dvh] w-full max-w-xl overflow-y-auto overflow-x-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3
                id="rem-modal-title"
                className="font-display text-base font-semibold text-slate-900"
              >
                {editingReminderId ? 'Editar recordatorio' : 'Crear recordatorio personalizado'}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setReminderFormOpen(false);
                  setFeedback(null);
                }}
                aria-label="Cerrar formulario de recordatorio"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <InlineFeedbackAlert
              feedback={feedback}
              onDismiss={() => setFeedback(null)}
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="rem-type" className="block text-xs font-semibold text-slate-700">
                  Categoría *
                </label>
                <select
                  id="rem-type"
                  value={remType}
                  onChange={(e) => setRemType(e.target.value as ReminderType)}
                  className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                >
                  <option value="delivery_deadline">Entrega de proyecto</option>
                  <option value="installment_due">Cuota / cobro</option>
                  <option value="pending_purchase">Compra pendiente</option>
                  <option value="material_arrival">Llegada de insumo</option>
                  <option value="work_session">Sesión de tejido</option>
                  <option value="component_goal">Meta de pieza</option>
                  <option value="low_stock">Stock bajo</option>
                  <option value="social_recording">Grabación / redes</option>
                </select>
              </div>

              <div>
                <label htmlFor="rem-date" className="block text-xs font-semibold text-slate-700">
                  Fecha del aviso *
                </label>
                <input
                  id="rem-date"
                  type="date"
                  required
                  value={remDateKey}
                  onChange={(e) => setRemDateKey(e.target.value)}
                  className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                />
              </div>

              <div className="sm:col-span-2">
                <label htmlFor="rem-title" className="block text-xs font-semibold text-slate-700">
                  Título *
                </label>
                <input
                  id="rem-title"
                  type="text"
                  required
                  placeholder="Ej. Confirmar entrega de amigurumi y empaque"
                  value={remTitle}
                  onChange={(e) => setRemTitle(e.target.value)}
                  className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                />
              </div>

              {!editingReminderId && (
                <div>
                  <label
                    htmlFor="rem-project"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Proyecto relacionado (opcional)
                  </label>
                  <select
                    id="rem-project"
                    value={remRelatedProjectId}
                    onChange={(e) => setRemRelatedProjectId(e.target.value)}
                    className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                  >
                    <option value="">General del taller</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label htmlFor="rem-lead" className="block text-xs font-semibold text-slate-700">
                  Días de anticipación registrados
                </label>
                <input
                  id="rem-lead"
                  type="number"
                  min={0}
                  max={60}
                  value={remLeadDays}
                  onChange={(e) => setRemLeadDays(e.target.value)}
                  className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 tabular-nums focus:border-teal-700 focus:outline-none"
                />
              </div>

              <div className="sm:col-span-2">
                <label htmlFor="rem-msg" className="block text-xs font-semibold text-slate-700">
                  Detalle del recordatorio
                </label>
                <textarea
                  id="rem-msg"
                  rows={2}
                  value={remMessage}
                  onChange={(e) => setRemMessage(e.target.value)}
                  placeholder="Qué verificar o a quién escribir cuando llegue la fecha..."
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white p-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setReminderFormOpen(false);
                  setFeedback(null);
                }}
                className="inline-flex min-h-[44px] items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex min-h-[44px] items-center rounded-lg bg-slate-900 px-5 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {busy
                  ? 'Guardando...'
                  : editingReminderId
                    ? 'Guardar cambios'
                    : 'Guardar recordatorio'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal confirmar borrado de tarea */}
      <ConfirmModal
        isOpen={Boolean(taskToDelete)}
        title="Eliminar tarea de la agenda"
        description={
          taskToDelete
            ? `Se eliminará "${taskToDelete.task.title}" de tu planificación. El proyecto y tus sesiones de cronómetro registradas no se verán afectados.`
            : ''
        }
        confirmLabel="Eliminar tarea"
        variant="danger"
        isBusy={busy}
        onConfirm={() => void handleConfirmDeleteTask()}
        onCancel={() => setTaskToDelete(null)}
      />

      {/* Modal confirmar borrado de recordatorio */}
      <ConfirmModal
        isOpen={Boolean(reminderToDelete)}
        title="Eliminar recordatorio"
        description={
          reminderToDelete
            ? `Se eliminará el recordatorio "${reminderToDelete.title}" de tu base local.`
            : ''
        }
        confirmLabel="Eliminar recordatorio"
        variant="danger"
        isBusy={busy}
        onConfirm={() => void handleConfirmDeleteReminder()}
        onCancel={() => setReminderToDelete(null)}
      />
    </>
  );
};

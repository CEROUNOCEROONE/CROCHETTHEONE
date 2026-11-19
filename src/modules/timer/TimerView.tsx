import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Clock,
  Edit3,
  History,
  Pause,
  Play,
  Plus,
  Square,
  X,
} from 'lucide-react';
import { useWorkshopData } from '@/src/data/DataContext.tsx';
import type { WorkSession } from '@/src/domain/models/index.ts';
import {
  formatDateTimeCO,
  formatDurationMinutes,
} from '@/src/domain/services/formatters.ts';
import {
  calculateSessionDurations,
  formatClockHHMMSS,
  isUnusuallyLongActiveSession,
} from '@/src/domain/services/timerEngine.ts';
import { ConfirmModal } from '@/src/shared/components/ConfirmModal.tsx';
import { DurationInput } from '@/src/shared/components/DurationInput.tsx';
import { EmptyState } from '@/src/shared/components/EmptyState.tsx';
import { SnapDeck, SnapSlide } from '@/src/shared/components/SnapDeck.tsx';
import { StatusBadge } from '@/src/shared/components/StatusBadge.tsx';
import { useLiveNowMs } from '@/src/shared/hooks/useLiveNowMs.ts';
import {
  chunkIntoPages,
  pickPageSize,
  useViewportProfile,
} from '@/src/shared/hooks/useViewportPageSize.ts';
import {
  clearTimerNoteDraft,
  getTimerNoteDraft,
  setTimerNoteDraft,
} from './timerDraftStorage.ts';

interface TimerViewProps {
  readonly initialProjectId?: string | null;
  readonly initialComponentId?: string | null;
  readonly initialFinishConfirmSessionId?: string | null;
  onClearInitialTarget?(): void;
  onClearFinishConfirm?(): void;
  onNavigateToProjects?(): void;
}

const ENTRY_TYPE_META: Record<
  WorkSession['entryType'],
  { label: string; tone: 'active' | 'neutral' | 'warning' }
> = {
  timer: { label: 'Cronómetro', tone: 'active' },
  manual: { label: 'Manual', tone: 'neutral' },
  adjusted: { label: 'Ajustado', tone: 'warning' },
};

export const TimerView: React.FC<TimerViewProps> = ({
  initialProjectId = null,
  initialComponentId = null,
  initialFinishConfirmSessionId = null,
  onClearInitialTarget,
  onClearFinishConfirm,
  onNavigateToProjects,
}) => {
  const {
    isLoading,
    projects,
    components,
    workSessions,
    activeTimerSession,
    stats,
    settings,
    startTimerSession,
    pauseTimerSession,
    resumeTimerSession,
    finishTimerSession,
    logManualWorkSession,
    adjustCompletedWorkSession,
  } = useWorkshopData();

  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [selectedComponentId, setSelectedComponentId] = useState<string>('');
  const [sessionNotes, setSessionNotes] = useState<string>('');
  const hasRunningSession = workSessions.some((s) => s.status === 'running');
  const nowMs = useLiveNowMs(hasRunningSession);
  const [busy, setBusy] = useState(false);
  const [finishConfirmSession, setFinishConfirmSession] =
    useState<WorkSession | null>(null);
  const profile = useViewportProfile();
  const [feedback, setFeedback] = useState<{
    type: 'error';
    message: string;
  } | null>(null);

  // Filtro del historial
  const [historyFilterMode, setHistoryFilterMode] = useState<'all' | 'project'>(
    'all',
  );

  // Modal de registro manual
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [manualProjectId, setManualProjectId] = useState('');
  const [manualComponentId, setManualComponentId] = useState('');
  const [manualMinutes, setManualMinutes] = useState('30');
  const [manualDate, setManualDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [manualNotes, setManualNotes] = useState('');

  // Modal de ajuste (para finalizar con ajuste o editar sesión completada)
  const [adjustModalState, setAdjustModalState] = useState<{
    mode: 'finish_override' | 'edit_completed';
    session: WorkSession;
    minutesInput: string;
    reasonInput: string;
  } | null>(null);

  // Abrir confirmación segura si el usuario tocó "Finalizar" desde una notificación
  useEffect(() => {
    if (isLoading || !initialFinishConfirmSessionId) return;
    const target = workSessions.find(
      (s) =>
        s.id === initialFinishConfirmSessionId &&
        (s.status === 'running' || s.status === 'paused'),
    );
    if (target) {
      setSelectedProjectId(target.projectId);
      setSelectedComponentId(target.componentId);
      if (isUnusuallyLongActiveSession(target, Date.now())) {
        const breakdown = calculateSessionDurations(target, Date.now());
        setAdjustModalState({
          mode: 'finish_override',
          session: target,
          minutesInput: String(Math.max(1, breakdown.effectiveMinutes)),
          reasonInput: '',
        });
      } else {
        setFinishConfirmSession(target);
      }
    }
    onClearFinishConfirm?.();
  }, [isLoading, initialFinishConfirmSessionId, workSessions, onClearFinishConfirm]);

  // Sincronizar selección inicial cuando el usuario llega desde Proyectos o Dock
  useEffect(() => {
    if (initialProjectId) {
      setSelectedProjectId(initialProjectId);
      if (initialComponentId) {
        setSelectedComponentId(initialComponentId);
      }
      onClearInitialTarget?.();
      return;
    }

    if (!selectedProjectId) {
      if (activeTimerSession) {
        setSelectedProjectId(activeTimerSession.projectId);
        setSelectedComponentId(activeTimerSession.componentId);
      } else if (projects.length > 0) {
        const preferred =
          projects.find((p) => p.status === 'in_progress') ?? projects[0];
        setSelectedProjectId(preferred.id);
      }
    }
  }, [
    initialProjectId,
    initialComponentId,
    onClearInitialTarget,
    activeTimerSession,
    projects,
    selectedProjectId,
  ]);

  const projectComponents = useMemo(() => {
    return components
      .filter((c) => c.projectId === selectedProjectId)
      .sort((a, b) => a.orderIndex - b.orderIndex);
  }, [components, selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId) {
      setSelectedComponentId('');
      return;
    }
    const stillValid = projectComponents.some(
      (c) => c.id === selectedComponentId,
    );
    if (!stillValid) {
      const preferred =
        projectComponents.find((c) => c.status === 'in_progress') ??
        projectComponents.find((c) => c.status === 'pending') ??
        projectComponents[0];
      setSelectedComponentId(preferred?.id ?? '');
    }
  }, [selectedProjectId, projectComponents, selectedComponentId]);

  const selectedProject =
    projects.find((p) => p.id === selectedProjectId) ?? null;
  const selectedComponent =
    projectComponents.find((c) => c.id === selectedComponentId) ?? null;

  // Sesión activa correspondiente a la pieza actualmente seleccionada (si existe)
  const selectedPieceSession = useMemo(() => {
    if (!selectedComponentId) return null;
    return (
      workSessions.find(
        (s) =>
          s.componentId === selectedComponentId &&
          (s.status === 'running' || s.status === 'paused'),
      ) ?? null
    );
  }, [workSessions, selectedComponentId]);

  // Cualquier otra sesión activa o pausada distinta a la pieza seleccionada
  const otherUnfinishedSessions = useMemo(() => {
    return workSessions
      .filter(
        (s) =>
          (s.status === 'running' || s.status === 'paused') &&
          s.id !== selectedPieceSession?.id,
      )
      .sort((a, b) => {
        if (a.status === 'running' && b.status !== 'running') return -1;
        if (b.status === 'running' && a.status !== 'running') return 1;
        return b.updatedAt.localeCompare(a.updatedAt);
      });
  }, [workSessions, selectedPieceSession]);

  const completedHistory = useMemo(() => {
    return workSessions
      .filter((s) => {
        if (s.status !== 'completed') return false;
        if (historyFilterMode === 'project' && selectedProjectId) {
          return s.projectId === selectedProjectId;
        }
        return true;
      })
      .sort((a, b) =>
        (b.endTime ?? b.updatedAt).localeCompare(a.endTime ?? a.updatedAt),
      );
  }, [workSessions, historyFilterMode, selectedProjectId]);

  const projectMap = useMemo(
    () => new Map(projects.map((p) => [p.id, p])),
    [projects],
  );
  const componentMap = useMemo(
    () => new Map(components.map((c) => [c.id, c])),
    [components],
  );

  // Tiempo en curso adicional de hoy (si hay sesión corriendo/pausada iniciada hoy)
  const activeBreakdown = selectedPieceSession
    ? calculateSessionDurations(selectedPieceSession, nowMs)
    : null;
  const isSelectedLongSession = selectedPieceSession
    ? isUnusuallyLongActiveSession(selectedPieceSession, nowMs)
    : false;

  const otherRunningSession = workSessions.find(
    (s) => s.status === 'running' && s.id !== selectedPieceSession?.id,
  );

  // Cargar borrador persistido de la nota cada vez que cambia la pieza seleccionada
  useEffect(() => {
    if (!selectedComponentId) {
      setSessionNotes('');
      return;
    }
    const storedDraft = getTimerNoteDraft(selectedComponentId);
    if (storedDraft !== undefined) {
      setSessionNotes(storedDraft);
    } else if (selectedPieceSession?.notes) {
      setSessionNotes(selectedPieceSession.notes);
    } else {
      setSessionNotes('');
    }
  }, [selectedComponentId, selectedPieceSession?.id, selectedPieceSession?.notes]);

  const handleNoteInputChange = (nextValue: string) => {
    setSessionNotes(nextValue);
    if (!selectedComponentId) return;
    if (nextValue === '' && !selectedPieceSession?.notes) {
      clearTimerNoteDraft(selectedComponentId);
    } else {
      setTimerNoteDraft(selectedComponentId, nextValue);
    }
  };

  const handleClearNoteDraft = () => {
    setSessionNotes('');
    if (!selectedComponentId) return;
    if (selectedPieceSession?.notes) {
      setTimerNoteDraft(selectedComponentId, '');
    } else {
      clearTimerNoteDraft(selectedComponentId);
    }
  };

  const handleStartOnSelected = async () => {
    if (!selectedProjectId || !selectedComponentId) return;
    setBusy(true);
    setFeedback(null);
    try {
      await startTimerSession(
        selectedProjectId,
        selectedComponentId,
        sessionNotes,
      );
      if (sessionNotes.trim().length > 0) {
        setTimerNoteDraft(selectedComponentId, sessionNotes);
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'No se pudo iniciar el cronómetro.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handlePause = async (session: WorkSession) => {
    setBusy(true);
    setFeedback(null);
    try {
      await pauseTimerSession(session.id);
    } catch (err) {
      setFeedback({
        type: 'error',
        message:
          err instanceof Error ? err.message : 'No se pudo pausar la sesión.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleResume = async (session: WorkSession) => {
    setBusy(true);
    setFeedback(null);
    try {
      await resumeTimerSession(session.id);
    } catch (err) {
      setFeedback({
        type: 'error',
        message:
          err instanceof Error ? err.message : 'No se pudo reanudar la sesión.',
      });
    } finally {
      setBusy(false);
    }
  };

  const resolveFinalNotesForSession = (session: WorkSession): string => {
    const storedDraft = getTimerNoteDraft(session.componentId);
    if (storedDraft !== undefined) return storedDraft;
    if (session.componentId === selectedComponentId) return sessionNotes;
    return session.notes;
  };

  const handleFinishExact = async (session: WorkSession) => {
    setBusy(true);
    setFeedback(null);
    try {
      const finalNotes = resolveFinalNotesForSession(session);
      await finishTimerSession(session.id, {
        notes: finalNotes,
      });
      clearTimerNoteDraft(session.componentId);
      if (session.componentId === selectedComponentId) {
        setSessionNotes('');
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'No se pudo finalizar la sesión.',
      });
    } finally {
      setBusy(false);
    }
  };

  const openFinishWithAdjustmentModal = (session: WorkSession) => {
    const breakdown = calculateSessionDurations(session, nowMs);
    setAdjustModalState({
      mode: 'finish_override',
      session,
      minutesInput: String(Math.max(1, breakdown.effectiveMinutes)),
      reasonInput: '',
    });
  };

  const openEditCompletedModal = (session: WorkSession) => {
    const currentMinutes = Math.round(session.effectiveSeconds / 60);
    setAdjustModalState({
      mode: 'edit_completed',
      session,
      minutesInput: String(currentMinutes),
      reasonInput: session.adjustmentReason ?? '',
    });
  };

  const handleSubmitAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustModalState) return;

    const parsedMinutes = Number(adjustModalState.minutesInput);
    const reason = adjustModalState.reasonInput.trim();
    if (!Number.isFinite(parsedMinutes) || parsedMinutes < 0) {
      setFeedback({
        type: 'error',
        message: 'Ingresa una cantidad válida de minutos.',
      });
      return;
    }
    if (reason.length < 3) {
      setFeedback({
        type: 'error',
        message: 'Indica el motivo del ajuste (mínimo 3 caracteres).',
      });
      return;
    }

    setBusy(true);
    setFeedback(null);
    try {
      if (adjustModalState.mode === 'finish_override') {
        const finalNotes = resolveFinalNotesForSession(adjustModalState.session);
        await finishTimerSession(adjustModalState.session.id, {
          overrideEffectiveMinutes: parsedMinutes,
          adjustmentReason: reason,
          notes: finalNotes,
        });
        clearTimerNoteDraft(adjustModalState.session.componentId);
        if (adjustModalState.session.componentId === selectedComponentId) {
          setSessionNotes('');
        }
      } else {
        await adjustCompletedWorkSession(
          adjustModalState.session.id,
          parsedMinutes,
          reason,
        );
      }
      setAdjustModalState(null);
    } catch (err) {
      setFeedback({
        type: 'error',
        message:
          err instanceof Error ? err.message : 'No fue posible aplicar el ajuste.',
      });
    } finally {
      setBusy(false);
    }
  };

  const openManualModal = () => {
    const projId = selectedProjectId || projects[0]?.id || '';
    const firstComp =
      selectedComponentId ||
      components.find((c) => c.projectId === projId)?.id ||
      '';
    setManualProjectId(projId);
    setManualComponentId(firstComp);
    setManualMinutes('30');
    setManualDate(new Date().toISOString().slice(0, 10));
    setManualNotes('');
    setManualModalOpen(true);
  };

  const manualModalComponents = useMemo(() => {
    return components
      .filter((c) => c.projectId === manualProjectId)
      .sort((a, b) => a.orderIndex - b.orderIndex);
  }, [components, manualProjectId]);

  const handleSaveManualSession = async (e: React.FormEvent) => {
    e.preventDefault();
    const mins = Number(manualMinutes);
    if (!manualProjectId || !manualComponentId) {
      setFeedback({
        type: 'error',
        message: 'Selecciona un proyecto y una pieza para registrar el tiempo.',
      });
      return;
    }
    if (!Number.isFinite(mins) || mins <= 0) {
      setFeedback({
        type: 'error',
        message: 'La duración manual debe ser mayor a 0 minutos.',
      });
      return;
    }

    setBusy(true);
    setFeedback(null);
    try {
      const workIso = manualDate
        ? new Date(`${manualDate}T12:00:00`).toISOString()
        : undefined;
      await logManualWorkSession({
        projectId: manualProjectId,
        componentId: manualComponentId,
        effectiveMinutes: mins,
        workDateIso: workIso,
        notes: manualNotes,
      });
      setManualModalOpen(false);
    } catch (err) {
      setFeedback({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'No se pudo guardar el registro manual.',
      });
    } finally {
      setBusy(false);
    }
  };

  if (projects.length === 0) {
    return (
      <SnapDeck ariaLabel="Cronómetro del taller">
        <SnapSlide id="timer-empty" label="Cronómetro">
          <EmptyState
            icon={Clock}
            title="Crea un proyecto antes de usar el cronómetro"
            description="El tiempo trabajado siempre se vincula a una pieza específica de un proyecto para alimentar tus metas y futuros costos de mano de obra."
            primaryAction={
              onNavigateToProjects
                ? {
                    label: 'Ir a Proyectos',
                    onClick: onNavigateToProjects,
                  }
                : undefined
            }
          />
        </SnapSlide>
      </SnapDeck>
    );
  }

  const dailyGoalPct =
    settings.dailyGoalMinutes > 0
      ? Math.min(
          100,
          Math.round(
            (stats.todayEffectiveMinutes / settings.dailyGoalMinutes) * 100,
          ),
        )
      : 0;

  const openSessionsList = [
    selectedPieceSession,
    ...otherUnfinishedSessions,
  ].filter((s): s is WorkSession => Boolean(s));

  const historyPageSize = pickPageSize(profile, {
    mobileCompact: 3,
    mobileRegular: 4,
    tablet: 5,
    desktopCompact: 5,
    desktopRegular: 6,
    desktopTall: 7,
  });
  const historyPages = chunkIntoPages(completedHistory, historyPageSize);

  const feedbackBanner = feedback ? (
    <div
      role="alert"
      className="flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900 sm:text-sm"
    >
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-700" />
        <p>{feedback.message}</p>
      </div>
      <button
        type="button"
        onClick={() => setFeedback(null)}
        className="text-xs font-medium underline shrink-0"
      >
        Cerrar
      </button>
    </div>
  ) : null;

  return (
    <>
      <SnapDeck
        ariaLabel="Cronómetro del taller"
        topSlot={feedbackBanner ?? undefined}
      >
        {/* Vista 1: Cabecera + Reloj principal */}
        <SnapSlide id="timer-clock" label="Cronómetro">
          <div className="space-y-4">
            {/* Cabecera de resumen de tiempo del día */}
            <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-medium text-slate-500">
                    Hoy: {formatDurationMinutes(stats.todayEffectiveMinutes)} de meta{' '}
                    {formatDurationMinutes(settings.dailyGoalMinutes)} ({dailyGoalPct}%) ·
                    Acumulado taller: {formatDurationMinutes(stats.totalEffectiveMinutes)}
                  </p>
                  <h2 className="mt-1 font-display text-lg font-semibold text-slate-900 sm:text-xl">
                    Control de tiempo por pieza
                  </h2>
                </div>

                <button
                  type="button"
                  onClick={openManualModal}
                  className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  <Plus className="h-4 w-4 text-teal-700" aria-hidden="true" />
                  <span>Registrar tiempo manual</span>
                </button>
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="timer-project-select"
                className="block text-xs font-semibold text-slate-700"
              >
                Proyecto
              </label>
              <select
                id="timer-project-select"
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
              >
                {projects.map((proj) => (
                  <option key={proj.id} value={proj.id}>
                    {proj.name}
                    {proj.isDemo ? ' (Ejemplo)' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="timer-component-select"
                className="block text-xs font-semibold text-slate-700"
              >
                Pieza o componente
              </label>
              <select
                id="timer-component-select"
                value={selectedComponentId}
                onChange={(e) => setSelectedComponentId(e.target.value)}
                disabled={projectComponents.length === 0}
                className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none disabled:bg-slate-100"
              >
                {projectComponents.length === 0 ? (
                  <option value="">Este proyecto no tiene piezas</option>
                ) : (
                  projectComponents.map((comp, idx) => (
                    <option key={comp.id} value={comp.id}>
                      {idx + 1}. {comp.name} (
                      {formatDurationMinutes(comp.effectiveMinutesSpent)})
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>

          {selectedComponent?.status === 'blocked_by_material' && (
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              <p>
                Esta pieza está marcada como <strong>Falta material</strong>. Si
                ya cuentas con el insumo o estás adelantando otra parte, puedes
                medir tu tiempo normalmente.
              </p>
            </div>
          )}

          {/* Aviso de exclusión mutua cuando hay otra sesión corriendo */}
          {otherRunningSession && (
            <div className="flex items-start justify-between gap-3 rounded-lg border border-teal-200 bg-teal-50/70 p-3.5 text-xs text-teal-950">
              <div className="flex items-start gap-2">
                <Clock className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" />
                <p>
                  Tienes un cronómetro activo en{' '}
                  <strong>
                    {projectMap.get(otherRunningSession.projectId)?.name ??
                      'Proyecto'}{' '}
                    ·{' '}
                    {componentMap.get(otherRunningSession.componentId)?.name ??
                      'Pieza'}
                  </strong>
                  . Si inicias aquí, esa sesión se pausará automáticamente sin
                  perder el tiempo acumulado.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedProjectId(otherRunningSession.projectId);
                  setSelectedComponentId(otherRunningSession.componentId);
                }}
                className="shrink-0 font-semibold text-teal-800 underline"
              >
                Ver activa
              </button>
            </div>
          )}

          {/* Display principal del reloj */}
          {selectedComponent ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-5 text-center sm:p-6">
              <p className="text-xs font-medium text-slate-500">
                {selectedProject?.name} · {selectedComponent.name}
              </p>

              <p
                className="mt-3 font-mono text-4xl font-bold tracking-tight text-slate-900 tabular-nums sm:text-5xl"
                aria-live="off"
              >
                {activeBreakdown
                  ? formatClockHHMMSS(activeBreakdown.effectiveSeconds)
                  : '00:00:00'}
              </p>

              <p className="mt-2 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-xs text-slate-600">
                {selectedPieceSession ? (
                  <>
                    <span className="inline-flex items-center gap-1 whitespace-nowrap">
                      <span>Estado:</span>
                      <strong className="inline-block min-w-[56px] text-left text-slate-900">
                        {selectedPieceSession.status === 'running'
                          ? 'En curso'
                          : 'En pausa'}
                      </strong>
                    </span>
                    <span
                      aria-hidden="true"
                      className="hidden text-slate-300 sm:inline"
                    >
                      ·
                    </span>
                    <span className="inline-flex items-center gap-1 whitespace-nowrap">
                      <span>Bruto:</span>
                      <span className="inline-block min-w-[8.5ch] text-left font-mono font-medium text-slate-800 tabular-nums">
                        {formatClockHHMMSS(activeBreakdown?.elapsedSeconds ?? 0)}
                      </span>
                    </span>
                    <span
                      aria-hidden="true"
                      className="hidden text-slate-300 sm:inline"
                    >
                      ·
                    </span>
                    <span className="inline-flex items-center gap-1 whitespace-nowrap">
                      <span>Pausas:</span>
                      <span className="inline-block min-w-[8.5ch] text-left font-mono font-medium text-slate-800 tabular-nums">
                        {formatClockHHMMSS(activeBreakdown?.pausedSeconds ?? 0)}
                      </span>
                    </span>
                  </>
                ) : (
                  <>
                    <span className="whitespace-nowrap">
                      Acumulado en esta pieza:{' '}
                      <strong className="font-mono text-slate-900 tabular-nums">
                        {formatDurationMinutes(
                          selectedComponent.effectiveMinutesSpent,
                        )}
                      </strong>
                    </span>
                    <span
                      aria-hidden="true"
                      className="hidden text-slate-300 sm:inline"
                    >
                      ·
                    </span>
                    <span className="whitespace-nowrap">
                      Estimado:{' '}
                      <span className="font-mono tabular-nums">
                        {formatDurationMinutes(
                          selectedComponent.estimatedMinutes,
                        )}
                      </span>
                    </span>
                  </>
                )}
              </p>

              {/* Recuperación ante sesión inusualmente larga (+4 horas) */}
              {selectedPieceSession && isSelectedLongSession && (
                <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3.5 text-left text-xs text-amber-950">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                    <div>
                      <p className="font-semibold">
                        Sesión continua de más de 4 horas detectada
                      </p>
                      <p className="mt-1 text-amber-900">
                        Inició el {formatDateTimeCO(selectedPieceSession.startTime)}.
                        Si cerraste el navegador sin pausarla, ajusta el tiempo
                        efectivo real antes de guardarla en el historial.
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          openFinishWithAdjustmentModal(selectedPieceSession)
                        }
                        className="mt-2 inline-flex min-h-[36px] items-center rounded-md bg-amber-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-800"
                      >
                        Revisar y ajustar antes de guardar
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Nota rápida persistente en borrador para la sesión */}
              <div className="mt-5 text-left">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor="timer-session-notes"
                    className="block text-xs font-medium text-slate-600"
                  >
                    Nota de la sesión (opcional)
                  </label>
                  {sessionNotes.length > 0 && (
                    <button
                      type="button"
                      onClick={handleClearNoteDraft}
                      className="text-xs font-medium text-slate-500 underline hover:text-slate-800"
                    >
                      Borrar nota
                    </button>
                  )}
                </div>
                <input
                  id="timer-session-notes"
                  type="text"
                  value={sessionNotes}
                  onChange={(e) => handleNoteInputChange(e.target.value)}
                  placeholder="Ej. Empiezo la vuelta 16 a la 25, cambio de aguja..."
                  className="mt-1 w-full min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900 focus:border-teal-700 focus:outline-none"
                />
                {sessionNotes.trim().length > 0 && (
                  <p className="mt-1 text-[11px] text-slate-500">
                    Borrador guardado: se conservará al iniciar o cambiar de pantalla y se guardará en la sesión al finalizar.
                  </p>
                )}
              </div>

              {/* Error inline cerca de los botones de control */}
              {feedback && (
                <p
                  role="alert"
                  className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-left text-xs text-rose-900"
                >
                  {feedback.message}
                </p>
              )}

              {/* Botones de control */}
              <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                {!selectedPieceSession ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleStartOnSelected()}
                    className="inline-flex min-h-[48px] flex-1 sm:flex-initial items-center justify-center gap-2 rounded-xl bg-teal-700 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-800 disabled:opacity-60"
                  >
                    <Play className="h-4 w-4" aria-hidden="true" />
                    <span>
                      {otherRunningSession
                        ? 'Iniciar aquí (pausa sesión actual)'
                        : 'Iniciar cronómetro'}
                    </span>
                  </button>
                ) : (
                  <>
                    {selectedPieceSession.status === 'running' ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handlePause(selectedPieceSession)}
                        className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-5 py-2.5 text-sm font-semibold text-amber-900 transition-colors hover:bg-amber-100 disabled:opacity-60"
                      >
                        <Pause className="h-4 w-4" aria-hidden="true" />
                        <span>Pausar</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleResume(selectedPieceSession)}
                        className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-800 disabled:opacity-60"
                      >
                        <Play className="h-4 w-4" aria-hidden="true" />
                        <span>Reanudar</span>
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleFinishExact(selectedPieceSession)}
                      className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-60"
                    >
                      <Square className="h-4 w-4" aria-hidden="true" />
                      <span>Finalizar y guardar</span>
                    </button>

                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        openFinishWithAdjustmentModal(selectedPieceSession)
                      }
                      className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                    >
                      <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Ajustar al finalizar</span>
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-600">
              Este proyecto aún no tiene piezas configuradas. Agrégalas en el
              módulo Proyectos para medir tiempo por componente.
            </div>
          )}
            </section>
          </div>
        </SnapSlide>

        {/* Vista 2: Sesiones abiertas en el taller */}
        <SnapSlide id="timer-open-sessions" label="Sesiones abiertas">
          <section className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6 space-y-4">
            <div className="flex items-center gap-2.5 border-b border-slate-100 pb-3.5">
              <Clock className="h-5 w-5 text-teal-700" aria-hidden="true" />
              <div>
                <h3 className="font-display text-base font-semibold text-slate-900">
                  Sesiones abiertas en el taller ({openSessionsList.length})
                </h3>
                <p className="text-xs text-slate-500">
                  Persisten aunque cierres la aplicación gracias al registro por
                  marcas de tiempo.
                </p>
              </div>
            </div>

            {openSessionsList.length === 0 ? (
              <div className="py-10 text-center text-sm text-slate-500">
                No hay sesiones abiertas ni pausadas en este momento. Inicia el
                cronómetro o registra tiempo manual cuando lo necesites.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {openSessionsList.map((sess) => {
                  const proj = projectMap.get(sess.projectId);
                  const comp = componentMap.get(sess.componentId);
                  const breakdown = calculateSessionDurations(sess, nowMs);
                  const isRunning = sess.status === 'running';

                  return (
                    <div
                      key={sess.id}
                      className="flex flex-col gap-2.5 py-3.5 first:pt-1 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">
                          {comp?.name ?? 'Pieza'}
                        </p>
                        <p className="truncate text-xs text-slate-500">
                          {proj?.name ?? 'Proyecto'} · Inicio{' '}
                          {formatDateTimeCO(sess.startTime)}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-end">
                        <StatusBadge
                          label={isRunning ? 'En curso' : 'En pausa'}
                          tone={isRunning ? 'active' : 'warning'}
                        />
                        <span className="font-mono text-base font-bold text-slate-900 tabular-nums">
                          {formatClockHHMMSS(breakdown.effectiveSeconds)}
                        </span>

                        <div className="flex items-center gap-1.5">
                          {isRunning ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void handlePause(sess)}
                              className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-3 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-60"
                            >
                              <Pause className="h-3.5 w-3.5" />
                              <span>Pausar</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void handleResume(sess)}
                              className="inline-flex min-h-[36px] items-center gap-1 rounded-lg bg-teal-700 px-3 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-60"
                            >
                              <Play className="h-3.5 w-3.5" />
                              <span>Reanudar</span>
                            </button>
                          )}

                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleFinishExact(sess)}
                            className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-60"
                          >
                            <Square className="h-3.5 w-3.5" />
                            <span>Finalizar</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </SnapSlide>

        {/* Vista 3+: Historial auditable paginado */}
        {historyPages.length === 0 ? (
          <SnapSlide id="timer-history-empty" label="Historial">
            <section className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
              <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2.5">
                  <History className="h-5 w-5 text-teal-700" aria-hidden="true" />
                  <div>
                    <h3 className="font-display text-base font-semibold text-slate-900">
                      Historial de sesiones de trabajo
                    </h3>
                    <p className="text-xs text-slate-500">
                      Cada registro conserva la fecha, el tiempo bruto, las pausas y
                      cualquier ajuste con su motivo.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 self-start sm:self-auto">
                  <button
                    type="button"
                    onClick={() => setHistoryFilterMode('all')}
                    className={`min-h-[34px] rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                      historyFilterMode === 'all'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Todo el taller
                  </button>
                  <button
                    type="button"
                    onClick={() => setHistoryFilterMode('project')}
                    className={`min-h-[34px] rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                      historyFilterMode === 'project'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Solo proyecto actual
                  </button>
                </div>
              </div>
              <div className="py-10 text-center text-sm text-slate-500">
                Aún no hay sesiones completadas para mostrar con este filtro.
              </div>
            </section>
          </SnapSlide>
        ) : (
          historyPages.map((pageSessions, pageIdx) => (
            <SnapSlide
              key={`timer-history-${pageIdx}`}
              id={`timer-history-${pageIdx}`}
              label={
                historyPages.length > 1
                  ? `Historial (${pageIdx + 1}/${historyPages.length})`
                  : 'Historial'
              }
            >
              <section className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
                <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2.5">
                    <History className="h-5 w-5 text-teal-700" aria-hidden="true" />
                    <div>
                      <h3 className="font-display text-base font-semibold text-slate-900">
                        Historial de sesiones de trabajo
                        {historyPages.length > 1
                          ? ` · ${pageIdx + 1}/${historyPages.length}`
                          : ''}
                      </h3>
                      <p className="text-xs text-slate-500">
                        Cada registro conserva la fecha, el tiempo bruto, las pausas y
                        cualquier ajuste con su motivo.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 self-start sm:self-auto">
                    <button
                      type="button"
                      onClick={() => setHistoryFilterMode('all')}
                      className={`min-h-[34px] rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                        historyFilterMode === 'all'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Todo el taller
                    </button>
                    <button
                      type="button"
                      onClick={() => setHistoryFilterMode('project')}
                      className={`min-h-[34px] rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                        historyFilterMode === 'project'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Solo proyecto actual
                    </button>
                  </div>
                </div>

                <div className="divide-y divide-slate-100">
                  {pageSessions.map((session) => {
                    const proj = projectMap.get(session.projectId);
                    const comp = componentMap.get(session.componentId);
                    const entryMeta = ENTRY_TYPE_META[session.entryType];
                    const hadPauses = session.pauseIntervals.length > 0;

                    return (
                      <div
                        key={session.id}
                        className="flex flex-col gap-3 py-3.5 first:pt-4 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-slate-900">
                              {proj?.name ?? 'Proyecto'} · {comp?.name ?? 'Pieza'}
                            </p>
                            <StatusBadge
                              label={entryMeta.label}
                              tone={entryMeta.tone}
                            />
                            {session.isDemo && (
                              <span className="text-xs text-slate-400">
                                · Ejemplo
                              </span>
                            )}
                          </div>

                          <p className="text-xs text-slate-500 tabular-nums">
                            {formatDateTimeCO(session.endTime ?? session.startTime)}
                            {hadPauses
                              ? ` · Bruto: ${formatClockHHMMSS(session.elapsedSeconds)} (${session.pauseIntervals.length} pausa${session.pauseIntervals.length > 1 ? 's' : ''})`
                              : ''}
                            {session.notes ? ` · ${session.notes}` : ''}
                          </p>

                          {session.adjustmentReason && (
                            <p className="text-xs text-amber-800">
                              Motivo: {session.adjustmentReason}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center justify-between gap-3 sm:justify-end shrink-0">
                          <div className="text-right">
                            <p className="font-mono text-sm font-bold text-slate-900 tabular-nums">
                              {formatClockHHMMSS(session.effectiveSeconds)}
                            </p>
                            <p className="text-[11px] text-slate-500 tabular-nums">
                              {formatDurationMinutes(
                                Math.round(session.effectiveSeconds / 60),
                              )}
                            </p>
                          </div>

                          <button
                            type="button"
                            onClick={() => openEditCompletedModal(session)}
                            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                          >
                            <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Ajustar</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            </SnapSlide>
          ))
        )}
      </SnapDeck>

      {/* MODAL REGISTRO MANUAL */}
      {manualModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="manual-timer-modal-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <h3
                  id="manual-timer-modal-title"
                  className="font-display text-lg font-semibold text-slate-900"
                >
                  Registrar tiempo manual
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Útil si tejiste sin el teléfono cerca y quieres mantener
                  cuadrado el avance real.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setManualModalOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                aria-label="Cerrar formulario"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              onSubmit={(e) => void handleSaveManualSession(e)}
              className="mt-5 space-y-4"
            >
              <div>
                <label
                  htmlFor="manual-project"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Proyecto *
                </label>
                <select
                  id="manual-project"
                  required
                  value={manualProjectId}
                  onChange={(e) => {
                    const nextProj = e.target.value;
                    setManualProjectId(nextProj);
                    const nextComp =
                      components.find((c) => c.projectId === nextProj)?.id ??
                      '';
                    setManualComponentId(nextComp);
                  }}
                  className="mt-1.5 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="manual-component"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Pieza o componente *
                </label>
                <select
                  id="manual-component"
                  required
                  value={manualComponentId}
                  onChange={(e) => setManualComponentId(e.target.value)}
                  className="mt-1.5 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                >
                  {manualModalComponents.length === 0 ? (
                    <option value="">Sin piezas en este proyecto</option>
                  ) : (
                    manualModalComponents.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="manual-minutes"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Duración *
                  </label>
                  <DurationInput
                    id="manual-minutes"
                    valueMinutes={Number(manualMinutes) || 1}
                    onChangeMinutes={(mins) => setManualMinutes(String(mins))}
                    minMinutes={1}
                    maxMinutes={1440}
                    ariaLabel="Duración del registro manual"
                    className="mt-1.5"
                  />
                </div>
                <div>
                  <label
                    htmlFor="manual-date"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Fecha
                  </label>
                  <input
                    id="manual-date"
                    type="date"
                    value={manualDate}
                    onChange={(e) => setManualDate(e.target.value)}
                    className="mt-1.5 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="manual-notes"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Notas (opcional)
                </label>
                <input
                  id="manual-notes"
                  type="text"
                  value={manualNotes}
                  onChange={(e) => setManualNotes(e.target.value)}
                  placeholder="Ej. Tejido en la tarde sin celular..."
                  className="mt-1.5 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setManualModalOpen(false)}
                  className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy || manualModalComponents.length === 0}
                  className="min-h-[44px] rounded-lg bg-teal-700 px-5 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
                >
                  {busy ? 'Guardando...' : 'Guardar tiempo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL AJUSTE DE TIEMPO AUDITABLE */}
      {adjustModalState && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="adjust-timer-modal-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <h3
                  id="adjust-timer-modal-title"
                  className="font-display text-lg font-semibold text-slate-900"
                >
                  {adjustModalState.mode === 'finish_override'
                    ? 'Finalizar sesión con ajuste'
                    : 'Ajustar tiempo efectivo'}
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  {componentMap.get(adjustModalState.session.componentId)?.name ??
                    'Pieza'}{' '}
                  · Bruto medido:{' '}
                  {formatClockHHMMSS(
                    calculateSessionDurations(adjustModalState.session, nowMs)
                      .elapsedSeconds,
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAdjustModalState(null)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                aria-label="Cerrar ajuste"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              onSubmit={(e) => void handleSubmitAdjustment(e)}
              className="mt-5 space-y-4"
            >
              <div>
                <label
                  htmlFor="adjust-minutes"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Tiempo efectivo final *
                </label>
                <DurationInput
                  id="adjust-minutes"
                  valueMinutes={Number(adjustModalState.minutesInput) || 0}
                  onChangeMinutes={(mins) =>
                    setAdjustModalState({
                      ...adjustModalState,
                      minutesInput: String(mins),
                    })
                  }
                  minMinutes={0}
                  maxMinutes={2880}
                  ariaLabel="Tiempo efectivo final"
                  className="mt-1.5"
                />
              </div>

              <div>
                <label
                  htmlFor="adjust-reason"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Motivo del ajuste *
                </label>
                <input
                  id="adjust-reason"
                  type="text"
                  required
                  minLength={3}
                  placeholder="Ej. Olvidé pausar al salir, solo tejí 45 minutos reales"
                  value={adjustModalState.reasonInput}
                  onChange={(e) =>
                    setAdjustModalState({
                      ...adjustModalState,
                      reasonInput: e.target.value,
                    })
                  }
                  className="mt-1.5 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setAdjustModalState(null)}
                  className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="min-h-[44px] rounded-lg bg-teal-700 px-5 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
                >
                  {busy ? 'Aplicando...' : 'Guardar ajuste'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Modal confirmar finalización disparada desde notificación externa */}
      <ConfirmModal
        isOpen={Boolean(finishConfirmSession)}
        title="Confirmar cierre de sesión"
        description={
          finishConfirmSession
            ? `Se guardarán ${formatClockHHMMSS(
                calculateSessionDurations(finishConfirmSession, nowMs)
                  .effectiveSeconds,
              )} efectivos en "${
                componentMap.get(finishConfirmSession.componentId)?.name ?? 'Pieza'
              }" (${
                projectMap.get(finishConfirmSession.projectId)?.name ?? 'Proyecto'
              }).`
            : ''
        }
        confirmLabel="Finalizar y guardar"
        variant="default"
        isBusy={busy}
        onCancel={() => setFinishConfirmSession(null)}
        onConfirm={() => {
          if (!finishConfirmSession) return;
          void handleFinishExact(finishConfirmSession).then(() => {
            setFinishConfirmSession(null);
          });
        }}
      />
    </>
  );
};

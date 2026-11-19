import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  Pause,
  Play,
  SlidersHorizontal,
} from 'lucide-react';
import { useWorkshopData } from '@/src/data/DataContext.tsx';
import { formatDateTimeCO } from '@/src/domain/services/formatters.ts';
import {
  calculateSessionDurations,
  formatClockHHMMSS,
  getOtherPausedTimerSessions,
  isTimerPastMinutes,
  isUnusuallyLongActiveSession,
} from '@/src/domain/services/timerEngine.ts';
import { getNotificationCapabilities } from '@/src/pwa/notificationBridge.ts';
import { ConfirmModal } from '@/src/shared/components/ConfirmModal.tsx';
import { useLiveNowMs } from '@/src/shared/hooks/useLiveNowMs.ts';
import {
  clearTimerNoteDraft,
  getTimerNoteDraft,
  setTimerNoteDraft,
} from './timerDraftStorage.ts';

interface FloatingTimerDockProps {
  onOpenTimerView(target?: { projectId?: string; componentId?: string }): void;
  onOpenProject?(projectId: string): void;
}

export const FloatingTimerDock: React.FC<FloatingTimerDockProps> = ({
  onOpenTimerView,
  onOpenProject,
}) => {
  const {
    activeTimerSession,
    workSessions,
    projects,
    components,
    settings,
    pauseTimerSession,
    resumeTimerSession,
    finishTimerSession,
  } = useWorkshopData();

  const isRunning = activeTimerSession?.status === 'running';
  const nowMs = useLiveNowMs(Boolean(isRunning));

  const [busy, setBusy] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [confirmFinishOpen, setConfirmFinishOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const otherPausedSessions = useMemo(
    () =>
      activeTimerSession
        ? getOtherPausedTimerSessions(workSessions, activeTimerSession.id)
        : [],
    [workSessions, activeTimerSession],
  );

  useEffect(() => {
    if (!activeTimerSession) {
      setPanelOpen(false);
      setNoteDraft('');
      return;
    }
    const stored = getTimerNoteDraft(activeTimerSession.componentId);
    setNoteDraft(stored !== undefined ? stored : activeTimerSession.notes);
  }, [activeTimerSession?.id, activeTimerSession?.componentId, activeTimerSession?.notes]);

  if (!activeTimerSession) {
    return null;
  }

  const project = projects.find((p) => p.id === activeTimerSession.projectId);
  const component = components.find(
    (c) => c.id === activeTimerSession.componentId,
  );
  const durations = calculateSessionDurations(activeTimerSession, nowMs);
  const unusuallyLong = isUnusuallyLongActiveSession(activeTimerSession, nowMs);
  const forgottenThresholdMins = Math.max(
    15,
    settings.forgottenTimerThresholdMinutes ?? 180,
  );
  const pastForgottenThreshold = isTimerPastMinutes(
    activeTimerSession,
    forgottenThresholdMins,
    nowMs,
  );
  const notifCaps = getNotificationCapabilities();

  const handleTogglePause = async () => {
    setBusy(true);
    setErrorMsg(null);
    try {
      if (isRunning) {
        await pauseTimerSession(activeTimerSession.id);
      } else {
        await resumeTimerSession(activeTimerSession.id);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'No se pudo actualizar el cronómetro.',
      );
    } finally {
      setBusy(false);
    }
  };

  const handleNoteChange = (nextVal: string) => {
    setNoteDraft(nextVal);
    setTimerNoteDraft(activeTimerSession.componentId, nextVal);
  };

  const handleFinishClick = () => {
    if (unusuallyLong) {
      onOpenTimerView({
        projectId: activeTimerSession.projectId,
        componentId: activeTimerSession.componentId,
      });
      return;
    }
    setConfirmFinishOpen(true);
  };

  const handleConfirmFinish = async () => {
    setBusy(true);
    setErrorMsg(null);
    try {
      const storedDraft = getTimerNoteDraft(activeTimerSession.componentId);
      const finalNotes =
        storedDraft !== undefined ? storedDraft : activeTimerSession.notes;
      await finishTimerSession(activeTimerSession.id, {
        notes: finalNotes,
      });
      clearTimerNoteDraft(activeTimerSession.componentId);
      setConfirmFinishOpen(false);
      setPanelOpen(false);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'No se pudo finalizar la sesión.',
      );
      setConfirmFinishOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div
        className={`rounded-xl border bg-white p-3 shadow-md transition-colors lg:shadow-none ${
          unusuallyLong || pastForgottenThreshold
            ? 'border-amber-300 bg-amber-50/40'
            : isRunning
              ? 'border-teal-200'
              : 'border-slate-200'
        }`}
        role="region"
        aria-label="Control global del cronómetro"
      >
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() =>
              onOpenTimerView({
                projectId: activeTimerSession.projectId,
                componentId: activeTimerSession.componentId,
              })
            }
            className="min-w-0 flex-1 text-left"
          >
            <div className="flex items-center gap-1.5 text-[11px] font-semibold">
              {isRunning ? (
                <span
                  aria-hidden="true"
                  className="h-2 w-2 shrink-0 rounded-full bg-teal-600 animate-pulse"
                />
              ) : (
                <Clock className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden="true" />
              )}
              <span className={isRunning ? 'text-teal-800' : 'text-amber-700'}>
                {isRunning ? 'Tejiendo ahora' : 'En pausa'}
              </span>
              {(unusuallyLong || pastForgottenThreshold) && (
                <span className="inline-flex items-center gap-1 text-amber-800">
                  ·
                  <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span>{unusuallyLong ? 'Revisar (+4h)' : 'Sesión larga'}</span>
                </span>
              )}
              {otherPausedSessions.length > 0 && (
                <span className="text-slate-400 font-medium">
                  · +{otherPausedSessions.length} paus.
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-xs font-semibold text-slate-900">
              {component?.name ?? 'Pieza'}
            </p>
            <p className="truncate text-[11px] text-slate-500">
              {project?.name ?? 'Proyecto'}
            </p>
          </button>

          <div className="flex items-center gap-1 shrink-0">
            <span className="font-mono text-sm font-bold text-slate-900 tabular-nums mr-1">
              {formatClockHHMMSS(durations.effectiveSeconds)}
            </span>

            <button
              type="button"
              disabled={busy}
              onClick={() => void handleTogglePause()}
              className={`inline-flex h-10 w-10 items-center justify-center rounded-lg border transition-colors ${
                isRunning
                  ? 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100'
                  : 'border-teal-700 bg-teal-700 text-white hover:bg-teal-800'
              }`}
              aria-label={isRunning ? 'Pausar cronómetro' : 'Reanudar cronómetro'}
              title={isRunning ? 'Pausar' : 'Reanudar'}
            >
              {isRunning ? (
                <Pause className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Play className="h-4 w-4" aria-hidden="true" />
              )}
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={handleFinishClick}
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 transition-colors hover:bg-slate-50"
              aria-label="Finalizar y guardar sesión"
              title="Finalizar sesión"
            >
              <Check className="h-4 w-4 text-emerald-700" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => setPanelOpen((v) => !v)}
              aria-expanded={panelOpen}
              aria-label={panelOpen ? 'Contraer controles rápidos' : 'Expandir controles rápidos'}
              className="inline-flex h-10 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
            >
              {panelOpen ? (
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              ) : (
                <ChevronUp className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        {errorMsg && (
          <p className="mt-2 rounded-lg bg-rose-50 px-2.5 py-1.5 text-[11px] text-rose-800">
            {errorMsg}
          </p>
        )}

        {panelOpen && (
          <div className="mt-3 space-y-2.5 border-t border-slate-200/80 pt-2.5 text-[11px]">
            <div className="flex flex-wrap items-center justify-between gap-2 text-slate-600">
              <span>
                Inicio:{' '}
                <strong className="font-mono text-slate-800 tabular-nums">
                  {formatDateTimeCO(activeTimerSession.startTime)}
                </strong>
              </span>
              <span className="font-mono tabular-nums">
                Bruto {formatClockHHMMSS(durations.elapsedSeconds)} · Pausas{' '}
                {formatClockHHMMSS(durations.pausedSeconds)}
              </span>
            </div>

            <div>
              <label
                htmlFor="floating-timer-note"
                className="block text-[11px] font-medium text-slate-600"
              >
                Nota rápida de la sesión (se guarda al instante)
              </label>
              <input
                id="floating-timer-note"
                type="text"
                value={noteDraft}
                onChange={(e) => handleNoteChange(e.target.value)}
                placeholder="Ej. Vuelta 18, cambio de aguja..."
                className="mt-1 w-full min-h-[36px] rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-slate-900 focus:border-teal-700 focus:outline-none"
              />
            </div>

            {otherPausedSessions.length > 0 && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 space-y-1.5">
                <p className="font-semibold text-slate-700">
                  Otras sesiones en pausa ({otherPausedSessions.length})
                </p>
                {otherPausedSessions.slice(0, 2).map((sess) => {
                  const sProj = projects.find((p) => p.id === sess.projectId);
                  const sComp = components.find((c) => c.id === sess.componentId);
                  const sBreakdown = calculateSessionDurations(sess, nowMs);
                  return (
                    <div
                      key={sess.id}
                      className="flex items-center justify-between gap-2 rounded-md bg-white px-2 py-1 border border-slate-100"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-slate-800">
                          {sComp?.name ?? 'Pieza'}
                        </p>
                        <p className="truncate text-[10px] text-slate-500">
                          {sProj?.name ?? 'Proyecto'} ·{' '}
                          {formatClockHHMMSS(sBreakdown.effectiveSeconds)}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void resumeTimerSession(sess.id)}
                        className="shrink-0 rounded-md bg-teal-50 px-2 py-1 text-[10px] font-semibold text-teal-800 hover:bg-teal-100"
                      >
                        Reanudar
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
              <span className="inline-flex items-center gap-1 text-[10px] text-slate-500">
                <Bell className="h-3 w-3 shrink-0" aria-hidden="true" />
                {notifCaps.permission === 'granted' &&
                Boolean(settings.enableBrowserNotifications)
                  ? 'Aviso PWA activo'
                  : 'Persistencia local activa'}
              </span>

              <div className="flex items-center gap-2">
                {onOpenProject && (
                  <button
                    type="button"
                    onClick={() => onOpenProject(activeTimerSession.projectId)}
                    className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <span>Proyecto</span>
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() =>
                    onOpenTimerView({
                      projectId: activeTimerSession.projectId,
                      componentId: activeTimerSession.componentId,
                    })
                  }
                  className="inline-flex min-h-[32px] items-center gap-1 rounded-lg bg-slate-900 px-2.5 text-[11px] font-semibold text-white hover:bg-slate-800"
                >
                  <SlidersHorizontal className="h-3 w-3" aria-hidden="true" />
                  <span>Vista completa</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <ConfirmModal
        isOpen={confirmFinishOpen}
        title="Finalizar sesión de tejido"
        description={`Se guardarán ${formatClockHHMMSS(durations.effectiveSeconds)} efectivos en la pieza "${component?.name ?? 'seleccionada'}" del proyecto "${project?.name ?? ''}".`}
        confirmLabel="Guardar sesión"
        variant="default"
        isBusy={busy}
        onCancel={() => setConfirmFinishOpen(false)}
        onConfirm={() => void handleConfirmFinish()}
      />
    </>
  );
};

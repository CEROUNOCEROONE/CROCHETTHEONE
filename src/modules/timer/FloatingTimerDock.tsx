import React, { useEffect, useState } from 'react';
import { AlertTriangle, Check, Clock, Pause, Play } from 'lucide-react';
import { useWorkshopData } from '@/src/data/DataContext.tsx';
import {
  calculateSessionDurations,
  formatClockHHMMSS,
  isUnusuallyLongActiveSession,
} from '@/src/domain/services/timerEngine.ts';
import { ConfirmModal } from '@/src/shared/components/ConfirmModal.tsx';
import {
  clearTimerNoteDraft,
  getTimerNoteDraft,
} from './timerDraftStorage.ts';

interface FloatingTimerDockProps {
  onOpenTimerView(): void;
}

export const FloatingTimerDock: React.FC<FloatingTimerDockProps> = ({
  onOpenTimerView,
}) => {
  const {
    activeTimerSession,
    projects,
    components,
    pauseTimerSession,
    resumeTimerSession,
    finishTimerSession,
  } = useWorkshopData();

  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [confirmFinishOpen, setConfirmFinishOpen] = useState(false);

  useEffect(() => {
    setNowMs(Date.now());
    if (!activeTimerSession || activeTimerSession.status !== 'running') {
      return;
    }
    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [activeTimerSession]);

  if (!activeTimerSession) {
    return null;
  }

  const project = projects.find((p) => p.id === activeTimerSession.projectId);
  const component = components.find(
    (c) => c.id === activeTimerSession.componentId,
  );
  const durations = calculateSessionDurations(activeTimerSession, nowMs);
  const isRunning = activeTimerSession.status === 'running';
  const unusuallyLong = isUnusuallyLongActiveSession(activeTimerSession, nowMs);

  const handleTogglePause = async () => {
    setBusy(true);
    try {
      if (isRunning) {
        await pauseTimerSession(activeTimerSession.id);
      } else {
        await resumeTimerSession(activeTimerSession.id);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleFinishClick = () => {
    if (unusuallyLong) {
      onOpenTimerView();
      return;
    }
    setConfirmFinishOpen(true);
  };

  const handleConfirmFinish = async () => {
    setBusy(true);
    try {
      const draft = getTimerNoteDraft(activeTimerSession.componentId);
      await finishTimerSession(activeTimerSession.id, {
        notes: draft !== undefined ? draft : activeTimerSession.notes,
      });
      clearTimerNoteDraft(activeTimerSession.componentId);
      setConfirmFinishOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div
        className="rounded-xl border border-slate-200 bg-white p-3 shadow-md lg:shadow-none"
        role="region"
        aria-label="Mini-reproductor del cronómetro"
      >
        <div className="flex items-center justify-between gap-2.5">
          <button
            type="button"
            onClick={onOpenTimerView}
            className="min-w-0 flex-1 text-left"
          >
            <div className="flex items-center gap-1.5 text-[11px] font-semibold">
              <Clock
                className={`h-3.5 w-3.5 shrink-0 ${
                  isRunning ? 'text-teal-700' : 'text-amber-600'
                }`}
                aria-hidden="true"
              />
              <span className={isRunning ? 'text-teal-800' : 'text-amber-700'}>
                {isRunning ? 'Tejiendo ahora' : 'En pausa'}
              </span>
              {unusuallyLong && (
                <span className="inline-flex items-center gap-1 text-amber-700">
                  ·
                  <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                  Revisar duración
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

          <div className="flex items-center gap-1.5 shrink-0">
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
          </div>
        </div>
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

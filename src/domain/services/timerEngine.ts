import type { PauseInterval, WorkSession } from '@/src/domain/models/index.ts';

export const LONG_SESSION_THRESHOLD_SECONDS = 4 * 3600; // 4 horas

export interface SessionDurationBreakdown {
  readonly elapsedSeconds: number;
  readonly pausedSeconds: number;
  readonly effectiveSeconds: number;
  readonly effectiveMinutes: number;
}

/**
 * Calcula duración bruta, tiempo en pausa y tiempo efectivo exclusivamente
 * a partir de marcas de tiempo ISO-8601. Permite cerrar y reabrir el navegador
 * sin perder ni un segundo ni depender de intervalos en memoria.
 */
export function calculateSessionDurations(
  session: Pick<WorkSession, 'startTime' | 'endTime' | 'status' | 'pauseIntervals'>,
  referenceNowMs: number = Date.now(),
): SessionDurationBreakdown {
  const startMs = Date.parse(session.startTime);
  if (Number.isNaN(startMs)) {
    return { elapsedSeconds: 0, pausedSeconds: 0, effectiveSeconds: 0, effectiveMinutes: 0 };
  }

  const safeRefMs = Number.isFinite(referenceNowMs) ? referenceNowMs : Date.now();
  const endMsRaw = session.endTime ? Date.parse(session.endTime) : safeRefMs;
  const endMs = Number.isNaN(endMsRaw) ? Math.max(startMs, safeRefMs) : Math.max(startMs, endMsRaw);
  const elapsedSeconds = Math.max(0, Math.floor((endMs - startMs) / 1000));

  // Normalizar y fusionar intervalos de pausa para resistir cambios de hora del reloj del dispositivo
  const clampedIntervals: Array<{ start: number; end: number }> = [];
  for (const interval of session.pauseIntervals) {
    const pStart = Date.parse(interval.pausedAt);
    if (Number.isNaN(pStart)) continue;
    const clampedStart = Math.max(startMs, Math.min(endMs, pStart));
    const pEndRaw = interval.resumedAt ? Date.parse(interval.resumedAt) : endMs;
    const pEnd = Number.isNaN(pEndRaw)
      ? endMs
      : Math.max(clampedStart, Math.min(endMs, pEndRaw));
    if (pEnd > clampedStart) {
      clampedIntervals.push({ start: clampedStart, end: pEnd });
    }
  }

  clampedIntervals.sort((a, b) => a.start - b.start);

  let pausedMs = 0;
  let currentWindow: { start: number; end: number } | null = null;
  for (const item of clampedIntervals) {
    if (!currentWindow) {
      currentWindow = { ...item };
      continue;
    }
    if (item.start <= currentWindow.end) {
      currentWindow.end = Math.max(currentWindow.end, item.end);
    } else {
      pausedMs += currentWindow.end - currentWindow.start;
      currentWindow = { ...item };
    }
  }
  if (currentWindow) {
    pausedMs += currentWindow.end - currentWindow.start;
  }

  const pausedSeconds = Math.min(elapsedSeconds, Math.floor(pausedMs / 1000));
  const effectiveSeconds = Math.max(0, elapsedSeconds - pausedSeconds);
  const effectiveMinutes = Math.round(effectiveSeconds / 60);

  return {
    elapsedSeconds,
    pausedSeconds,
    effectiveSeconds,
    effectiveMinutes,
  };
}

export function formatClockHHMMSS(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return [
    String(hours).padStart(2, '0'),
    String(minutes).padStart(2, '0'),
    String(seconds).padStart(2, '0'),
  ].join(':');
}

export function closeOpenPauseIntervals(
  intervals: PauseInterval[],
  resumedAtIso: string,
): PauseInterval[] {
  return intervals.map((item) =>
    item.resumedAt === null ? { ...item, resumedAt: resumedAtIso } : item,
  );
}

export function isUnusuallyLongActiveSession(
  session: WorkSession,
  referenceNowMs: number = Date.now(),
): boolean {
  if (session.status !== 'running') return false;
  const { effectiveSeconds } = calculateSessionDurations(session, referenceNowMs);
  return effectiveSeconds >= LONG_SESSION_THRESHOLD_SECONDS;
}

export function isTimerPastMinutes(
  session: WorkSession,
  thresholdMinutes: number,
  referenceNowMs: number = Date.now(),
): boolean {
  if (session.status !== 'running' || thresholdMinutes <= 0) return false;
  const { effectiveSeconds } = calculateSessionDurations(session, referenceNowMs);
  return effectiveSeconds >= thresholdMinutes * 60;
}

/**
 * Selecciona la sesión global prioritaria: primero la que está corriendo,
 * y si no hay ninguna corriendo, la sesión pausada más reciente.
 */
export function resolveActiveTimerCandidate(
  allSessions: ReadonlyArray<WorkSession>,
): WorkSession | null {
  const running = allSessions.find((s) => s.status === 'running');
  if (running) return running;
  const paused = allSessions
    .filter((s) => s.status === 'paused')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return paused[0] ?? null;
}

export function getOtherPausedTimerSessions(
  allSessions: ReadonlyArray<WorkSession>,
  primarySessionId: string | null,
): WorkSession[] {
  return allSessions
    .filter((s) => s.status === 'paused' && s.id !== primarySessionId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * Fuente única de verdad para el tiempo acumulado en un componente:
 * suma el tiempo efectivo de todas sus sesiones completadas (cronómetro, manual o ajustado).
 */
export function sumComponentEffectiveMinutes(
  componentId: string,
  allSessions: WorkSession[],
): number {
  const totalSeconds = allSessions
    .filter((s) => s.componentId === componentId && s.status === 'completed')
    .reduce((acc, s) => acc + Math.max(0, s.effectiveSeconds), 0);
  return Math.round(totalSeconds / 60);
}

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

  const endMsRaw = session.endTime ? Date.parse(session.endTime) : referenceNowMs;
  const endMs = Number.isNaN(endMsRaw) ? referenceNowMs : Math.max(startMs, endMsRaw);
  const elapsedSeconds = Math.max(0, Math.floor((endMs - startMs) / 1000));

  let pausedMs = 0;
  for (const interval of session.pauseIntervals) {
    const pStart = Date.parse(interval.pausedAt);
    if (Number.isNaN(pStart)) continue;
    const clampedStart = Math.max(startMs, Math.min(endMs, pStart));
    const pEndRaw = interval.resumedAt ? Date.parse(interval.resumedAt) : endMs;
    const pEnd = Number.isNaN(pEndRaw) ? endMs : Math.max(clampedStart, Math.min(endMs, pEndRaw));
    pausedMs += Math.max(0, pEnd - clampedStart);
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

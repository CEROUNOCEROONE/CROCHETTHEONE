import type {
  Project,
  ProjectComponent,
  WorkSession,
  WorkshopSettings,
} from '@/src/domain/models/index.ts';
import { formatDurationMinutes } from './formatters.ts';
import type { SmartAlertItem } from './planningService.ts';
import { calculateSessionDurations, formatClockHHMMSS } from './timerEngine.ts';

export const ACTIVE_TIMER_NOTIFICATION_TAG = 'crochet-active-timer';
export const TIMER_REMINDER_NOTIFICATION_TAG = 'crochet-timer-reminder';

export interface NotificationActionDescriptor {
  readonly action: 'pause' | 'resume' | 'finish' | 'open';
  readonly title: string;
}

export interface TimerNotificationPayload {
  readonly title: string;
  readonly body: string;
  readonly tag: string;
  readonly renotify: boolean;
  readonly requireInteraction: boolean;
  readonly silent: boolean;
  readonly actions: NotificationActionDescriptor[];
  readonly data: {
    readonly kind: 'active_timer' | 'timer_milestone';
    readonly sessionId: string;
    readonly projectId: string;
    readonly componentId: string;
    readonly status: 'running' | 'paused';
    readonly route: 'timer';
    readonly url: string;
  };
}

export interface WorkshopAlertNotificationPayload {
  readonly alertId: string;
  readonly dedupeKey: string;
  readonly title: string;
  readonly body: string;
  readonly tag: string;
  readonly requireInteraction: boolean;
  readonly data: {
    readonly kind: 'workshop_alert';
    readonly alertId: string;
    readonly alertType: SmartAlertItem['type'];
    readonly relatedEntityId: string | null;
    readonly relatedEntityType: SmartAlertItem['relatedEntityType'];
    readonly route: 'projects' | 'clients' | 'shopping' | 'inventory' | 'planner' | 'timer';
    readonly url: string;
  };
}

function formatStartClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function buildActiveTimerNotificationPayload(params: {
  readonly session: WorkSession;
  readonly project: Project | null | undefined;
  readonly component: ProjectComponent | null | undefined;
  readonly nowMs?: number;
  readonly renotify?: boolean;
}): TimerNotificationPayload {
  const { session, project, component, nowMs = Date.now(), renotify = false } = params;
  const projectName = project?.name ?? 'Proyecto de tejido';
  const componentName = component?.name ?? 'Pieza';
  const breakdown = calculateSessionDurations(session, nowMs);
  const formattedTime = formatClockHHMMSS(breakdown.effectiveSeconds);
  const startedClock = formatStartClock(session.startTime);
  const isRunning = session.status === 'running';

  const title = isRunning
    ? '🧶 Tiempo de tejido en curso'
    : '⏸️ Cronómetro de tejido en pausa';

  const body = isRunning
    ? `${projectName} · ${componentName}\nTiempo: ${formattedTime}${startedClock ? ` (inicio ${startedClock})` : ''}`
    : `${projectName} · ${componentName}\nAcumulado en pausa: ${formattedTime}`;

  const actions: NotificationActionDescriptor[] = isRunning
    ? [
        { action: 'pause', title: 'Pausar' },
        { action: 'finish', title: 'Finalizar' },
      ]
    : [
        { action: 'resume', title: 'Reanudar' },
        { action: 'finish', title: 'Finalizar' },
      ];

  return {
    title,
    body,
    tag: ACTIVE_TIMER_NOTIFICATION_TAG,
    renotify,
    requireInteraction: isRunning,
    silent: !renotify,
    actions,
    data: {
      kind: 'active_timer',
      sessionId: session.id,
      projectId: session.projectId,
      componentId: session.componentId,
      status: isRunning ? 'running' : 'paused',
      route: 'timer',
      url: `/?route=timer&projectId=${encodeURIComponent(session.projectId)}&componentId=${encodeURIComponent(session.componentId)}`,
    },
  };
}

export function evaluateTimerMilestoneNotification(params: {
  readonly session: WorkSession;
  readonly project: Project | null | undefined;
  readonly component: ProjectComponent | null | undefined;
  readonly settings: Pick<
    WorkshopSettings,
    'enableTimerNotifications' | 'timerReminderIntervalMinutes' | 'forgottenTimerThresholdMinutes'
  >;
  readonly lastSentMilestoneKey: string | null;
  readonly nowMs?: number;
}): {
  readonly shouldNotify: boolean;
  readonly milestoneKey: string | null;
  readonly isForgottenAlert: boolean;
  readonly payload: TimerNotificationPayload | null;
} {
  const {
    session,
    project,
    component,
    settings,
    lastSentMilestoneKey,
    nowMs = Date.now(),
  } = params;

  if (session.status !== 'running' || settings.enableTimerNotifications === false) {
    return { shouldNotify: false, milestoneKey: null, isForgottenAlert: false, payload: null };
  }

  const breakdown = calculateSessionDurations(session, nowMs);
  const elapsedMinutes = Math.floor(breakdown.effectiveSeconds / 60);
  const intervalMinutes = Math.max(0, settings.timerReminderIntervalMinutes ?? 60);
  const forgottenMinutes = Math.max(15, settings.forgottenTimerThresholdMinutes ?? 180);

  const projectName = project?.name ?? 'Proyecto';
  const componentName = component?.name ?? 'Pieza';

  // Prioridad 1: umbral de cronómetro olvidado / sesión excesiva
  if (elapsedMinutes >= forgottenMinutes) {
    const forgottenBucket = Math.floor((elapsedMinutes - forgottenMinutes) / 60);
    const key = `forgotten:${session.id}:${forgottenBucket}`;
    if (key === lastSentMilestoneKey) {
      return { shouldNotify: false, milestoneKey: key, isForgottenAlert: true, payload: null };
    }
    return {
      shouldNotify: true,
      milestoneKey: key,
      isForgottenAlert: true,
      payload: {
        title: '⏰ ¿Sigues tejiendo? Cronómetro activo',
        body: `${projectName} · ${componentName}\nLleva ${formatClockHHMMSS(breakdown.effectiveSeconds)} (${formatDurationMinutes(breakdown.effectiveMinutes)}) en marcha.`,
        tag: TIMER_REMINDER_NOTIFICATION_TAG,
        renotify: true,
        requireInteraction: true,
        silent: false,
        actions: [
          { action: 'pause', title: 'Pausar' },
          { action: 'finish', title: 'Finalizar' },
        ],
        data: {
          kind: 'timer_milestone',
          sessionId: session.id,
          projectId: session.projectId,
          componentId: session.componentId,
          status: 'running',
          route: 'timer',
          url: `/?route=timer&projectId=${encodeURIComponent(session.projectId)}&componentId=${encodeURIComponent(session.componentId)}`,
        },
      },
    };
  }

  // Prioridad 2: recordatorio periódico configurable mientras se teje
  if (intervalMinutes > 0 && elapsedMinutes >= intervalMinutes) {
    const intervalStep = Math.floor(elapsedMinutes / intervalMinutes);
    const key = `interval:${session.id}:${intervalStep}`;
    if (key === lastSentMilestoneKey) {
      return { shouldNotify: false, milestoneKey: key, isForgottenAlert: false, payload: null };
    }
    return {
      shouldNotify: true,
      milestoneKey: key,
      isForgottenAlert: false,
      payload: {
        title: `🧶 Llevas ${formatDurationMinutes(intervalStep * intervalMinutes)} tejiendo`,
        body: `${projectName} · ${componentName}\nTiempo efectivo actual: ${formatClockHHMMSS(breakdown.effectiveSeconds)}.`,
        tag: TIMER_REMINDER_NOTIFICATION_TAG,
        renotify: true,
        requireInteraction: false,
        silent: false,
        actions: [
          { action: 'pause', title: 'Pausar' },
          { action: 'finish', title: 'Finalizar' },
        ],
        data: {
          kind: 'timer_milestone',
          sessionId: session.id,
          projectId: session.projectId,
          componentId: session.componentId,
          status: 'running',
          route: 'timer',
          url: `/?route=timer&projectId=${encodeURIComponent(session.projectId)}&componentId=${encodeURIComponent(session.componentId)}`,
        },
      },
    };
  }

  return { shouldNotify: false, milestoneKey: null, isForgottenAlert: false, payload: null };
}

function parseHHMMToMinutes(hhmm: string | undefined, fallbackMinutes: number): number {
  if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return fallbackMinutes;
  const [hStr, mStr] = hhmm.split(':');
  const h = Number.parseInt(hStr, 10);
  const m = Number.parseInt(mStr, 10);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    return fallbackMinutes;
  }
  return h * 60 + m;
}

export function isWithinQuietHours(
  settings: Pick<WorkshopSettings, 'quietHoursEnabled' | 'quietHoursStart' | 'quietHoursEnd'>,
  nowDate: Date = new Date(),
): boolean {
  if (!settings.quietHoursEnabled) return false;
  const startMin = parseHHMMToMinutes(settings.quietHoursStart, 22 * 60);
  const endMin = parseHHMMToMinutes(settings.quietHoursEnd, 7 * 60);
  if (startMin === endMin) return false;
  const currentMin = nowDate.getHours() * 60 + nowDate.getMinutes();
  if (startMin < endMin) {
    return currentMin >= startMin && currentMin < endMin;
  }
  // Rango que cruza medianoche (ej. 22:00 a 07:00)
  return currentMin >= startMin || currentMin < endMin;
}

export function resolveAlertTargetRoute(
  alert: Pick<SmartAlertItem, 'relatedEntityType' | 'relatedEntityId' | 'type'>,
): {
  readonly route: 'projects' | 'clients' | 'shopping' | 'inventory' | 'planner' | 'timer';
  readonly url: string;
} {
  if (alert.type === 'timer_reminder' || alert.relatedEntityType === 'work_session') {
    return { route: 'timer', url: '/?route=timer' };
  }
  if (alert.relatedEntityType === 'project' && alert.relatedEntityId) {
    return {
      route: 'projects',
      url: `/?route=projects&projectId=${encodeURIComponent(alert.relatedEntityId)}`,
    };
  }
  if (alert.relatedEntityType === 'installment' || alert.relatedEntityType === 'client') {
    return { route: 'clients', url: '/?route=clients' };
  }
  if (alert.relatedEntityType === 'pending_material') {
    return { route: 'shopping', url: '/?route=shopping' };
  }
  if (alert.relatedEntityType === 'variant') {
    return { route: 'inventory', url: '/?route=inventory' };
  }
  return { route: 'planner', url: '/?route=planner' };
}

export function buildWorkshopAlertNotificationPayload(
  alert: SmartAlertItem,
): WorkshopAlertNotificationPayload {
  const target = resolveAlertTargetRoute(alert);
  const prefix =
    alert.urgency === 'overdue'
      ? '⚠️ Atención urgente'
      : alert.urgency === 'due_soon'
        ? '🔔 Recordatorio próximo'
        : '📅 Recordatorio del taller';

  return {
    alertId: alert.id,
    dedupeKey: `alert:${alert.id}:${alert.urgency}`,
    title: `${prefix}: ${alert.title}`,
    body: alert.message || 'Abre App Crochet para revisar este aviso.',
    tag: `crochet-alert-${alert.id}`,
    requireInteraction: alert.urgency === 'overdue',
    data: {
      kind: 'workshop_alert',
      alertId: alert.id,
      alertType: alert.type,
      relatedEntityId: alert.relatedEntityId,
      relatedEntityType: alert.relatedEntityType,
      route: target.route,
      url: target.url,
    },
  };
}

export function shouldDispatchNotificationWithCooldown(params: {
  readonly dedupeKey: string;
  readonly dispatchLog: Record<string, number>;
  readonly cooldownMs: number;
  readonly nowMs?: number;
}): boolean {
  const { dedupeKey, dispatchLog, cooldownMs, nowMs = Date.now() } = params;
  const lastAt = dispatchLog[dedupeKey];
  if (typeof lastAt !== 'number' || !Number.isFinite(lastAt)) return true;
  return nowMs - lastAt >= cooldownMs;
}

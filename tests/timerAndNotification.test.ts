import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultWorkshopSettings, normalizeWorkshopSettings } from '../src/data/local/indexedDbClient.ts';
import type {
  Client,
  Material,
  MaterialVariant,
  PaymentInstallment,
  PaymentPlan,
  PendingMaterial,
  Project,
  ProjectComponent,
  Reminder,
  WorkSession,
} from '../src/domain/models/index.ts';
import {
  ACTIVE_TIMER_NOTIFICATION_TAG,
  buildActiveTimerNotificationPayload,
  buildWorkshopAlertNotificationPayload,
  evaluateTimerMilestoneNotification,
  isWithinQuietHours,
  shouldDispatchNotificationWithCooldown,
} from '../src/domain/services/notificationEngine.ts';
import { resolveSmartRemindersAndAlerts } from '../src/domain/services/planningService.ts';
import {
  calculateSessionDurations,
  getOtherPausedTimerSessions,
  resolveActiveTimerCandidate,
} from '../src/domain/services/timerEngine.ts';

function makeSession(overrides: Partial<WorkSession> = {}): WorkSession {
  return {
    id: 'sess-1',
    ownerId: 'local-workshop',
    syncStatus: 'local_only',
    projectId: 'proj-1',
    componentId: 'comp-1',
    entryType: 'timer',
    status: 'running',
    startTime: '2026-05-10T10:00:00.000Z',
    endTime: null,
    pauseIntervals: [],
    elapsedSeconds: 0,
    effectiveSeconds: 0,
    adjustmentReason: null,
    notes: '',
    version: 1,
    isDemo: false,
    createdAt: '2026-05-10T10:00:00.000Z',
    updatedAt: '2026-05-10T10:00:00.000Z',
    ...overrides,
  };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    ownerId: 'local-workshop',
    syncStatus: 'local_only',
    name: 'Amigurumi Conejo',
    description: '',
    referencePhotoUrl: null,
    clientId: 'client-1',
    patternId: null,
    startDate: '2026-05-01T10:00:00.000Z',
    estimatedEndDate: '2026-05-12T12:00:00.000Z',
    targetTotalMinutes: 240,
    dailyGoalMinutes: 60,
    weeklyGoalMinutes: 300,
    estimatedBudgetCOP: 90000,
    status: 'in_progress',
    paymentStatus: 'unpaid',
    isDemo: false,
    notes: '',
    version: 1,
    createdAt: '2026-05-01T10:00:00.000Z',
    updatedAt: '2026-05-10T10:00:00.000Z',
    ...overrides,
  };
}

function makeComponent(overrides: Partial<ProjectComponent> = {}): ProjectComponent {
  return {
    id: 'comp-1',
    ownerId: 'local-workshop',
    syncStatus: 'local_only',
    projectId: 'proj-1',
    name: 'Cabeza',
    orderIndex: 1,
    status: 'in_progress',
    estimatedMinutes: 120,
    effectiveMinutesSpent: 0,
    requiredVariantIds: [],
    isDemo: false,
    notes: '',
    version: 1,
    createdAt: '2026-05-01T10:00:00.000Z',
    updatedAt: '2026-05-10T10:00:00.000Z',
    ...overrides,
  };
}

test('calculateSessionDurations computes accurate durations across background sleep & midnight rollover', () => {
  const session = makeSession({
    startTime: '2026-05-10T23:30:00.000Z',
    pauseIntervals: [
      {
        pausedAt: '2026-05-10T23:50:00.000Z',
        resumedAt: '2026-05-11T00:05:00.000Z',
      },
    ],
  });
  const refMs = Date.parse('2026-05-11T01:00:00.000Z');
  const breakdown = calculateSessionDurations(session, refMs);

  // Total 1h 30m = 5400s, Pausa 15m = 900s -> Efectivo 4500s (75 min)
  assert.equal(breakdown.elapsedSeconds, 5400);
  assert.equal(breakdown.pausedSeconds, 900);
  assert.equal(breakdown.effectiveSeconds, 4500);
  assert.equal(breakdown.effectiveMinutes, 75);
});

test('calculateSessionDurations resists clock skew backward and overlapping pause intervals', () => {
  const session = makeSession({
    startTime: '2026-05-10T12:00:00.000Z',
    pauseIntervals: [
      {
        pausedAt: '2026-05-10T11:55:00.000Z', // antes del startTime por ajuste de reloj
        resumedAt: '2026-05-10T12:10:00.000Z',
      },
      {
        pausedAt: '2026-05-10T12:05:00.000Z', // solapado con la pausa anterior
        resumedAt: '2026-05-10T12:15:00.000Z',
      },
    ],
  });
  const refPastMs = Date.parse('2026-05-10T11:50:00.000Z');
  const skewedBack = calculateSessionDurations(session, refPastMs);
  assert.equal(skewedBack.elapsedSeconds, 0);
  assert.equal(skewedBack.pausedSeconds, 0);
  assert.equal(skewedBack.effectiveSeconds, 0);

  const normalRefMs = Date.parse('2026-05-10T12:25:00.000Z');
  const merged = calculateSessionDurations(session, normalRefMs);
  assert.equal(merged.elapsedSeconds, 1500);
  assert.equal(merged.pausedSeconds, 900); // [12:00..12:15] fusionado = 15 min
  assert.equal(merged.effectiveSeconds, 600);
});

test('resolveActiveTimerCandidate prioritizes running session and preserves paused queue', () => {
  const pausedOld = makeSession({
    id: 'p-old',
    status: 'paused',
    updatedAt: '2026-05-10T09:00:00.000Z',
  });
  const pausedNew = makeSession({
    id: 'p-new',
    status: 'paused',
    updatedAt: '2026-05-10T11:00:00.000Z',
  });
  const running = makeSession({
    id: 'run-1',
    status: 'running',
    updatedAt: '2026-05-10T10:30:00.000Z',
  });
  const done = makeSession({ id: 'done-1', status: 'completed' });

  assert.equal(
    resolveActiveTimerCandidate([pausedOld, done, running, pausedNew])?.id,
    'run-1',
  );
  assert.equal(
    resolveActiveTimerCandidate([pausedOld, done, pausedNew])?.id,
    'p-new',
  );
  assert.equal(resolveActiveTimerCandidate([done]), null);

  const otherPaused = getOtherPausedTimerSessions(
    [pausedOld, running, pausedNew, done],
    'run-1',
  );
  assert.deepEqual(
    otherPaused.map((s) => s.id),
    ['p-new', 'p-old'],
  );
});

test('normalizeWorkshopSettings preserves backward compatibility with legacy backups', () => {
  const legacy = {
    id: 'default',
    workshopName: 'Mi Taller Legacy',
    ownerDisplayName: 'Ana',
    currency: 'COP',
    hourlyRateCOP: 18000,
    dailyGoalMinutes: 90,
    weeklyGoalMinutes: 450,
    defaultMarkupPercent: 40,
    isDemo: false,
    version: 3,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  } as unknown as ReturnType<typeof createDefaultWorkshopSettings>;

  const normalized = normalizeWorkshopSettings(legacy);
  assert.equal(normalized.workshopName, 'Mi Taller Legacy');
  assert.equal(normalized.enableBrowserNotifications, false);
  assert.equal(normalized.enableTimerNotifications, true);
  assert.equal(normalized.timerReminderIntervalMinutes, 60);
  assert.equal(normalized.forgottenTimerThresholdMinutes, 180);
  assert.equal(normalized.quietHoursStart, '22:00');
  assert.equal(normalized.quietHoursEnd, '07:00');
});

test('notificationEngine builds active payloads, periodic/forgotten milestones, quiet hours, and cooldowns', () => {
  const proj = makeProject();
  const comp = makeComponent();
  const running = makeSession({ startTime: '2026-05-10T10:00:00.000Z' });

  const activePayload = buildActiveTimerNotificationPayload({
    session: running,
    project: proj,
    component: comp,
    nowMs: Date.parse('2026-05-10T10:45:00.000Z'),
  });
  assert.equal(activePayload.tag, ACTIVE_TIMER_NOTIFICATION_TAG);
  assert.deepEqual(
    activePayload.actions.map((a) => a.action),
    ['pause', 'finish'],
  );
  assert.ok(activePayload.body.includes('00:45:00'));

  const milestone60 = evaluateTimerMilestoneNotification({
    session: running,
    project: proj,
    component: comp,
    settings: {
      enableTimerNotifications: true,
      timerReminderIntervalMinutes: 60,
      forgottenTimerThresholdMinutes: 180,
    },
    lastSentMilestoneKey: null,
    nowMs: Date.parse('2026-05-10T11:05:00.000Z'),
  });
  assert.equal(milestone60.shouldNotify, true);
  assert.equal(milestone60.isForgottenAlert, false);

  const duplicateCheck = evaluateTimerMilestoneNotification({
    session: running,
    project: proj,
    component: comp,
    settings: {
      enableTimerNotifications: true,
      timerReminderIntervalMinutes: 60,
      forgottenTimerThresholdMinutes: 180,
    },
    lastSentMilestoneKey: milestone60.milestoneKey,
    nowMs: Date.parse('2026-05-10T11:10:00.000Z'),
  });
  assert.equal(duplicateCheck.shouldNotify, false);

  const forgotten = evaluateTimerMilestoneNotification({
    session: running,
    project: proj,
    component: comp,
    settings: {
      enableTimerNotifications: true,
      timerReminderIntervalMinutes: 60,
      forgottenTimerThresholdMinutes: 180,
    },
    lastSentMilestoneKey: milestone60.milestoneKey,
    nowMs: Date.parse('2026-05-10T13:10:00.000Z'),
  });
  assert.equal(forgotten.shouldNotify, true);
  assert.equal(forgotten.isForgottenAlert, true);

  // Horario silencioso cruzando medianoche (22:00 - 07:00)
  const quietNight = new Date(2026, 4, 10, 23, 30, 0);
  const quietMorning = new Date(2026, 4, 11, 6, 15, 0);
  const activeDay = new Date(2026, 4, 11, 14, 0, 0);
  assert.equal(
    isWithinQuietHours(
      { quietHoursEnabled: true, quietHoursStart: '22:00', quietHoursEnd: '07:00' },
      quietNight,
    ),
    true,
  );
  assert.equal(
    isWithinQuietHours(
      { quietHoursEnabled: true, quietHoursStart: '22:00', quietHoursEnd: '07:00' },
      quietMorning,
    ),
    true,
  );
  assert.equal(
    isWithinQuietHours(
      { quietHoursEnabled: true, quietHoursStart: '22:00', quietHoursEnd: '07:00' },
      activeDay,
    ),
    false,
  );

  const dispatchLog = { 'alert:a1:overdue': 1000 };
  assert.equal(
    shouldDispatchNotificationWithCooldown({
      dedupeKey: 'alert:a1:overdue',
      dispatchLog,
      cooldownMs: 3600_000,
      nowMs: 1000 + 60_000,
    }),
    false,
  );
  assert.equal(
    shouldDispatchNotificationWithCooldown({
      dedupeKey: 'alert:a1:overdue',
      dispatchLog,
      cooldownMs: 3600_000,
      nowMs: 1000 + 3601_000,
    }),
    true,
  );
});

test('resolveSmartRemindersAndAlerts emits timer, shortage & client alerts and honors category toggles', () => {
  const settings = createDefaultWorkshopSettings();
  const nowDate = new Date('2026-05-15T14:00:00.000Z');

  const client: Client = {
    id: 'client-1',
    ownerId: 'local-workshop',
    syncStatus: 'local_only',
    name: 'Laura Pérez',
    phone: '3001234567',
    email: null,
    address: 'Medellín',
    notes: '',
    isDemo: false,
    version: 1,
    createdAt: '2026-04-01T10:00:00.000Z',
    updatedAt: '2026-04-01T10:00:00.000Z',
  };

  const staleProj = makeProject({
    id: 'proj-1',
    estimatedEndDate: '2026-05-16T12:00:00.000Z',
    updatedAt: '2026-05-01T10:00:00.000Z', // >10 días
  });
  const blockedComp = makeComponent({
    id: 'comp-1',
    status: 'blocked_by_material',
  });
  const forgottenTimer = makeSession({
    id: 'sess-forgotten',
    startTime: '2026-05-15T10:00:00.000Z', // 4h continuas
  });

  const alerts = resolveSmartRemindersAndAlerts({
    settings,
    reminders: [] as Reminder[],
    projects: [staleProj],
    components: [blockedComp],
    workSessions: [forgottenTimer],
    pendingMaterials: [] as PendingMaterial[],
    materials: [] as Material[],
    variants: [] as MaterialVariant[],
    paymentPlans: [] as PaymentPlan[],
    installments: [] as PaymentInstallment[],
    clients: [client],
    nowDate,
  });

  const types = new Set(alerts.map((a) => a.type));
  assert.ok(types.has('timer_reminder'));
  assert.ok(types.has('material_shortage'));
  assert.ok(types.has('client_followup'));
  assert.ok(types.has('delivery_deadline'));

  const timerAlert = alerts.find((a) => a.type === 'timer_reminder')!;
  const osPayload = buildWorkshopAlertNotificationPayload(timerAlert);
  assert.equal(osPayload.data.route, 'timer');

  const mutedAlerts = resolveSmartRemindersAndAlerts({
    settings: {
      ...settings,
      enableTimerNotifications: false,
      enableClientReminders: false,
    },
    reminders: [],
    projects: [staleProj],
    components: [blockedComp],
    workSessions: [forgottenTimer],
    pendingMaterials: [],
    materials: [],
    variants: [],
    paymentPlans: [],
    installments: [],
    clients: [client],
    nowDate,
  });
  const mutedTypes = new Set(mutedAlerts.map((a) => a.type));
  assert.equal(mutedTypes.has('timer_reminder'), false);
  assert.equal(mutedTypes.has('client_followup'), false);
});

import React, { useEffect, useRef } from 'react';
import { useWorkshopData } from '@/src/data/DataContext.tsx';
import {
  ACTIVE_TIMER_NOTIFICATION_TAG,
  buildActiveTimerNotificationPayload,
  buildWorkshopAlertNotificationPayload,
  evaluateTimerMilestoneNotification,
  isWithinQuietHours,
  shouldDispatchNotificationWithCooldown,
  TIMER_REMINDER_NOTIFICATION_TAG,
} from '@/src/domain/services/notificationEngine.ts';
import { resolveSmartRemindersAndAlerts } from '@/src/domain/services/planningService.ts';
import {
  closeNotificationsByTag,
  getNotificationCapabilities,
  playSoftNotificationChime,
  showOrUpdateNotification,
  triggerSafeVibration,
} from '@/src/pwa/notificationBridge.ts';
import type { ModuleRouteId } from '@/src/shared/navigation/routes.ts';
import {
  loadDispatchLog,
  loadNotificationCenterState,
  markNotificationDispatched,
  recordNotificationHistoryEvent,
} from './notificationCenterStore.ts';

interface NotificationOrchestratorProps {
  onNavigateRoute(params: {
    route: ModuleRouteId;
    projectId?: string | null;
    componentId?: string | null;
    confirmFinishSessionId?: string | null;
  }): void;
}

const VALID_ROUTES = new Set<ModuleRouteId>([
  'dashboard',
  'projects',
  'timer',
  'inventory',
  'shopping',
  'quoting',
  'clients',
  'planner',
  'settings',
]);

const URGENT_ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000;

export const NotificationOrchestrator: React.FC<NotificationOrchestratorProps> = ({
  onNavigateRoute,
}) => {
  const {
    isLoading,
    settings,
    activeTimerSession,
    projects,
    components,
    workSessions,
    reminders,
    pendingMaterials,
    materials,
    variants,
    paymentPlans,
    installments,
    clients,
  } = useWorkshopData();

  const lastTimerNotifSignatureRef = useRef<string>('');
  const lastMilestoneKeyRef = useRef<string | null>(null);

  // 1. Escuchar mensajes de deep-link y acciones de confirmación del Service Worker
  useEffect(() => {
    const handleRouteMessage = (raw: unknown) => {
      if (!raw || typeof raw !== 'object') return;
      const data = raw as Record<string, unknown>;
      if (data.type === 'TIMER_OPEN_FINISH_CONFIRM') {
        const sessionId = typeof data.sessionId === 'string' ? data.sessionId : null;
        const projectId = typeof data.projectId === 'string' ? data.projectId : null;
        const componentId =
          typeof data.componentId === 'string' ? data.componentId : null;
        onNavigateRoute({
          route: 'timer',
          projectId,
          componentId,
          confirmFinishSessionId: sessionId,
        });
        return;
      }

      if (data.type === 'NOTIFICATION_NAVIGATE') {
        const rawRoute = typeof data.route === 'string' ? data.route : 'dashboard';
        const route: ModuleRouteId = VALID_ROUTES.has(rawRoute as ModuleRouteId)
          ? (rawRoute as ModuleRouteId)
          : 'dashboard';
        onNavigateRoute({
          route,
          projectId: typeof data.projectId === 'string' ? data.projectId : null,
          componentId: typeof data.componentId === 'string' ? data.componentId : null,
        });
      }
    };

    const handleSwMessage = (event: MessageEvent) => {
      handleRouteMessage(event.data);
    };
    const handleLocalNavigateEvent = (event: Event) => {
      const detail = (event as CustomEvent).detail as Record<string, unknown> | undefined;
      if (!detail) return;
      handleRouteMessage({
        type: 'NOTIFICATION_NAVIGATE',
        ...detail,
      });
    };

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleSwMessage);
    }
    window.addEventListener('crochet:notification-navigate', handleLocalNavigateEvent);

    return () => {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', handleSwMessage);
      }
      window.removeEventListener(
        'crochet:notification-navigate',
        handleLocalNavigateEvent,
      );
    };
  }, [onNavigateRoute]);

  // 2. Sincronizar notificación persistente del cronómetro en transiciones de estado
  useEffect(() => {
    if (isLoading) return;
    const caps = getNotificationCapabilities();
    const browserNotificationsEnabled =
      Boolean(settings.enableBrowserNotifications) &&
      settings.enableTimerNotifications !== false;

    if (!activeTimerSession || !browserNotificationsEnabled) {
      if (lastTimerNotifSignatureRef.current !== 'none') {
        lastTimerNotifSignatureRef.current = 'none';
        void closeNotificationsByTag(ACTIVE_TIMER_NOTIFICATION_TAG);
        void closeNotificationsByTag(TIMER_REMINDER_NOTIFICATION_TAG);
      }
      return;
    }

    const signature = `${activeTimerSession.id}:${activeTimerSession.status}:${activeTimerSession.pauseIntervals.length}`;
    if (signature === lastTimerNotifSignatureRef.current) {
      return;
    }
    lastTimerNotifSignatureRef.current = signature;

    if (!caps.supported || caps.permission !== 'granted') {
      return;
    }

    const project = projects.find((p) => p.id === activeTimerSession.projectId);
    const component = components.find((c) => c.id === activeTimerSession.componentId);
    const payload = buildActiveTimerNotificationPayload({
      session: activeTimerSession,
      project,
      component,
      nowMs: Date.now(),
      renotify: false,
    });

    void showOrUpdateNotification({
      title: payload.title,
      body: payload.body,
      tag: payload.tag,
      renotify: payload.renotify,
      requireInteraction: payload.requireInteraction,
      silent: true,
      actions: payload.actions,
      data: payload.data,
    });
  }, [
    isLoading,
    activeTimerSession,
    projects,
    components,
    settings.enableBrowserNotifications,
    settings.enableTimerNotifications,
  ]);

  // 3. Evaluación periódica de hitos de cronómetro y alertas urgentes del taller
  useEffect(() => {
    if (isLoading) return;

    const evaluateAndDispatch = async () => {
      const nowDate = new Date();
      const nowMs = nowDate.getTime();
      const inQuietHours = isWithinQuietHours(settings, nowDate);
      const caps = getNotificationCapabilities();
      const canDispatchOS =
        caps.supported &&
        caps.permission === 'granted' &&
        Boolean(settings.enableBrowserNotifications);

      // 3a. Evaluar hitos del cronómetro activo (recordatorio periódico / olvidado)
      if (activeTimerSession && activeTimerSession.status === 'running') {
        const project = projects.find((p) => p.id === activeTimerSession.projectId);
        const component = components.find((c) => c.id === activeTimerSession.componentId);
        const milestone = evaluateTimerMilestoneNotification({
          session: activeTimerSession,
          project,
          component,
          settings,
          lastSentMilestoneKey: lastMilestoneKeyRef.current,
          nowMs,
        });

        if (milestone.shouldNotify && milestone.milestoneKey && milestone.payload) {
          const dispatchLog = loadDispatchLog();
          const alreadyLogged = !shouldDispatchNotificationWithCooldown({
            dedupeKey: milestone.milestoneKey,
            dispatchLog,
            cooldownMs: 45 * 60 * 1000,
            nowMs,
          });
          lastMilestoneKeyRef.current = milestone.milestoneKey;

          if (!alreadyLogged) {
            let deliveredToOS = false;
            if (canDispatchOS && !inQuietHours) {
              deliveredToOS = await showOrUpdateNotification({
                title: milestone.payload.title,
                body: milestone.payload.body,
                tag: milestone.payload.tag,
                renotify: true,
                requireInteraction: milestone.isForgottenAlert,
                silent: false,
                actions: milestone.payload.actions,
                data: milestone.payload.data,
              });
            }
            if (!inQuietHours && settings.enableTimerNotifications !== false) {
              if (settings.enableSoundAlerts) playSoftNotificationChime();
              if (settings.enableVibrationAlerts) triggerSafeVibration();
            }
            markNotificationDispatched(milestone.milestoneKey, nowMs);
            recordNotificationHistoryEvent({
              alertId: milestone.milestoneKey,
              type: 'timer_reminder',
              title: milestone.payload.title,
              message: milestone.payload.body.replace('\n', ' · '),
              status: 'sent',
              deliveredToOS,
              route: 'timer',
              projectId: activeTimerSession.projectId,
            });
          }
        }
      }

      // 3b. Evaluar alertas urgentes del taller (entregas, cuotas, compras, stock)
      if (!canDispatchOS || inQuietHours) {
        return;
      }

      const centerState = loadNotificationCenterState();
      const dismissedSet = new Set(centerState.dismissedIds);
      const alerts = resolveSmartRemindersAndAlerts({
        settings,
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
        nowDate,
      }).filter(
        (a) =>
          !a.isCompleted &&
          !a.isRead &&
          !dismissedSet.has(a.id) &&
          a.type !== 'timer_reminder' &&
          (a.urgency === 'overdue' || a.urgency === 'due_soon'),
      );

      const dispatchLog = loadDispatchLog();
      let dispatchedCount = 0;

      for (const alert of alerts) {
        if (dispatchedCount >= 2) break;
        const payload = buildWorkshopAlertNotificationPayload(alert);
        if (
          !shouldDispatchNotificationWithCooldown({
            dedupeKey: payload.dedupeKey,
            dispatchLog,
            cooldownMs: URGENT_ALERT_COOLDOWN_MS,
            nowMs,
          })
        ) {
          continue;
        }

        const delivered = await showOrUpdateNotification({
          title: payload.title,
          body: payload.body,
          tag: payload.tag,
          renotify: false,
          requireInteraction: payload.requireInteraction,
          silent: false,
          data: payload.data,
        });

        markNotificationDispatched(payload.dedupeKey, nowMs);
        recordNotificationHistoryEvent({
          alertId: alert.id,
          type: alert.type,
          title: alert.title,
          message: alert.message,
          status: 'sent',
          deliveredToOS: delivered,
          route: payload.data.route,
          projectId:
            alert.relatedEntityType === 'project' ? alert.relatedEntityId : null,
        });
        dispatchedCount += 1;
      }

      if (dispatchedCount > 0) {
        if (settings.enableSoundAlerts) playSoftNotificationChime();
        if (settings.enableVibrationAlerts) triggerSafeVibration();
      }
    };

    void evaluateAndDispatch();
    const intervalId = window.setInterval(() => {
      void evaluateAndDispatch();
    }, 30_000);

    const handleWake = () => {
      if (document.visibilityState === 'visible') {
        void evaluateAndDispatch();
      }
    };
    document.addEventListener('visibilitychange', handleWake);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleWake);
    };
  }, [
    isLoading,
    settings,
    activeTimerSession,
    projects,
    components,
    workSessions,
    reminders,
    pendingMaterials,
    materials,
    variants,
    paymentPlans,
    installments,
    clients,
  ]);

  return null;
};

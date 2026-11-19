import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { clientsClaim } from 'workbox-core';
import { ExpirationPlugin } from 'workbox-expiration';
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { DB_NAME } from '@/src/data/local/dbSchema.ts';
import type {
  Project,
  ProjectComponent,
  WorkSession,
} from '@/src/domain/models/index.ts';
import {
  buildActiveTimerNotificationPayload,
  ACTIVE_TIMER_NOTIFICATION_TAG,
} from '@/src/domain/services/notificationEngine.ts';
import {
  calculateSessionDurations,
  closeOpenPauseIntervals,
} from '@/src/domain/services/timerEngine.ts';

interface SWClientLike {
  url: string;
  postMessage(message: unknown): void;
  focus?(): Promise<SWClientLike>;
}

interface SWExtendableEventLike extends Event {
  waitUntil(promise: Promise<unknown>): void;
}

interface SWNotificationLike {
  readonly tag: string;
  readonly data: Record<string, unknown> | undefined;
  close(): void;
}

interface SWNotificationEventLike extends SWExtendableEventLike {
  readonly action: string;
  readonly notification: SWNotificationLike;
}

interface SWMessageEventLike extends Event {
  readonly data: unknown;
}

interface SWGlobalScopeLike {
  __WB_MANIFEST: Array<string | { url: string; revision: string | null }>;
  skipWaiting(): Promise<void>;
  clients: {
    matchAll(options?: {
      type?: 'window' | 'worker' | 'sharedworker' | 'all';
      includeUncontrolled?: boolean;
    }): Promise<SWClientLike[]>;
    openWindow?(url: string): Promise<SWClientLike | null>;
  };
  registration: {
    showNotification(
      title: string,
      options?: NotificationOptions & {
        actions?: Array<{ action: string; title: string }>;
        renotify?: boolean;
      },
    ): Promise<void>;
    getNotifications(filter?: { tag?: string }): Promise<SWNotificationLike[]>;
  };
  addEventListener(type: 'install', listener: (event: SWExtendableEventLike) => void): void;
  addEventListener(type: 'message', listener: (event: SWMessageEventLike) => void): void;
  addEventListener(
    type: 'notificationclick',
    listener: (event: SWNotificationEventLike) => void,
  ): void;
}

const swSelf = self as unknown as SWGlobalScopeLike;
const SYNC_CHANNEL_NAME = 'crochet_workshop_sync_v1';

const wbManifest = (self as unknown as SWGlobalScopeLike).__WB_MANIFEST || [];
precacheAndRoute(wbManifest);
cleanupOutdatedCaches();
clientsClaim();

// En producción, permitir navegación offline hacia rutas con query strings (/?route=timer...)
const hasPrecachedIndex =
  Array.isArray(wbManifest) &&
  wbManifest.some((entry) => {
    const url = typeof entry === 'string' ? entry : entry?.url;
    return typeof url === 'string' && url.endsWith('index.html');
  });

if (hasPrecachedIndex) {
  try {
    registerRoute(
      new NavigationRoute(createHandlerBoundToURL('/index.html'), {
        denylist: [/^\/api\//],
      }),
    );
  } catch {
    // Evitar errores en modo desarrollo cuando index.html no está precacheado
  }
}

registerRoute(
  ({ url }) => url.origin === 'https://fonts.googleapis.com',
  new CacheFirst({
    cacheName: 'google-fonts-cache',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 10,
        maxAgeSeconds: 60 * 60 * 24 * 365,
      }),
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
    ],
  }),
);

registerRoute(
  ({ url }) => url.origin === 'https://fonts.gstatic.com',
  new CacheFirst({
    cacheName: 'gstatic-fonts-cache',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 10,
        maxAgeSeconds: 60 * 60 * 24 * 365,
      }),
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
    ],
  }),
);

swSelf.addEventListener('install', () => {
  void swSelf.skipWaiting();
});

swSelf.addEventListener('message', (event) => {
  const data = event.data as Record<string, unknown> | undefined;
  if (!data || typeof data !== 'object') return;

  if (data.type === 'SKIP_WAITING') {
    void swSelf.skipWaiting();
    return;
  }

  if (data.type === 'CLOSE_NOTIFICATIONS_BY_TAG') {
    const tag = typeof data.tag === 'string' ? data.tag : ACTIVE_TIMER_NOTIFICATION_TAG;
    void swSelf.registration.getNotifications({ tag }).then((list) => {
      for (const notif of list) {
        notif.close();
      }
    });
  }
});

function openWorkshopIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME);
    req.onerror = () => reject(req.error ?? new Error('No se pudo abrir IndexedDB.'));
    req.onsuccess = () => resolve(req.result);
  });
}

async function applySwTimerMutation(
  sessionId: string,
  mutation: 'pause' | 'resume',
): Promise<{
  session: WorkSession | null;
  project: Project | null;
  component: ProjectComponent | null;
}> {
  const db = await openWorkshopIdb();
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  return new Promise((resolve, reject) => {
    const storeNames = ['work_sessions', 'projects', 'project_components'];
    const tx = db.transaction(storeNames, 'readwrite');
    const sessionsStore = tx.objectStore('work_sessions');
    const projectsStore = tx.objectStore('projects');
    const componentsStore = tx.objectStore('project_components');

    let updatedSession: WorkSession | null = null;
    let relatedProject: Project | null = null;
    let relatedComponent: ProjectComponent | null = null;

    tx.oncomplete = () => {
      db.close();
      resolve({
        session: updatedSession,
        project: relatedProject,
        component: relatedComponent,
      });
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('Error de transacción en Service Worker.'));
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error('Transacción abortada en Service Worker.'));
    };

    const allReq = sessionsStore.getAll();
    allReq.onsuccess = () => {
      const allSessions = (allReq.result as WorkSession[]) ?? [];
      const target = allSessions.find((s) => s.id === sessionId);
      if (!target || target.status === 'completed') {
        return;
      }

      if (mutation === 'pause') {
        if (target.status === 'paused') {
          updatedSession = target;
        } else {
          const nextIntervals = [
            ...target.pauseIntervals,
            { pausedAt: nowIso, resumedAt: null },
          ];
          const breakdown = calculateSessionDurations(
            { ...target, pauseIntervals: nextIntervals },
            nowMs,
          );
          updatedSession = {
            ...target,
            status: 'paused',
            pauseIntervals: nextIntervals,
            elapsedSeconds: breakdown.elapsedSeconds,
            effectiveSeconds: breakdown.effectiveSeconds,
            version: target.version + 1,
            updatedAt: nowIso,
          };
          sessionsStore.put(updatedSession);
        }
      } else {
        if (target.status === 'running') {
          updatedSession = target;
        } else {
          // Auto-pausar otras sesiones corriendo para mantener exclusividad real
          for (const other of allSessions) {
            if (other.id !== target.id && other.status === 'running') {
              const otherIntervals = [
                ...other.pauseIntervals,
                { pausedAt: nowIso, resumedAt: null },
              ];
              const otherBreakdown = calculateSessionDurations(
                { ...other, pauseIntervals: otherIntervals },
                nowMs,
              );
              sessionsStore.put({
                ...other,
                status: 'paused',
                pauseIntervals: otherIntervals,
                elapsedSeconds: otherBreakdown.elapsedSeconds,
                effectiveSeconds: otherBreakdown.effectiveSeconds,
                version: other.version + 1,
                updatedAt: nowIso,
              });
            }
          }

          const closedIntervals = closeOpenPauseIntervals(target.pauseIntervals, nowIso);
          const breakdown = calculateSessionDurations(
            { ...target, pauseIntervals: closedIntervals },
            nowMs,
          );
          updatedSession = {
            ...target,
            status: 'running',
            pauseIntervals: closedIntervals,
            elapsedSeconds: breakdown.elapsedSeconds,
            effectiveSeconds: breakdown.effectiveSeconds,
            version: target.version + 1,
            updatedAt: nowIso,
          };
          sessionsStore.put(updatedSession);
        }
      }

      const projReq = projectsStore.get(target.projectId);
      projReq.onsuccess = () => {
        relatedProject = (projReq.result as Project | undefined) ?? null;
      };
      const compReq = componentsStore.get(target.componentId);
      compReq.onsuccess = () => {
        relatedComponent = (compReq.result as ProjectComponent | undefined) ?? null;
      };
    };
  });
}

async function notifyAllWorkshopClients(message: Record<string, unknown>): Promise<void> {
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const bc = new BroadcastChannel(SYNC_CHANNEL_NAME);
      bc.postMessage({
        type: 'WORKSHOP_DB_UPDATED',
        scope: 'timer',
        senderId: 'service-worker',
        at: Date.now(),
      });
      bc.close();
    }
  } catch {
    // BroadcastChannel opcional
  }

  const windowClients = await swSelf.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  });
  for (const client of windowClients) {
    client.postMessage(message);
  }
}

async function focusOrOpenWorkshopRoute(
  urlPath: string,
  clientMessage: Record<string, unknown>,
): Promise<void> {
  const windowClients = await swSelf.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  });

  if (windowClients.length > 0) {
    const primary = windowClients[0];
    if (typeof primary.focus === 'function') {
      await primary.focus();
    }
    primary.postMessage(clientMessage);
    return;
  }

  if (typeof swSelf.clients.openWindow === 'function') {
    await swSelf.clients.openWindow(urlPath);
  }
}

swSelf.addEventListener('notificationclick', (event) => {
  const notification = event.notification;
  const action = event.action || '';
  const data = notification.data ?? {};
  const sessionId = typeof data.sessionId === 'string' ? data.sessionId : '';
  const projectId = typeof data.projectId === 'string' ? data.projectId : '';
  const componentId = typeof data.componentId === 'string' ? data.componentId : '';
  const route = typeof data.route === 'string' ? data.route : 'timer';
  const alertId = typeof data.alertId === 'string' ? data.alertId : '';
  const fallbackUrl =
    typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/';

  notification.close();

  if ((action === 'pause' || action === 'resume') && sessionId) {
    event.waitUntil(
      (async () => {
        try {
          const { session, project, component } = await applySwTimerMutation(
            sessionId,
            action,
          );
          if (session && (session.status === 'running' || session.status === 'paused')) {
            const nextPayload = buildActiveTimerNotificationPayload({
              session,
              project,
              component,
              nowMs: Date.now(),
              renotify: false,
            });
            await swSelf.registration.showNotification(nextPayload.title, {
              body: nextPayload.body,
              tag: nextPayload.tag,
              icon: '/pwa-192x192.png',
              badge: '/pwa-192x192.png',
              renotify: nextPayload.renotify,
              requireInteraction: nextPayload.requireInteraction,
              silent: nextPayload.silent,
              actions: nextPayload.actions.map((a) => ({
                action: a.action,
                title: a.title,
              })),
              data: nextPayload.data,
            });
          }
          await notifyAllWorkshopClients({
            type: 'SW_DB_UPDATED',
            scope: 'timer',
            sessionId,
          });
        } catch {
          // Si falla la mutación en frío, abrir la app para recuperación segura
          await focusOrOpenWorkshopRoute(
            `/?route=timer&projectId=${encodeURIComponent(projectId)}&componentId=${encodeURIComponent(componentId)}`,
            {
              type: 'NOTIFICATION_NAVIGATE',
              route: 'timer',
              projectId,
              componentId,
            },
          );
        }
      })(),
    );
    return;
  }

  if (action === 'finish' && sessionId) {
    const finishUrl = `/?route=timer&action=confirm-finish&sessionId=${encodeURIComponent(sessionId)}&projectId=${encodeURIComponent(projectId)}&componentId=${encodeURIComponent(componentId)}`;
    event.waitUntil(
      focusOrOpenWorkshopRoute(finishUrl, {
        type: 'TIMER_OPEN_FINISH_CONFIRM',
        sessionId,
        projectId,
        componentId,
      }),
    );
    return;
  }

  event.waitUntil(
    focusOrOpenWorkshopRoute(fallbackUrl, {
      type: 'NOTIFICATION_NAVIGATE',
      route,
      projectId,
      componentId,
      alertId,
    }),
  );
});

import { useEffect, useState } from 'react';
import type { ReminderType } from '@/src/domain/models/index.ts';
import {
  broadcastWorkshopSync,
  subscribeWorkshopSync,
} from '@/src/shared/utils/workshopSyncBus.ts';

const NOTIFICATION_CENTER_STORAGE_KEY = 'crochet_notification_center_v1';
const NOTIFICATION_DISPATCH_LOG_KEY = 'crochet_notif_dispatch_log_v1';
const MAX_HISTORY_ITEMS = 100;
const HISTORY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export type NotificationHistoryStatus =
  | 'sent'
  | 'read'
  | 'snoozed'
  | 'completed'
  | 'dismissed';

export interface NotificationHistoryItem {
  readonly id: string;
  readonly alertId: string;
  readonly type: ReminderType | 'system';
  readonly title: string;
  readonly message: string;
  readonly createdAt: string;
  readonly status: NotificationHistoryStatus;
  readonly deliveredToOS: boolean;
  readonly route?: string;
  readonly projectId?: string | null;
}

export interface NotificationCenterState {
  readonly readIds: string[];
  readonly dismissedIds: string[];
  readonly history: NotificationHistoryItem[];
}

const DEFAULT_STATE: NotificationCenterState = {
  readIds: [],
  dismissedIds: [],
  history: [],
};

const localListeners = new Set<() => void>();

function notifyAllLocalSubscribers() {
  for (const listener of localListeners) {
    listener();
  }
}

export function loadNotificationCenterState(): NotificationCenterState {
  if (typeof window === 'undefined') return DEFAULT_STATE;
  try {
    const raw = window.localStorage.getItem(NOTIFICATION_CENTER_STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<NotificationCenterState>;
    const cutoff = Date.now() - HISTORY_RETENTION_MS;
    const history = Array.isArray(parsed.history)
      ? parsed.history
          .filter(
            (item): item is NotificationHistoryItem =>
              Boolean(item) &&
              typeof item.id === 'string' &&
              typeof item.title === 'string' &&
              Date.parse(item.createdAt ?? '') >= cutoff,
          )
          .slice(0, MAX_HISTORY_ITEMS)
      : [];

    return {
      readIds: Array.isArray(parsed.readIds)
        ? parsed.readIds.filter((v): v is string => typeof v === 'string').slice(-300)
        : [],
      dismissedIds: Array.isArray(parsed.dismissedIds)
        ? parsed.dismissedIds
            .filter((v): v is string => typeof v === 'string')
            .slice(-300)
        : [],
      history,
    };
  } catch {
    return DEFAULT_STATE;
  }
}

function saveNotificationCenterState(state: NotificationCenterState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      NOTIFICATION_CENTER_STORAGE_KEY,
      JSON.stringify(state),
    );
  } catch {
    // Ignorar error de cuota
  }
  notifyAllLocalSubscribers();
  broadcastWorkshopSync('NOTIFICATIONS_CENTER_UPDATED', 'notifications');
}

export function markAlertsAsReadInCenter(alertIds: string[]): void {
  if (alertIds.length === 0) return;
  const current = loadNotificationCenterState();
  const nextRead = new Set(current.readIds);
  let changed = false;
  for (const id of alertIds) {
    if (!nextRead.has(id)) {
      nextRead.add(id);
      changed = true;
    }
  }
  if (!changed) return;

  const idSet = new Set(alertIds);
  const nextHistory = current.history.map((h) =>
    idSet.has(h.alertId) && h.status === 'sent'
      ? { ...h, status: 'read' as const }
      : h,
  );
  saveNotificationCenterState({
    ...current,
    readIds: Array.from(nextRead),
    history: nextHistory,
  });
}

export function dismissAlertInCenter(
  alert: Pick<NotificationHistoryItem, 'alertId' | 'type' | 'title' | 'message'>,
): void {
  const current = loadNotificationCenterState();
  const nextDismissed = Array.from(new Set([...current.dismissedIds, alert.alertId]));
  const nextRead = Array.from(new Set([...current.readIds, alert.alertId]));
  const entry: NotificationHistoryItem = {
    id: `hist_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    alertId: alert.alertId,
    type: alert.type,
    title: alert.title,
    message: alert.message,
    createdAt: new Date().toISOString(),
    status: 'dismissed',
    deliveredToOS: false,
  };
  saveNotificationCenterState({
    readIds: nextRead,
    dismissedIds: nextDismissed,
    history: [entry, ...current.history].slice(0, MAX_HISTORY_ITEMS),
  });
}

export function restoreDismissedAlertsInCenter(): void {
  const current = loadNotificationCenterState();
  if (current.dismissedIds.length === 0) return;
  saveNotificationCenterState({
    ...current,
    dismissedIds: [],
  });
}

export function recordNotificationHistoryEvent(
  item: Omit<NotificationHistoryItem, 'id' | 'createdAt'>,
): void {
  const current = loadNotificationCenterState();
  // Evitar duplicar exactamente el mismo evento en un intervalo menor a 2 minutos
  const duplicateRecent = current.history.find(
    (h) =>
      h.alertId === item.alertId &&
      h.status === item.status &&
      Date.now() - Date.parse(h.createdAt) < 120_000,
  );
  if (duplicateRecent) return;

  const entry: NotificationHistoryItem = {
    ...item,
    id: `hist_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
  };

  saveNotificationCenterState({
    ...current,
    history: [entry, ...current.history].slice(0, MAX_HISTORY_ITEMS),
  });
}

export function clearNotificationHistory(): void {
  const current = loadNotificationCenterState();
  saveNotificationCenterState({
    ...current,
    history: [],
  });
}

export function loadDispatchLog(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(NOTIFICATION_DISPATCH_LOG_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const now = Date.now();
    const cleaned: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v) && now - v < 7 * 24 * 3600 * 1000) {
        cleaned[k] = v;
      }
    }
    return cleaned;
  } catch {
    return {};
  }
}

export function markNotificationDispatched(dedupeKey: string, atMs: number = Date.now()): void {
  if (typeof window === 'undefined') return;
  const current = loadDispatchLog();
  current[dedupeKey] = atMs;
  try {
    window.localStorage.setItem(NOTIFICATION_DISPATCH_LOG_KEY, JSON.stringify(current));
  } catch {
    // Ignorar error de cuota
  }
}

export function useNotificationCenterState(): NotificationCenterState {
  const [state, setState] = useState<NotificationCenterState>(() =>
    loadNotificationCenterState(),
  );

  useEffect(() => {
    const reload = () => setState(loadNotificationCenterState());
    localListeners.add(reload);

    const handleStorage = (event: StorageEvent) => {
      if (event.key === NOTIFICATION_CENTER_STORAGE_KEY) {
        reload();
      }
    };
    window.addEventListener('storage', handleStorage);

    const unsubSync = subscribeWorkshopSync((msg) => {
      if (msg.type === 'NOTIFICATIONS_CENTER_UPDATED') {
        reload();
      }
    });

    return () => {
      localListeners.delete(reload);
      window.removeEventListener('storage', handleStorage);
      unsubSync();
    };
  }, []);

  return state;
}

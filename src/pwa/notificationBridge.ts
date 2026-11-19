import type { NotificationActionDescriptor } from '@/src/domain/services/notificationEngine.ts';

export type NotificationPermissionState = NotificationPermission | 'unsupported';

export interface NotificationCapabilities {
  readonly supported: boolean;
  readonly permission: NotificationPermissionState;
  readonly hasServiceWorker: boolean;
  readonly supportsActions: boolean;
  readonly maxActions: number;
}

export interface DispatchNotificationOptions {
  readonly title: string;
  readonly body: string;
  readonly tag: string;
  readonly renotify?: boolean;
  readonly requireInteraction?: boolean;
  readonly silent?: boolean;
  readonly actions?: NotificationActionDescriptor[];
  readonly data?: Record<string, unknown>;
}

export function getNotificationCapabilities(): NotificationCapabilities {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return {
      supported: false,
      permission: 'unsupported',
      hasServiceWorker: false,
      supportsActions: false,
      maxActions: 0,
    };
  }

  const maxActionsRaw = (Notification as unknown as { maxActions?: number }).maxActions;
  const maxActions =
    typeof maxActionsRaw === 'number' && Number.isFinite(maxActionsRaw)
      ? Math.max(0, maxActionsRaw)
      : 0;
  const hasServiceWorker = 'serviceWorker' in navigator;

  return {
    supported: true,
    permission: Notification.permission,
    hasServiceWorker,
    supportsActions: hasServiceWorker && maxActions > 0,
    maxActions,
  };
}

export async function requestNotificationPermissionExplicitly(): Promise<NotificationPermissionState> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  if (Notification.permission === 'granted' || Notification.permission === 'denied') {
    return Notification.permission;
  }

  try {
    const result = await new Promise<NotificationPermission>((resolve) => {
      const maybePromise = Notification.requestPermission((legacyPerm) => {
        resolve(legacyPerm);
      });
      if (maybePromise && typeof maybePromise.then === 'function') {
        void maybePromise.then(resolve);
      }
    });
    return result;
  } catch {
    return Notification.permission ?? 'default';
  }
}

async function getReadyServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }
  try {
    const existing = await navigator.serviceWorker.getRegistration();
    if (!existing) return null;
    const ready = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 1500)),
    ]);
    return ready ?? existing;
  } catch {
    return null;
  }
}

export async function showOrUpdateNotification(
  options: DispatchNotificationOptions,
): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return false;
  }
  if (Notification.permission !== 'granted') {
    return false;
  }

  const capabilities = getNotificationCapabilities();
  const registration = await getReadyServiceWorkerRegistration();

  if (registration && typeof registration.showNotification === 'function') {
    try {
      const safeActions =
        capabilities.supportsActions && options.actions && options.actions.length > 0
          ? options.actions.slice(0, Math.max(1, capabilities.maxActions)).map((a) => ({
              action: a.action,
              title: a.title,
            }))
          : undefined;

      const swOptions: NotificationOptions & {
        actions?: Array<{ action: string; title: string }>;
        renotify?: boolean;
      } = {
        body: options.body,
        tag: options.tag,
        icon: '/pwa-192x192.png',
        badge: '/pwa-192x192.png',
        renotify: Boolean(options.renotify),
        requireInteraction: Boolean(options.requireInteraction),
        silent: options.silent ?? false,
        data: options.data,
      };
      if (safeActions && safeActions.length > 0) {
        swOptions.actions = safeActions;
      }

      try {
        await registration.showNotification(options.title, swOptions);
        return true;
      } catch {
        if (swOptions.actions) {
          const { actions: _ignored, ...withoutActions } = swOptions;
          await registration.showNotification(options.title, withoutActions);
          return true;
        }
        throw new Error('SW showNotification failed');
      }
    } catch {
      // Continuar con fallback de Notification API en escritorio si aplica
    }
  }

  // Fallback seguro para escritorio sin SW activo (en Android Chrome suele lanzar excepción)
  try {
    const notif = new Notification(options.title, {
      body: options.body,
      tag: options.tag,
      icon: '/pwa-192x192.png',
      silent: options.silent ?? false,
      data: options.data,
    });
    notif.onclick = () => {
      window.focus();
      const targetUrl =
        options.data && typeof options.data.url === 'string' ? options.data.url : '/';
      window.dispatchEvent(
        new CustomEvent('crochet:notification-navigate', {
          detail: {
            url: targetUrl,
            ...(options.data ?? {}),
          },
        }),
      );
      notif.close();
    };
    return true;
  } catch {
    return false;
  }
}

export async function closeNotificationsByTag(tag: string): Promise<void> {
  if (
    typeof window === 'undefined' ||
    !('Notification' in window) ||
    Notification.permission !== 'granted'
  ) {
    return;
  }
  const registration = await getReadyServiceWorkerRegistration();
  if (!registration || typeof registration.getNotifications !== 'function') {
    return;
  }
  try {
    const notifications = await registration.getNotifications({ tag });
    for (const notif of notifications) {
      notif.close();
    }
  } catch {
    // Ignorar errores de cierre en plataformas restrictivas
  }
}

export function playSoftNotificationChime(): void {
  if (typeof window === 'undefined') return;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return;

  try {
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const notes = [587.33, 880]; // D5 -> A5 acorde suave y discreto
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.12);
      gain.gain.setValueAtTime(0.001, now + idx * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.08, now + idx * 0.12 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.12 + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.12);
      osc.stop(now + idx * 0.12 + 0.36);
    });

    window.setTimeout(() => {
      void ctx.close().catch(() => {});
    }, 900);
  } catch {
    // El navegador puede bloquear AudioContext sin gesto previo
  }
}

export function triggerSafeVibration(): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
    return;
  }
  try {
    navigator.vibrate([110, 55, 110]);
  } catch {
    // Ignorar en dispositivos que no permiten vibración
  }
}

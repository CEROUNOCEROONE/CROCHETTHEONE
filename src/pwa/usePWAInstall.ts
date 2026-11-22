import { useSyncExternalStore } from 'react';

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export type PWAInstallOutcome = 'accepted' | 'dismissed' | null;

export interface PWAInstallSnapshot {
  readonly isInstallable: boolean;
  readonly isInstalled: boolean;
  readonly isIOS: boolean;
  readonly isPrompting: boolean;
  readonly lastOutcome: PWAInstallOutcome;
}

interface MediaQueryListLike {
  readonly matches: boolean;
  addEventListener?: (
    type: 'change',
    listener: (event: MediaQueryListEvent) => void,
  ) => void;
  removeEventListener?: (
    type: 'change',
    listener: (event: MediaQueryListEvent) => void,
  ) => void;
  addListener?: (listener: (event: MediaQueryListEvent) => void) => void;
  removeListener?: (listener: (event: MediaQueryListEvent) => void) => void;
}

export interface PWAInstallEnvironment {
  readonly win: {
    addEventListener: (type: string, listener: EventListener) => void;
    removeEventListener: (type: string, listener: EventListener) => void;
    matchMedia?: (query: string) => MediaQueryListLike;
  };
  readonly nav: {
    readonly userAgent?: string;
    readonly platform?: string;
    readonly maxTouchPoints?: number;
    readonly standalone?: boolean;
  };
}

export interface PWAInstallController {
  readonly getSnapshot: () => PWAInstallSnapshot;
  readonly getServerSnapshot: () => PWAInstallSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly install: () => Promise<boolean>;
}

const SERVER_SNAPSHOT: PWAInstallSnapshot = Object.freeze({
  isInstallable: false,
  isInstalled: false,
  isIOS: false,
  isPrompting: false,
  lastOutcome: null,
});

function detectStandalone(env: PWAInstallEnvironment | null): boolean {
  if (!env) return false;
  const mediaMatches =
    typeof env.win.matchMedia === 'function'
      ? env.win.matchMedia('(display-mode: standalone)').matches === true
      : false;
  return mediaMatches || env.nav.standalone === true;
}

function detectIOS(env: PWAInstallEnvironment | null): boolean {
  if (!env) return false;
  const userAgent = (env.nav.userAgent ?? '').toLowerCase();
  if (/iphone|ipad|ipod/.test(userAgent)) {
    return true;
  }
  const maxTouchPoints = env.nav.maxTouchPoints ?? 0;
  const isIPadOSDesktopUA =
    (env.nav.platform === 'MacIntel' || userAgent.includes('macintosh')) &&
    maxTouchPoints > 1;
  return isIPadOSDesktopUA;
}

export function createPWAInstallController(
  env: PWAInstallEnvironment | null,
): PWAInstallController {
  let deferredPrompt: BeforeInstallPromptEvent | null = null;
  let state: PWAInstallSnapshot = env
    ? Object.freeze({
        isInstallable: false,
        isInstalled: detectStandalone(env),
        isIOS: detectIOS(env),
        isPrompting: false,
        lastOutcome: null,
      })
    : SERVER_SNAPSHOT;

  const listeners = new Set<() => void>();
  let isAttached = false;
  let standaloneMediaQuery: MediaQueryListLike | null = null;

  const emit = () => {
    listeners.forEach((listener) => listener());
  };

  const setState = (patch: Partial<PWAInstallSnapshot>) => {
    const next: PWAInstallSnapshot = Object.freeze({
      ...state,
      ...patch,
    });
    if (
      next.isInstallable === state.isInstallable &&
      next.isInstalled === state.isInstalled &&
      next.isIOS === state.isIOS &&
      next.isPrompting === state.isPrompting &&
      next.lastOutcome === state.lastOutcome
    ) {
      return;
    }
    state = next;
    emit();
  };

  const handleBeforeInstallPrompt: EventListener = (event) => {
    event.preventDefault();
    if (state.isInstalled) {
      deferredPrompt = null;
      setState({ isInstallable: false });
      return;
    }
    deferredPrompt = event as BeforeInstallPromptEvent;
    setState({ isInstallable: true });
  };

  const handleAppInstalled: EventListener = () => {
    deferredPrompt = null;
    setState({
      isInstallable: false,
      isInstalled: true,
      isPrompting: false,
      lastOutcome: 'accepted',
    });
  };

  const handleDisplayModeChange = (event: MediaQueryListEvent) => {
    if (event.matches) {
      deferredPrompt = null;
      setState({
        isInstallable: false,
        isInstalled: true,
        isPrompting: false,
      });
    }
  };

  const attach = () => {
    if (!env || isAttached) return;
    isAttached = true;

    const standalone = detectStandalone(env);
    const ios = detectIOS(env);
    if (standalone) {
      deferredPrompt = null;
    }
    setState({
      isInstalled: standalone || state.isInstalled,
      isIOS: ios,
      isInstallable: standalone ? false : Boolean(deferredPrompt),
    });

    env.win.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    env.win.addEventListener('appinstalled', handleAppInstalled);

    if (typeof env.win.matchMedia === 'function') {
      standaloneMediaQuery = env.win.matchMedia('(display-mode: standalone)');
      if (typeof standaloneMediaQuery.addEventListener === 'function') {
        standaloneMediaQuery.addEventListener('change', handleDisplayModeChange);
      } else if (typeof standaloneMediaQuery.addListener === 'function') {
        standaloneMediaQuery.addListener(handleDisplayModeChange);
      }
    }
  };

  const detach = () => {
    if (!env || !isAttached) return;
    isAttached = false;

    env.win.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    env.win.removeEventListener('appinstalled', handleAppInstalled);

    if (standaloneMediaQuery) {
      if (typeof standaloneMediaQuery.removeEventListener === 'function') {
        standaloneMediaQuery.removeEventListener('change', handleDisplayModeChange);
      } else if (typeof standaloneMediaQuery.removeListener === 'function') {
        standaloneMediaQuery.removeListener(handleDisplayModeChange);
      }
      standaloneMediaQuery = null;
    }
  };

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    if (listeners.size === 1) {
      attach();
    }
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        detach();
      }
    };
  };

  const install = async (): Promise<boolean> => {
    if (state.isPrompting || state.isInstalled || !deferredPrompt) {
      return false;
    }

    // BeforeInstallPromptEvent es de un solo uso: consumir y limpiar la referencia
    // inmediatamente antes de esperar el diálogo para evitar reutilizar eventos vencidos.
    const promptEvent = deferredPrompt;
    deferredPrompt = null;
    setState({
      isInstallable: false,
      isPrompting: true,
    });

    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      const accepted = choice?.outcome === 'accepted';
      setState({
        isPrompting: false,
        isInstallable: !state.isInstalled && Boolean(deferredPrompt),
        lastOutcome: accepted ? 'accepted' : 'dismissed',
      });
      return accepted;
    } catch {
      setState({
        isPrompting: false,
        isInstallable: !state.isInstalled && Boolean(deferredPrompt),
      });
      return false;
    }
  };

  return {
    getSnapshot: () => state,
    getServerSnapshot: () => SERVER_SNAPSHOT,
    subscribe,
    install,
  };
}

let defaultController: PWAInstallController | null = null;

function getDefaultController(): PWAInstallController {
  if (!defaultController) {
    const env: PWAInstallEnvironment | null =
      typeof window !== 'undefined' && typeof navigator !== 'undefined'
        ? {
            win: window,
            nav: navigator as PWAInstallEnvironment['nav'],
          }
        : null;
    defaultController = createPWAInstallController(env);
  }
  return defaultController;
}

export function usePWAInstall() {
  const controller = getDefaultController();
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getServerSnapshot,
  );

  return {
    isInstallable: snapshot.isInstallable,
    isInstalled: snapshot.isInstalled,
    isIOS: snapshot.isIOS,
    isPrompting: snapshot.isPrompting,
    lastOutcome: snapshot.lastOutcome,
    install: controller.install,
  };
}
